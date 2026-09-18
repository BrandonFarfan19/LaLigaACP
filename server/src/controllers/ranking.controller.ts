import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { listAdminBetsQuery } from '../schemas/betting.schema.js';
import { paginationQuerySchema } from '../schemas/common.schema.js';
import { listAdminBets } from '../services/admin-bets.service.js';
import { getPoolStats, getRanking, listRanking } from '../services/ranking.service.js';

/**
 * T-15: the pool ranking (any session) and, for the admin, the full ranking
 * and the pool's figures. T-21: the admin's query of the bets placed.
 */
export function createRankingController(pool: Pool) {
	const ranking: RequestHandler = async (req, res) => {
		sendSuccess(res, await getRanking(pool, authUser(req).id));
	};

	const adminRanking: RequestHandler = async (req, res) => {
		sendSuccess(res, await listRanking(pool, paginationQuerySchema.parse(req.query)));
	};

	const stats: RequestHandler = async (_req, res) => {
		sendSuccess(res, await getPoolStats(pool));
	};

	const adminBets: RequestHandler = async (req, res) => {
		sendSuccess(res, await listAdminBets(pool, listAdminBetsQuery.parse(req.query)));
	};

	return { ranking, adminRanking, stats, adminBets };
}
