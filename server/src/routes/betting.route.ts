import { type RequestHandler, Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { createBettingController } from '../controllers/betting.controller.js';
import { requireBettor, requireParticipant } from '../middleware/auth.js';
import { rejectQueryParams } from '../middleware/no-query.js';

/**
 * `/apuestas` (T-09 to T-11, Módulo Polla). Everything needs a session.
 *
 *   GET  /apuestas/partidos?deporteId=&competicionId=&desde=&hasta=&estadoApuesta=   (BR-051, BR-052, BR-013)
 *   POST /apuestas/vista-previa   { selecciones }   (BR-023; writes nothing)
 *   POST /apuestas/tickets        { selecciones } + Idempotency-Key   (BR-024, BR-025, BR-053, BR-054)
 *   GET  /apuestas/tickets/:id    the receipt of one of the user's own tickets (BR-025)
 *   GET  /apuestas/mis-apuestas?estado=&estadoTicket=&ticketId=&partidoId=&deporteId=&competicionId=&desde=&hasta=   (BR-026)
 *   GET  /apuestas/mis-apuestas/resumen
 *
 * Betting routes are for a validated `apostador` only (`requireBettor`): a
 * `pendiente` user gets 403 `USER_NOT_VALIDATED`, an admin 403
 * `ADMIN_CANNOT_BET`. The receipt only needs a session and answers 404 for
 * any ticket that isn't the caller's (an admin has none), so ticket ids of
 * other users can't be probed. The history is for any `apostador`
 * (`requireParticipant`): a `pendiente` user just has none yet, and an admin
 * gets 403 `NOT_A_PARTICIPANT`, as in `/monedas`. POSTs go through CSRF like
 * every other one.
 */
export function createBettingRouter(pool: Pool, requireAuth: RequestHandler): Router {
	const router = Router();
	const controller = createBettingController(pool);
	router.use(requireAuth);

	router.get('/partidos', requireBettor, controller.matches);
	router.post('/vista-previa', requireBettor, rejectQueryParams, controller.preview);
	router.post('/tickets', requireBettor, rejectQueryParams, controller.confirm);
	router.get('/tickets/:id', rejectQueryParams, controller.ticket);
	router.get('/mis-apuestas', requireParticipant, controller.myBets);
	router.get('/mis-apuestas/resumen', requireParticipant, rejectQueryParams, controller.myBetsSummary);

	return router;
}
