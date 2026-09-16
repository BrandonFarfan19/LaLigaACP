import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { confirmTicketBody, listBettingMatchesQuery, listMyBetsQuery, parseIdempotencyKey, ticketPreviewBody } from '../schemas/betting.schema.js';
import { idParamsSchema } from '../schemas/common.schema.js';
import { getMyBetsSummary, listMyBets } from '../services/bet-history.service.js';
import { listBettingMatches, previewTicket } from '../services/betting.service.js';
import { confirmTicket, getTicket } from '../services/tickets.service.js';

/** `/apuestas` (T-09 to T-11): match list, ticket preview, confirmation, receipt and history. */
export function createBettingController(pool: Pool) {
	const matches: RequestHandler = async (req, res) => {
		sendSuccess(res, await listBettingMatches(pool, listBettingMatchesQuery.parse(req.query)));
	};

	const preview: RequestHandler = async (req, res) => {
		const body = ticketPreviewBody.parse(req.body);
		sendSuccess(res, await previewTicket(pool, authUser(req).id, body.selecciones));
	};

	/** 201 with the new ticket, or 200 with the same one when the key repeats (`Idempotent-Replayed: true`). */
	const confirm: RequestHandler = async (req, res) => {
		const key = parseIdempotencyKey(req.get('Idempotency-Key'));
		if (!key) {
			throw new HttpError(
				400,
				ErrorCode.IDEMPOTENCY_KEY_INVALID,
				'Falta el header Idempotency-Key o no es un UUID. Generá uno nuevo por cada ticket y repetilo en los reintentos.',
			);
		}
		const body = confirmTicketBody.parse(req.body);
		const { ticket, repetido } = await confirmTicket(pool, authUser(req).id, key, body.selecciones);
		res.set('Location', `/apuestas/tickets/${ticket.id}`);
		if (repetido) res.set('Idempotent-Replayed', 'true');
		sendSuccess(res, ticket, repetido ? 200 : 201);
	};

	const ticket: RequestHandler = async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		sendSuccess(res, await getTicket(pool, authUser(req).id, id));
	};

	const myBets: RequestHandler = async (req, res) => {
		sendSuccess(res, await listMyBets(pool, authUser(req).id, listMyBetsQuery.parse(req.query)));
	};

	const myBetsSummary: RequestHandler = async (req, res) => {
		sendSuccess(res, await getMyBetsSummary(pool, authUser(req).id));
	};

	return { matches, preview, confirm, ticket, myBets, myBetsSummary };
}
