import type { Pool } from 'mysql2/promise';
import { describe, expect, it } from 'vitest';
import { ConfigError, parseEnv } from '../src/config/env.js';
import { env } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';
import { assertIsTestDatabase, resolveTestDatabase } from './helpers/test-database.js';

/**
 * The guards that keep the suite away from the real database. Nothing here
 * opens a connection to MYSQL_DATABASE: the reset case uses a fake pool that
 * only answers "which database am I on?" and records anything else.
 */
describe('test database guards', () => {
	const realDatabase = process.env.MYSQL_DATABASE!;
	const testDatabase = resolveTestDatabase();

	it('runs with NODE_ENV=test and the test database, whatever the terminal exported', () => {
		expect(process.env.NODE_ENV).toBe('test');
		expect(env.nodeEnv).toBe('test');
		expect(env.db.database).toBe(testDatabase);
		expect(env.db.database).not.toBe(realDatabase);
	});

	it('refuses a config where MYSQL_DATABASE_TEST equals MYSQL_DATABASE', () => {
		const same = { ...process.env, MYSQL_DATABASE_TEST: realDatabase };

		expect(() => parseEnv(same)).toThrow(ConfigError);
		expect(() => parseEnv(same)).toThrow(/MYSQL_DATABASE_TEST/);
		expect(() => resolveTestDatabase(same)).toThrow(/MYSQL_DATABASE_TEST/);
	});

	it('refuses a MYSQL_DATABASE_TEST that is not a plain identifier', () => {
		expect(() => parseEnv({ ...process.env, MYSQL_DATABASE_TEST: 'x`; DROP DATABASE y; --' })).toThrow(
			/MYSQL_DATABASE_TEST/,
		);
	});

	it('only accepts the test database as a destructive target', () => {
		expect(() => assertIsTestDatabase(testDatabase)).not.toThrow();
		expect(() => assertIsTestDatabase(realDatabase)).toThrow(/cancelada/);
		expect(() => assertIsTestDatabase('otra_base')).toThrow(/cancelada/);
		expect(() => assertIsTestDatabase(null)).toThrow(/cancelada/);
	});

	it('resetDatabase aborts before any statement when the pool is on another database', async () => {
		const executed: string[] = [];
		const fakePool = {
			query: async (sql: string) => {
				if (sql.startsWith('SELECT DATABASE()')) return [[{ name: realDatabase }], []];
				executed.push(sql);
				return [[], []];
			},
			getConnection: async () => {
				executed.push('getConnection');
				throw new Error('no debería pedir una conexión');
			},
		} as unknown as Pool;

		await expect(resetDatabase(fakePool)).rejects.toThrow(/cancelada/);
		expect(executed).toEqual([]);
	});
});
