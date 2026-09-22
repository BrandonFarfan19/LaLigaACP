import { describe, expect, it } from 'vitest';
import { apiRoutes } from '../test/betting-fixtures';
import { fail, json, mockFetch, ok, type RecordedCall } from '../test/fetch-mock';
import { aguilas, apiMatch, apiTeamDetail, copa, halcones, liga, leagueRoutes, matchesRoute, page, pumas, squadMember, standingRow } from '../test/league-fixtures';
import { defaultCompetition, getTeamWithSquad, imageSrc, listCompetitions, listFixture, listSports, listStandings, listTeams } from './league';

/**
 * The league's data layer against the public API (T-22): every field mapped,
 * 400 and 404 as "no existe", and the fixture asked for by competition.
 */

const params = (call: RecordedCall) => Object.fromEntries(new URL(call.url, 'http://x').searchParams);
const gets = (calls: RecordedCall[], path: string) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === path);

/** Dates around a fixed "now", so the proximity order of the simulated API is the one the test means. */
const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const hours = (count: number) => new Date(NOW + count * 3_600_000).toISOString();

describe('league data layer (T-22)', () => {
	it('maps sports and competitions with their sport', async () => {
		mockFetch(apiRoutes(leagueRoutes()));

		expect(await listSports()).toEqual([
			{ id: '1', name: 'Fútbol' },
			{ id: '2', name: 'Vóley' },
		]);
		expect(await listCompetitions()).toEqual([
			{ id: '10', name: 'Liga Apertura', sport: { id: '1', name: 'Fútbol' } },
			{ id: '11', name: 'Copa Vóley', sport: { id: '2', name: 'Vóley' } },
		]);
	});

	it('maps a team: numeric id as text, Spanish names, and the crest only if an <img> may load it', async () => {
		mockFetch(apiRoutes(leagueRoutes()));

		const teams = await listTeams('10');
		expect(teams[0]).toEqual({ id: '100', name: 'Halcones', shortName: 'HAL', competitionId: '10', crest: '/escudos/halcones.webp', accent: '#3cf281' });
		expect(teams[1]!.crest).toBe('https://img.test/pumas.png');
		expect((await listTeams('11'))[0]!.crest).toBe('/escudos/aguilas.webp');
	});

	it('only accepts a crest an <img> may load', () => {
		expect(imageSrc('escudos/club.webp')).toBe('/escudos/club.webp');
		expect(imageSrc('https://img.test/a.png')).toBe('https://img.test/a.png');
		for (const bad of ['javascript:alert(1)', '//evil.test/a.png', '../secret.png', '/ya-absoluta.png', 'http://img.test/a.png', 'sin-extension', '', null, undefined, 7, {}]) {
			expect(imageSrc(bad), String(bad)).toBeNull();
		}
	});

	it('maps a match: its state, its teams and a score only with the official result (BR-049)', async () => {
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/partidos': () =>
						ok(
							page([
								apiMatch({ id: 1, jornada: 2, estado: 'finalizado', goles: [2, 1], sede: 'Estadio Sur' }),
								apiMatch({ id: 2, estado: 'en_curso' }),
								apiMatch({ id: 3, estado: 'cancelado' }),
								// Finished but with only one side loaded: no score is shown.
								{ ...apiMatch({ id: 4, estado: 'finalizado' }), local: { equipo: halcones, goles: 3 }, visita: { equipo: pumas, goles: null } },
							]),
						),
				}),
			),
		);

		const { matches } = await listFixture('10');
		expect(matches[0]).toEqual({
			id: '1',
			matchday: 2,
			kickoff: '2026-10-01T20:00:00.000Z',
			venue: 'Estadio Sur',
			status: 'finished',
			score: { home: 2, away: 1 },
			competition: { id: '10', name: 'Liga Apertura', sport: { id: '1', name: 'Fútbol' } },
			homeTeam: { id: '100', name: 'Halcones', shortName: 'HAL', competitionId: '10', crest: '/escudos/halcones.webp', accent: '#3cf281' },
			awayTeam: { id: '101', name: 'Pumas', shortName: 'PUM', competitionId: '10', crest: 'https://img.test/pumas.png', accent: '#ffd23f' },
		});
		expect(matches.map((match) => match.status)).toEqual(['finished', 'live', 'cancelled', 'finished']);
		expect(matches[3]!.score).toBeUndefined();
	});

	it('asks the fixture by competition, 100 at a time, and walks only the pages there are', async () => {
		const { calls } = mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/partidos': ({ url }) => {
						const asked = Number(new URL(url, 'http://x').searchParams.get('page')) || 1;
						return ok(page([apiMatch({ id: asked })], { page: asked, total: 150, totalPages: 2 }));
					},
				}),
			),
		);

		const { matches, truncated } = await listFixture('10', { matchday: 3 });

		expect(matches.map((match) => match.id)).toEqual(['1', '2']);
		expect(truncated).toBe(false);
		expect(gets(calls, '/api/public/partidos').map(params)).toEqual([
			{ competicionId: '10', jornada: '3', page: '1', pageSize: '100' },
			{ competicionId: '10', jornada: '3', page: '2', pageSize: '100' },
		]);
	});

	it('a competition with more matches than the pages it reads says it was cut (T-22 fix)', async () => {
		// 900 matches: the read stops at its fifth page and says there are more.
		const all = Array.from({ length: 900 }, (_, index) => apiMatch({ id: index + 1, fechaHora: hours(index + 1) }));
		const { calls } = mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/partidos': matchesRoute(all, NOW) })));

		const { matches, truncated } = await listFixture('10');

		expect(matches).toHaveLength(500);
		expect(truncated).toBe(true);
		expect(gets(calls, '/api/public/partidos')).toHaveLength(5);
		// Exactly the whole thing is not "cut": 500 matches in five pages.
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/partidos': matchesRoute(all.slice(0, 500), NOW) })));
		expect((await listFixture('10')).truncated).toBe(false);
	});

	it('maps the table onto the front types, with every column of BR-050', async () => {
		mockFetch(apiRoutes(leagueRoutes()));

		const rows = await listStandings('10');

		expect(rows[0]).toEqual({
			position: 1,
			team: { id: '100', name: 'Halcones', shortName: 'HAL', competitionId: '10', crest: '/escudos/halcones.webp', accent: '#3cf281' },
			played: 3,
			won: 3,
			drawn: 0,
			lost: 0,
			goalsFor: 5,
			goalsAgainst: 2,
			goalDifference: 3,
			points: 9,
		});
		// The API's order is kept as it comes: nothing is sorted or recomputed here.
		expect(rows.map((row) => [row.position, row.team.name, row.points])).toEqual([
			[1, 'Halcones', 9],
			[2, 'Pumas', 3],
		]);
		// Not a single Spanish key reaches the screen.
		expect(Object.keys(rows[0]!).some((key) => ['posicion', 'puntos', 'equipo', 'jugados', 'diferencia'].includes(key))).toBe(false);
	});

	it('a negative goal difference is kept as it comes', async () => {
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/competiciones/10/posiciones': () => ok({ competicion: liga, filas: [standingRow(pumas, 1, 0, { diferencia: -4, golesAFavor: 1, golesEnContra: 5 })] }) })));

		expect(await listStandings('10')).toMatchObject([{ goalDifference: -4, goalsFor: 1, goalsAgainst: 5 }]);
	});

	it('a team with its squad: shirt numbers and photos as the API gives them', async () => {
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/equipos/100': () => ok(apiTeamDetail(halcones, liga, [squadMember(500, 'Luis Paredes', 9, 'fotos/luis.webp'), squadMember(501, 'Sofía Díaz', 4)])) })));

		const found = await getTeamWithSquad('100');

		expect(found?.team.id).toBe('100');
		expect(found?.competition).toEqual({ id: '10', name: 'Liga Apertura', sport: { id: '1', name: 'Fútbol' } });
		expect(found?.players).toEqual([
			{ id: '500', teamId: '100', name: 'Luis Paredes', photo: '/fotos/luis.webp', shirtNumber: 9 },
			{ id: '501', teamId: '100', name: 'Sofía Díaz', photo: null, shirtNumber: 4 },
		]);
	});

	it('an id that does not exist (404) and one the API refuses (400) are both "no existe"', async () => {
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/equipos/999': () => fail(404, 'TEAM_NOT_FOUND', 'No existe ese equipo.'),
					'GET /api/public/equipos/abc': () => fail(400, 'VALIDATION_ERROR', 'El id debe ser un entero positivo.'),
				}),
			),
		);

		expect(await getTeamWithSquad('999')).toBeUndefined();
		expect(await getTeamWithSquad('abc')).toBeUndefined();
	});

	it('a competition that does not exist leaves its teams and its table empty, never an error page', async () => {
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/competiciones/77/equipos': () => fail(404, 'COMPETITION_NOT_FOUND', 'No existe.'),
					'GET /api/public/competiciones/77/posiciones': () => fail(404, 'COMPETITION_NOT_FOUND', 'No existe.'),
				}),
			),
		);

		expect(await listTeams('77')).toEqual([]);
		expect(await listStandings('77')).toEqual([]);
	});

	it('a server that is down is not "no existe": it reaches the page as a failure', async () => {
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/equipos/100': () => new Response('', { status: 502 }) })));

		await expect(getTeamWithSquad('100')).rejects.toMatchObject({ status: 502 });
	});
});

