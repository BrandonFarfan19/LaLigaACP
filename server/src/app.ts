import express, { type Express } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Env } from './config/env.js';
import { csrfProtection } from './middleware/csrf.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { applySecurity } from './middleware/security.js';
import { createRouter } from './routes/index.js';

/**
 * Builds the app without listening on a port, so tests can exercise it
 * directly through `supertest` — and so it never binds a real socket by
 * accident just by being imported.
 *
 * `pool` is a required argument, not read from a module-level singleton:
 * `index.ts` passes the real one; tests pass their own (see
 * `tests/helpers/app.ts`), including one pointed at an unreachable address
 * to exercise `GET /health`'s unhealthy path end-to-end.
 */
export function createApp({ pool, env }: { pool: Pool; env: Env }): Express {
	const app = express();
	// Nothing is cacheable unless a route says so (only /public successes do):
	// session data, balances, admin screens and every error or 429 (including
	// the ones the security middleware answers before any route) must never
	// be kept by a browser or proxy. First, so it covers everything below.
	app.use((_req, res, next) => {
		res.set('Cache-Control', 'no-store');
		next();
	});
	// Which proxies may set X-Forwarded-For. Off by default: req.ip (and so
	// every rate limit) uses the socket's address. See TRUST_PROXY in env.ts.
	app.set('trust proxy', env.trustProxy);

	applySecurity(app, env);
	app.use(csrfProtection(env));

	app.use(createRouter(pool, env));

	app.use(notFoundHandler);
	app.use(errorHandler);

	return app;
}
