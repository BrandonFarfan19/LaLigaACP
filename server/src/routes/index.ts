import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { createHealthRouter } from './health.route.js';

/**
 * Every future resource (T-03 onward) mounts here the same way `health`
 * does: one `create<Resource>Router(pool)` per module, added to this list.
 * Nothing outside this file knows the URL layout of the app as a whole.
 */
export function createRouter(pool: Pool): Router {
	const router = Router();
	router.use('/health', createHealthRouter(pool));
	return router;
}
