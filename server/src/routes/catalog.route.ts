import { Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { type CatalogResource, createCatalogController } from '../controllers/catalog.controller.js';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { rejectQueryParams } from '../middleware/no-query.js';
import * as schemas from '../schemas/catalog.schema.js';
import { idParamsSchema } from '../schemas/common.schema.js';
import * as matchSchemas from '../schemas/matches.schema.js';
import type { AdminActionHooks } from '../services/admin-action.js';
import * as competitions from '../services/competitions.service.js';
import * as enrollments from '../services/enrollments.service.js';
import * as matches from '../services/matches.service.js';
import * as players from '../services/players.service.js';
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
 * Plus, for matches (T-07): POST /partidos/:id/estado { estado }.
 */

export interface CatalogRouterOptions {
	/** BR-015 checks from other modules (the Polla guard), wired by the composition root. */
	drawRuleGuards: readonly sports.DrawRuleGuard[];
	/** T-07: how many bets a match has (the Polla probe), wired by the composition root. */
	countBetsOnMatch: matches.MatchBetsProbe;
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
	matchRouter.post('/:id/estado', rejectQueryParams, async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		const { estado } = matchSchemas.changeStateBody.parse(req.body);
		sendSuccess(res, await matches.changeMatchState(pool, { actorId: authUser(req).id, hooks }, id, estado, matchDeps));
	});
	router.use('/partidos', matchRouter);

	return router;
}
