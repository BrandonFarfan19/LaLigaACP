import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { env } from '../src/config/env.js';
import { resetDatabase } from './helpers/db.js';

interface CountRow extends RowDataPacket {
	n: number;
}

/**
 * Proves the between-tests cleanup helper actually works: insert a row
 * directly, reset, and confirm it's gone. T-02 has no data-writing endpoints
 * yet, so this is the one place that exercises it before later tasks rely on
 * it in a `beforeEach`.
 */
describe('resetDatabase', () => {
	let pool: Pool;

	beforeAll(() => {
		pool = createPool(env);
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	it('truncates every table, including one just written to', async () => {
		await resetDatabase(pool);
		await pool.query(
			"INSERT INTO deporte (nombre, slug, permite_empate) VALUES ('Futbol', 'futbol-reset-test', TRUE)",
		);
		const [before] = await pool.query<CountRow[]>('SELECT COUNT(*) AS n FROM deporte');
		expect(before[0]?.n).toBe(1);

		await resetDatabase(pool);

		const [after] = await pool.query<CountRow[]>('SELECT COUNT(*) AS n FROM deporte');
		expect(after[0]?.n).toBe(0);
	});
});
