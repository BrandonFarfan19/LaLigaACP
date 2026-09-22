import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertInTransaction } from '../src/db/transaction.js';
import { officialResult, resultOfScore } from '../src/lib/match-result.js';
import type { AdminActionOutcome } from '../src/services/admin-action.js';
import { countPendingSelections } from '../src/services/bets-match-probe.service.js';
import { confirmResult, type MatchSettler, type ResultDeps, setResult } from '../src/services/results.service.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertDrawBet, insertGoal, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);
const noSettle: MatchSettler = async () => {};

describe('match results (T-12: BR-028 to BR-032)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	const s = {} as {
		futbol: number;
		voley: number;
		liga: number;
		ligaVoley: number;
		team: Record<string, number>;
		enrollment: Record<string, number>;
	};

	type Sport = 'futbol' | 'voley';
	/**
	 * A fresh match of the sport, in the state and at the date given. By default
	 * a programado one is a week ahead and the others started two hours ago
	 * (so their time is over, T-13).
	 */
	async function match(
		estado: 'programado' | 'en_curso' | 'finalizado' | 'cancelado',
		sport: Sport = 'futbol',
		fecha = new Date(Date.now() + (estado === 'programado' ? 7 * DAY : -2 * HOUR)),
	) {
		return sport === 'futbol'
			? insertMatch(pool, s.liga, s.team.A!, s.team.B!, estado, wholeSeconds(fecha.getTime()))
			: insertMatch(pool, s.ligaVoley, s.team.P!, s.team.Q!, estado, wholeSeconds(fecha.getTime()));
	}
	const load = (id: number | string, body: unknown) => api.put(`/partidos/${id}/resultado`, body);
	const preview = (id: number | string) => api.get(`/partidos/${id}/resultado`);
	const confirm = (id: number | string, body: unknown) => api.post(`/partidos/${id}/resultado/confirmar`, body);
	async function row(id: number) {
		const [[r]] = await pool.query<RowDataPacket[]>(
			`SELECT ep.codigo AS estado, p.fecha_hora, p.jornada, p.sede, p.competicion_id,
				(SELECT goles FROM partido_equipo WHERE partido_id = p.id AND es_visita = FALSE) AS local,
				(SELECT goles FROM partido_equipo WHERE partido_id = p.id AND es_visita = TRUE) AS visita
			FROM partido p JOIN estado_partido ep ON ep.id = p.estado_partido_id WHERE p.id = ?`,
			[id],
		);
		return r;
	}
	const setSides = (id: number, local: number | null, visita: number | null) =>
		pool.query('UPDATE partido_equipo SET goles = IF(es_visita, ?, ?) WHERE partido_id = ?', [visita, local, id]);
	const deps = (overrides: Partial<ResultDeps> = {}): ResultDeps => ({ countPendingSelections, settle: noSettle, ...overrides });

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		const post = (path: string, body: unknown) => created<{ id: number }>(api.post(path, body));
		s.futbol = (await post('/deportes', { nombre: 'Fútbol', permiteEmpate: true })).id;
		s.voley = (await post('/deportes', { nombre: 'Vóley', permiteEmpate: false })).id;
		s.liga = (await post('/competiciones', { deporteId: s.futbol, nombre: 'Liga' })).id;
		s.ligaVoley = (await post('/competiciones', { deporteId: s.voley, nombre: 'Liga Vóley' })).id;
		s.team = {};
		for (const [key, comp, nombre] of [['A', s.liga, 'Alianza'], ['B', s.liga, 'Boca'], ['P', s.ligaVoley, 'Pumas'], ['Q', s.ligaVoley, 'Quilmes']] as const) {
			s.team[key] = (await post('/equipos', teamBody(comp, { nombre }))).id;
		}
		const ana = (await post('/jugadores', { nombre: 'Ana Pérez' })).id;
		const bea = (await post('/jugadores', { nombre: 'Bea Soto' })).id;
		s.enrollment = {
			ana: (await post('/planteles', { jugadorId: ana, equipoId: s.team.A, numeroCamiseta: 9 })).id,
			bea: (await post('/planteles', { jugadorId: bea, equipoId: s.team.B, numeroCamiseta: 10 })).id,
		};
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('access', () => {
		it('anonymous 401, a bettor 403, and writes need the CSRF token', async () => {
			const id = await match('en_curso');
			for (const res of [
				await request(app).get(`/admin/partidos/${id}/resultado`),
				await request(app).put(`/admin/partidos/${id}/resultado`).send({ golesLocal: 1, golesVisitante: 0 }),
				await request(app).post(`/admin/partidos/${id}/resultado/confirmar`).send({ confirmar: true, golesLocal: 1, golesVisitante: 0 }),
			]) {
				expect(res.status).toBe(401);
			}
			const bettor = await signedInUser(app, pool, { estado: 'validado' });
			const asBettor = await request(app)
				.put(`/admin/partidos/${id}/resultado`)
				.set('Cookie', bettor.cookie)
				.set('X-CSRF-Token', bettor.csrfToken)
				.send({ golesLocal: 1, golesVisitante: 0 });
			expect(asBettor.status).toBe(403);

			for (const res of [
				await request(app).put(`/admin/partidos/${id}/resultado`).set('Cookie', api.admin.cookie).send({ golesLocal: 1, golesVisitante: 0 }),
				await request(app)
					.post(`/admin/partidos/${id}/resultado/confirmar`)
					.set('Cookie', api.admin.cookie)
					.send({ confirmar: true, golesLocal: 1, golesVisitante: 0 }),
			]) {
				expect(res.status).toBe(403);
				expect(res.body.error.code).toBe('CSRF_FAILED');
			}
			expect(await row(id)).toMatchObject({ estado: 'en_curso', local: null, visita: null });
		});
	});

	describe('loading the score (BR-028)', () => {
		it('in progress: loads both sides, then corrects them; the match stays en_curso', async () => {
			const id = await match('en_curso');
			const first = await load(id, { golesLocal: 2, golesVisitante: 1 });
			expect(first.status).toBe(200);
			expect(first.body.data).toMatchObject({ id, estado: 'en_curso', local: { goles: 2 }, visita: { goles: 1 } });

			const fixed = await load(id, { golesLocal: 1, golesVisitante: 1 });
			expect(fixed.body.data).toMatchObject({ local: { goles: 1 }, visita: { goles: 1 } });
			expect(await row(id)).toMatchObject({ estado: 'en_curso', local: 1, visita: 1 });
		});

		it('a programado match whose kick-off passed (nobody started it): loads, and it moves to en_curso', async () => {
			const id = await match('programado', 'futbol', new Date(Date.now() - 2 * HOUR));
			const res = await load(id, { golesLocal: 0, golesVisitante: 0 });
			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({ estado: 'en_curso', local: { goles: 0 }, visita: { goles: 0 } });
		});

		it.each([
			['programado and not started yet', 'programado', 'RESULT_NOT_ALLOWED_YET', undefined],
			// Old data from the removed state route: stored en_curso, kick-off still ahead.
			['stored en_curso with a future date', 'en_curso', 'RESULT_NOT_ALLOWED_YET', new Date(Date.now() + DAY)],
			['finalizado', 'finalizado', 'RESULT_ALREADY_CONFIRMED', undefined],
			['cancelado', 'cancelado', 'MATCH_LOCKED', undefined],
		] as const)('refused while %s, nothing changes', async (_label, estado, code, fecha) => {
			const id = await match(estado, 'futbol', fecha);
			const before = await row(id);
			const res = await load(id, { golesLocal: 3, golesVisitante: 0 });
			expect(res.status).toBe(409);
			expect(res.body.error.code).toBe(code);
			expect(await row(id)).toEqual(before);
		});

		it('a missing match: 404', async () => {
			const res = await load(999_999_999, { golesLocal: 1, golesVisitante: 0 });
			expect(res.status).toBe(404);
			expect(res.body.error.code).toBe('MATCH_NOT_FOUND');
		});

		it.each([
			['one side only', { golesLocal: 1 }],
			['negative goals', { golesLocal: -1, golesVisitante: 0 }],
			['more than 999', { golesLocal: 1000, golesVisitante: 0 }],
			['fractions', { golesLocal: 1.5, golesVisitante: 0 }],
			['text', { golesLocal: '1', golesVisitante: 0 }],
			['null', { golesLocal: null, golesVisitante: 0 }],
			['an extra key', { golesLocal: 1, golesVisitante: 0, estado: 'finalizado' }],
			['nothing', {}],
		])('400 for %s', async (_label, body) => {
			const id = await match('en_curso');
			const res = await load(id, body);
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
			expect(await row(id)).toMatchObject({ local: null, visita: null });
		});

		it('999 is accepted; a query string or a bad id is a 400', async () => {
			const id = await match('en_curso');
			expect((await load(id, { golesLocal: 999, golesVisitante: 0 })).status).toBe(200);
			expect((await api.put(`/partidos/${id}/resultado?confirmar=true`, { golesLocal: 1, golesVisitante: 0 })).status).toBe(400);
			expect((await load('abc', { golesLocal: 1, golesVisitante: 0 })).status).toBe(400);
		});

		it('a loaded but unconfirmed score stays private: the public API shows no goals and no result', async () => {
			const id = await match('en_curso');
			await load(id, { golesLocal: 4, golesVisitante: 2 });
			const res = await request(app).get(`/public/partidos/${id}`);
			expect(res.body.data).toMatchObject({ estado: 'en_curso', resultado: null, local: { goles: null }, visita: { goles: null }, goles: null });
			const standings = await request(app).get(`/public/competiciones/${s.liga}/posiciones`);
			expect(standings.body.data.filas.every((f: { jugados: number }) => f.jugados === 0)).toBe(true);
		});

		it('a started match with a loaded score cannot be deleted; a cancelled one with a score neither (MATCH_HAS_RESULT)', async () => {
			const id = await match('en_curso');
			await load(id, { golesLocal: 1, golesVisitante: 0 });
			const del = await api.del(`/partidos/${id}`);
			expect(del.status).toBe(409);
			expect(del.body.error.code).toBe('MATCH_NOT_PROGRAMMED');
			expect(await row(id)).toMatchObject({ estado: 'en_curso', local: 1, visita: 0 });

			const cancelled = await match('cancelado');
			await setSides(cancelled, 1, 1);
			expect((await api.del(`/partidos/${cancelled}`)).body.error.code).toBe('MATCH_HAS_RESULT');
		});

		it('a match still stored as programado whose kick-off came: loads, and is stored as en_curso', async () => {
			const id = await match('programado', 'futbol', new Date(Date.now() - 1000));
			const res = await load(id, { golesLocal: 1, golesVisitante: 0 });
			expect(res.status).toBe(200);
			expect(await row(id)).toMatchObject({ estado: 'en_curso', local: 1, visita: 0 });
		});

		it('during the match: loads, but confirming waits until its 60 minutes are over (409 MATCH_NOT_ENDED)', async () => {
			const id = await match('en_curso', 'futbol', new Date(Date.now() - 30 * 60 * 1000));
			expect((await load(id, { golesLocal: 1, golesVisitante: 0 })).status).toBe(200);
			const view = await preview(id);
			expect(view.body.data).toMatchObject({ puedeConfirmar: false, problemas: [{ code: 'MATCH_NOT_ENDED' }] });
			const res = await confirm(id, { confirmar: true, golesLocal: 1, golesVisitante: 0 });
			expect(res.status).toBe(409);
			expect(res.body.error.code).toBe('MATCH_NOT_ENDED');
			expect(await row(id)).toMatchObject({ estado: 'en_curso' });
		});

		it('a tie can be loaded in a sport without draws (it may still change), but not confirmed', async () => {
			const id = await match('en_curso', 'voley');
			expect((await load(id, { golesLocal: 2, golesVisitante: 2 })).status).toBe(200);
			const view = await preview(id);
			expect(view.body.data).toMatchObject({
				resultado: 'empate',
				puedeConfirmar: false,
				problemas: [{ code: 'DRAW_NOT_ALLOWED', message: expect.any(String) }],
			});
			const res = await confirm(id, { confirmar: true, golesLocal: 2, golesVisitante: 2 });
			expect(res.status).toBe(409);
			expect(res.body.error.code).toBe('DRAW_NOT_ALLOWED');
			expect(await row(id)).toMatchObject({ estado: 'en_curso' });
			// Corrected to a winner, it confirms.
			await load(id, { golesLocal: 3, golesVisitante: 2 });
			expect((await confirm(id, { confirmar: true, golesLocal: 3, golesVisitante: 2 })).status).toBe(200);
		});
	});

	describe('derived result (BR-029)', () => {
		it('is computed in one place', () => {
			expect([resultOfScore(2, 1), resultOfScore(1, 1), resultOfScore(0, 3)]).toEqual(['local_gana', 'empate', 'visitante_gana']);
			expect(officialResult('finalizado', 2, 1)).toEqual({ golesLocal: 2, golesVisitante: 1, resultado: 'local_gana' });
			for (const [estado, l, v] of [['en_curso', 2, 1], ['finalizado', 2, null], ['finalizado', null, 1], ['programado', 0, 0]] as const) {
				expect(officialResult(estado, l, v)).toBeNull();
			}
		});

		it.each([
			[2, 1, 'local_gana', 'A'],
			[1, 1, 'empate', null],
			[0, 3, 'visitante_gana', 'B'],
		] as const)('%i-%i: %s in the preview', async (local, visita, resultado, winner) => {
			const id = await match('en_curso');
			await load(id, { golesLocal: local, golesVisitante: visita });
			const res = await preview(id);
			expect(res.body.data).toMatchObject({
				marcador: { golesLocal: local, golesVisitante: visita },
				resultado,
				ganador: winner ? { equipoId: s.team[winner], nombre: winner === 'A' ? 'Alianza' : 'Boca' } : null,
				puedeConfirmar: true,
				problemas: [],
			});
		});
	});

	describe('preview (BR-030)', () => {
		it('shows the match, teams, score, winner, scorers, pending bets and the warning; writes nothing', async () => {
			const id = await match('en_curso');
			await load(id, { golesLocal: 2, golesVisitante: 1 });
			await insertDrawBet(app, pool, id);
			await insertDrawBet(app, pool, id);
			await insertDrawBet(app, pool, id);
			await pool.query(
				"UPDATE seleccion SET estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = 'anulada') WHERE partido_id = ? ORDER BY id LIMIT 1",
				[id],
			);
			await insertGoal(pool, id, s.team.A!, s.enrollment.ana!);
			await insertGoal(pool, id, s.team.B!, s.enrollment.bea!);
			await pool.query('UPDATE gol g JOIN partido_equipo pe ON pe.id = g.partido_equipo_id SET g.minuto = IF(g.equipo_id = ?, 80, 12) WHERE pe.partido_id = ?', [s.team.A, id]);
			const before = await row(id);
			const auditCount = async () => Number((await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM auditoria'))[0][0]!.n);
			const auditBefore = await auditCount();

			const res = await preview(id);
			expect(res.status).toBe(200);
			expect(res.headers['cache-control']).toBe('no-store');
			expect(res.body.data).toEqual({
				partido: expect.objectContaining({ id, estado: 'en_curso', jornada: 1, sede: 'Estadio', local: expect.objectContaining({ nombre: 'Alianza', goles: 2 }), visita: expect.objectContaining({ nombre: 'Boca', goles: 1 }) }),
				competicion: { id: s.liga, nombre: 'Liga' },
				deporte: { id: s.futbol, nombre: 'Fútbol', permiteEmpate: true },
				marcador: { golesLocal: 2, golesVisitante: 1 },
				resultado: 'local_gana',
				ganador: { equipoId: s.team.A, nombre: 'Alianza' },
				goles: [
					{ id: expect.any(Number), minuto: 12, equipoId: s.team.B, jugador: { id: expect.any(Number), nombre: 'Bea Soto' } },
					{ id: expect.any(Number), minuto: 80, equipoId: s.team.A, jugador: { id: expect.any(Number), nombre: 'Ana Pérez' } },
				],
				seleccionesPendientes: 2,
				confirmableDesde: expect.any(String),
				puedeConfirmar: true,
				problemas: [],
				// 2-1 with one scorer on each side: one goal without a scorer, which doesn't block.
				avisos: [{ code: 'GOALS_UNATTRIBUTED', message: expect.any(String) }],
				advertencia: expect.stringMatching(/definitivo/),
			});
			expect(await row(id)).toEqual(before);
			expect(await auditCount()).toBe(auditBefore);
		});

		it.each([
			['no score yet', 'en_curso', null, null, 'RESULT_INCOMPLETE'],
			['one side only', 'en_curso', 2, null, 'RESULT_INCOMPLETE'],
			['not started', 'programado', null, null, 'RESULT_NOT_ALLOWED_YET'],
			['already confirmed', 'finalizado', 1, 0, 'RESULT_ALREADY_CONFIRMED'],
			['cancelled', 'cancelado', null, null, 'MATCH_LOCKED'],
		] as const)('%s: cannot be confirmed (%s)', async (_label, estado, local, visita, code) => {
			const id = await match(estado);
			await setSides(id, local, visita);
			const res = await preview(id);
			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({ puedeConfirmar: false, problemas: [{ code }] });
			if (local === null || visita === null) expect(res.body.data).toMatchObject({ marcador: null, resultado: null, ganador: null });
		});

		it('a missing match: 404; a query string: 400', async () => {
			expect((await preview(999_999_999)).status).toBe(404);
			const id = await match('en_curso');
			expect((await api.get(`/partidos/${id}/resultado?x=1`)).status).toBe(400);
		});
	});

	describe('confirming (BR-031, BR-032)', () => {
		it('needs an explicit confirmation with the score that was previewed', async () => {
			const id = await match('en_curso');
			await load(id, { golesLocal: 2, golesVisitante: 0 });
			for (const body of [{}, { golesLocal: 2, golesVisitante: 0 }, { confirmar: false, golesLocal: 2, golesVisitante: 0 }, { confirmar: 'true', golesLocal: 2, golesVisitante: 0 }, { confirmar: true }]) {
				const res = await confirm(id, body);
				expect(res.status, JSON.stringify(body)).toBe(400);
			}
			const changed = await confirm(id, { confirmar: true, golesLocal: 2, golesVisitante: 1 });
			expect(changed.status).toBe(409);
			expect(changed.body.error).toMatchObject({ code: 'RESULT_CHANGED', details: { golesLocal: 2, golesVisitante: 0 } });
			expect(await row(id)).toMatchObject({ estado: 'en_curso' });
		});

		it.each([
			['no goals', null, null],
			['the local side only', 3, null],
			['the away side only', null, 3],
		] as const)('refused with %s: 409 RESULT_INCOMPLETE', async (_label, local, visita) => {
			const id = await match('en_curso');
			await setSides(id, local, visita);
			const res = await confirm(id, { confirmar: true, golesLocal: local ?? 0, golesVisitante: visita ?? 0 });
			expect(res.status).toBe(409);
			expect(res.body.error.code).toBe('RESULT_INCOMPLETE');
			expect(await row(id)).toMatchObject({ estado: 'en_curso' });
		});

		it('refused for a match not yet started, cancelled or already final', async () => {
			for (const [estado, code] of [['programado', 'RESULT_NOT_ALLOWED_YET'], ['cancelado', 'MATCH_LOCKED'], ['finalizado', 'RESULT_ALREADY_CONFIRMED']] as const) {
				const id = await match(estado);
				await setSides(id, 1, 0);
				const res = await confirm(id, { confirmar: true, golesLocal: 1, golesVisitante: 0 });
				expect(res.status, estado).toBe(409);
				expect(res.body.error.code, estado).toBe(code);
			}
		});

		it('confirms: the match is final, the result public, the standings count it', async () => {
			const id = await match('en_curso');
			await load(id, { golesLocal: 3, golesVisitante: 1 });
			const res = await confirm(id, { confirmar: true, golesLocal: 3, golesVisitante: 1 });
			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({
				partido: { id, estado: 'finalizado', local: { goles: 3 }, visita: { goles: 1 } },
				resultado: { golesLocal: 3, golesVisitante: 1, resultado: 'local_gana' },
			});
			const pub = await request(app).get(`/public/partidos/${id}`);
			expect(pub.body.data).toMatchObject({ estado: 'finalizado', resultado: 'local_gana', local: { goles: 3 }, visita: { goles: 1 } });
			const standings = await request(app).get(`/public/competiciones/${s.liga}/posiciones`);
			const alianza = standings.body.data.filas.find((f: { equipo: { id: number } }) => f.equipo.id === s.team.A);
			expect(alianza).toMatchObject({ ganados: expect.any(Number) });
			expect(alianza.ganados).toBeGreaterThanOrEqual(1);
		});

		it('after confirming, nothing about the match can change through any route (BR-032)', async () => {
			const id = await match('en_curso');
			await load(id, { golesLocal: 1, golesVisitante: 0 });
			expect((await confirm(id, { confirmar: true, golesLocal: 1, golesVisitante: 0 })).status).toBe(200);
			const before = await row(id);

			const attempts: Array<[string, Promise<{ status: number; body: { error: { code: string } } }>, string]> = [
				['load', load(id, { golesLocal: 0, golesVisitante: 0 }), 'RESULT_ALREADY_CONFIRMED'],
				['confirm again', confirm(id, { confirmar: true, golesLocal: 1, golesVisitante: 0 }), 'RESULT_ALREADY_CONFIRMED'],
				['jornada', api.patch(`/partidos/${id}`, { jornada: 9 }), 'MATCH_LOCKED'],
				['sede', api.patch(`/partidos/${id}`, { sede: 'Otra' }), 'MATCH_LOCKED'],
				['fecha', api.patch(`/partidos/${id}`, { fechaHora: new Date(Math.floor((Date.now() + 9 * DAY) / 1000) * 1000).toISOString() }), 'MATCH_LOCKED'],
				['equipos', api.patch(`/partidos/${id}`, { localId: s.team.B, visitaId: s.team.A }), 'MATCH_LOCKED'],
				['delete', api.del(`/partidos/${id}`), 'MATCH_LOCKED'],
			];
			for (const [label, attempt, code] of attempts) {
				const res = await attempt;
				expect(res.status, label).toBe(409);
				expect(res.body.error.code, label).toBe(code);
			}
			// And there is no manual state change route at all.
			expect((await api.post(`/partidos/${id}/estado`, { estado: 'en_curso' })).status).toBe(404);
			expect(await row(id)).toEqual(before);
		});

		it('confirmations at once: exactly one wins, the settler runs once', async () => {
			const id = await match('en_curso');
			await load(id, { golesLocal: 2, golesVisitante: 2 });
			const http = await Promise.all(Array.from({ length: 6 }, () => confirm(id, { confirmar: true, golesLocal: 2, golesVisitante: 2 })));
			expect(http.map((r) => r.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
			for (const r of http.filter((x) => x.status === 409)) expect(r.body.error.code).toBe('RESULT_ALREADY_CONFIRMED');

			const other = await match('en_curso');
			await load(other, { golesLocal: 0, golesVisitante: 1 });
			let calls = 0;
			const settle: MatchSettler = async () => {
				calls++;
			};
			const results = await Promise.allSettled(
				Array.from({ length: 6 }, () =>
					confirmResult(pool, { actorId: api.admin.user.id }, other, { confirmar: true, golesLocal: 0, golesVisitante: 1 }, deps({ settle })),
				),
			);
			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect(calls).toBe(1);
		});

		it('a match whose date passed long ago still gets its result (user decision)', async () => {
			const id = await match('programado', 'futbol', new Date(Date.now() - 40 * DAY));
			expect((await load(id, { golesLocal: 1, golesVisitante: 2 })).status).toBe(200);
			const res = await confirm(id, { confirmar: true, golesLocal: 1, golesVisitante: 2 });
			expect(res.status).toBe(200);
			expect(res.body.data.resultado).toMatchObject({ resultado: 'visitante_gana' });
		});
	});

	describe('settlement hook and audit (for T-14 and T-17)', () => {
		it('runs once, inside the transaction, after the match is final and before anyone else sees it', async () => {
			const id = await match('en_curso');
			await load(id, { golesLocal: 4, golesVisitante: 4 });
			const seen: unknown[] = [];
			const settle: MatchSettler = async (conn, settled) => {
				assertInTransaction(conn);
				const [[inside]] = await conn.query<RowDataPacket[]>(
					'SELECT ep.codigo FROM partido p JOIN estado_partido ep ON ep.id = p.estado_partido_id WHERE p.id = ?',
					[id],
				);
				seen.push({ settled, inside: inside!.codigo, outside: (await row(id))!.estado });
			};
			await confirmResult(pool, { actorId: api.admin.user.id }, id, { confirmar: true, golesLocal: 4, golesVisitante: 4 }, deps({ settle }));
			expect(seen).toEqual([
				{
					settled: { id, competicionId: s.liga, golesLocal: 4, golesVisitante: 4, resultado: 'empate' },
					inside: 'finalizado',
					outside: 'en_curso',
				},
			]);
		});

		it('if it fails, the confirmation is undone', async () => {
			const id = await match('en_curso');
			await load(id, { golesLocal: 1, golesVisitante: 0 });
			const settle: MatchSettler = async (conn) => {
				await conn.query("UPDATE partido SET sede = 'no debe quedar' WHERE id = ?", [id]);
				throw new Error('fallo al liquidar');
			};
			await expect(
				confirmResult(pool, { actorId: api.admin.user.id }, id, { confirmar: true, golesLocal: 1, golesVisitante: 0 }, deps({ settle })),
			).rejects.toThrow('fallo al liquidar');
			expect(await row(id)).toMatchObject({ estado: 'en_curso', sede: 'Estadio', local: 1, visita: 0 });
			// And it can still be confirmed afterwards.
			expect((await confirm(id, { confirmar: true, golesLocal: 1, golesVisitante: 0 })).status).toBe(200);
		});

		it('both writes go through the audit hook, with their action names', async () => {
			const id = await match('en_curso');
			const outcomes: AdminActionOutcome[] = [];
			const ctx = { actorId: api.admin.user.id, hooks: { inTransaction: async (_c: unknown, o: AdminActionOutcome) => void outcomes.push(o) } };
			await setResult(pool, ctx, id, { golesLocal: 2, golesVisitante: 0 }, deps());
			await confirmResult(pool, ctx, id, { confirmar: true, golesLocal: 2, golesVisitante: 0 }, deps());
			expect(outcomes.map((o) => [o.action, o.id, (o.before as { estado: string }).estado, (o.after as { estado: string }).estado])).toEqual([
				['registrar_resultado_partido', id, 'en_curso', 'en_curso'],
				['confirmar_resultado_partido', id, 'en_curso', 'finalizado'],
			]);
		});
	});

	it('Informativo does not import Polla: the probe and the settler are injected', () => {
		const code = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/services/results.service.ts'), 'utf8');
		const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
		for (const imported of imports) expect(imported).not.toMatch(/bets-|betting|tickets|coin|bet-history/);
	});
});
