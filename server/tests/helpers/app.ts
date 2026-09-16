import { createApp } from '../../src/app.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { createPool } from '../../src/db/pool.js';

/**
 * The validated env for tests. `env.db.database` resolves to
 * `MYSQL_DATABASE_TEST` because `vitest.config.ts` forces `NODE_ENV=test`,
 * whatever the terminal exported — see `src/config/env.ts`.
 */
export const env: Env = loadEnv();

/**
 * The real app, wired to the test database. `overrides` tweaks config (e.g. a
 * tiny rate limit). The global, login, registration and public limits default to generous
 * values here, because most files register and log in many users from the
 * same address; the files that test those limits set them explicitly.
 */
export function createTestApp(overrides: Partial<Env> = {}) {
	const testEnv: Env = {
		...env,
		rateLimit: { ...env.rateLimit, max: 10_000 },
		loginRateLimit: { ...env.loginRateLimit, max: 1000 },
		registerRateLimit: { ...env.registerRateLimit, max: 1000 },
		publicRateLimit: { ...env.publicRateLimit, max: 10_000 },
		...overrides,
	};
	const pool = createPool(testEnv);
	return { app: createApp({ pool, env: testEnv }), pool };
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
