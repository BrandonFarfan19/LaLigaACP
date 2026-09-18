import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
 * Uploaded images of this test process go to a temporary directory, never to
 * UPLOADS_DIR. The media store creates it on the first upload; the files that
 * upload remove it (`testUploadsRoot`) when they finish. It sits under a
 * dotted folder, like the local default `.data/uploads`, so serving an image
 * is tested with one (T-21 fix).
 */
export const testUploadsRoot = join(tmpdir(), `liga-uploads-${process.pid}-${Date.now()}`);
export const testUploadsDir = join(testUploadsRoot, '.data', 'uploads');

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
		uploadRateLimit: { ...env.uploadRateLimit, max: 10_000 },
		sessionReadRateLimit: { ...env.sessionReadRateLimit, max: 10_000 },
		uploads: { ...env.uploads, dir: testUploadsDir },
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
