import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { createMatchCancellationController } from '../controllers/match-cancellation.controller.js';
import { rejectQueryParams } from '../middleware/no-query.js';
import type { AdminActionHooks } from '../services/admin-action.js';

/**
 * T-16 (Módulo Polla, BR-045 to BR-047), mounted at `/admin/partidos` (session,
 * admin role; the POST needs the CSRF token):
 *
 *   GET  /admin/partidos/:id/cancelacion                        preview, no effects
 *   POST /admin/partidos/:id/cancelacion/confirmar { confirmar: true }   cancel for good
 */
export function createMatchCancellationRouter(pool: Pool, hooks?: AdminActionHooks): Router {
	const router = Router();
	const controller = createMatchCancellationController(pool, hooks);
	router.get('/:id/cancelacion', rejectQueryParams, controller.preview);
	router.post('/:id/cancelacion/confirmar', rejectQueryParams, controller.cancel);
	return router;
}
