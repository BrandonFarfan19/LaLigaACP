import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Env } from '../config/env.js';
import { createAuthController } from '../controllers/auth.controller.js';
import { loginRateLimit, registerRateLimit } from '../middleware/auth-rate-limits.js';
import { rejectQueryParams } from '../middleware/no-query.js';

export function createAuthRouter(pool: Pool, env: Env, requireAuth: RequestHandler): Router {
	const router = Router();
	const controller = createAuthController(pool, env);

	// None of these takes query parameters: an unexpected one is a 400.
	// On register and login it goes BEFORE the limiter: a request rejected for
	// its query string never reached the credentials or the account data, so
	// it must not count as a failed login or use up the registration limit.
	// (The global limiter still counts it, like any other request.)
	router.post('/register', rejectQueryParams, registerRateLimit(env), controller.register);
	router.post('/login', rejectQueryParams, loginRateLimit(env), controller.login);
	router.get('/me', requireAuth, rejectQueryParams, controller.me);
	router.post('/logout', requireAuth, rejectQueryParams, controller.logout);

	return router;
}
