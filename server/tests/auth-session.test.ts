import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashSessionToken } from '../src/lib/tokens.js';
import { createTestApp, env } from './helpers/app.js';
import { countSessions, LEAKS_SECRET, login, PASSWORD, registerUser, sessionCookieFrom } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';

describe('login, /auth/me and logout (BR-004, BR-005, NFR-005)', () => {
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

	describe('POST /auth/login', () => {
		it('opens a session: httpOnly SameSite=Strict cookie, user and CSRF token', async () => {
			const { body, user } = await registerUser(app);
			const res = await request(app).post('/auth/login').send({ email: body.email, password: PASSWORD });

			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({
				user: expect.objectContaining({ id: user.id, email: body.email, rol: 'apostador' }),
				csrfToken: expect.any(String),
				expiraEn: expect.any(String),
			});
			expect(JSON.stringify(res.body)).not.toMatch(LEAKS_SECRET);

			const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
			expect(setCookie).toHaveLength(1);
			const cookie = setCookie[0]!;
			expect(cookie).toMatch(new RegExp(`^${env.session.cookieName}=[A-Za-z0-9_-]{43};`));
			expect(cookie).toMatch(/; HttpOnly/);
			expect(cookie).toMatch(/; SameSite=Strict/);
			expect(cookie).toMatch(/; Path=\//);
			expect(cookie).toMatch(/; Expires=/);
			// Plain http in development and tests; Secure is covered below.
			expect(cookie).not.toMatch(/; Secure/);

			const expires = new Date(cookie.match(/Expires=([^;]+)/)![1]!).getTime();
			expect(Math.abs(expires - (Date.now() + env.session.ttlMs))).toBeLessThan(5_000);
			expect(await countSessions(pool, user.id)).toBe(1);
		});

		it('accepts the email in any case and with spaces', async () => {
			const { body } = await registerUser(app);
			const res = await request(app)
				.post('/auth/login')
				.send({ email: `  ${body.email.toUpperCase()} `, password: PASSWORD });

			expect(res.status).toBe(200);
		});

		it('lets a pending user log in (BR-005)', async () => {
			const { body } = await registerUser(app);
			const { res } = await login(app, body.email);

			expect(res.body.data.user.estadoValidacion).toBe('pendiente');
		});

		it('answers a wrong password and an unknown email identically', async () => {
			const { body } = await registerUser(app);
			const wrong = await request(app).post('/auth/login').send({ email: body.email, password: 'otra-clave-123' });
			const unknown = await request(app).post('/auth/login').send({ email: 'nadie@liga.test', password: PASSWORD });

			for (const res of [wrong, unknown]) {
				expect(res.status).toBe(401);
				expect(res.headers['set-cookie']).toBeUndefined();
			}
			expect(wrong.body).toEqual({
				error: { code: 'INVALID_CREDENTIALS', message: 'Correo o contraseña incorrectos.' },
			});
			expect(unknown.body).toEqual(wrong.body);
		});

		it('takes about the same time for a wrong password and an unknown email', async () => {
			const { body } = await registerUser(app);
			const time = async (email: string) => {
				const start = performance.now();
				await request(app).post('/auth/login').send({ email, password: 'otra-clave-123' });
				return performance.now() - start;
			};
			const median = (xs: number[]) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;

			await time('calentar@liga.test');
			const known: number[] = [];
			const unknown: number[] = [];
			for (let i = 0; i < 5; i++) {
				known.push(await time(body.email));
				unknown.push(await time(`nadie${i}@liga.test`));
			}

			// Both run one argon2 verification (~20+ ms); without the dummy
			// verification the unknown case would take ~1 ms.
			const ratio = median(unknown) / median(known);
			expect(ratio).toBeGreaterThan(0.5);
			expect(ratio).toBeLessThan(2);
		});

		it('purges every user’s expired sessions, and only those', async () => {
			const [indexes] = await pool.query<RowDataPacket[]>(
				"SELECT INDEX_NAME FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'sesion' AND column_name = 'expira_en'",
			);
			expect(indexes.map((row) => row.INDEX_NAME)).toContain('idx_sesion_expira_en');

			const ana = await registerUser(app);
			const expired = await login(app, ana.body.email);
			const alive = await login(app, ana.body.email);
			await pool.query('UPDATE sesion SET creado_en = ?, expira_en = ? WHERE token_hash = ?', [
				new Date(Date.now() - 2 * 60_000),
				new Date(Date.now() - 60_000),
				hashSessionToken(expired.cookie.split('=')[1]!),
			]);
			expect(await countSessions(pool, ana.user.id)).toBe(2);

			// Someone else logging in cleans up Ana's expired row.
			const beto = await registerUser(app);
			await login(app, beto.body.email);

			expect(await countSessions(pool, ana.user.id)).toBe(1);
			expect((await request(app).get('/auth/me').set('Cookie', alive.cookie)).status).toBe(200);
		});

		it('replaces the session the request already had instead of piling them up', async () => {
			const { body, user } = await registerUser(app);
			const first = await login(app, body.email);
			const second = await request(app)
				.post('/auth/login')
				.set('Cookie', first.cookie)
				.send({ email: body.email, password: PASSWORD });

			expect(second.status).toBe(200);
			expect(await countSessions(pool, user.id)).toBe(1);
			expect((await request(app).get('/auth/me').set('Cookie', first.cookie)).status).toBe(401);
		});
	});

	describe('GET /auth/me', () => {
		it('without a session -> 401 UNAUTHENTICATED', async () => {
			const res = await request(app).get('/auth/me');

			expect(res.status).toBe(401);
			expect(res.body).toEqual({ error: { code: 'UNAUTHENTICATED', message: expect.any(String) } });
		});

		it('with an unknown or tampered cookie -> 401', async () => {
			const res = await request(app).get('/auth/me').set('Cookie', `${env.session.cookieName}=inventado`);

			expect(res.status).toBe(401);
		});

		it('with a session -> the user with role, states and balance, never the hash', async () => {
			const { body, user } = await registerUser(app);
			const { cookie, csrfToken } = await login(app, body.email);
			const res = await request(app).get('/auth/me').set('Cookie', cookie);

			expect(res.status).toBe(200);
			expect(res.body).toEqual({
				data: {
					user: {
						id: user.id,
						nombre: body.nombre,
						email: body.email,
						rol: 'apostador',
						estadoValidacion: 'pendiente',
						estadoPago: 'pendiente',
						saldoMonedas: 0,
						creadoEn: expect.any(String),
					},
					csrfToken,
				},
			});
			expect(JSON.stringify(res.body)).not.toMatch(LEAKS_SECRET);
		});

		it('rejects an expired session', async () => {
			const { body, user } = await registerUser(app);
			const { cookie } = await login(app, body.email);
			await pool.query(
				'UPDATE sesion SET creado_en = ?, expira_en = ? WHERE usuario_id = ?',
				[new Date(Date.now() - 2 * 60_000), new Date(Date.now() - 60_000), user.id],
			);

			expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(401);
		});
	});

	describe('POST /auth/logout', () => {
		it('deletes the session: the same cookie no longer works', async () => {
			const { body, user } = await registerUser(app);
			const { cookie, csrfToken } = await login(app, body.email);

			const res = await request(app).post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrfToken);

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ data: null });
			// The browser is told to drop the cookie...
			const cleared = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
			expect(sessionCookieFrom(cleared)).toBeUndefined();
			expect(cleared[0]).toMatch(/Expires=Thu, 01 Jan 1970/);
			// ...and a copy of it is useless, because the row is gone.
			expect(await countSessions(pool, user.id)).toBe(0);
			expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(401);
		});

		it('only closes that session, not the user’s other ones', async () => {
			const { body, user } = await registerUser(app);
			const phone = await login(app, body.email);
			const laptop = await login(app, body.email);

			await request(app).post('/auth/logout').set('Cookie', phone.cookie).set('X-CSRF-Token', phone.csrfToken);

			expect(await countSessions(pool, user.id)).toBe(1);
			expect((await request(app).get('/auth/me').set('Cookie', laptop.cookie)).status).toBe(200);
		});

		it('without a session -> 401', async () => {
			expect((await request(app).post('/auth/logout')).status).toBe(401);
		});
	});

	it('marks the cookie Secure (and __Host-) when configured for production', async () => {
		const prod = createTestApp({
			session: { ...env.session, secureCookie: true, cookieName: '__Host-liga_sid' },
		});
		try {
			const { body } = await registerUser(prod.app);
			const res = await request(prod.app).post('/auth/login').send({ email: body.email, password: PASSWORD });
			const cookie = ([] as string[]).concat(res.headers['set-cookie'] ?? [])[0]!;

			expect(cookie).toMatch(/^__Host-liga_sid=/);
			expect(cookie).toMatch(/; Secure/);
			expect(cookie).not.toMatch(/; Domain=/);
		} finally {
			await prod.pool.end();
		}
	});
});
