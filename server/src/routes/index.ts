import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Env } from '../config/env.js';
import { createRequireAuth } from '../middleware/auth.js';
import { createAdminRouter } from './admin.route.js';
import { createAuthRouter } from './auth.route.js';
import { createHealthRouter } from './health.route.js';

/**
 * Every resource mounts here the same way: one `create<Resource>Router(...)`
 * per module, added to this list. Nothing outside this file knows the URL
 * layout of the app as a whole. `requireAuth` is built once and shared.
 */
export function createRouter(pool: Pool, env: Env): Router {
	const router = Router();
	const requireAuth = createRequireAuth(pool, env);

	router.use('/health', createHealthRouter(pool));
	router.use('/auth', createAuthRouter(pool, env, requireAuth));
	router.use('/admin', createAdminRouter(pool, requireAuth));
	return router;
}
