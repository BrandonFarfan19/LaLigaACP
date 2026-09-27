import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseEnv } from '../src/config/env.js';

describe('parseEnv', () => {
	it('starts from a fully-populated environment without throwing', () => {
		expect(() => parseEnv(process.env)).not.toThrow();
	});

	it('fails clearly, naming the missing variable, when one is absent', () => {
		const incomplete = { ...process.env };
		delete incomplete.CORS_ORIGIN;

		expect(() => parseEnv(incomplete)).toThrow(ConfigError);
		expect(() => parseEnv(incomplete)).toThrow(/CORS_ORIGIN/);
	});

	it('fails clearly when a variable has the wrong shape', () => {
		const invalid = { ...process.env, DB_PORT: 'not-a-number' };

		expect(() => parseEnv(invalid)).toThrow(/DB_PORT/);
	});

	it('reports every missing variable at once, not just the first', () => {
		const incomplete = { ...process.env };
		delete incomplete.CORS_ORIGIN;
		delete incomplete.DB_HOST;

		try {
			parseEnv(incomplete);
			expect.unreachable('parseEnv debía lanzar');
		} catch (error) {
			expect(String(error)).toMatch(/CORS_ORIGIN/);
			expect(String(error)).toMatch(/DB_HOST/);
		}
	});

	it.each([
		['https://acpleague2026.grupoacp.com.pe/', 'https://acpleague2026.grupoacp.com.pe'],
		['  https://ACPLeague2026.GrupoACP.com.pe  ', 'https://acpleague2026.grupoacp.com.pe'],
		['https://acpleague2026.grupoacp.com.pe:443', 'https://acpleague2026.grupoacp.com.pe'],
		['http://localhost:5173/', 'http://localhost:5173'],
	])('reduces CORS_ORIGIN %j to the Origin a browser sends', (value, expected) => {
		expect(parseEnv({ ...process.env, CORS_ORIGIN: value }).corsOrigin).toBe(expected);
	});

	it.each([
		['a path', 'https://acpleague2026.grupoacp.com.pe/app'],
		['a query', 'https://acpleague2026.grupoacp.com.pe/?x=1'],
		['credentials', 'https://user:pass@acpleague2026.grupoacp.com.pe'],
		['another scheme', 'ftp://acpleague2026.grupoacp.com.pe'],
		['no URL', 'acpleague2026.grupoacp.com.pe'],
	])('rejects a CORS_ORIGIN with %s', (_label, value) => {
		expect(() => parseEnv({ ...process.env, CORS_ORIGIN: value })).toThrow(/CORS_ORIGIN/);
	});

	/**
	 * `csrfProtection` escribe `env.corsOrigin` en el registro **sin** pasarlo
	 * por `textoParaLog`, y eso solo vale mientras un salto de línea no pueda
	 * llegar hasta ahí y partir la línea. No puede: el analizador de URL borra
	 * CR, LF y tabulación del texto antes de mirarlo, así que `url.origin` no
	 * puede contenerlos, y lo que queda después de borrarlos suele dejar de ser
	 * una URL válida y se rechaza al arrancar. Si algún día `corsOrigin` dejara
	 * de salir de `parseCorsOrigin`, esta prueba cae y hay que sanearlo también.
	 */
	it('ningún CORS_ORIGIN puede meter un salto de línea en el registro', () => {
		const intentos = [
			'https://liga.ejemplo.com\nCSRF: línea falsa',
			'https://liga\n.ejemplo.com',
			'https://liga.ejemplo.com\r\nX-Falsa: 1',
			'https://liga\tejemplo.com',
			'https://liga.ejemplo.com\r',
		];
		const resultados = intentos.map((value) => {
			try {
				return parseEnv({ ...process.env, CORS_ORIGIN: value }).corsOrigin;
			} catch {
				// Rechazado al arrancar: el proceso no llega a registrar nada.
				return null;
			}
		});

		for (const [index, origen] of resultados.entries()) {
			if (origen !== null) expect(origen, intentos[index]).not.toMatch(/[\r\n\t]/);
		}
		// Y no es una prueba vacía: al menos uno de los intentos se acepta, ya
		// limpio, así que lo que se ejercita es el borrado y no solo el rechazo.
		expect(resultados.filter((origen) => origen !== null).length).toBeGreaterThan(0);
	});

	it('requires an https CORS_ORIGIN in production, where the session cookie is Secure', () => {
		const production = { ...process.env, NODE_ENV: 'production' };

		expect(() => parseEnv({ ...production, CORS_ORIGIN: 'http://acpleague2026.grupoacp.com.pe' })).toThrow(
			/CORS_ORIGIN: en producción debe ser https/,
		);
		expect(parseEnv({ ...production, CORS_ORIGIN: 'https://acpleague2026.grupoacp.com.pe/' }).corsOrigin).toBe(
			'https://acpleague2026.grupoacp.com.pe',
		);
	});

	it('requires a SESSION_SECRET of at least 32 characters', () => {
		const missing = { ...process.env };
		delete missing.SESSION_SECRET;

		expect(() => parseEnv(missing)).toThrow(/SESSION_SECRET/);
		expect(() => parseEnv({ ...process.env, SESSION_SECRET: 'corto' })).toThrow(/SESSION_SECRET/);
	});

	it('rejects the SESSION_SECRET placeholder from .env.example, so an unedited copy does not start', () => {
		const example = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../.env.example'), 'utf8');
		const placeholder = /^SESSION_SECRET=(.*)$/m.exec(example)?.[1]?.trim();
		expect(placeholder?.length).toBeGreaterThanOrEqual(32);

		expect(() => parseEnv({ ...process.env, SESSION_SECRET: placeholder })).toThrow(/SESSION_SECRET: es un valor de ejemplo/);
	});

	it.each([
		['changeme', 'changeme-changeme-changeme-changeme-1234'],
		['secret', 'my-super-secret-value-for-sessions-2026!'],
		['ejemplo', 'EJEMPLO_de_clave_para_la_sesion_0123456789'],
		['repetitive', 'a'.repeat(48)],
		['low variety', 'abcabcabcabcabcabcabcabcabcabcabcabc'],
	])('rejects an obvious SESSION_SECRET (%s)', (_label, value) => {
		expect(() => parseEnv({ ...process.env, SESSION_SECRET: value })).toThrow(/SESSION_SECRET/);
	});

	it('accepts a random SESSION_SECRET', () => {
		expect(() => parseEnv({ ...process.env, SESSION_SECRET: randomBytes(48).toString('base64') })).not.toThrow();
	});

	it.each([
		[undefined, false],
		['false', false],
		['0', false],
		['1', 1],
		['2', 2],
		['loopback', ['loopback']],
		['loopback, 10.0.0.0/8, ::1', ['loopback', '10.0.0.0/8', '::1']],
	])('TRUST_PROXY=%s -> %o', (value, expected) => {
		const source = { ...process.env, TRUST_PROXY: value };
		if (value === undefined) delete source.TRUST_PROXY;
		expect(parseEnv(source).trustProxy).toEqual(expected);
	});

	it.each(['true', 'cualquiera', '10.0.0.0/33', '999.1.1.1', '-1'])('rejects TRUST_PROXY=%s', (value) => {
		expect(() => parseEnv({ ...process.env, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
	});

	it('has registration limit defaults and validates them', () => {
		const source = { ...process.env };
		delete source.REGISTER_RATE_LIMIT_MAX;
		delete source.REGISTER_RATE_LIMIT_WINDOW_MS;
		expect(parseEnv(source).registerRateLimit).toEqual({ windowMs: 3_600_000, max: 10 });
		expect(() => parseEnv({ ...process.env, REGISTER_RATE_LIMIT_MAX: '0' })).toThrow(/REGISTER_RATE_LIMIT_MAX/);
	});

	const WINDOWS = ['RATE_LIMIT_WINDOW_MS', 'LOGIN_RATE_LIMIT_WINDOW_MS', 'REGISTER_RATE_LIMIT_WINDOW_MS', 'PUBLIC_RATE_LIMIT_WINDOW_MS'];

	it.each(WINDOWS)('rejects a %s above 2147483647 ms (a longer timer fires at once and disables the limit)', (name) => {
		for (const value of ['2147483648', '9999999999999', '1e20']) {
			expect(() => parseEnv({ ...process.env, [name]: value }), `${name}=${value}`).toThrow(new RegExp(name));
		}
		expect(() => parseEnv({ ...process.env, [name]: '2147483647' })).not.toThrow();
	});

	it.each([
		['RATE_LIMIT_MAX', '1000001'],
		['LOGIN_RATE_LIMIT_MAX', '1000001'],
		['REGISTER_RATE_LIMIT_MAX', '1000001'],
		['PUBLIC_RATE_LIMIT_MAX', '1000001'],
		['PORT', '65536'],
		['PORT', '0'],
		['DB_PORT', '65536'],
		['DB_POOL_SIZE', '1001'],
		['SESSION_TTL_HOURS', '721'],
	])('rejects %s=%s (out of range)', (name, value) => {
		expect(() => parseEnv({ ...process.env, [name]: value })).toThrow(new RegExp(name));
	});

	it('derives the session cookie settings from NODE_ENV', () => {
		const dev = parseEnv({ ...process.env, NODE_ENV: 'development' });
		const prod = parseEnv({ ...process.env, NODE_ENV: 'production', CORS_ORIGIN: 'https://liga.example' });

		expect(dev.session).toMatchObject({ cookieName: 'liga_sid', secureCookie: false });
		expect(prod.session).toMatchObject({ cookieName: '__Host-liga_sid', secureCookie: true });
		expect(dev.session.ttlMs).toBe(Number(process.env.SESSION_TTL_HOURS ?? 12) * 3_600_000);
	});

	it('resolves the test database name (not the real one) when NODE_ENV=test', () => {
		// Vitest sets NODE_ENV=test for the whole run, so process.env already
		// reflects this — this just makes the intent explicit and checkable.
		const parsed = parseEnv(process.env);
		expect(parsed.nodeEnv).toBe('test');
		expect(parsed.db.database).toBe(process.env.MYSQL_DATABASE_TEST ?? 'la_liga_acp_test');
		expect(parsed.db.database).not.toBe(process.env.MYSQL_DATABASE);
	});
});
