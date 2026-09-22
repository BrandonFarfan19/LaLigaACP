import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	DURACION_PARTIDO_MINUTOS,
	effectiveState,
	effectiveStateCondition,
	hasEnded,
	hasStarted,
	MATCH_STATES,
	type MatchState,
	matchEndTime,
} from '../src/lib/match-state.js';
import { countBetsOnMatch, countPendingSelections } from '../src/services/bets-match-probe.service.js';
import { listBettingMatches, previewTicket } from '../src/services/betting.service.js';
import { deleteMatch, listMatches, updateMatch } from '../src/services/matches.service.js';
import { listFixture } from '../src/services/public.service.js';
import { confirmResult, getResultPreview, type ResultDeps, setResult } from '../src/services/results.service.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/**
 * T-13 step 0: a match starts by itself at its fecha_hora and lasts 60
 * minutes. Every rule is checked at the edges with an injected `now`:
 * kick-off - 1 ms, kick-off, end - 1 ms and end.
 */
describe('effective match state (T-13 step 0, BR-012)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	let comp: number;
	let sport: number;
	let teams: [number, number];
	/** A whole-second kick-off three days ahead: the edges are injected around it. */
	const kickoff = new Date(Math.floor((Date.now() + 3 * DAY) / 1000) * 1000);
	const at = (ms: number) => new Date(kickoff.getTime() + ms);
	const END = DURACION_PARTIDO_MINUTOS * MINUTE;

	const newMatch = (estado: MatchState = 'programado') => insertMatch(pool, comp, teams[0], teams[1], estado, kickoff);
	const ctx = () => ({ actorId: api.admin.user.id });
	const resultDeps = (now: Date): ResultDeps => ({ countPendingSelections, settle: async () => {}, now: () => now });
	const storedState = async (id: number) => {
		const [[row]] = await pool.query<RowDataPacket[]>('SELECT ep.codigo FROM partido p JOIN estado_partido ep ON ep.id = p.estado_partido_id WHERE p.id = ?', [id]);
		return row!.codigo as string;
	};

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		sport = (await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }))).id;
		comp = (await created<{ id: number }>(api.post('/competiciones', { deporteId: sport, nombre: 'Liga' }))).id;
		teams = [
			(await created<{ id: number }>(api.post('/equipos', teamBody(comp, { nombre: 'Alianza' })))).id,
			(await created<{ id: number }>(api.post('/equipos', teamBody(comp, { nombre: 'Boca' })))).id,
		];
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('the rule, in TypeScript and in SQL', () => {
		it('starts at the kick-off and ends 60 minutes later', () => {
			expect(DURACION_PARTIDO_MINUTOS).toBe(60);
			expect(matchEndTime(kickoff)).toEqual(at(END));
			expect([hasStarted(kickoff, at(-1)), hasStarted(kickoff, at(0))]).toEqual([false, true]);
			expect([hasEnded(kickoff, at(END - 1)), hasEnded(kickoff, at(END))]).toEqual([false, true]);
			expect([effectiveState('programado', kickoff, at(-1)), effectiveState('programado', kickoff, at(0))]).toEqual(['programado', 'en_curso']);
			// After the 60 minutes it is still en_curso until the result is confirmed.
			expect(effectiveState('programado', kickoff, at(10 * DAY))).toBe('en_curso');
			for (const stored of ['en_curso', 'finalizado', 'cancelado'] as const) {
				expect(effectiveState(stored, kickoff, at(-DAY))).toBe(stored);
			}
		});

		it('the SQL condition agrees with effectiveState for every stored state, at every edge', async () => {
			for (const stored of MATCH_STATES) {
				for (const ms of [-DAY, -1, 0, 1, END - 1, END]) {
					const now = at(ms);
					const expected = effectiveState(stored, kickoff, now);
					for (const state of MATCH_STATES) {
						const condition = effectiveStateCondition(state, now);
						// Parameters go in the order of the placeholders: the condition first, then the derived tables.
						const [[checked]] = await pool.query<RowDataPacket[]>(
							`SELECT ${condition.sql} AS hit FROM (SELECT CAST(? AS DATETIME) AS fecha_hora) p, (SELECT ? AS codigo) ep`,
							[...condition.params, kickoff, stored],
						);
						expect(Number(checked!.hit), `${stored} at ${ms} ms as ${state}`).toBe(state === expected ? 1 : 0);
					}
				}
			}
		});
	});

	describe('reads use the effective state', () => {
		it('public fixture: state and the estado filter flip at the kick-off', async () => {
			const id = await newMatch();
			const view = async (now: Date) => {
				const all = await listFixture(pool, { page: 1, pageSize: 100 }, now);
				const programado = await listFixture(pool, { page: 1, pageSize: 100, estado: 'programado' }, now);
				const enCurso = await listFixture(pool, { page: 1, pageSize: 100, estado: 'en_curso' }, now);
				return {
					estado: all.items.find((m) => m.id === id)!.estado,
					programado: programado.items.some((m) => m.id === id),
					enCurso: enCurso.items.some((m) => m.id === id),
				};
			};
			expect(await view(at(-1))).toEqual({ estado: 'programado', programado: true, enCurso: false });
			expect(await view(at(0))).toEqual({ estado: 'en_curso', programado: false, enCurso: true });
			expect(await view(at(END))).toEqual({ estado: 'en_curso', programado: false, enCurso: true });
		});

		it('admin list: same flip', async () => {
			const id = await newMatch();
			const inState = async (estado: MatchState, now: Date) =>
				(await listMatches(pool, { page: 1, pageSize: 100, estado }, now)).items.some((m) => m.id === id);
			expect([await inState('programado', at(-1)), await inState('en_curso', at(-1))]).toEqual([true, false]);
			expect([await inState('programado', at(0)), await inState('en_curso', at(0))]).toEqual([false, true]);
		});

		it('betting list: cerrada until the kick-off, then en_curso; a ticket gets MATCH_NOT_PROGRAMMED', async () => {
			const id = await newMatch();
			const bettor = await signedInUser(app, pool, { estado: 'validado' });
			const view = async (now: Date) => {
				const all = await listBettingMatches(pool, { page: 1, pageSize: 100 }, now);
				const cerrada = await listBettingMatches(pool, { page: 1, pageSize: 100, estadoApuesta: 'cerrada' }, now);
				const enCurso = await listBettingMatches(pool, { page: 1, pageSize: 100, estadoApuesta: 'en_curso' }, now);
				const ticket = await previewTicket(pool, bettor.user.id, [{ partidoId: id, tipo: 'resultado_general', pronostico: 'empate' }], now);
				const match = all.items.find((m) => m.id === id)!;
				return {
					estado: match.estado,
					apuesta: match.apuesta.estado,
					cerrada: cerrada.items.some((m) => m.id === id),
					enCurso: enCurso.items.some((m) => m.id === id),
					errores: ticket.selecciones[0]!.errores.map((e) => e.code),
				};
			};
			expect(await view(at(-1))).toEqual({ estado: 'programado', apuesta: 'cerrada', cerrada: true, enCurso: false, errores: ['BETTING_CLOSED'] });
			expect(await view(at(0))).toEqual({ estado: 'en_curso', apuesta: 'en_curso', cerrada: false, enCurso: true, errores: ['MATCH_NOT_PROGRAMMED'] });
		});

		it('HTTP: a match still stored as programado whose kick-off passed shows en_curso everywhere', async () => {
			const id = await insertMatch(pool, comp, teams[0], teams[1], 'programado', new Date(Math.floor((Date.now() - MINUTE) / 1000) * 1000));
			expect((await request(app).get(`/public/partidos/${id}`)).body.data.estado).toBe('en_curso');
			expect((await request(app).get('/public/partidos?estado=en_curso')).body.data.items.map((m: { id: number }) => m.id)).toContain(id);
			expect((await api.get(`/partidos/${id}`)).body.data.estado).toBe('en_curso');
			expect(await storedState(id)).toBe('programado');
		});
	});

	describe('T-07 rules use it', () => {
		it('postponing: allowed 1 ms before the kick-off, refused at the kick-off', async () => {
			const id = await newMatch();
			const later = new Date(kickoff.getTime() + DAY);
			const deps = (now: Date) => ({ countBets: countBetsOnMatch, now: () => now });
			const refused = updateMatch(pool, ctx(), id, { fechaHora: later }, deps(at(0)));
			await expect(refused).rejects.toMatchObject({ code: 'MATCH_NOT_PROGRAMMED' });
			const ok = await updateMatch(pool, ctx(), id, { fechaHora: later }, deps(at(-1)));
			expect(ok.fechaHora).toEqual(later);
		});

		it('deleting: allowed before the kick-off, refused at it', async () => {
			const deps = (now: Date) => ({ countBets: countBetsOnMatch, now: () => now });
			const started = await newMatch();
			await expect(deleteMatch(pool, ctx(), started, deps(at(0)))).rejects.toMatchObject({ code: 'MATCH_NOT_PROGRAMMED' });
			const notYet = await newMatch();
			await deleteMatch(pool, ctx(), notYet, deps(at(-1)));
			const [[row]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM partido WHERE id = ?', [notYet]);
			expect(Number(row!.n)).toBe(0);
		});

		it('permite_empate is locked once any of the sport\'s matches started, even if still stored as programado', async () => {
			const otherSport = (await created<{ id: number }>(api.post('/deportes', { nombre: 'Handball', permiteEmpate: true }))).id;
			const otherComp = (await created<{ id: number }>(api.post('/competiciones', { deporteId: otherSport, nombre: 'Liga H' }))).id;
			const h1 = (await created<{ id: number }>(api.post('/equipos', teamBody(otherComp, { nombre: 'H1' })))).id;
			const h2 = (await created<{ id: number }>(api.post('/equipos', teamBody(otherComp, { nombre: 'H2' })))).id;
			await insertMatch(pool, otherComp, h1, h2, 'programado', new Date(Math.floor((Date.now() - MINUTE) / 1000) * 1000));
			const res = await api.patch(`/deportes/${otherSport}`, { permiteEmpate: false });
			expect(res.status).toBe(409);
			expect(res.body.error.code).toBe('DRAW_RULE_LOCKED');
		});
	});

	describe('T-12 rules use it', () => {
		it('loading the result: refused 1 ms before the kick-off, allowed at it (and stored as en_curso)', async () => {
			const id = await newMatch();
			await expect(setResult(pool, ctx(), id, { golesLocal: 1, golesVisitante: 0 }, resultDeps(at(-1)))).rejects.toMatchObject({
				code: 'RESULT_NOT_ALLOWED_YET',
			});
			expect(await storedState(id)).toBe('programado');
			const loaded = await setResult(pool, ctx(), id, { golesLocal: 1, golesVisitante: 0 }, resultDeps(at(0)));
			expect(loaded).toMatchObject({ estado: 'en_curso', local: { goles: 1 } });
			expect(await storedState(id)).toBe('en_curso');
		});

		it('confirming: refused until 60 minutes after the kick-off (1 ms before the end), allowed at the end', async () => {
			const id = await newMatch();
			await setResult(pool, ctx(), id, { golesLocal: 2, golesVisitante: 2 }, resultDeps(at(MINUTE)));
			const body = { confirmar: true as const, golesLocal: 2, golesVisitante: 2 };

			const preview = await getResultPreview(pool, id, resultDeps(at(END - 1)));
			expect(preview).toMatchObject({ puedeConfirmar: false, problemas: [{ code: 'MATCH_NOT_ENDED' }], confirmableDesde: at(END) });
			await expect(confirmResult(pool, ctx(), id, body, resultDeps(at(END - 1)))).rejects.toMatchObject({ code: 'MATCH_NOT_ENDED' });
			expect(await storedState(id)).toBe('en_curso');

			expect((await getResultPreview(pool, id, resultDeps(at(END)))).puedeConfirmar).toBe(true);
			const confirmed = await confirmResult(pool, ctx(), id, body, resultDeps(at(END)));
			expect(confirmed.partido.estado).toBe('finalizado');
		});

		it('a match never loaded, long past its time, can still be loaded and confirmed', async () => {
			const id = await newMatch();
			await setResult(pool, ctx(), id, { golesLocal: 0, golesVisitante: 1 }, resultDeps(at(30 * DAY)));
			const confirmed = await confirmResult(pool, ctx(), id, { confirmar: true, golesLocal: 0, golesVisitante: 1 }, resultDeps(at(30 * DAY)));
			expect(confirmed.resultado.resultado).toBe('visitante_gana');
		});
	});
});
