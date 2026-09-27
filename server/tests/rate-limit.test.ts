import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestApp, env } from './helpers/app.js';

/** Uses a limit of 1 request per window, so the second counted request is already a 429. */
describe('rate limit', () => {
	let pool: Pool | undefined;

	function tinyLimitApp() {
		const created = createTestApp({ rateLimit: { ...env.rateLimit, max: 1 } });
		pool = created.pool;
		return created.app;
	}

	afterEach(async () => {
		await pool?.end();
		pool = undefined;
	});

	it('does not count GET /health, in any case, with or without trailing slash', async () => {
		const app = tinyLimitApp();

		// The same variants Express routes to the health endpoint.
		for (const path of ['/health', '/health/', '/HEALTH', '/Health/']) {
			const res = await request(app).get(path);
			expect(res.status, path).toBe(200);
			expect(res.body.data?.status, path).toBe('ok');
			expect(res.headers['ratelimit-remaining'], path).toBeUndefined();
		}
		expect((await request(app).head('/HEALTH')).status).toBe(200);
		// The one allowed request is still available after those three.
		const counted = await request(app).get('/no-existe');
		expect(counted.status).toBe(404);
		expect(counted.headers['ratelimit-remaining']).toBe('0');
	});

	it('still counts paths that only look like /health', async () => {
		const app = tinyLimitApp();

		// Not the endpoint (404), so each one counts: the second is already a 429.
		expect((await request(app).get('/health/extra')).status).toBe(404);
		expect((await request(app).post('/health')).status).toBe(429);
	});

	it('answers 429 in the standard envelope once the limit is used', async () => {
		const app = tinyLimitApp();

		expect((await request(app).get('/no-existe')).status).toBe(404);
		const res = await request(app).get('/no-existe');

		expect(res.status).toBe(429);
		expect(res.body).toEqual({ error: { code: 'RATE_LIMITED', message: expect.any(String), details: { limite: 'general' } } });
		expect(res.headers['cache-control']).toBe('no-store');
	});

	it('the 429 is never cacheable, on any route kind (T-08 follow-up)', async () => {
		for (const [method, path] of [['get', '/health/extra'], ['post', '/auth/me'], ['get', '/admin/deportes'], ['get', '/monedas'], ['post', '/auth/logout']] as const) {
			const app = tinyLimitApp();
			await request(app)[method](path);
			const res = await request(app)[method](path);
			expect(res.status, path).toBe(429);
			expect(res.headers['cache-control'], path).toBe('no-store');
			await pool?.end();
			pool = undefined;
		}
	});

	it('does not count GET /auth/me (D-009): it has its own, roomier limit', async () => {
		const created = createTestApp({ rateLimit: { ...env.rateLimit, max: 1 }, sessionReadRateLimit: { ...env.sessionReadRateLimit, max: 3 } });
		pool = created.pool;
		const app = created.app;

		// Same variants the router takes; without a session they are 401, never a 429 from the global limit.
		for (const path of ['/auth/me', '/auth/me/', '/AUTH/ME']) {
			const res = await request(app).get(path);
			expect(res.status, path).toBe(401);
		}
		// The global budget (1) is still whole.
		const counted = await request(app).get('/no-existe');
		expect(counted.status).toBe(404);
		expect(counted.headers['ratelimit-remaining']).toBe('0');

		// Its own limit counts it: the fourth read is a 429 that says which limit it was.
		const blocked = await request(app).get('/auth/me');
		expect(blocked.status).toBe(429);
		expect(blocked.body).toEqual({ error: { code: 'RATE_LIMITED', message: expect.any(String), details: { limite: 'sesion' } } });
		expect(blocked.headers['cache-control']).toBe('no-store');
		expect(blocked.headers['retry-after']).toBeDefined();
		// Other methods on that path are not the session read: the global limit counts them.
		expect((await request(app).post('/auth/me')).status).toBe(429);
	});

	it('the default session-read limit is roomier than the global one', () => {
		expect(env.sessionReadRateLimit.max / env.sessionReadRateLimit.windowMs).toBeGreaterThan(env.rateLimit.max / env.rateLimit.windowMs);
	});

	/**
	 * D-032: the skip for `/public` is by path **and** method, like
	 * `isHealthCheck`. These two fix the two halves of it.
	 */
	it('does not count GET or HEAD under /public: it has its own limit', async () => {
		const app = tinyLimitApp();

		// The variants the public router takes (Router() is case insensitive).
		for (const path of ['/public/deportes', '/PUBLIC/deportes']) {
			expect((await request(app).get(path)).status, path).toBe(200);
		}
		expect((await request(app).head('/public/deportes')).status).toBe(200);

		// The one allowed request is still available after those three.
		const counted = await request(app).get('/no-existe');
		expect(counted.status).toBe(404);
		expect(counted.headers['ratelimit-remaining']).toBe('0');
	});

	it('still counts other methods under /public, a refused Origin included', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		try {
			// The public API is read-only, so a write there is a 404 — but a
			// counted one: it uses up the single request.
			const plain = tinyLimitApp();
			expect((await request(plain).post('/public/deportes')).status).toBe(404);
			expect((await request(plain).get('/no-existe')).status).toBe(429);
			await pool?.end();
			pool = undefined;

			// The case that motivated D-032: `csrfProtection` runs before the
			// public router, and so before that router's own limiter. Skipping by
			// path alone, this reached the Origin check — which writes a line to
			// the server log (D-06) — having passed no limiter at all.
			const foreign = tinyLimitApp();
			const refused = await request(foreign).post('/public/deportes').set('Origin', 'https://ajeno.ejemplo');
			expect(refused.status).toBe(403);
			expect(refused.body.error.code).toBe('CSRF_FAILED');
			expect((await request(foreign).get('/no-existe')).status).toBe(429);
		} finally {
			warn.mockRestore();
		}
	});

	it('counts a request before its body is parsed', async () => {
		const app = tinyLimitApp();
		const invalid = () => request(app).post('/no-existe').set('Content-Type', 'application/json').send('{bad');

		expect((await invalid()).status).toBe(400);
		// Limiter first: the second invalid body is rejected as 429, never parsed.
		expect((await invalid()).status).toBe(429);
	});
});
