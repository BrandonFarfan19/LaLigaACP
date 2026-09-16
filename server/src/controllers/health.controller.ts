import type { Request, RequestHandler, Response } from 'express';
import type { Pool } from 'mysql2/promise';
import { checkHealth } from '../services/health.service.js';
import { sendSuccess } from '../lib/response.js';

/**
 * A factory, not a bare handler: the pool is injected so tests can point it
 * at a database that's up, or deliberately unreachable, without touching
 * global state — see `tests/helpers/app.ts`.
 */
export function createHealthController(pool: Pool): RequestHandler {
	return async (_req: Request, res: Response) => {
		const status = await checkHealth(pool);
		sendSuccess(res, status);
	};
}