describe('which competition a page opens on (D-021)', () => {
	/** The API with these matches and nothing else; every other route is the usual one. */
	const withMatches = (all: ReturnType<typeof apiMatch>[]) => mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/partidos': matchesRoute(all, NOW) })));

	it('1. the competition of the next scheduled match, even with matches already played', async () => {
		const { calls } = withMatches([
			apiMatch({ id: 1, estado: 'finalizado', fechaHora: hours(-2), goles: [2, 1] }),
			apiMatch({ id: 2, estado: 'programado', fechaHora: hours(48), competicion: copa, local: aguilas, visita: aguilas }),
			apiMatch({ id: 3, estado: 'programado', fechaHora: hours(96) }),
		]);

		expect((await defaultCompetition()).competition).toMatchObject({ id: '11', name: 'Copa Vóley' });
		// One read, and it doesn't drag the whole fixture along.
		expect(gets(calls, '/api/public/partidos')).toHaveLength(1);
		expect(params(gets(calls, '/api/public/partidos')[0]!)).toEqual({ page: '1', pageSize: '20' });
	});

	it('2. with nothing scheduled, the most recent match actually played, never a cancelled one', async () => {
		withMatches([
			// The most recent of all is cancelled: it never had a score and never counted.
			apiMatch({ id: 1, estado: 'cancelado', fechaHora: hours(-1), competicion: copa, local: aguilas, visita: aguilas }),
			apiMatch({ id: 2, estado: 'finalizado', fechaHora: hours(-5), goles: [1, 0] }),
			apiMatch({ id: 3, estado: 'finalizado', fechaHora: hours(-50), goles: [0, 0] }),
		]);

		expect((await defaultCompetition()).competition).toMatchObject({ id: '10', name: 'Liga Apertura' });
	});

	it('2b. a match in progress counts as played', async () => {
		withMatches([apiMatch({ id: 1, estado: 'en_curso', fechaHora: hours(-1), competicion: copa, local: aguilas, visita: aguilas })]);

		expect((await defaultCompetition()).competition).toMatchObject({ id: '11' });
	});

	it('3. with only cancelled matches, the most recent of those, so a competition with matches still wins', async () => {
		withMatches([
			apiMatch({ id: 1, estado: 'cancelado', fechaHora: hours(-2), competicion: copa, local: aguilas, visita: aguilas }),
			apiMatch({ id: 2, estado: 'cancelado', fechaHora: hours(-40) }),
		]);

		expect((await defaultCompetition()).competition).toMatchObject({ id: '11', name: 'Copa Vóley' });
	});

	it('a page full of cancelled matches does not hide a scheduled one behind it', async () => {
		// 30 cancelled matches ahead of the scheduled one: the first page (20) is all cancelled.
		const all = [
			...Array.from({ length: 30 }, (_, index) => apiMatch({ id: index + 1, estado: 'cancelado', fechaHora: hours(index + 1), competicion: copa, local: aguilas, visita: aguilas })),
			apiMatch({ id: 99, estado: 'programado', fechaHora: hours(200) }),
		];
		const { calls } = withMatches(all);

		expect((await defaultCompetition()).competition).toMatchObject({ id: '10', name: 'Liga Apertura' });
		// Only then is the scheduled one asked for exactly.
		expect(gets(calls, '/api/public/partidos').map(params)).toEqual([
			{ page: '1', pageSize: '20' },
			{ estado: 'programado', pageSize: '1' },
		]);
	});

	it('4. with no matches at all there is no competition to open on', async () => {
		withMatches([]);

		expect(await defaultCompetition()).toEqual({ competition: undefined, matches: null });
	});

	it('with a sport chosen, the rule runs among that sport matches (T-22 second fix)', async () => {
		const { calls } = withMatches([
			// Sooner, but another sport: it must not decide the football view.
			apiMatch({ id: 1, fechaHora: hours(2), competicion: copa, local: aguilas, visita: aguilas }),
			apiMatch({ id: 2, fechaHora: hours(30) }),
		]);

		expect((await defaultCompetition({ sportId: '1' })).competition).toMatchObject({ id: '10', name: 'Liga Apertura' });
		expect(params(gets(calls, '/api/public/partidos')[0]!)).toEqual({ deporteId: '1', page: '1', pageSize: '20' });
		// Without a sport, the soonest of all wins, whatever its sport.
		expect((await defaultCompetition()).competition).toMatchObject({ id: '11', name: 'Copa Vóley' });
	});

	it('a sport with no matches has no competition to open on: the caller falls back to its list', async () => {
		withMatches([apiMatch({ id: 1, fechaHora: hours(2), competicion: copa, local: aguilas, visita: aguilas })]);

		expect(await defaultCompetition({ sportId: '1' })).toEqual({ competition: undefined, matches: null });
	});

	it('the sport also travels in the exact read for a page of nothing but cancelled matches', async () => {
		const all = [
			...Array.from({ length: 30 }, (_, index) => apiMatch({ id: index + 1, estado: 'cancelado', fechaHora: hours(index + 1) })),
			apiMatch({ id: 99, estado: 'programado', fechaHora: hours(200) }),
		];
		const { calls } = withMatches(all);

		await defaultCompetition({ sportId: '1' });

		expect(gets(calls, '/api/public/partidos').map(params)).toEqual([
			{ deporteId: '1', page: '1', pageSize: '20' },
			{ deporteId: '1', estado: 'programado', pageSize: '1' },
		]);
	});

	it('the matches it read come back only when they are every match there is (T-22 fix)', async () => {
		const few = [apiMatch({ id: 1, fechaHora: hours(10) }), apiMatch({ id: 2, fechaHora: hours(20), competicion: copa, local: aguilas, visita: aguilas })];
		withMatches(few);
		const reusable = await defaultCompetition({ withMatches: true });
		expect(reusable.matches?.map((match) => match.id)).toEqual(['1', '2']);

		// More than one page: what it read is not the whole fixture, so it is not offered.
		withMatches(Array.from({ length: 150 }, (_, index) => apiMatch({ id: index + 1, fechaHora: hours(index + 1) })));
		expect((await defaultCompetition({ withMatches: true })).matches).toBeNull();
	});
});

