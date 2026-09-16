import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { listBettingMatchesQuery, ticketPreviewBody } from '../schemas/betting.schema.js';
import { listBettingMatches, previewTicket } from '../services/betting.service.js';

/** `/apuestas` (T-09): the validated bettor's match list and ticket preview. */
export function createBettingController(pool: Pool) {
	const matches: RequestHandler = async (req, res) => {
		sendSuccess(res, await listBettingMatches(pool, listBettingMatchesQuery.parse(req.query)));
	};

	const preview: RequestHandler = async (req, res) => {
		const body = ticketPreviewBody.parse(req.body);
		sendSuccess(res, await previewTicket(pool, authUser(req).id, body.selecciones));
	};

	return { matches, preview };
}
