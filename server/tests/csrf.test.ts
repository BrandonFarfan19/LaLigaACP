import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, env } from './helpers/app.js';
import { countSessions, login, PASSWORD, registerUser, signedInUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';

const CSRF_FAILED = { error: { code: 'CSRF_FAILED', message: expect.any(String) } };

describe('CSRF protection (NFR-005)', () => {
	let app: Express;
	let pool: Pool;

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
	});

	afterAll(async () => {
		await pool.end();
	});

	describe('state-changing request with a session cookie', () => {
		it('403 without X-CSRF-Token, and nothing changes', async () => {
			const { cookie, user } = await signedInUser(app, pool);
			const res = await request(app).post('/auth/logout').set('Cookie', cookie);

			expect(res.status).toBe(403);
			expect(res.body).toEqual(CSRF_FAILED);
			expect(await countSessions(pool, user.id)).toBe(1);
		});

		it('403 with a wrong token', async () => {
			const { cookie } = await signedInUser(app, pool);
			const res = await request(app).post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', 'x'.repeat(43));

			expect(res.status).toBe(403);
		});

		it("403 with another session's token", async () => {
			const victim = await signedInUser(app, pool);
			const attacker = await signedInUser(app, pool);
			const res = await request(app)
				.post('/auth/logout')
				.set('Cookie', victim.cookie)
				.set('X-CSRF-Token', attacker.csrfToken);

			expect(res.status).toBe(403);
		});

		it('passes with the token of its own session', async () => {
			const { cookie, csrfToken } = await signedInUser(app, pool);

			expect((await request(app).post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrfToken)).status).toBe(
				200,
			);
		});

		it('GET needs no token', async () => {
			const { cookie } = await signedInUser(app, pool);

			expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(200);
		});
	});

	describe('Origin check', () => {
		it('rejects a login posted from another site (login CSRF)', async () => {
			const { body } = await registerUser(app);
			const res = await request(app)
				.post('/auth/login')
				.set('Origin', 'https://evil.example')
				.send({ email: body.email, password: PASSWORD });

			expect(res.status).toBe(403);
			expect(res.body).toEqual(CSRF_FAILED);
			expect(res.headers['set-cookie']).toBeUndefined();
		});

		it('rejects a registration posted from another site', async () => {
			const res = await request(app)
				.post('/auth/register')
				.set('Origin', 'http://localhost:9999')
				.send({ nombre: 'X', email: 'x@liga.test', password: PASSWORD });

			expect(res.status).toBe(403);
		});

		it('accepts the frontend origin, and clients that send no Origin', async () => {
			const { body } = await registerUser(app);

			const fromFront = await request(app)
				.post('/auth/login')
				.set('Origin', env.corsOrigin)
				.send({ email: body.email, password: PASSWORD });
			expect(fromFront.status).toBe(200);
			expect((await request(app).post('/auth/login').send({ email: body.email, password: PASSWORD })).status).toBe(200);
		});
	});

	it('login and register need no token, even with a stale session cookie', async () => {
		const { body } = await registerUser(app);
		const { cookie, csrfToken } = await login(app, body.email);
		await request(app).post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrfToken);

		const res = await request(app).post('/auth/login').set('Cookie', cookie).send({ email: body.email, password: PASSWORD });
		expect(res.status).toBe(200);
	});
});