describe('a body that is not the contract (T-22 fix)', () => {
	const bodies = [null, 'texto', 42, { otra: 'cosa' }, [1, 2]];

	it('an answer with another shape is a transient failure, not a crash', async () => {
		for (const body of bodies) {
			mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/deportes': () => ok(body) })));
			// status 0 is what `isTransientError` reads: the page keeps its notice and "Reintentar".
			await expect(listSports(), String(body)).rejects.toMatchObject({ status: 0, code: 'BAD_RESPONSE' });
		}
	});

	it('a page without items, a table without rows and a squad without players are all caught', async () => {
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/partidos': () => ok({ page: 1 }),
					'GET /api/public/competiciones/10/posiciones': () => ok({ competicion: liga, filas: 'ninguna' }),
					'GET /api/public/equipos/100': () => ok({ ...halcones, competicion: liga, deporte: liga.deporte, plantel: null }),
				}),
			),
		);

		await expect(listFixture('10')).rejects.toMatchObject({ status: 0, code: 'BAD_RESPONSE' });
		await expect(listStandings('10')).rejects.toMatchObject({ status: 0, code: 'BAD_RESPONSE' });
		await expect(getTeamWithSquad('100')).rejects.toMatchObject({ status: 0, code: 'BAD_RESPONSE' });
	});

	it('a row missing a field, or with a state nobody knows, is caught too', async () => {
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/partidos': () => ok(page([{ ...apiMatch({ id: 1 }), local: null }])),
					'GET /api/public/competiciones/10/posiciones': () => ok({ competicion: liga, filas: [{ ...standingRow(halcones, 1, 3), diferencia: null }] }),
					'GET /api/public/competiciones/11/equipos': () => ok([{ ...aguilas, nombre: undefined }]),
				}),
			),
		);

		await expect(listFixture('10')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
		await expect(listStandings('10')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
		await expect(listTeams('11')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });

		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/partidos': () => ok(page([{ ...apiMatch({ id: 1 }), estado: 'suspendido' }])) })));
		await expect(listFixture('10')).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
	});

	it('an envelope without `data` at all is still a failure with a message, never a TypeError', async () => {
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/deportes': () => json(200, { otra: 'cosa' }) })));

		await expect(listSports()).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
	});
});
