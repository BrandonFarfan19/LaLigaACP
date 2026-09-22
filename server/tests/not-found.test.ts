import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';

describe('unknown routes', () => {
	let app: Express;
	let pool: Pool;

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	afterAll(async () => {
		await pool.end();
	});

	it('respond 404 with the standard error envelope', async () => {
		const res = await request(app).get('/no-existe');

		expect(res.status).toBe(404);
		expect(res.body).toEqual({
			error: {
				code: 'NOT_FOUND',
				message: expect.any(String),
			},
		});
	});
});
