import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../src/config/env.js';
import { createTestApp, env } from './helpers/app.js';
import { newUserBody, PASSWORD, registerUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';

const RATE_LIMITED = { error: { code: 'RATE_LIMITED', message: expect.any(String) } };

/**
 * `/auth` limits, with small maximums: 3 failed logins per IP + email, 3
 * registrations per IP. A new app per test, so each starts with fresh
 * counters.
 */
describe('auth rate limits', () => {
	let app: Express;
	let pool: Pool | undefined;

	async function freshApp(overrides: Partial<Env> = {}) {
		await pool?.end();
		const created = createTestApp({
			loginRateLimit: { ...env.loginRateLimit, max: 3 },
			registerRateLimit: { ...env.registerRateLimit, max: 3 },
			...overrides,
		});
		({ app, pool } = created);
		return created;
	}

	beforeEach(async () => {
		const { pool: fresh } = await freshApp();
		await resetDatabase(fresh);
	});

	afterAll(async () => {
		await pool?.end();
	});

	const attempt = (email: string, password: string) => request(app).post('/auth/login').send({ email, password });

	it('both are stricter than the global limit by default', () => {
		expect(env.loginRateLimit.max).toBeLessThan(env.rateLimit.max);
		expect(env.registerRateLimit.max).toBeLessThan(env.rateLimit.max);
	});

	describe('login', () => {
		it('blocks the account for this client after too many failures, even with the right password', async () => {
			const { body } = await registerUser(app);
			for (let i = 0; i < 3; i++) {
				expect((await attempt(body.email, 'mala-clave-123')).status).toBe(401);
			}

			const blocked = await attempt(body.email, PASSWORD);
			expect(blocked.status).toBe(429);
			expect(blocked.body).toEqual(RATE_LIMITED);
			expect(blocked.headers['set-cookie']).toBeUndefined();
			expect(blocked.headers['cache-control']).toBe('no-store');
			// Same key whatever the case of the email.
			expect((await attempt(body.email.toUpperCase(), PASSWORD)).status).toBe(429);
		});

		it('counts unknown emails too, without revealing they are unknown', async () => {
			for (let i = 0; i < 3; i++) {
				expect((await attempt('nadie@liga.test', 'mala-clave-123')).status).toBe(401);
			}
			expect((await attempt('nadie@liga.test', 'mala-clave-123')).status).toBe(429);
		});

		it('does not count successful logins', async () => {
			const { body } = await registerUser(app);
			for (let i = 0; i < 5; i++) {
				expect((await attempt(body.email, PASSWORD)).status).toBe(200);
			}
		});

		it('logins rejected for their query string (400) never count, even with the right password', async () => {
			const { body } = await registerUser(app);
			for (let i = 0; i < 6; i++) {
				const res = await request(app).post('/auth/login?next=/x').send({ email: body.email, password: PASSWORD });
				expect(res.status).toBe(400);
			}

			expect((await attempt(body.email, PASSWORD)).status).toBe(200);
		});

		it('wrong passwords without a query still count after query-rejected attempts', async () => {
			const { body } = await registerUser(app);
			for (let i = 0; i < 4; i++) {
				const res = await request(app).post('/auth/login?next=/x').send({ email: body.email, password: 'mala-clave-123' });
				expect(res.status).toBe(400);
			}
			for (let i = 0; i < 3; i++) {
				expect((await attempt(body.email, 'mala-clave-123')).status).toBe(401);
			}

			expect((await attempt(body.email, PASSWORD)).status).toBe(429);
		});

		it('does not block other accounts from the same client', async () => {
			const target = await registerUser(app);
			const other = await registerUser(app);
			for (let i = 0; i < 4; i++) await attempt(target.body.email, 'mala-clave-123');

			expect((await attempt(other.body.email, PASSWORD)).status).toBe(200);
		});
	});

	describe('registration', () => {
		const register = (overrides: Record<string, unknown> = {}) =>
			request(app).post('/auth/register').send(newUserBody(overrides));

		it('registrations rejected for their query string (400) never use up the limit', async () => {
			for (let i = 0; i < 5; i++) {
				const res = await request(app).post('/auth/register?next=/x').send(newUserBody());
				expect(res.status).toBe(400);
			}

			for (let i = 0; i < 3; i++) {
				expect((await register()).status).toBe(201);
			}
			expect((await register()).status).toBe(429);
		});

		it('answers 429 in the standard envelope after the limit, and creates nothing', async () => {
			for (let i = 0; i < 3; i++) {
				expect((await register()).status).toBe(201);
			}

			const blocked = await register();
			expect(blocked.status).toBe(429);
			expect(blocked.body).toEqual(RATE_LIMITED);
			expect(blocked.headers['ratelimit-remaining']).toBe('0');
			expect(blocked.headers['cache-control']).toBe('no-store');
		});

		it('counts failed attempts too (invalid data, duplicate email)', async () => {
			const { body } = await registerUser(app);
			expect((await register({ email: 'no-es-correo' })).status).toBe(400);
			expect((await register({ email: body.email })).status).toBe(409);

			expect((await register()).status).toBe(429);
		});

		it('does not affect login', async () => {
			const { body } = await registerUser(app);
			for (let i = 0; i < 3; i++) await register();

			expect((await attempt(body.email, PASSWORD)).status).toBe(200);
		});
	});

	describe('client IP and TRUST_PROXY', () => {
		// express-rate-limit warns (console.error) when X-Forwarded-For arrives
		// while trust proxy is off: expected here, so silenced.
		const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => {});

		it('defaults to off', () => {
			expect(env.trustProxy).toBe(false);
		});

		it('without it, the socket IP is used: a forged X-Forwarded-For does not dodge the limit', async () => {
			const spy = quiet();
			try {
				for (let i = 0; i < 3; i++) {
					const res = await request(app)
						.post('/auth/login')
						.set('X-Forwarded-For', `203.0.113.${i}`)
						.send({ email: 'nadie@liga.test', password: 'mala-clave-123' });
					expect(res.status).toBe(401);
				}
				const res = await request(app)
					.post('/auth/login')
					.set('X-Forwarded-For', '198.51.100.99')
					.send({ email: 'nadie@liga.test', password: 'mala-clave-123' });
				expect(res.status).toBe(429);
			} finally {
				spy.mockRestore();
			}
		});

		it('with TRUST_PROXY=1, the address reported by the proxy is the client', async () => {
			await freshApp({ trustProxy: 1 });
			const from = (ip: string) =>
				request(app)
					.post('/auth/login')
					.set('X-Forwarded-For', ip)
					.send({ email: 'nadie@liga.test', password: 'mala-clave-123' });

			for (let i = 0; i < 3; i++) expect((await from('203.0.113.7')).status).toBe(401);
			expect((await from('203.0.113.7')).status).toBe(429);
			// Another client behind the same proxy is counted apart.
			expect((await from('198.51.100.8')).status).toBe(401);
		});
	});
});
