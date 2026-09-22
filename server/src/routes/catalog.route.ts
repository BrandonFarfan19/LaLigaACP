import { type RequestHandler, Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { type CatalogResource, createCatalogController } from '../controllers/catalog.controller.js';
import { createMediaController } from '../controllers/media.controller.js';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { rejectQueryParams } from '../middleware/no-query.js';
import * as schemas from '../schemas/catalog.schema.js';
import { idParamsSchema } from '../schemas/common.schema.js';
import * as matchSchemas from '../schemas/matches.schema.js';
import type { AdminActionHooks } from '../services/admin-action.js';
import * as competitions from '../services/competitions.service.js';
import * as enrollments from '../services/enrollments.service.js';
import type { MediaDeps } from '../services/goals.service.js';
import * as matches from '../services/matches.service.js';
import * as players from '../services/players.service.js';
import * as results from '../services/results.service.js';
import * as sports from '../services/sports.service.js';
import * as teams from '../services/teams.service.js';

/**
 * Admin CRUD of the sports catalog (T-06), mounted inside `/admin` (session +
 * admin role already required; writes need the CSRF token):
 *
 *   GET    /<recurso>        list (paginated, filters; strict query)
 *   GET    /<recurso>/:id    read
 *   POST   /<recurso>        create → 201
 *   PATCH  /<recurso>/:id    edit (only the fields sent)
 *   DELETE /<recurso>/:id    delete, only if nothing uses it → { id }
 *
 * Plus, for matches:
 *
 *   GET  /partidos/:id/resultado                                              preview, no effects (T-12, BR-030)
 *   PUT  /partidos/:id/resultado { golesLocal, golesVisitante }               load or correct (T-12, BR-028)
 *   POST /partidos/:id/resultado/confirmar { confirmar: true, golesLocal, golesVisitante }   final (T-12, BR-031, BR-032)
 *
 *   Goals (T-13, BR-033), from the kick-off until the result is confirmed:
 *   GET    /partidos/:id/goles
 *   POST   /partidos/:id/goles { jugadorId, equipoId, minuto }
 *   PATCH  /partidos/:id/goles/:golId { jugadorId?, equipoId?, minuto? }
 *   DELETE /partidos/:id/goles/:golId
 *   Their media, and the match's, from the kick-off on (also after confirming):
 *   PUT    /partidos/:id/goles/:golId/imagen   (multipart, field "imagen")
 *   DELETE /partidos/:id/goles/:golId/imagen
 *   PUT    /partidos/:id/goles/:golId/video { url }
 *   DELETE /partidos/:id/goles/:golId/video
 *   GET    /partidos/:id/multimedia
 *   POST   /partidos/:id/multimedia/imagenes   (multipart, field "imagen")
 *   POST   /partidos/:id/multimedia/videos { url }
 *   DELETE /partidos/:id/multimedia/:mediaId
 */

export interface CatalogRouterOptions {
	/** BR-015 checks from other modules (the Polla guard), wired by the composition root. */
	drawRuleGuards: readonly sports.DrawRuleGuard[];
	/** T-07: how many bets a match has (the Polla probe), wired by the composition root. */
	countBetsOnMatch: matches.MatchBetsProbe;
	/** T-12: how many pending selections a match has (the Polla probe). */
	countPendingSelections: results.PendingSelectionsProbe;
	/** T-12/T-14: settles a match's bets when its result is confirmed (the Polla settler). */
	settleMatch: results.MatchSettler;
	/** T-13: where uploaded images go, the upload parser and its rate limit. */
	media: { deps: MediaDeps; parseImage: RequestHandler; uploadLimit: RequestHandler };
	/** T-17: the audit hook for every write. */
	hooks?: AdminActionHooks;
}

function crudRouter<T, Q, C, U>(pool: Pool, resource: CatalogResource<T, Q, C, U>, hooks?: AdminActionHooks): Router {
	const router = Router();
	const controller = createCatalogController(pool, resource, hooks);
	router.get('/', controller.list);
	router.get('/:id', rejectQueryParams, controller.get);
	router.post('/', rejectQueryParams, controller.create);
	router.patch('/:id', rejectQueryParams, controller.update);
	router.delete('/:id', rejectQueryParams, controller.remove);

	return router;
}

export function createCatalogRouter(pool: Pool, options: CatalogRouterOptions): Router {
	const router = Router();
	const { hooks } = options;
	const matchDeps: matches.MatchDeps = { countBets: options.countBetsOnMatch };
	const resultDeps: results.ResultDeps = { countPendingSelections: options.countPendingSelections, settle: options.settleMatch };

	router.use(
		'/deportes',
		crudRouter(
			pool,
			{
				listQuery: schemas.listSportsQuery,
				createBody: schemas.createSportBody,
				updateBody: schemas.updateSportBody,
				list: sports.listSports,
				get: sports.getSport,
				create: sports.createSport,
				update: (p, ctx, id, body) => sports.updateSport(p, ctx, id, body, options.drawRuleGuards),
				remove: sports.deleteSport,
			},
			hooks,
		),
	);
	router.use(
		'/competiciones',
		crudRouter(
			pool,
			{
				listQuery: schemas.listCompetitionsQuery,
				createBody: schemas.createCompetitionBody,
				updateBody: schemas.updateCompetitionBody,
				list: competitions.listCompetitions,
				get: competitions.getCompetition,
				create: competitions.createCompetition,
				update: competitions.updateCompetition,
				remove: competitions.deleteCompetition,
			},
			hooks,
		),
	);
	router.use(
		'/equipos',
		crudRouter(
			pool,
			{
				listQuery: schemas.listTeamsQuery,
				createBody: schemas.createTeamBody,
				updateBody: schemas.updateTeamBody,
				list: teams.listTeams,
				get: teams.getTeam,
				create: teams.createTeam,
				update: teams.updateTeam,
				remove: teams.deleteTeam,
			},
			hooks,
		),
	);
	router.use(
		'/jugadores',
		crudRouter(
			pool,
			{
				listQuery: schemas.listPlayersQuery,
				createBody: schemas.createPlayerBody,
				updateBody: schemas.updatePlayerBody,
				list: players.listPlayers,
				get: players.getPlayer,
				create: players.createPlayer,
				update: players.updatePlayer,
				remove: players.deletePlayer,
			},
			hooks,
		),
	);
	router.use(
		'/planteles',
		crudRouter(
			pool,
			{
				listQuery: schemas.listEnrollmentsQuery,
				createBody: schemas.createEnrollmentBody,
				updateBody: schemas.updateEnrollmentBody,
				list: enrollments.listEnrollments,
				get: enrollments.getEnrollment,
				create: enrollments.createEnrollment,
				update: enrollments.updateEnrollment,
				remove: enrollments.deleteEnrollment,
			},
			hooks,
		),
	);

	const matchRouter = crudRouter(
		pool,
		{
			listQuery: matchSchemas.listMatchesQuery,
			createBody: matchSchemas.createMatchBody,
			updateBody: matchSchemas.updateMatchBody,
			list: (p, query) => matches.listMatches(p, query),
			get: matches.getMatch,
			create: (p, ctx, body) => matches.createMatch(p, ctx, body, matchDeps),
			update: (p, ctx, id, body) => matches.updateMatch(p, ctx, id, body, matchDeps),
			remove: (p, ctx, id) => matches.deleteMatch(p, ctx, id, matchDeps),
		},
		hooks,
	);
	// No manual state change (T-13): en_curso comes at the kick-off, finalizado with the
	// result (below) and cancelado with T-16's cancellation. POST /:id/estado is gone (404).
	matchRouter.get('/:id/resultado', rejectQueryParams, async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		sendSuccess(res, await results.getResultPreview(pool, id, resultDeps));
	});
	matchRouter.put('/:id/resultado', rejectQueryParams, async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		const body = matchSchemas.setResultBody.parse(req.body);
		sendSuccess(res, await results.setResult(pool, { actorId: authUser(req).id, hooks }, id, body, resultDeps));
	});
	matchRouter.post('/:id/resultado/confirmar', rejectQueryParams, async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		const body = matchSchemas.confirmResultBody.parse(req.body);
		sendSuccess(res, await results.confirmResult(pool, { actorId: authUser(req).id, hooks }, id, body, resultDeps));
	});
	const media = createMediaController(pool, options.media.deps, hooks);
	const { parseImage, uploadLimit } = options.media;
	matchRouter.get('/:id/goles', rejectQueryParams, media.listGoals);
	matchRouter.post('/:id/goles', rejectQueryParams, media.createGoal);
	matchRouter.patch('/:id/goles/:golId', rejectQueryParams, media.updateGoal);
	matchRouter.delete('/:id/goles/:golId', rejectQueryParams, media.deleteGoal);
	matchRouter.put('/:id/goles/:golId/imagen', uploadLimit, rejectQueryParams, parseImage, media.setGoalImage);
	matchRouter.delete('/:id/goles/:golId/imagen', rejectQueryParams, media.removeGoalImage);
	matchRouter.put('/:id/goles/:golId/video', rejectQueryParams, media.setGoalVideo);
	matchRouter.delete('/:id/goles/:golId/video', rejectQueryParams, media.removeGoalVideo);
	matchRouter.get('/:id/multimedia', rejectQueryParams, media.listMedia);
	matchRouter.post('/:id/multimedia/imagenes', uploadLimit, rejectQueryParams, parseImage, media.addImage);
	matchRouter.post('/:id/multimedia/videos', rejectQueryParams, media.addVideo);
	matchRouter.delete('/:id/multimedia/:mediaId', rejectQueryParams, media.deleteMedia);
	router.use('/partidos', matchRouter);

	return router;
}
