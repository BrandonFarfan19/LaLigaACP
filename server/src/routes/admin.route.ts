import { Router, type RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { sendSuccess } from '../lib/response.js';
import { authUser, requireRole } from '../middleware/auth.js';
import { rejectQueryParams } from '../middleware/no-query.js';
import { createParticipantsRouter } from './participants.route.js';

/**
 * Everything under `/admin` requires a session (401) and the `admin` role
 * (403), applied once here. Admin resources mount on this router.
 */
export function createAdminRouter(pool: Pool, requireAuth: RequestHandler): Router {
	const router = Router();
	router.use(requireAuth, requireRole('admin'));

	/** Only confirms the guard. */
	router.get('/sesion', rejectQueryParams, (req, res) => {
		const { id, nombre, rol } = authUser(req);
		sendSuccess(res, { id, nombre, rol });
	});

	router.use('/participantes', createParticipantsRouter(pool));

	return router;
}
