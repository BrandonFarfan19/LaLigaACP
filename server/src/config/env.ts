import { z } from 'zod';
import { loadRootEnvFile } from './load-root-env.js';

/**
 * Typed, validated configuration — read once at startup (NFR-005: no
 * business rule, including "is the app configured at all", depends only on
 * the frontend). Every other module imports `env` from here; nothing else in
 * the codebase reads `process.env` directly.
 *
 * Reuses the variables `compose.yaml` already defines for the `db` service
 * (`MYSQL_USER`, `MYSQL_PASSWORD`, `MYSQL_DATABASE`) instead of duplicating
 * them under new names. `DB_HOST`/`DB_PORT` are new: they say where the
 * *backend* should dial MySQL, which differs between running on the host
 * (`127.0.0.1` + the port `db` publishes) and running as a compose service
 * (the internal network alias `db` + MySQL's own fixed port 3306) — see
 * `compose.yaml` and `.env.example`.
 */
const schema = z.object({
	NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
	PORT: z.coerce.number().int().positive().default(3001),
	CORS_ORIGIN: z.url(),
	DB_HOST: z.string().min(1),
	DB_PORT: z.coerce.number().int().positive(),
	MYSQL_USER: z.string().min(1),
	MYSQL_PASSWORD: z.string().min(1),
	MYSQL_DATABASE: z.string().min(1),
	// Only used when NODE_ENV=test (see resolveDatabaseName below). Never the
	// database real traffic touches.
	MYSQL_DATABASE_TEST: z.string().min(1).default('la_liga_acp_test'),
	DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
	RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
	RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
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
	};
}

loadRootEnvFile();

/** The process fails to start right here if the environment is incomplete. */
export const env: Env = parseEnv(process.env);
