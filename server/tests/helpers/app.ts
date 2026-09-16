import { createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';

/**
 * The real app, wired to the test database (`env.db.database` already
 * resolves to `MYSQL_DATABASE_TEST` here, since Vitest sets
 * `NODE_ENV=test` — see `src/config/env.ts`).
 */
export function createTestApp() {
	const pool = createPool(env);
	return { app: createApp({ pool, env }), pool };
}

/**
 * An app wired to an unreachable address, with a short connect timeout — for
 * exercising `GET /health`'s unhealthy path against a real (if fake)
 * connection failure, not a mock.
 */
export function createUnreachableApp() {
	const pool = createPool({ ...env, db: { ...env.db, host: '127.0.0.1', port: 1 } });
	return { app: createApp({ pool, env }), pool };
}
