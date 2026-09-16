import { isIP } from 'node:net';
import { z } from 'zod';
import { loadRootEnvFile } from './load-root-env.js';

/**
 * Values that only prove someone copied .env.example (or typed a
 * placeholder) without generating a real secret.
 */
const PLACEHOLDER_SECRET = /cambiar|changeme|change[-_ ]?me|ejemplo|example|placeholder|secret|secreto|password|contrase/i;

function checkSessionSecret(value: string, ctx: z.RefinementCtx): void {
	if (PLACEHOLDER_SECRET.test(value)) {
		ctx.addIssue({ code: 'custom', message: 'es un valor de ejemplo: generá uno propio (openssl rand -base64 48)' });
	} else if (new Set(value).size < 12) {
		ctx.addIssue({ code: 'custom', message: 'tiene muy pocos caracteres distintos para ser aleatorio' });
	}
}

/** Express's `trust proxy` value: `false`, a hop count, or named ranges / IPs / CIDRs. */
export type TrustProxy = false | number | string[];

const NAMED_RANGES = new Set(['loopback', 'linklocal', 'uniquelocal']);

function isCidr(entry: string): boolean {
	const [ip, prefix, ...rest] = entry.split('/');
	const version = isIP(ip ?? '');
	if (!version || rest.length > 0) return false;
	if (prefix === undefined) return true;
	const bits = Number(prefix);
	return /^\d+$/.test(prefix) && bits <= (version === 4 ? 32 : 128);
}

/**
 * `true` is rejected on purpose: it trusts X-Forwarded-For from anyone, so
 * any client could pick its own IP and dodge the rate limits.
 */
function parseTrustProxy(raw: string, ctx: z.RefinementCtx): TrustProxy {
	const value = raw.trim().toLowerCase();
	if (value === '' || value === 'false' || value === '0') return false;
	if (/^\d+$/.test(value)) return Number(value);
	if (value === 'true') {
		ctx.addIssue({
			code: 'custom',
			message: 'true no se acepta (cualquiera podría falsear su IP): usá la cantidad de proxies (1) o sus IPs/rangos',
		});
		return z.NEVER;
	}
	const entries = value.split(',').map((entry) => entry.trim());
	const invalid = entries.filter((entry) => !NAMED_RANGES.has(entry) && !isCidr(entry));
	if (invalid.length > 0) {
		ctx.addIssue({ code: 'custom', message: `valores no válidos: ${invalid.join(', ')}` });
		return z.NEVER;
	}
	return entries;
}

/**
 * Typed, validated configuration — read once at startup (NFR-005: no
 * business rule, including "is the app configured at all", depends only on
 * the frontend). Every other module gets its `Env` from `loadEnv()`; nothing
 * else in the codebase reads `process.env` directly.
 *
 * Reuses the variables `compose.yaml` already defines for the `db` service
 * (`MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`) instead of duplicating
 * them under new names. `DB_HOST`/`DB_PORT` are new: they say where the
 * *backend* should dial MySQL, which differs between running on the host
 * (`127.0.0.1` + the port `db` publishes) and running as a compose service
 * (the internal network alias `db` + MySQL's own fixed port 3306) — see
 * `compose.yaml` and `.env.example`.
 */
/**
 * Longest window a rate limiter accepts: it's a Node timer, and a delay above
 * 2^31 - 1 ms (about 24.8 days) is silently treated as 1 ms by setTimeout,
 * which would turn the limit off.
 */
const MAX_WINDOW_MS = 2_147_483_647;
const windowMs = (defaultMs: number) =>
	z.coerce.number().int().positive().max(MAX_WINDOW_MS, `como máximo ${MAX_WINDOW_MS} ms (unos 24 días)`).default(defaultMs);
/** Requests per window: at least 1, and a sane ceiling that still means "limited". */
const maxRequests = (defaultMax: number) => z.coerce.number().int().positive().max(1_000_000).default(defaultMax);
const port = z.coerce.number().int().min(1).max(65_535);

const schema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		PORT: port.default(3001),
		CORS_ORIGIN: z.url(),
		DB_HOST: z.string().min(1),
		DB_PORT: port,
		MYSQL_USER: z.string().min(1),
		MYSQL_PASSWORD: z.string().min(1),
		MYSQL_DATABASE: z.string().min(1),
		// Only used when NODE_ENV=test (see resolveDatabaseName below). Never the
		// database real traffic touches. The test setup drops and recreates it by
		// name, so it must be a plain identifier.
		MYSQL_DATABASE_TEST: z
			.string()
			.regex(/^[A-Za-z0-9_]+$/, 'solo letras, números y guion bajo')
			.default('la_liga_acp_test'),
		DB_POOL_SIZE: z.coerce.number().int().positive().max(1000).default(10),
		RATE_LIMIT_WINDOW_MS: windowMs(15 * 60 * 1000),
		RATE_LIMIT_MAX: maxRequests(100),
		// Signs the CSRF tokens (lib/csrf.ts). Rotating it invalidates every
		// outstanding CSRF token, not the sessions themselves.
		SESSION_SECRET: z
			.string()
			.min(32, 'mínimo 32 caracteres (generalo con: openssl rand -base64 48)')
			.superRefine(checkSessionSecret),
		SESSION_TTL_HOURS: z.coerce.number().int().positive().max(24 * 30).default(12),
		// Failed login attempts per IP + email, stricter than the global limit.
		LOGIN_RATE_LIMIT_WINDOW_MS: windowMs(15 * 60 * 1000),
		LOGIN_RATE_LIMIT_MAX: maxRequests(5),
		// New accounts per IP (BR-003), counting every attempt.
		REGISTER_RATE_LIMIT_WINDOW_MS: windowMs(60 * 60 * 1000),
		REGISTER_RATE_LIMIT_MAX: maxRequests(10),
		// Public read-only API (T-08), per IP: its own, roomier limit instead of the global one.
		PUBLIC_RATE_LIMIT_WINDOW_MS: windowMs(60 * 1000),
		PUBLIC_RATE_LIMIT_MAX: maxRequests(120),
		// Off by default: req.ip is the socket's address. See parseTrustProxy.
		TRUST_PROXY: z.string().default('false').transform(parseTrustProxy),
	})
	// The test suite empties and recreates MYSQL_DATABASE_TEST: if it were the
	// real database, `npm test` would wipe it.
	.refine((raw) => raw.MYSQL_DATABASE_TEST !== raw.MYSQL_DATABASE, {
		path: ['MYSQL_DATABASE_TEST'],
		message: 'no puede ser igual a MYSQL_DATABASE (las pruebas borran esa base)',
	});

