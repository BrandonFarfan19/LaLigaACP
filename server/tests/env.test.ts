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

	it('resolves the test database name (not the real one) when NODE_ENV=test', () => {
		// Vitest sets NODE_ENV=test for the whole run, so process.env already
		// reflects this — this just makes the intent explicit and checkable.
		const parsed = parseEnv(process.env);
		expect(parsed.nodeEnv).toBe('test');
		expect(parsed.db.database).toBe(process.env.MYSQL_DATABASE_TEST ?? 'la_liga_acp_test');
		expect(parsed.db.database).not.toBe(process.env.MYSQL_DATABASE);
	});
});
