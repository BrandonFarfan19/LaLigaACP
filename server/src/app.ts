import express, { type Express } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Env } from './config/env.js';
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

	applySecurity(app, env);

	app.use(createRouter(pool));

	app.use(notFoundHandler);
	app.use(errorHandler);

	return app;
}
