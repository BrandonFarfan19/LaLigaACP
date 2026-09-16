import mysql, { type Pool } from 'mysql2/promise';
import type { Env } from '../config/env.js';

/**
 * One pool per process, created from validated config. `timezone: 'Z'` tells
 * the driver every DATETIME is UTC — matching the server's own
 * `--default-time-zone=+00:00` (see `compose.yaml`) — so it never applies a
 * local-time conversion on the way in or out.
 *
 * A factory, not a bare singleton: `index.ts` creates the real pool from
 * `env` and threads it into `createApp()`; tests create their own (pointed
 * at the test database, or at an unreachable address to exercise the
 * unhealthy path) — see `tests/helpers/app.ts`.
 */
export function createPool(env: Env): Pool {
	return mysql.createPool({
		host: env.db.host,
		port: env.db.port,
		user: env.db.user,
		password: env.db.password,
		database: env.db.database,
		connectionLimit: env.db.poolSize,
		timezone: 'Z',
		connectTimeout: 5000,
		dateStrings: false,
	});
}

/**
 * A short-lived, retried liveness check — used by `GET /health` (D-nothing:
 * this is a runtime/per-request concern, not a startup gate; see
 * `services/health.service.ts`). Never throws: callers get `true`/`false`.
 */
export async function pingDatabase(pool: Pool, { retries = 1, delayMs = 300 } = {}): Promise<boolean> {
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			await pool.query('SELECT 1');
			return true;
		} catch {
			if (attempt === retries) return false;
			await new Promise((r) => setTimeout(r, delayMs));
		}
	}
	return false;
}
