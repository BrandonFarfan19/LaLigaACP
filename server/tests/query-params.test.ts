import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import { countSessions, newUserBody, PASSWORD, registerUser, signedInUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';
import { setPayment, userState } from './helpers/participants.js';

/**
 * Routes under /auth and /admin never ignore a query string they don't
 * understand: it is a 400 in the standard envelope, and nothing happens.
 */
describe('unexpected query parameters', () => {
	let app: Express;
	let pool: Pool;
	let admin: Awaited<ReturnType<typeof signedInUser>>;

	const rejected = (res: request.Response, key: string) => {
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe('VALIDATION_ERROR');
		expect(JSON.stringify(res.body.error.details)).toContain(key);
	};

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		admin = await signedInUser(app, pool, { rol: 'admin' });
	});

	afterAll(async () => {
		await pool.end();
	});

	describe('GET /admin/participantes/conteos', () => {
		it.each([
			['rol=admin', 'rol'],
			['rol=apostador', 'rol'],
			['x=1', 'x'],
			['estadoPago=confirmado', 'estadoPago'],
		])('?%s -> 400', async (query, key) => {
			rejected(await request(app).get(`/admin/participantes/conteos?${query}`).set('Cookie', admin.cookie), key);
		});

		it('without parameters -> 200', async () => {
			const res = await request(app).get('/admin/participantes/conteos').set('Cookie', admin.cookie);

			expect(res.status).toBe(200);
			expect(res.body.data.inscritos).toBe(0);
		});
	});

	it('GET /admin/sesion?x=1 -> 400', async () => {
		rejected(await request(app).get('/admin/sesion?x=1').set('Cookie', admin.cookie), 'x');
	});

	it.each(['pago/confirmar', 'pago/revertir', 'validar'])('POST /admin/participantes/:id/%s?x=1 -> 400, no effects', async (action) => {
		const { user } = await registerUser(app);
		await setPayment(pool, user.id, 'confirmado');

		const res = await request(app)
			.post(`/admin/participantes/${user.id}/${action}?x=1`)
			.set('Cookie', admin.cookie)
			.set('X-CSRF-Token', admin.csrfToken);

		rejected(res, 'x');
		expect(await userState(pool, user.id)).toMatchObject({ estadoPago: 'confirmado', estadoValidacion: 'pendiente', saldo: 0 });
	});

	it('POST /auth/register?rol=admin -> 400, no account created', async () => {
		const body = newUserBody();
		rejected(await request(app).post('/auth/register?rol=admin').send(body), 'rol');

		expect((await request(app).post('/auth/login').send({ email: body.email, password: PASSWORD })).status).toBe(401);
	});

	it('POST /auth/login?x=1 -> 400, no session', async () => {
		const { body, user } = await registerUser(app);
		const res = await request(app).post('/auth/login?x=1').send({ email: body.email, password: PASSWORD });

		rejected(res, 'x');
		expect(res.headers['set-cookie']).toBeUndefined();
		expect(await countSessions(pool, user.id)).toBe(0);
	});

	it('GET /auth/me?x=1 -> 400 with a session, 401 without one', async () => {
		rejected(await request(app).get('/auth/me?x=1').set('Cookie', admin.cookie), 'x');
		expect((await request(app).get('/auth/me?x=1')).status).toBe(401);
	});

	it('POST /auth/logout?x=1 -> 400, the session stays open', async () => {
		const res = await request(app).post('/auth/logout?x=1').set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrfToken);

		rejected(res, 'x');
		expect(await countSessions(pool, admin.user.id)).toBe(1);
	});

	it('admin routes still answer 401 before looking at the query', async () => {
		expect((await request(app).get('/admin/participantes/conteos?rol=admin')).status).toBe(401);
	});
});
