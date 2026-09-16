import express from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { MAX_TRANSACTION_ATTEMPTS, transactionStats, withTransaction } from '../src/db/transaction.js';
import { translateDbError } from '../src/lib/db-errors.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createTestApp } from './helpers/app.js';
import { resetDatabase } from './helpers/db.js';

/** What mysql2 rejects with: `errno`, `code` and `sqlState`. */
const mysqlError = (errno: number, code: string) =>
	Object.assign(new Error(`${code} (simulado)`), { errno, code, sqlState: errno === 1213 ? '40001' : 'HY000' });
const DEADLOCK = () => mysqlError(1213, 'ER_LOCK_DEADLOCK');
const LOCK_TIMEOUT = () => mysqlError(1205, 'ER_LOCK_WAIT_TIMEOUT');

describe('withTransaction: deadlock retry and lock conflicts (T-09 follow-up)', () => {
	let pool: Pool;
	let warn: MockInstance<typeof console.warn>;

	const countSports = async (nombre: string) => {
		const [[row]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM deporte WHERE nombre = ?', [nombre]);
		return Number(row!.n);
	};
	const insertSport = (conn: { query: Pool['query'] }, nombre: string) =>
		conn.query<ResultSetHeader>('INSERT INTO deporte (nombre, slug, permite_empate) VALUES (?, ?, TRUE)', [nombre, nombre.toLowerCase()]);

	beforeAll(() => {
		({ pool } = createTestApp());
		warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		warn.mockClear();
	});

	afterAll(async () => {
		warn.mockRestore();
		await resetDatabase(pool);
		await pool.end();
	});

	it('a deadlock runs the whole transaction again; the rolled-back attempt leaves nothing', async () => {
		const before = { ...transactionStats };
		let calls = 0;
		const result = await withTransaction(pool, async (conn) => {
			calls++;
			await insertSport(conn, `Intento${calls}`);
			if (calls === 1) throw DEADLOCK();
			return 'hecho';
		});

		expect(result).toBe('hecho');
		expect(calls).toBe(2);
		expect(await countSports('Intento1')).toBe(0);
		expect(await countSports('Intento2')).toBe(1);
		expect(transactionStats.deadlockRetries).toBe(before.deadlockRetries + 1);
		expect(warn).not.toHaveBeenCalled();
	});

	it(`gives up after ${MAX_TRANSACTION_ATTEMPTS} attempts and rethrows the deadlock, logged as a warning`, async () => {
		const before = { ...transactionStats };
		let calls = 0;
		const failing = withTransaction(pool, async () => {
			calls++;
			throw DEADLOCK();
		});

		await expect(failing).rejects.toMatchObject({ errno: 1213 });
		expect(calls).toBe(MAX_TRANSACTION_ATTEMPTS);
		expect(transactionStats.deadlocksExhausted).toBe(before.deadlocksExhausted + 1);
		expect(warn).toHaveBeenCalledOnce();
	});

	it('does not retry a lock wait timeout, nor any other error', async () => {
		for (const error of [LOCK_TIMEOUT(), mysqlError(1062, 'ER_DUP_ENTRY'), new Error('otra cosa')]) {
			let calls = 0;
			await expect(
				withTransaction(pool, async () => {
					calls++;
					throw error;
				}),
			).rejects.toBe(error);
			expect(calls).toBe(1);
		}
	});

	it('1213 and 1205 become 409 CONCURRENT_UPDATE: never a 500, not logged as an error', async () => {
		const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			for (const make of [DEADLOCK, LOCK_TIMEOUT]) {
				expect(translateDbError(make())).toMatchObject({ status: 409, code: 'CONCURRENT_UPDATE' });

				const app = express();
				app.get('/boom', async () => {
					throw make();
				});
				app.use(errorHandler);
				const res = await request(app).get('/boom');
				expect(res.status).toBe(409);
				expect(res.body).toEqual({ error: { code: 'CONCURRENT_UPDATE', message: expect.any(String) } });
				expect(JSON.stringify(res.body)).not.toMatch(/simulado|ER_LOCK/);
			}
			expect(consoleError).not.toHaveBeenCalled();
		} finally {
			consoleError.mockRestore();
		}
	});

	it('a real deadlock between two transactions: MySQL picks a victim, it is retried, and both commit', async () => {
		const [a] = await insertSport(pool, 'Uno');
		const [b] = await insertSport(pool, 'Dos');
		const before = { ...transactionStats };

		// Each transaction locks its first row, waits until both have, then asks for the other's row.
		let bothHaveFirst: () => void = () => {};
		const barrier = new Promise<void>((resolve) => {
			bothHaveFirst = resolve;
		});
		let holding = 0;
		const crossed = (first: number, second: number, label: string) =>
			withTransaction(pool, async (conn) => {
				await conn.query('SELECT id FROM deporte WHERE id = ? FOR UPDATE', [first]);
				if (++holding === 2) bothHaveFirst();
				await barrier;
				await conn.query('SELECT id FROM deporte WHERE id = ? FOR UPDATE', [second]);
				await conn.query('UPDATE deporte SET nombre = CONCAT(nombre, ?) WHERE id IN (?, ?)', [label, first, second]);
				return label;
			});

		const results = await Promise.all([crossed(a.insertId, b.insertId, '-A'), crossed(b.insertId, a.insertId, '-B')]);

		expect(results).toEqual(['-A', '-B']);
		expect(transactionStats.deadlockRetries).toBe(before.deadlockRetries + 1);
		const [rows] = await pool.query<RowDataPacket[]>('SELECT nombre FROM deporte WHERE id IN (?, ?) ORDER BY id', [a.insertId, b.insertId]);
		// Both updates are there, once each, in whichever order they committed.
		for (const row of rows) expect(String(row.nombre)).toMatch(/^(Uno|Dos)(-A-B|-B-A)$/);
	});
});
