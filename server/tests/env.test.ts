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
		const prod = parseEnv({ ...process.env, NODE_ENV: 'production' });

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
