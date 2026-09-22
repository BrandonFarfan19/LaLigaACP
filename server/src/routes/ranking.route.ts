import { type RequestHandler, Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { createRankingController } from '../controllers/ranking.controller.js';
import { rejectQueryParams } from '../middleware/no-query.js';

/**
 * `/ranking` (T-15, Módulo Polla, BR-041 to BR-044): any session (BR-002).
 *
 *   GET /ranking   { top, propia, participantes, posicionesTop }
 *
 * A `pendiente` user and an admin see it too, with `propia: null` (they are
 * not ranked). There is no public version: the ranking ties display names to
 * betting results, which only people inside the pool should see.
 */
export function createRankingRouter(pool: Pool, requireAuth: RequestHandler): Router {
	const router = Router();
	const controller = createRankingController(pool);
	router.get('/', requireAuth, rejectQueryParams, controller.ranking);
	return router;
}

/**
 * `/admin/polla` (T-15, BR-001): already behind `requireAuth` + `requireRole('admin')`.
 *
 *   GET /admin/polla/ranking?page=&pageSize=   the whole ranking, with each participant's id
 *   GET /admin/polla/estadisticas              participants, tickets and selections by state, coins, points
 *   GET /admin/polla/apuestas?...              T-21: the bets placed (one row per selection, participants only)
 */
export function createAdminPoolRouter(pool: Pool): Router {
	const router = Router();
	const controller = createRankingController(pool);
	router.get('/ranking', controller.adminRanking);
	router.get('/estadisticas', rejectQueryParams, controller.stats);
	router.get('/apuestas', controller.adminBets);
	return router;
}
