import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { createCoinsController } from '../controllers/coins.controller.js';
import { requireParticipant } from '../middleware/auth.js';
import { rejectQueryParams } from '../middleware/no-query.js';

/**
 * `/monedas`: the logged-in participant's own coins (BR-002, BR-010). A
 * `pendiente` user can read them too (balance 0, no movements); an admin
 * gets 403 `NOT_A_PARTICIPANT`.
 */
export function createCoinsRouter(pool: Pool, requireAuth: RequestHandler): Router {
	const router = Router();
	const controller = createCoinsController(pool);
	router.use(requireAuth, requireParticipant);

	router.get('/saldo', rejectQueryParams, controller.balance);
	router.get('/movimientos', controller.movements);

	return router;
}

/** `/admin/monedas`, mounted inside the admin router (session + admin role already required). */
export function createAdminCoinsRouter(pool: Pool): Router {
	const router = Router();
	const controller = createCoinsController(pool);

	router.get('/consistencia', rejectQueryParams, controller.consistency);

	return router;
}
