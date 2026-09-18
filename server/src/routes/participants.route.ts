import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { createParticipantsController } from '../controllers/participants.controller.js';
import { rejectQueryParams } from '../middleware/no-query.js';
import type { ParticipantActionHooks } from '../services/participant-validation.service.js';

/** Mounted under `/admin`, which already requires a session and the `admin` role. */
export function createParticipantsRouter(pool: Pool, hooks?: ParticipantActionHooks): Router {
	const router = Router();
	const controller = createParticipantsController(pool, hooks);

	router.get('/', controller.list);
	router.get('/conteos', controller.counts);
	// The actions take only `:id`; a query string is a 400 (the list and the counts validate theirs).
	router.post('/:id/pago/confirmar', rejectQueryParams, controller.confirmPayment);
	router.post('/:id/pago/revertir', rejectQueryParams, controller.revertPayment);
	router.post('/:id/validar', rejectQueryParams, controller.validate);

	return router;
}
