import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, createUnreachableApp } from './helpers/app.js';

describe('GET /health', () => {
	describe('with the database up', () => {
		let app: Express;
		let pool: Pool;

		beforeAll(() => {
			({ app, pool } = createTestApp());
		});

		afterAll(async () => {
			await pool.end();
		});

		it('responds 200 with the standard success envelope', async () => {
			const res = await request(app).get('/health');

			expect(res.status).toBe(200);
			expect(res.body).toEqual({
				data: {
					status: 'ok',
					database: 'up',
					version: expect.any(String),
				},
			});
		});
	});

	describe('with the database unreachable', () => {
		let app: Express;
		let pool: Pool;

		beforeAll(() => {
			({ app, pool } = createUnreachableApp());
		});

		afterAll(async () => {
			await pool.end();
		});

		it('responds 503 with a clear error, no internal detail leaked', async () => {
			const res = await request(app).get('/health');

			expect(res.status).toBe(503);
			expect(res.body).toEqual({
				error: {
					code: 'DATABASE_UNAVAILABLE',
					message: expect.any(String),
				},
			});
			// No driver internals (host, port, ECONNREFUSED, stack, ...) in the response.
			const raw = JSON.stringify(res.body);
			expect(raw).not.toMatch(/ECONNREFUSED|errno|stack|127\.0\.0\.1/i);
		});
	});
});
