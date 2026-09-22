import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { paginationQuerySchema } from '../schemas/common.schema.js';
import { getBalance, listMovements } from '../services/coin-history.service.js';
import { checkCoinConsistency } from '../services/coins-consistency.service.js';

/** `/monedas` (the participant's own) and `/admin/monedas` (the consistency report). */
export function createCoinsController(pool: Pool) {
	const balance: RequestHandler = async (req, res) => {
		sendSuccess(res, { saldoMonedas: await getBalance(pool, authUser(req).id) });
	};

	const movements: RequestHandler = async (req, res) => {
		sendSuccess(res, await listMovements(pool, authUser(req).id, paginationQuerySchema.parse(req.query)));
	};

	const consistency: RequestHandler = async (_req, res) => {
		sendSuccess(res, await checkCoinConsistency(pool));
	};

	return { balance, movements, consistency };
}
