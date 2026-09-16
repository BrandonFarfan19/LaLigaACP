import { createRequire } from 'node:module';
import type { Pool } from 'mysql2/promise';
import { pingDatabase } from '../db/pool.js';
import { HttpError } from '../lib/http-error.js';

// `createRequire` reads package.json reliably in an ESM module without the
// TS/Node friction of `import ... with { type: 'json' }`; the relative depth
// is the same from `src/services/` (dev) and `dist/services/` (build).
const { version } = createRequire(import.meta.url)('../../package.json') as { version: string };

export interface HealthStatus {
	status: 'ok';
	database: 'up';
	version: string;
}

/**
 * Throws `HttpError.serviceUnavailable()` if the database doesn't answer —
 * `GET /health` never blocks the app from starting (see `db/pool.ts`'s
 * comment): this is a live, per-request check, retried once, so a very
 * transient blip doesn't flip the whole endpoint red.
 */
export async function checkHealth(pool: Pool): Promise<HealthStatus> {
	const up = await pingDatabase(pool, { retries: 1, delayMs: 300 });
	if (!up) {
		throw HttpError.serviceUnavailable('No se pudo conectar a la base de datos.');
	}
	return { status: 'ok', database: 'up', version };
}
