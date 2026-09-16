import { type RequestHandler, Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { createBettingController } from '../controllers/betting.controller.js';
import { requireBettor } from '../middleware/auth.js';
import { rejectQueryParams } from '../middleware/no-query.js';

/**
 * `/apuestas` (T-09, Módulo Polla). Only a validated `apostador`
 * (`requireBettor`): a `pendiente` user gets 403 `USER_NOT_VALIDATED`, an
 * admin 403 `ADMIN_CANNOT_BET`.
 *
 *   GET  /apuestas/partidos?deporteId=&competicionId=&desde=&hasta=&estadoApuesta=   (BR-051, BR-052, BR-013)
 *   POST /apuestas/vista-previa   { selecciones: [...] }   (BR-023; writes nothing, CSRF like every POST)
 *
 * T-10 adds the ticket confirmation here.
 */
export function createBettingRouter(pool: Pool, requireAuth: RequestHandler): Router {
	const router = Router();
	const controller = createBettingController(pool);
	router.use(requireAuth, requireBettor);

	router.get('/partidos', controller.matches);
	router.post('/vista-previa', rejectQueryParams, controller.preview);

	return router;
}
