import { type RequestHandler, Router } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Env } from '../config/env.js';
import { sendSuccess } from '../lib/response.js';
import { publicRateLimit } from '../middleware/security.js';
import { idParamsSchema } from '../schemas/common.schema.js';
import { listFixtureQuery, listPublicCompetitionsQuery, noQuery } from '../schemas/public.schema.js';
import * as publicData from '../services/public.service.js';
import type { MediaStore } from '../services/media-storage.js';
import { serveImage } from '../controllers/media.controller.js';

/**
 * Public read-only API (T-08, Módulo Informativo), no session needed:
 *
 *   GET /public/deportes
 *   GET /public/competiciones?deporteId=            (paginated)
 *   GET /public/competiciones/:id
 *   GET /public/competiciones/:id/equipos
 *   GET /public/competiciones/:id/posiciones        (BR-050)
 *   GET /public/partidos?deporteId=&competicionId=&equipoId=&estado=&jornada=&desde=&hasta=   (BR-049, BR-013)
 *   GET /public/partidos/:id                        (with goals once finalizado)
 *   GET /public/equipos/:id                         (with squad)
 *   GET /public/archivos/:nombre                    an image of a match with its official result (T-13)
 *
 * Its own rate limit, and `Cache-Control: public, max-age=30` on success:
 * the answers are the same for everyone and nothing in them is private.
 * Errors are `no-store` (error handler).
 */

/** How long a browser or proxy may reuse a public answer. Short: results change on match days. */
export const PUBLIC_MAX_AGE_SECONDS = 30;

export function createPublicRouter(pool: Pool, env: Env, store: MediaStore): Router {
	const router = Router();
	router.use(publicRateLimit(env));

	/** Parses the query (strict) and `:id` when present, runs `load`, answers cacheable. */
	const handler =
		<Q>(querySchema: { parse(input: unknown): Q }, load: (query: Q, id: number) => Promise<unknown>): RequestHandler =>
		async (req, res) => {
			const query = querySchema.parse(req.query);
			const id = req.params.id === undefined ? 0 : idParamsSchema.parse(req.params).id;
			const data = await load(query, id);
			res.set('Cache-Control', `public, max-age=${PUBLIC_MAX_AGE_SECONDS}`);
			sendSuccess(res, data);
		};

	router.get('/deportes', handler(noQuery, () => publicData.listPublicSports(pool)));
	router.get('/competiciones', handler(listPublicCompetitionsQuery, (q) => publicData.listPublicCompetitions(pool, q)));
	router.get('/competiciones/:id', handler(noQuery, (_q, id) => publicData.getPublicCompetition(pool, id)));
	router.get('/competiciones/:id/equipos', handler(noQuery, (_q, id) => publicData.listCompetitionTeams(pool, id)));
	router.get('/competiciones/:id/posiciones', handler(noQuery, (_q, id) => publicData.getStandings(pool, id)));
	router.get('/partidos', handler(listFixtureQuery, (q) => publicData.listFixture(pool, q)));
	router.get('/partidos/:id', handler(noQuery, (_q, id) => publicData.getPublicMatch(pool, id)));
	router.get('/equipos/:id', handler(noQuery, (_q, id) => publicData.getPublicTeam(pool, id)));
	// T-13: images of matches with an official result (the handler sets its own headers).
	router.get('/archivos/:nombre', (req, _res, next) => {
		noQuery.parse(req.query);
		next();
	}, serveImage(pool, store, 'public'));

	return router;
}
