import express, { type Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRequireAuth, requireBettor, requireRole } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createTestApp, env } from './helpers/app.js';
import { setUserState, signedInUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';

describe('route protection (BR-001, BR-002, BR-005)', () => {
	let app: Express;
	let pool: Pool;
	/** Stand-in for T-09's betting route: session + validated apostador. */
	let bettingApp: Express;

	beforeAll(() => {
		({ app, pool } = createTestApp());
		bettingApp = express();
		const requireAuth = createRequireAuth(pool, env);
		bettingApp.get('/apostar', requireAuth, requireBettor, (_req, res) => {
			res.json({ data: 'ok' });
		});
		bettingApp.get('/solo-usuarios', requireAuth, requireRole('apostador'), (_req, res) => {
			res.json({ data: 'ok' });
		});
		bettingApp.use(errorHandler);
	});

	beforeEach(async () => {
		await resetDatabase(pool);
	});

	afterAll(async () => {
		await pool.end();
	});

	describe('requireRole("admin") on /admin', () => {
		it('401 without a session', async () => {
			const res = await request(app).get('/admin/sesion');

			expect(res.status).toBe(401);
			expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
		});

		it('403 for an apostador, even a validated one', async () => {
			const { cookie } = await signedInUser(app, pool, { estado: 'validado' });
			const res = await request(app).get('/admin/sesion').set('Cookie', cookie);

			expect(res.status).toBe(403);
			expect(res.body).toEqual({ error: { code: 'FORBIDDEN', message: expect.any(String) } });
		});

		it('200 for an admin', async () => {
			const { cookie, user } = await signedInUser(app, pool, { rol: 'admin' });
			const res = await request(app).get('/admin/sesion').set('Cookie', cookie);

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ data: { id: user.id, nombre: expect.any(String), rol: 'admin' } });
		});

		it('applies a role change on the next request, without logging in again', async () => {
			const { cookie, user } = await signedInUser(app, pool, { rol: 'admin' });
			expect((await request(app).get('/admin/sesion').set('Cookie', cookie)).status).toBe(200);

			await setUserState(pool, user.id, { rol: 'apostador' });

			expect((await request(app).get('/admin/sesion').set('Cookie', cookie)).status).toBe(403);
		});

		it('also guards unknown paths under /admin (401 before 404)', async () => {
			expect((await request(app).get('/admin/no-existe')).status).toBe(401);
		});
	});

	describe('requireBettor', () => {
		it('401 without a session', async () => {
			expect((await request(bettingApp).get('/apostar')).status).toBe(401);
		});

		it('a pending user is logged in and can use /auth/me, but cannot bet', async () => {
			const { cookie } = await signedInUser(app, pool);

			expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(200);
			const res = await request(bettingApp).get('/apostar').set('Cookie', cookie);
			expect(res.status).toBe(403);
			expect(res.body).toEqual({ error: { code: 'USER_NOT_VALIDATED', message: expect.any(String) } });
		});

		it('a validated user can bet', async () => {
			const { cookie } = await signedInUser(app, pool, { estado: 'validado' });

			expect((await request(bettingApp).get('/apostar').set('Cookie', cookie)).status).toBe(200);
		});

		it.each(['pendiente', 'validado'] as const)(
			'an admin never bets, even if the database says %s -> 403 ADMIN_CANNOT_BET',
			async (estado) => {
				const { cookie } = await signedInUser(app, pool, { rol: 'admin', estado });
				const res = await request(bettingApp).get('/apostar').set('Cookie', cookie);

				expect(res.status).toBe(403);
				expect(res.body).toEqual({ error: { code: 'ADMIN_CANNOT_BET', message: expect.any(String) } });
			},
		);

		it('an apostador promoted to admin loses betting on the next request', async () => {
			const { cookie, user } = await signedInUser(app, pool, { estado: 'validado' });
			expect((await request(bettingApp).get('/apostar').set('Cookie', cookie)).status).toBe(200);

			await setUserState(pool, user.id, { rol: 'admin' });

			expect((await request(bettingApp).get('/apostar').set('Cookie', cookie)).body.error.code).toBe('ADMIN_CANNOT_BET');
		});
	});

	it('requireRole("apostador") does not let admins through: roles do not include each other', async () => {
		const admin = await signedInUser(app, pool, { rol: 'admin' });
		const apostador = await signedInUser(app, pool);

		expect((await request(bettingApp).get('/solo-usuarios').set('Cookie', admin.cookie)).status).toBe(403);
		expect((await request(bettingApp).get('/solo-usuarios').set('Cookie', apostador.cookie)).status).toBe(200);
	});
});
