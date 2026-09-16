import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compareByProximity } from '../src/lib/match-order.js';
import type { AdminActionOutcome } from '../src/services/admin-action.js';
import { countBetsOnMatch } from '../src/services/bets-match-probe.service.js';
import { changeMatchState } from '../src/services/matches.service.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertDrawBet, insertGoal, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** An ISO string `ms` from now, whole seconds, in UTC. */
const inMs = (ms: number) => new Date(Math.floor((Date.now() + ms) / 1000) * 1000).toISOString().replace('.000Z', 'Z');

describe('admin: partidos (BR-011 to BR-014)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	/** A sport with two competitions: `comp` has teams a, b, c; `other` has team x. */
	let ids: { sport: number; comp: number; other: number; a: number; b: number; c: number; x: number };

	const code = (res: { body: { error?: { code: string } } }) => res.body.error?.code;
	const matchBody = (overrides: Record<string, unknown> = {}) => ({
		competicionId: ids.comp,
		localId: ids.a,
		visitaId: ids.b,
		jornada: 1,
		fechaHora: inMs(3 * DAY),
		sede: 'Estadio Nacional',
		...overrides,
	});
	const createMatch = (overrides: Record<string, unknown> = {}) => created<{ id: number }>(api.post('/partidos', matchBody(overrides)));
	const setState = (id: number, estado: string) => api.post(`/partidos/${id}/estado`, { estado });

	async function sides(matchId: number) {
		const [rows] = await pool.query<RowDataPacket[]>(
			'SELECT equipo_id, competicion_id, es_visita, goles FROM partido_equipo WHERE partido_id = ? ORDER BY es_visita',
			[matchId],
		);
		return rows.map((r) => ({ equipoId: Number(r.equipo_id), competicionId: Number(r.competicion_id), visita: Boolean(r.es_visita), goles: r.goles }));
	}

	async function enrollmentIn(teamId: number) {
		const player = await created<{ id: number }>(api.post('/jugadores', { nombre: `Jugador ${teamId}` }));
		return created<{ id: number }>(api.post('/planteles', { jugadorId: player.id, equipoId: teamId, numeroCamiseta: 9 }));
	}

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
		const comp = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Apertura' }));
		const other = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Clausura' }));
		const team = async (competicionId: number, nombre: string) => (await created<{ id: number }>(api.post('/equipos', teamBody(competicionId, { nombre })))).id;
		ids = {
			sport: sport.id,
			comp: comp.id,
			other: other.id,
			a: await team(comp.id, 'Alianza'),
			b: await team(comp.id, 'Boca'),
			c: await team(comp.id, 'Cristal'),
			x: await team(other.id, 'Xeneize'),
		};
	});

	afterAll(async () => {
		await pool.end();
	});

	describe('create', () => {
		it('creates the match programado with its two sides, goals empty', async () => {
			const fechaHora = inMs(3 * DAY);
			const res = await api.post('/partidos', matchBody({ fechaHora }));

			expect(res.status).toBe(201);
			expect(res.body.data).toEqual({
				id: expect.any(Number),
				competicionId: ids.comp,
				deporteId: ids.sport,
				estado: 'programado',
				jornada: 1,
				fechaHora: new Date(fechaHora).toISOString(),
				cierreApuestas: new Date(Date.parse(fechaHora) - DAY).toISOString(),
				sede: 'Estadio Nacional',
				local: { equipoId: ids.a, nombre: 'Alianza', goles: null },
				visita: { equipoId: ids.b, nombre: 'Boca', goles: null },
			});
			expect(await sides(res.body.data.id)).toEqual([
				{ equipoId: ids.a, competicionId: ids.comp, visita: false, goles: null },
				{ equipoId: ids.b, competicionId: ids.comp, visita: true, goles: null },
			]);
		});

		it('stores the instant in UTC, whatever the offset sent, to the second', async () => {
			const local = new Date(Date.now() + 5 * DAY);
			local.setUTCHours(23, 30, 0, 0);
			// Same instant written as Lima time (UTC-5), with milliseconds.
			const lima = new Date(local.getTime() - 5 * HOUR).toISOString().replace('.000Z', '.456-05:00');
			const { id } = await createMatch({ fechaHora: lima });

			const [[row]] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(fecha_hora, '%Y-%m-%dT%H:%i:%s') AS f FROM partido WHERE id = ?", [id]);
			expect(row!.f).toBe(local.toISOString().slice(0, 19));
		});

		it('two equal teams -> 400 SAME_TEAM', async () => {
			const res = await api.post('/partidos', matchBody({ visitaId: ids.a }));

			expect(res.status).toBe(400);
			expect(code(res)).toBe('SAME_TEAM');
		});

		it('a team of another competition -> 409 COMPETITION_MISMATCH, saying which side', async () => {
			const res = await api.post('/partidos', matchBody({ visitaId: ids.x }));

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'COMPETITION_MISMATCH', details: { lado: 'visita', equipoId: ids.x, competicionDelEquipo: ids.other } });
			const [[count]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM partido');
			expect(count!.n).toBe(0);
		});

		it('unknown team or competition -> 404', async () => {
			expect(code(await api.post('/partidos', matchBody({ localId: 999999 })))).toBe('TEAM_NOT_FOUND');
			expect(code(await api.post('/partidos', matchBody({ competicionId: 999999 })))).toBe('COMPETITION_NOT_FOUND');
		});

		it('a date in the past -> 400 MATCH_DATE_IN_PAST', async () => {
			const res = await api.post('/partidos', matchBody({ fechaHora: inMs(-HOUR) }));

			expect(res.status).toBe(400);
			expect(code(res)).toBe('MATCH_DATE_IN_PAST');
		});

		it.each([
			['no zone', { fechaHora: '2030-10-01T18:00:00' }, 'fechaHora'],
			['no seconds', { fechaHora: '2030-10-01T18:00Z' }, 'fechaHora'],
			['space instead of T', { fechaHora: '2030-10-01 18:00:00Z' }, 'fechaHora'],
			['February 30', { fechaHora: '2030-02-30T18:00:00Z' }, 'fechaHora'],
			['hour 24', { fechaHora: '2030-10-01T24:00:00Z' }, 'fechaHora'],
			['offset without colon', { fechaHora: '2030-10-01T18:00:00+0500' }, 'fechaHora'],
			['a timestamp number', { fechaHora: 1_900_000_000_000 }, 'fechaHora'],
			['year 2100', { fechaHora: '2100-01-01T00:00:00Z' }, 'fechaHora'],
			['jornada 0', { jornada: 0 }, 'jornada'],
			['blank sede', { sede: '  ' }, 'sede'],
			['sede with a newline inside', { sede: 'Estadio\nNacional' }, 'sede'],
			['goals', { golesLocal: 1 }, ''],
			['a state', { estado: 'en_curso' }, ''],
			['localId as a string', { localId: String(1) }, 'localId'],
		])('%s -> 400', async (_label, overrides, path) => {
			const res = await api.post('/partidos', matchBody(overrides));

			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
			expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
		});
	});

	describe('list (BR-013)', () => {
		it('orders by proximity: upcoming soonest first, then past most recent first', async () => {
			const now = Date.now();
			const past1 = await insertMatch(pool, ids.comp, ids.a, ids.b, 'finalizado', new Date(now - 2 * DAY));
			const past2 = await insertMatch(pool, ids.comp, ids.a, ids.c, 'finalizado', new Date(now - 10 * DAY));
			const past3 = await insertMatch(pool, ids.comp, ids.b, ids.c, 'en_curso', new Date(now - HOUR));
			const soon = (await createMatch({ fechaHora: inMs(2 * HOUR) })).id;
			const later = (await createMatch({ fechaHora: inMs(9 * DAY) })).id;
			const mid = (await createMatch({ fechaHora: inMs(4 * DAY), localId: ids.b, visitaId: ids.c })).id;

			const res = await api.get('/partidos');

			expect(res.status).toBe(200);
			const items = res.body.data.items as Array<{ id: number; fechaHora: string }>;
			expect(items.map((m) => m.id)).toEqual([soon, mid, later, past3, past1, past2]);
			// Same order as the in-memory definition every view shares.
			const byDefinition = [...items]
				.map((m) => ({ id: m.id, fechaHora: new Date(m.fechaHora) }))
				.sort((x, y) => compareByProximity(x, y, new Date()));
			expect(byDefinition.map((m) => m.id)).toEqual(items.map((m) => m.id));
		});

		it('same date: lowest id first; and pages keep the order', async () => {
			const fechaHora = inMs(2 * DAY);
			const first = (await createMatch({ fechaHora })).id;
			const second = (await createMatch({ fechaHora, localId: ids.b, visitaId: ids.c })).id;
			const third = (await createMatch({ fechaHora: inMs(DAY + HOUR), localId: ids.c, visitaId: ids.a })).id;

			expect((await api.get('/partidos?pageSize=2')).body.data.items.map((m: { id: number }) => m.id)).toEqual([third, first]);
			const page2 = await api.get('/partidos?pageSize=2&page=2');
			expect(page2.body.data).toMatchObject({ total: 3, totalPages: 2 });
			expect(page2.body.data.items.map((m: { id: number }) => m.id)).toEqual([second]);
		});

		it('filters by sport, competition, team, state and date range', async () => {
			const otherSport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Vóley', permiteEmpate: false }));
			const otherComp = await created<{ id: number }>(api.post('/competiciones', { deporteId: otherSport.id, nombre: 'Liga' }));
			const v1 = (await created<{ id: number }>(api.post('/equipos', teamBody(otherComp.id, { nombre: 'V1' })))).id;
			const v2 = (await created<{ id: number }>(api.post('/equipos', teamBody(otherComp.id, { nombre: 'V2' })))).id;
			const ab = (await createMatch({ fechaHora: inMs(2 * DAY) })).id;
			const bc = (await createMatch({ fechaHora: inMs(5 * DAY), localId: ids.b, visitaId: ids.c })).id;
			const voley = (await createMatch({ competicionId: otherComp.id, localId: v1, visitaId: v2, fechaHora: inMs(3 * DAY) })).id;
			const started = await insertMatch(pool, ids.comp, ids.c, ids.a, 'en_curso', new Date(Date.now() - HOUR));
			const list = async (q: string) => (await api.get(`/partidos?${q}`)).body.data.items.map((m: { id: number }) => m.id);

			expect(await list(`deporteId=${otherSport.id}`)).toEqual([voley]);
			expect(await list(`deporteId=${ids.sport}`)).toEqual([ab, bc, started]);
			expect(await list(`competicionId=${ids.comp}&estado=programado`)).toEqual([ab, bc]);
			expect(await list(`equipoId=${ids.a}`)).toEqual([ab, started]);
			expect(await list('estado=en_curso')).toEqual([started]);
			expect(await list(`desde=${inMs(DAY)}&hasta=${inMs(4 * DAY)}`)).toEqual([ab, voley]);
			expect(await list(`desde=${encodeURIComponent(new Date(Date.now() + 4 * DAY).toISOString().replace('Z', '+00:00'))}`)).toEqual([bc]);
			expect(await list(`hasta=${inMs(0)}`)).toEqual([started]);
		});

		it.each([
			['desde after hasta', `desde=${inMs(2 * DAY)}&hasta=${inMs(DAY)}`, 'hasta'],
			['desde without zone', 'desde=2030-01-01T00:00:00', 'desde'],
			['unknown state', 'estado=suspendido', 'estado'],
			['unknown key', 'fecha=2030-01-01', ''],
			['bad id', 'equipoId=abc', 'equipoId'],
			['pageSize over 100', 'pageSize=101', 'pageSize'],
		])('%s -> 400', async (_label, query, path) => {
			const res = await api.get(`/partidos?${query}`);

			expect(res.status).toBe(400);
			expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
		});
	});

	describe('states (BR-012)', () => {
		it('programado -> en_curso once betting closed, and back while it has no goals', async () => {
			const { id } = await createMatch({ fechaHora: inMs(HOUR) });

			const started = await setState(id, 'en_curso');
			expect(started.status).toBe(200);
			expect(started.body.data.estado).toBe('en_curso');

			const back = await setState(id, 'programado');
			expect(back.status).toBe(200);
			expect(back.body.data.estado).toBe('programado');
		});

		it('programado -> en_curso while betting is still open -> 409', async () => {
			const { id } = await createMatch({ fechaHora: inMs(3 * DAY) });

			const res = await setState(id, 'en_curso');

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { desde: 'programado', hacia: 'en_curso' } });
		});

		it.each([
			['programado', 'finalizado'],
			['programado', 'cancelado'],
			['programado', 'programado'],
			['en_curso', 'finalizado'],
			['en_curso', 'cancelado'],
			['en_curso', 'en_curso'],
			['finalizado', 'en_curso'],
			['finalizado', 'programado'],
			['cancelado', 'programado'],
			['cancelado', 'en_curso'],
		] as const)('%s -> %s is rejected with 409 and nothing changes', async (desde, hacia) => {
			const id = await insertMatch(pool, ids.comp, ids.a, ids.b, desde, new Date(Date.now() + HOUR));

			const res = await setState(id, hacia);

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { desde, hacia } });
			expect((await api.get(`/partidos/${id}`)).body.data.estado).toBe(desde);
		});

		it('en_curso with goals cannot go back to programado', async () => {
			const id = await insertMatch(pool, ids.comp, ids.a, ids.b, 'en_curso', new Date(Date.now() - HOUR));
			await insertGoal(pool, id, ids.a, (await enrollmentIn(ids.a)).id);

			expect(code(await setState(id, 'programado'))).toBe('INVALID_STATE_TRANSITION');
		});

		it('bad input: unknown state 400, unknown match 404, extra field 400', async () => {
			const { id } = await createMatch();
			expect((await setState(id, 'suspendido')).status).toBe(400);
			expect(code(await setState(999999, 'en_curso'))).toBe('MATCH_NOT_FOUND');
			expect((await api.post(`/partidos/${id}/estado`, { estado: 'en_curso', motivo: 'x' })).status).toBe(400);
			expect((await api.post(`/partidos/${id}/estado?x=1`, { estado: 'en_curso' })).status).toBe(400);
		});

		it('the audit hook sees cambiar_estado_partido', async () => {
			const { id } = await createMatch({ fechaHora: inMs(HOUR) });
			const seen: AdminActionOutcome[] = [];

			await changeMatchState(
				pool,
				{ actorId: api.admin.user.id, hooks: { inTransaction: async (_c, o) => void seen.push(o) } },
				id,
				'en_curso',
				{ countBets: countBetsOnMatch },
			);

			expect(seen).toEqual([
				expect.objectContaining({
					action: 'cambiar_estado_partido',
					entity: 'partido',
					id,
					before: expect.objectContaining({ estado: 'programado' }),
					after: expect.objectContaining({ estado: 'en_curso' }),
				}),
			]);
		});
	});

	describe('edit (BR-011, BR-014)', () => {
		it('changes jornada, venue, date and teams while programado and without bets', async () => {
			const { id } = await createMatch();
			const fechaHora = inMs(2 * DAY);

			const res = await api.patch(`/partidos/${id}`, { jornada: 3, sede: 'Monumental', fechaHora, localId: ids.b, visitaId: ids.a });

			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({
				jornada: 3,
				sede: 'Monumental',
				fechaHora: new Date(fechaHora).toISOString(),
				local: { equipoId: ids.b },
				visita: { equipoId: ids.a },
			});
			expect(await sides(id)).toEqual([
				{ equipoId: ids.b, competicionId: ids.comp, visita: false, goles: null },
				{ equipoId: ids.a, competicionId: ids.comp, visita: true, goles: null },
			]);
		});

		it('moves to another competition only together with teams of it', async () => {
			const y = (await created<{ id: number }>(api.post('/equipos', teamBody(ids.other, { nombre: 'Yacaré' })))).id;
			const { id } = await createMatch();

			expect(code(await api.patch(`/partidos/${id}`, { competicionId: ids.other }))).toBe('COMPETITION_MISMATCH');
			expect(code(await api.patch(`/partidos/${id}`, { competicionId: ids.other, localId: ids.x }))).toBe('COMPETITION_MISMATCH');

			const res = await api.patch(`/partidos/${id}`, { competicionId: ids.other, localId: ids.x, visitaId: y });
			expect(res.status).toBe(200);
			expect(await sides(id)).toEqual([
				{ equipoId: ids.x, competicionId: ids.other, visita: false, goles: null },
				{ equipoId: y, competicionId: ids.other, visita: true, goles: null },
			]);
		});

		it('same team on both sides -> 400 SAME_TEAM', async () => {
			const { id } = await createMatch();

			expect(code(await api.patch(`/partidos/${id}`, { visitaId: ids.a }))).toBe('SAME_TEAM');
		});

		it.each(['finalizado', 'cancelado'] as const)('a %s match is locked: 409 MATCH_LOCKED', async (estado) => {
			const id = await insertMatch(pool, ids.comp, ids.a, ids.b, estado, new Date(Date.now() - DAY));

			const res = await api.patch(`/partidos/${id}`, { sede: 'Otra' });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'MATCH_LOCKED', details: { estado } });
			expect((await api.get(`/partidos/${id}`)).body.data.sede).toBe('Estadio');
		});

		it('an en_curso match: venue and jornada yes, date and teams no', async () => {
			const id = await insertMatch(pool, ids.comp, ids.a, ids.b, 'en_curso', new Date(Date.now() - HOUR));

			expect((await api.patch(`/partidos/${id}`, { sede: 'Otra', jornada: 2 })).status).toBe(200);
			expect(code(await api.patch(`/partidos/${id}`, { fechaHora: inMs(DAY) }))).toBe('MATCH_NOT_PROGRAMMED');
			expect(code(await api.patch(`/partidos/${id}`, { localId: ids.c }))).toBe('MATCH_NOT_PROGRAMMED');
		});

		it('never writes goals: they are not part of the body', async () => {
			const { id } = await createMatch();

			for (const body of [{ golesLocal: 2 }, { local: { goles: 2 } }, { estado: 'finalizado' }]) {
				expect((await api.patch(`/partidos/${id}`, body)).status).toBe(400);
			}
			expect((await sides(id)).map((s) => s.goles)).toEqual([null, null]);
		});

		it('the new date must be in the future', async () => {
			const { id } = await createMatch();

			expect(code(await api.patch(`/partidos/${id}`, { fechaHora: inMs(-DAY) }))).toBe('MATCH_DATE_IN_PAST');
		});

		describe('with bets', () => {
			it('teams and competition cannot change: 409 MATCH_HAS_BETS', async () => {
				const { id } = await createMatch();
				await insertDrawBet(app, pool, id);

				const res = await api.patch(`/partidos/${id}`, { localId: ids.c });

				expect(res.status).toBe(409);
				expect(res.body.error).toMatchObject({ code: 'MATCH_HAS_BETS', details: { apuestas: 1 } });
				expect((await sides(id)).map((s) => s.equipoId)).toEqual([ids.a, ids.b]);
			});

			it('the date can only be postponed, never brought forward', async () => {
				const fechaHora = inMs(3 * DAY);
				const { id } = await createMatch({ fechaHora });
				await insertDrawBet(app, pool, id);

				const earlier = await api.patch(`/partidos/${id}`, { fechaHora: inMs(2 * DAY) });
				expect(earlier.status).toBe(409);
				expect(earlier.body.error).toMatchObject({ code: 'MATCH_HAS_BETS', details: { apuestas: 1 } });

				const later = inMs(6 * DAY);
				const res = await api.patch(`/partidos/${id}`, { fechaHora: later });
				expect(res.status).toBe(200);
				// The betting close moves with it.
				expect(res.body.data.cierreApuestas).toBe(new Date(Date.parse(later) - DAY).toISOString());
			});

			it('venue and jornada still change; without bets, bringing the date forward is fine', async () => {
				const withBets = (await createMatch()).id;
				await insertDrawBet(app, pool, withBets);
				expect((await api.patch(`/partidos/${withBets}`, { sede: 'Otra', jornada: 5 })).status).toBe(200);

				const free = (await createMatch({ fechaHora: inMs(5 * DAY), localId: ids.b, visitaId: ids.c })).id;
				expect((await api.patch(`/partidos/${free}`, { fechaHora: inMs(2 * DAY) })).status).toBe(200);
			});
		});
	});

	describe('delete', () => {
		it('deletes a free match with its two sides', async () => {
			const { id } = await createMatch();

			const res = await api.del(`/partidos/${id}`);

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ data: { id } });
			expect(await sides(id)).toEqual([]);
			expect(code(await api.get(`/partidos/${id}`))).toBe('MATCH_NOT_FOUND');
		});

		it('refuses one with bets, one with goals and a finished one', async () => {
			const withBets = (await createMatch()).id;
			await insertDrawBet(app, pool, withBets);
			expect((await api.del(`/partidos/${withBets}`)).body.error).toMatchObject({ code: 'MATCH_HAS_BETS', details: { apuestas: 1, goles: 0 } });

			const withGoals = await insertMatch(pool, ids.comp, ids.a, ids.c, 'en_curso', new Date(Date.now() - HOUR));
			await insertGoal(pool, withGoals, ids.a, (await enrollmentIn(ids.a)).id);
			expect((await api.del(`/partidos/${withGoals}`)).body.error).toMatchObject({ code: 'MATCH_HAS_GOALS', details: { goles: 1 } });

			const finished = await insertMatch(pool, ids.comp, ids.b, ids.c, 'finalizado', new Date(Date.now() - DAY));
			expect((await api.del(`/partidos/${finished}`)).body.error).toMatchObject({ code: 'MATCH_LOCKED' });

			for (const id of [withBets, withGoals, finished]) expect((await sides(id)).length).toBe(2);
		});

		it('a cancelled match without bets can be deleted', async () => {
			const id = await insertMatch(pool, ids.comp, ids.a, ids.b, 'cancelado');

			expect((await api.del(`/partidos/${id}`)).status).toBe(200);
		});
	});

	describe('access', () => {
		it('401 without a session, 403 for an apostador, CSRF on writes', async () => {
			const { id } = await createMatch();
			for (const req of [
				request(app).get('/admin/partidos'),
				request(app).post('/admin/partidos').send(matchBody()),
				request(app).patch(`/admin/partidos/${id}`).send({ sede: 'X' }),
				request(app).post(`/admin/partidos/${id}/estado`).send({ estado: 'en_curso' }),
				request(app).delete(`/admin/partidos/${id}`),
			]) {
				expect((await req).status).toBe(401);
			}

			const user = await signedInUser(app, pool, { estado: 'validado' });
			const res = await request(app).get('/admin/partidos').set('Cookie', user.cookie);
			expect(res.status).toBe(403);

			const noCsrf = await request(app).post(`/admin/partidos/${id}/estado`).set('Cookie', api.admin.cookie).send({ estado: 'en_curso' });
			expect(noCsrf.status).toBe(403);
			expect(code(noCsrf)).toBe('CSRF_FAILED');
		});
	});

	describe('concurrency', () => {
		it('parallel team changes leave exactly one consistent pair', async () => {
			const d = (await created<{ id: number }>(api.post('/equipos', teamBody(ids.comp, { nombre: 'Deportivo' })))).id;
			const { id } = await createMatch();
			const pairs = [
				[ids.b, ids.a],
				[ids.c, d],
				[d, ids.a],
				[ids.a, ids.c],
				[ids.b, d],
			] as const;

			const results = await Promise.all(pairs.map(([localId, visitaId]) => api.patch(`/partidos/${id}`, { localId, visitaId })));

			expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
			const final = await sides(id);
			expect(final).toHaveLength(2);
			expect(final[0]!.equipoId).not.toBe(final[1]!.equipoId);
			expect(pairs.map((p) => `${p[0]}-${p[1]}`)).toContain(`${final[0]!.equipoId}-${final[1]!.equipoId}`);
			expect(final.every((s) => s.competicionId === ids.comp)).toBe(true);
		});

		it('parallel starts: exactly one passes', async () => {
			const { id } = await createMatch({ fechaHora: inMs(HOUR) });

			const statuses = (await Promise.all(Array.from({ length: 5 }, () => setState(id, 'en_curso')))).map((r) => r.status).sort();

			expect(statuses).toEqual([200, 409, 409, 409, 409]);
		});

		it('an edit and a new bet do not interleave: postponing sees the bet or the bet comes after', async () => {
			const { id } = await createMatch({ fechaHora: inMs(3 * DAY) });

			const [edit] = await Promise.all([api.patch(`/partidos/${id}`, { fechaHora: inMs(2 * DAY) }), insertDrawBet(app, pool, id)]);

			// Either the edit ran first (200, then the bet) or saw the bet (409); never a half state.
			expect([200, 409]).toContain(edit.status);
			const [[row]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM seleccion WHERE partido_id = ?', [id]);
			expect(row!.n).toBe(1);
		});
	});

	it('Informativo does not import Polla: the bets probe is injected', () => {
		const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src/services');
		for (const file of ['matches.service.ts', 'sports.service.ts']) {
			expect(readFileSync(resolve(src, file), 'utf8')).not.toMatch(/from '\.\/bets-/);
		}
	});
});