export interface Env {
	readonly nodeEnv: 'development' | 'test' | 'production';
	readonly port: number;
	readonly corsOrigin: string;
	readonly db: {
		readonly host: string;
		readonly port: number;
		readonly user: string;
		readonly password: string;
		readonly database: string;
		readonly poolSize: number;
	};
	readonly rateLimit: {
		readonly windowMs: number;
		readonly max: number;
	};
	readonly loginRateLimit: {
		readonly windowMs: number;
		readonly max: number;
	};
	readonly publicRateLimit: {
		readonly windowMs: number;
		readonly max: number;
	};
	readonly registerRateLimit: {
		readonly windowMs: number;
		readonly max: number;
	};
	/** Applied as Express's `trust proxy` setting in app.ts. */
	readonly trustProxy: TrustProxy;
	readonly session: {
		readonly secret: string;
		readonly ttlMs: number;
		/** `__Host-` prefix in production: the browser then enforces Secure, Path=/ and no Domain. */
		readonly cookieName: string;
		/** Secure cookie only in production: local development runs on plain http. */
		readonly secureCookie: boolean;
	};
}

export class ConfigError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ConfigError';
	}
}

function resolveDatabaseName(raw: z.infer<typeof schema>): string {
	// Tests run against their own database (see tests/global-setup.ts), never
	// the one with real data — matches the project's "recreate from scratch"
	// approach to the dev database, one level down.
	return raw.NODE_ENV === 'test' ? raw.MYSQL_DATABASE_TEST : raw.MYSQL_DATABASE;
}

/**
 * Pure by design (takes the env object instead of reading `process.env`
 * itself) so it's trivial to unit-test with a deliberately incomplete
 * environment, without mutating the real `process.env` — see
 * `tests/env.test.ts`.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
	const result = schema.safeParse(source);
	if (!result.success) {
		const issues = result.error.issues
			.map((issue) => `  - ${issue.path.join('.') || '(sin nombre)'}: ${issue.message}`)
			.join('\n');
		throw new ConfigError(
			`Configuración inválida: revisá estas variables de entorno (copiá .env.example a .env si falta el archivo):\n${issues}`,
		);
	}

	const raw = result.data;
	return {
		nodeEnv: raw.NODE_ENV,
		port: raw.PORT,
		corsOrigin: raw.CORS_ORIGIN,
		db: {
			host: raw.DB_HOST,
			port: raw.DB_PORT,
			user: raw.MYSQL_USER,
			password: raw.MYSQL_PASSWORD,
			database: resolveDatabaseName(raw),
			poolSize: raw.DB_POOL_SIZE,
		},
		rateLimit: {
			windowMs: raw.RATE_LIMIT_WINDOW_MS,
			max: raw.RATE_LIMIT_MAX,
		},
		loginRateLimit: {
			windowMs: raw.LOGIN_RATE_LIMIT_WINDOW_MS,
			max: raw.LOGIN_RATE_LIMIT_MAX,
		},
		publicRateLimit: {
			windowMs: raw.PUBLIC_RATE_LIMIT_WINDOW_MS,
			max: raw.PUBLIC_RATE_LIMIT_MAX,
		},
		registerRateLimit: {
			windowMs: raw.REGISTER_RATE_LIMIT_WINDOW_MS,
			max: raw.REGISTER_RATE_LIMIT_MAX,
		},
		trustProxy: raw.TRUST_PROXY,
		session: {
			secret: raw.SESSION_SECRET,
			ttlMs: raw.SESSION_TTL_HOURS * 60 * 60 * 1000,
			cookieName: raw.NODE_ENV === 'production' ? '__Host-liga_sid' : 'liga_sid',
			secureCookie: raw.NODE_ENV === 'production',
		},
	};
}

/**
 * Loads the root `.env` and validates the process environment. Throws
 * `ConfigError` when it's incomplete — `index.ts` turns that into a clear
 * message and exit code 1 instead of an uncaught exception.
 */
export function loadEnv(): Env {
	loadRootEnvFile();
	return parseEnv(process.env);
}
