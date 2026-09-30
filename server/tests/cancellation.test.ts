import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import mysql, { type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { transactionStats } from '../src/db/transaction.js';
import type { AdminActionOutcome } from '../src/services/admin-action.js';
import { countPendingSelections } from '../src/services/bets-match-probe.service.js';
import { settleMatchBets } from '../src/services/bets-settlement.service.js';
import { cancelMatch } from '../src/services/match-cancellation.service.js';
import { confirmResult } from '../src/services/results.service.js';
import { env, createTestApp } from './helpers/app.js';
import { setUserState, signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';
import { canInspectLocks } from './helpers/locks.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

type Session = Awaited<ReturnType<typeof signedInUser>>;
type Pick =
	| { partidoId: number; tipo: 'resultado_general'; pronostico: 'local_gana' | 'empate' | 'visitante_gana' }
	| { partidoId: number; tipo: 'marcador_exacto'; golesLocal: number; golesVisitante: number };
const win = (partidoId: number): Pick => ({ partidoId, tipo: 'resultado_general', pronostico: 'local_gana' });
const score = (partidoId: number, golesLocal: number, golesVisitante: number): Pick => ({ partidoId, tipo: 'marcador_exacto', golesLocal, golesVisitante });

describe('cancelling a match (T-16: BR-045, BR-047; no refunds since C-13)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	const s = {} as { liga: number; A: number; B: number };
	const settlement = { countPendingSelections, settle: settleMatchBets };

	const ctx = (hooks?: Parameters<typeof cancelMatch>[1]['hooks']) => ({ actorId: api.admin.user.id as number, hooks });
	const preview = (id: number) => api.get(`/partidos/${id}/cancelacion`);
	const cancel = (id: number, body: unknown = { confirmar: true }) => api.post(`/partidos/${id}/cancelacion/confirmar`, body);

	/** A match a few days ahead (betting open). */
	const openMatch = (days = 3, extraSeconds = 0) =>
		insertMatch(pool, s.liga, s.A, s.B, 'programado', wholeSeconds(Date.now() + days * DAY + extraSeconds * 1000));
	/** Time passes: the match started two hours ago (stored `en_curso`), optionally with a score loaded. */
	async function played(id: number, goles?: [number, number]) {
		await pool.query(
			"UPDATE partido SET fecha_hora = ?, estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = 'en_curso') WHERE id = ?",
			[wholeSeconds(Date.now() - 2 * HOUR), id],
		);
		if (goles) await pool.query('UPDATE partido_equipo SET goles = IF(es_visita, ?, ?) WHERE partido_id = ?', [goles[1], goles[0], id]);
	}

	/** A participant validated through the real admin actions (no coins since C-13). */
	async function bettor(): Promise<Session> {
		const who = await signedInUser(app, pool);
		expect((await api.post(`/participantes/${who.user.id}/pago/confirmar`, {})).status).toBe(200);
		expect((await api.post(`/participantes/${who.user.id}/validar`, {})).status).toBe(200);
		return who;
	}
	const placeTicket = (who: Session, selecciones: Pick[]) =>
		request(app)
			.post('/apuestas/tickets')
			.set('Cookie', who.cookie)
			.set('X-CSRF-Token', who.csrfToken)
			.set('Idempotency-Key', randomUUID())
			.send({ selecciones });
	async function ticket(who: Session, selecciones: Pick[]): Promise<number> {
		const res = await placeTicket(who, selecciones);
		if (res.status !== 201) throw new Error(`ticket: ${res.status} ${JSON.stringify(res.body)}`);
		return res.body.data.id as number;
	}
	const receipt = (who: Session, id: number) => request(app).get(`/apuestas/tickets/${id}`).set('Cookie', who.cookie);

	async function snapshot() {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT (SELECT GROUP_CONCAT(CONCAT(s.id, ':', es.codigo, ':', COALESCE(s.puntos_obtenidos, '-')) ORDER BY s.id)
					FROM seleccion s JOIN estado_seleccion es ON es.id = s.estado_seleccion_id) AS selecciones,
				(SELECT COUNT(*) FROM movimiento_moneda) AS movimientos,
				(SELECT GROUP_CONCAT(CONCAT(id, ':', saldo_monedas) ORDER BY id) FROM usuario) AS saldos,
				(SELECT GROUP_CONCAT(CONCAT(p.id, ':', ep.codigo) ORDER BY p.id) FROM partido p JOIN estado_partido ep ON ep.id = p.estado_partido_id) AS partidos`,
		);
		return rows[0];
	}
	async function states(matchId: number) {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT es.codigo, COUNT(*) AS n FROM seleccion s JOIN estado_seleccion es ON es.id = s.estado_seleccion_id
			WHERE s.partido_id = ? GROUP BY es.codigo ORDER BY es.codigo`,
			[matchId],
		);
		return Object.fromEntries(rows.map((r) => [r.codigo, Number(r.n)]));
	}
	async function matchState(id: number) {
		const [[row]] = await pool.query<RowDataPacket[]>(
			'SELECT ep.codigo FROM partido p JOIN estado_partido ep ON ep.id = p.estado_partido_id WHERE p.id = ?',
			[id],
		);
		return String(row!.codigo);
	}
	/** Since C-13 nothing moves coins: no movement and no balance, after every test. */
	async function noCoins() {
		const [[row]] = await pool.query<RowDataPacket[]>(
			'SELECT (SELECT COUNT(*) FROM movimiento_moneda) AS movimientos, (SELECT COUNT(*) FROM usuario WHERE saldo_monedas <> 0) AS saldos',
		);
		expect({ movimientos: Number(row!.movimientos), saldos: Number(row!.saldos) }).toEqual({ movimientos: 0, saldos: 0 });
	}

	beforeAll(async () => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		const post = (path: string, body: unknown) => created<{ id: number }>(api.post(path, body));
		const futbol = (await post('/deportes', { nombre: 'Fútbol', permiteEmpate: true })).id;
		s.liga = (await post('/competiciones', { deporteId: futbol, nombre: 'Liga' })).id;
		s.A = (await post('/equipos', teamBody(s.liga, { nombre: 'Alianza' }))).id;
		s.B = (await post('/equipos', teamBody(s.liga, { nombre: 'Boca' }))).id;
	});

	afterEach(async () => {
		await noCoins();
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('preview and cancellation', () => {
		it('the preview is exact and writes nothing; cancelling voids the pending bets, refunds nothing and leaves other matches alone (BR-047)', async () => {
			const x = await openMatch(3);
			const y = await openMatch(4);
			const ana = await bettor();
			const beto = await bettor();
			const onlyX = await ticket(ana, [win(x), score(x, 1, 0)]); // every selection on X: ends anulado
			const mixed = await ticket(ana, [win(y)]); // BR-047: Y stays
			const betoMixed = await ticket(beto, [score(x, 2, 2), win(y), score(y, 0, 0)]);
			const before = await snapshot();

			const shown = await preview(x);
			expect(shown.status).toBe(200);
			expect(shown.body.data).toEqual({
				partido: expect.objectContaining({ id: x, estado: 'programado' }),
				puedeCancelar: true,
				problemas: [],
				selecciones: 3,
				usuarios: 2,
				tickets: 2,
				ticketsAnulados: 1,
				advertencia: expect.stringMatching(/definitivo/),
			});
			expect(shown.body.data.advertencia).not.toMatch(/moneda|devuelve/i);
			expect(await snapshot()).toEqual(before);

			const res = await cancel(x);
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({
				partido: expect.objectContaining({ id: x, estado: 'cancelado' }),
				selecciones: 3,
				usuarios: 2,
				tickets: 2,
				ticketsAnulados: 1,
			});
			expect(await matchState(x)).toBe('cancelado');
			expect(await states(x)).toEqual({ anulada: 3 });
			expect(await states(y)).toEqual({ pendiente: 3 });

			// Receipts: states and the ticket state (T-10 rule), no coin figure.
			const onlyXReceipt = (await receipt(ana, onlyX)).body.data;
			expect(onlyXReceipt).toMatchObject({ estado: 'anulado', puntosObtenidos: 0 });
			expect(JSON.stringify(onlyXReceipt)).not.toMatch(/moneda/i);
			expect((await receipt(ana, mixed)).body.data).toMatchObject({ estado: 'pendiente' });
			const betoReceipt = (await receipt(beto, betoMixed)).body.data;
			expect(betoReceipt.selecciones.map((sel: { estado: string; puntosObtenidos: null }) => [sel.estado, sel.puntosObtenidos])).toEqual([
				['anulada', null],
				['pendiente', null],
				['pendiente', null],
			]);
			expect(betoReceipt.selecciones[0].partido.estado).toBe('cancelado');

			// My bets and its summary.
			const summary = (await request(app).get('/apuestas/mis-apuestas/resumen').set('Cookie', ana.cookie)).body.data;
			expect(summary).toEqual({
				tickets: { total: 2, pendiente: 1, anulado: 1, finalizado: 0 },
				selecciones: { total: 3, anulada: 2, pendiente: 1, acertada: 0, no_acertada: 0 },
				puntos: 0,
				aciertos: 0,
			});
			const voided = await request(app).get('/apuestas/mis-apuestas?estado=anulada').set('Cookie', ana.cookie);
			expect(voided.body.data.total).toBe(2);

			// Ranking: voided selections have no points.
			const ranking = (await request(app).get('/ranking').set('Cookie', ana.cookie)).body.data;
			expect(ranking.propia).toMatchObject({ puntos: 0, aciertos: 0 });

			// The public fixture shows it cancelled.
			const pub = await request(app).get(`/public/partidos/${x}`);
			expect(pub.body.data).toMatchObject({ estado: 'cancelado', resultado: null, goles: null, multimedia: null });
		});

		it('C-13: once cancelled, the match takes no new bet', async () => {
			const x = await openMatch();
			const ana = await bettor();
			await ticket(ana, [win(x)]);
			expect((await cancel(x)).status).toBe(200);
			const again = await placeTicket(ana, [win(x)]);
			expect(again.status).toBe(409);
			expect(again.body.error.details.selecciones[0].errores.map((e: { code: string }) => e.code)).toEqual(['MATCH_NOT_PROGRAMMED']);
		});

		it('a match in progress, with a score, goals and media, can be cancelled; none of it becomes public', async () => {
			const x = await openMatch();
			const ana = await bettor();
			const t = await ticket(ana, [win(x), score(x, 1, 0)]);
			await played(x, [1, 0]);
			const player = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Goleadora' }));
			const enrollment = await created<{ id: number }>(api.post('/planteles', { jugadorId: player.id, equipoId: s.A, numeroCamiseta: 9 }));
			expect((await api.post(`/partidos/${x}/goles`, { jugadorId: player.id, equipoId: s.A, minuto: 30 })).status).toBe(201);
			expect((await api.post(`/partidos/${x}/multimedia/videos`, { url: 'https://youtu.be/dQw4w9WgXcQ' })).status).toBe(201);
			expect(enrollment.id).toBeGreaterThan(0);

			const res = await cancel(x);
			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({ partido: { estado: 'cancelado', local: { goles: 1 } }, selecciones: 2 });
			expect((await receipt(ana, t)).body.data).toMatchObject({ estado: 'anulado' });
			const pub = (await request(app).get(`/public/partidos/${x}`)).body.data;
			expect(pub).toMatchObject({ estado: 'cancelado', resultado: null, goles: null, multimedia: null, local: { goles: null } });

			// Locked for good: no result, goals, edits or new media; the admin still lists its old media.
			expect((await api.put(`/partidos/${x}/resultado`, { golesLocal: 2, golesVisitante: 0 })).body.error.code).toBe('MATCH_LOCKED');
			expect((await api.post(`/partidos/${x}/goles`, { jugadorId: player.id, equipoId: s.A, minuto: 40 })).body.error.code).toBe('MATCH_LOCKED');
			expect((await api.patch(`/partidos/${x}`, { sede: 'Otra' })).body.error.code).toBe('MATCH_LOCKED');
			expect((await api.post(`/partidos/${x}/multimedia/videos`, { url: 'https://vimeo.com/1234' })).body.error.code).toBe('MATCH_LOCKED');
			expect((await api.get(`/partidos/${x}/multimedia`)).body.data.videos).toHaveLength(1);
		});

		it('a match with no bets cancels too; a programado match whose betting closed as well', async () => {
			const empty = await openMatch();
			expect((await preview(empty)).body.data).toMatchObject({ puedeCancelar: true, selecciones: 0, usuarios: 0 });
			expect((await cancel(empty)).body.data).toMatchObject({ partido: { estado: 'cancelado' }, selecciones: 0 });
			const closing = await insertMatch(pool, s.liga, s.A, s.B, 'programado', wholeSeconds(Date.now() + 30 * 60 * 1000));
			expect((await cancel(closing)).status).toBe(200);
		});

		it('finished or already cancelled: 409 with its own code, nothing changes; the preview says why', async () => {
			const x = await openMatch();
			const ana = await bettor();
			await ticket(ana, [win(x)]);
			await played(x, [1, 0]);
			await confirmResult(pool, ctx(), x, { confirmar: true, golesLocal: 1, golesVisitante: 0 }, settlement);
			const before = await snapshot();
			const finished = await cancel(x);
			expect(finished.status).toBe(409);
			expect(finished.body.error).toMatchObject({ code: 'MATCH_ALREADY_FINISHED', details: { estado: 'finalizado' } });
			expect((await preview(x)).body.data).toMatchObject({ puedeCancelar: false, problemas: [{ code: 'MATCH_ALREADY_FINISHED' }], selecciones: 0 });
			expect(await snapshot()).toEqual(before);

			const y = await openMatch();
			expect((await cancel(y)).status).toBe(200);
			const again = await cancel(y);
			expect(again.status).toBe(409);
			expect(again.body.error.code).toBe('MATCH_ALREADY_CANCELLED');
			expect((await preview(y)).body.data).toMatchObject({ puedeCancelar: false, problemas: [{ code: 'MATCH_ALREADY_CANCELLED' }] });
			// And no ticket can bet on it.
			const rejected = await placeTicket(ana, [win(y)]);
			expect(rejected.status).toBe(409);
			expect(rejected.body.error.details.selecciones[0].errores[0].code).toBe('MATCH_NOT_PROGRAMMED');
		});

		it('hand-loaded selections: settled or voided ones stay as they are; every pending one is voided', async () => {
			const x = await openMatch();
			const ana = await bettor();
			const t = await ticket(ana, [win(x)]);
			const [[cat]] = await pool.query<RowDataPacket[]>(
				`SELECT (SELECT id FROM tipo_apuesta WHERE codigo = 'resultado_general') AS tipo, (SELECT id FROM resultado_general WHERE codigo = 'empate') AS pron,
					(SELECT id FROM estado_seleccion WHERE codigo = 'acertada') AS acertada, (SELECT id FROM estado_seleccion WHERE codigo = 'no_acertada') AS no_acertada,
					(SELECT id FROM estado_seleccion WHERE codigo = 'anulada') AS anulada, (SELECT id FROM estado_seleccion WHERE codigo = 'pendiente') AS pendiente`,
			);
			const [forced] = await pool.query<ResultSetHeader>(
				`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id, puntos_obtenidos)
				VALUES (?, ?, ?, ?, ?, 3), (?, ?, ?, ?, ?, 0), (?, ?, ?, ?, ?, NULL), (?, ?, ?, ?, ?, NULL)`,
				[t, x, cat!.tipo, cat!.pron, cat!.acertada, t, x, cat!.tipo, cat!.pron, cat!.no_acertada, t, x, cat!.tipo, cat!.pron, cat!.anulada, t, x, cat!.tipo, cat!.pron, cat!.pendiente],
			);
			const [settled, missed, alreadyVoid, extraPending] = [0, 1, 2, 3].map((i) => forced.insertId + i);
			expect((await preview(x)).body.data).toMatchObject({ selecciones: 2, usuarios: 1, tickets: 1 });

			const res = await cancel(x);
			expect(res.body.data).toMatchObject({ selecciones: 2, usuarios: 1 });
			const [rows] = await pool.query<RowDataPacket[]>(
				`SELECT s.id, es.codigo, s.puntos_obtenidos AS p FROM seleccion s JOIN estado_seleccion es ON es.id = s.estado_seleccion_id WHERE s.id IN (?) ORDER BY s.id`,
				[[settled, missed, alreadyVoid, extraPending]],
			);
			expect(rows.map((r) => [r.codigo, r.p])).toEqual([
				['acertada', 3],
				['no_acertada', 0],
				['anulada', null],
				['anulada', null],
			]);
			expect((await receipt(ana, t)).body.data).toMatchObject({ cantidadSelecciones: 5 });
			const summary = (await request(app).get('/apuestas/mis-apuestas/resumen').set('Cookie', ana.cookie)).body.data;
			expect(summary).toMatchObject({ selecciones: { anulada: 3 } });
			expect((await api.get('/polla/estadisticas')).body.data).toMatchObject({ selecciones: { anulada: 3 } });
		});

		it('pending selections of an account that is an admin today are voided like any other, and never block the cancellation', async () => {
			const x = await openMatch();
			const ana = await bettor();
			const beto = await bettor();
			const anaTicket = await ticket(ana, [win(x), score(x, 0, 0)]);
			await ticket(beto, [win(x)]);
			await setUserState(pool, beto.user.id, { rol: 'admin' });

			const expected = { selecciones: 3, usuarios: 2, tickets: 2 };
			expect((await preview(x)).body.data).toMatchObject({ puedeCancelar: true, ...expected });
			const res = await cancel(x);
			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject(expected);
			expect(await states(x)).toEqual({ anulada: 3 });
			expect((await receipt(ana, anaTicket)).body.data).toMatchObject({ estado: 'anulado' });
			await setUserState(pool, beto.user.id, { rol: 'apostador' });
		});

		it('D-001: a cancelled match with no bets, goals, result or media can be deleted; with any of them, not', async () => {
			const plain = await openMatch();
			expect((await cancel(plain)).status).toBe(200);
			const deleted = await api.del(`/partidos/${plain}`);
			expect(deleted.status).toBe(200);
			expect(await pool.query<RowDataPacket[]>('SELECT id FROM partido WHERE id = ?', [plain]).then(([r]) => r)).toHaveLength(0);

			const withBets = await openMatch();
			await ticket(await bettor(), [win(withBets)]);
			const withResult = await openMatch();
			await played(withResult, [1, 1]);
			const withGoals = await openMatch();
			await played(withGoals, [1, 0]);
			const player = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Autora' }));
			await created(api.post('/planteles', { jugadorId: player.id, equipoId: s.A, numeroCamiseta: 7 }));
			expect((await api.post(`/partidos/${withGoals}/goles`, { jugadorId: player.id, equipoId: s.A, minuto: 3 })).status).toBe(201);
			const withMedia = await openMatch();
			await played(withMedia);
			expect((await api.post(`/partidos/${withMedia}/multimedia/videos`, { url: 'https://vimeo.com/4321' })).status).toBe(201);

			for (const [id, code] of [
				[withBets, 'MATCH_HAS_BETS'],
				[withResult, 'MATCH_HAS_RESULT'],
				[withGoals, 'MATCH_HAS_GOALS'],
				[withMedia, 'MATCH_HAS_MEDIA'],
			] as const) {
				expect((await cancel(id)).status, code).toBe(200);
				const refused = await api.del(`/partidos/${id}`);
				expect(refused.status, code).toBe(409);
				expect(refused.body.error.code, code).toBe(code);
				expect(await matchState(id), code).toBe('cancelado');
			}
		});
	});

	describe('transactions', () => {
		it('a failure halfway (after voiding) rolls everything back; then it can be cancelled', async () => {
			const x = await openMatch();
			const ana = await bettor();
			await ticket(ana, [win(x), score(x, 0, 0)]);
			const before = await snapshot();
			await expect(
				cancelMatch(pool, ctx(), x, {
					afterVoiding: async () => {
						throw new Error('falla a mitad de la cancelación');
					},
				}),
			).rejects.toThrow('falla a mitad');
			expect(await snapshot()).toEqual(before);

			const failingAudit = ctx({
				inTransaction: async () => {
					throw new Error('falla la auditoría');
				},
			});
			await expect(cancelMatch(pool, failingAudit, x)).rejects.toThrow('falla la auditoría');
			expect(await snapshot()).toEqual(before);

			const actions: string[] = [];
			const done = await cancelMatch(pool, ctx({ inTransaction: async (_c, outcome: AdminActionOutcome) => void actions.push(outcome.action) }), x);
			expect(done).toMatchObject({ selecciones: 2 });
			expect(actions).toEqual(['cancelar_partido']);
		});

		it('a deadlock retry voids once', async () => {
			const x = await openMatch();
			const ana = await bettor();
			await ticket(ana, [win(x), score(x, 2, 2)]);
			let calls = 0;
			const retries = transactionStats.deadlockRetries;
			const flaky = ctx({
				inTransaction: async () => {
					calls++;
					if (calls === 1) throw Object.assign(new Error('deadlock simulado'), { errno: 1213, sqlState: '40001' });
				},
			});
			expect(await cancelMatch(pool, flaky, x)).toMatchObject({ selecciones: 2 });
			expect(calls).toBe(2);
			expect(transactionStats.deadlockRetries).toBe(retries + 1);
			expect(await states(x)).toEqual({ anulada: 2 });
		});

		it('cancelling twice at once: one wins, the rest get 409', async () => {
			const x = await openMatch();
			const people = [await bettor(), await bettor(), await bettor()];
			for (const who of people) await ticket(who, [win(x), score(x, 1, 1)]);
			const results = await Promise.all(Array.from({ length: 6 }, () => cancel(x)));
			expect(results.filter((r) => r.status === 200)).toHaveLength(1);
			for (const r of results.filter((r) => r.status !== 200)) {
				expect(r.status).toBe(409);
				expect(r.body.error.code).toBe('MATCH_ALREADY_CANCELLED');
			}
			expect(await states(x)).toEqual({ anulada: 6 });
		});

		it('cancel against confirming the same match: exactly one wins, and its effects are the only ones', async () => {
			const people = [await bettor(), await bettor()];
			for (let round = 0; round < 4; round++) {
				const x = await openMatch(3, round);
				for (const who of people) await ticket(who, [win(x)]);
				await played(x, [2, 0]);
				const [cancelled, confirmed] = await Promise.allSettled([
					cancelMatch(pool, ctx(), x),
					confirmResult(pool, ctx(), x, { confirmar: true, golesLocal: 2, golesVisitante: 0 }, settlement),
				]);
				const winners = [cancelled, confirmed].filter((r) => r.status === 'fulfilled');
				expect(winners, `ronda ${round}`).toHaveLength(1);
				if (cancelled.status === 'fulfilled') {
					expect(confirmed).toMatchObject({ status: 'rejected', reason: { code: 'MATCH_LOCKED' } });
					expect(await matchState(x)).toBe('cancelado');
					expect(await states(x)).toEqual({ anulada: 2 });
				} else {
					expect(cancelled).toMatchObject({ status: 'rejected', reason: { code: 'MATCH_ALREADY_FINISHED' } });
					expect(await matchState(x)).toBe('finalizado');
					expect(await states(x)).toEqual({ acertada: 2 });
				}
			}
		});

		it('against tickets of the same users on other matches and the settlement of a match sharing their tickets: no deadlocks', async () => {
			const people = [await bettor(), await bettor(), await bettor()];
			for (let round = 0; round < 3; round++) {
				const x = await openMatch(3, round);
				const y = await openMatch(4, round);
				const z = await openMatch(5, round);
				const tickets = [];
				for (const who of people) tickets.push(await ticket(who, [win(x), win(y)]));
				await played(y, [1, 0]);
				const deadlocks = { ...transactionStats };
				const [cancelled, settled, ...placed] = await Promise.all([
					cancel(x),
					confirmResult(pool, ctx(), y, { confirmar: true, golesLocal: 1, golesVisitante: 0 }, settlement),
					...people.map((who) => placeTicket(who, [win(z)])),
				]);
				expect(cancelled.status).toBe(200);
				expect(settled.partido.estado).toBe('finalizado');
				expect(placed.map((p) => p.status)).toEqual([201, 201, 201]);
				expect(transactionStats).toEqual(deadlocks);
				expect(await states(x)).toEqual({ anulada: 3 });
				expect(await states(y)).toEqual({ acertada: 3 });
				for (const [i, who] of people.entries()) {
					expect((await receipt(who, tickets[i]!)).body.data).toMatchObject({ estado: 'finalizado', puntosObtenidos: 3 });
				}
			}
		});

		it.skipIf(!canInspectLocks)('a ticket in flight while the cancellation waits for the match: its selection is voided too, with no retry (C-13)', async () => {
			const x = await openMatch();
			const ana = await bettor();
			await ticket(ana, [win(x)]);
			const late = await bettor();

			// A ticket in flight for a new user: holds the user and the match (S), like T-10.
			const conn: PoolConnection = await pool.getConnection();
			const root = await mysql.createConnection({ host: env.db.host, port: env.db.port, user: 'root', password: process.env.MYSQL_ROOT_PASSWORD });
			try {
				await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
				await conn.beginTransaction();
				await conn.query('SELECT id FROM usuario FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE', [late.user.id]);
				await conn.query('SELECT id FROM partido FORCE INDEX (PRIMARY) WHERE id = ? FOR SHARE', [x]);
				const [t] = await conn.query<ResultSetHeader>(
					'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, UTC_TIMESTAMP(), ?, SHA2(UUID(), 256))',
					[late.user.id, randomUUID()],
				);
				await conn.query(
					`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id)
					SELECT ?, ?, ta.id, rg.id, es.id FROM tipo_apuesta ta, resultado_general rg, estado_seleccion es
					WHERE ta.codigo = 'resultado_general' AND rg.codigo = 'empate' AND es.codigo = 'pendiente'`,
					[t.insertId, x],
				);

				const retries = transactionStats.deadlockRetries;
				const pending = cancelMatch(pool, ctx(), x);
				// Wait until the cancellation is blocked on the match.
				for (let i = 0; i < 200; i++) {
					const [[w]] = await root.query<RowDataPacket[]>(
						'SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID WHERE l.OBJECT_SCHEMA = ? AND l.OBJECT_NAME = ?',
						[env.db.database, 'partido'],
					);
					if (Number(w!.n) > 0) break;
					await new Promise((resolve) => setTimeout(resolve, 25));
				}
				await conn.commit();
				expect(await pending).toMatchObject({ selecciones: 2, usuarios: 2 });
				expect(transactionStats.deadlockRetries).toBe(retries);
			} finally {
				conn.release();
				await root.end();
			}
			expect(await states(x)).toEqual({ anulada: 2 });
		});

		it.skipIf(!canInspectLocks)('C-13: the cancellation locks no user row', async () => {
			const x = await openMatch();
			const ana = await bettor();
			await ticket(ana, [win(x), score(x, 1, 0)]);
			const root = await mysql.createConnection({ host: env.db.host, port: env.db.port, user: 'root', password: process.env.MYSQL_ROOT_PASSWORD });
			try {
				let userLocks = -1;
				await cancelMatch(pool, ctx(), x, {
					afterVoiding: async (conn) => {
						const [[me]] = await conn.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
						const [[row]] = await root.query<RowDataPacket[]>(
							`SELECT COUNT(*) AS n FROM performance_schema.data_locks l
							JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID
							WHERE t.PROCESSLIST_ID = ? AND l.OBJECT_SCHEMA = ? AND l.OBJECT_NAME = 'usuario' AND l.LOCK_TYPE = 'RECORD'`,
							[Number(me!.id), env.db.database],
						);
						userLocks = Number(row!.n);
					},
				});
				expect(userLocks).toBe(0);
			} finally {
				await root.end();
			}
		});
	});

	describe('volume', () => {
		it('300 users and 3000 selections: a handful of statements', async () => {
			const USERS = 300;
			const PER_USER = 10;
			const x = await openMatch();
			const y = await openMatch(4);
			const [[ids]] = await pool.query<RowDataPacket[]>(
				`SELECT (SELECT id FROM rol WHERE codigo = 'apostador') AS rol, (SELECT id FROM estado_usuario WHERE codigo = 'validado') AS validado,
					(SELECT id FROM estado_pago WHERE codigo = 'confirmado') AS pago, (SELECT id FROM tipo_apuesta WHERE codigo = 'resultado_general') AS tipo,
					(SELECT id FROM resultado_general WHERE codigo = 'local_gana') AS pron, (SELECT id FROM estado_seleccion WHERE codigo = 'pendiente') AS pendiente`,
			);
			const now = wholeSeconds(Date.now());
			const [users] = await pool.query<ResultSetHeader>(
				'INSERT INTO usuario (rol_id, estado_usuario_id, estado_pago_id, nombre, email, password_hash, creado_en) VALUES ?',
				[Array.from({ length: USERS }, (_, i) => [ids!.rol, ids!.validado, ids!.pago, `V${i}`, `vol${i}@liga.test`, 'x', now])],
			);
			const userIds = Array.from({ length: USERS }, (_, i) => users.insertId + i);
			const [tickets] = await pool.query<ResultSetHeader>('INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES ?', [
				userIds.map((u) => [u, now, randomUUID(), 'b'.repeat(64)]),
			]);
			// Nine selections on X and one on Y per user, loaded by hand (the app takes one per type since C-13).
			const rows = userIds.flatMap((_, i) =>
				Array.from({ length: PER_USER }, (__, k) => [tickets.insertId + i, k === 0 ? y : x, ids!.tipo, ids!.pron, ids!.pendiente]),
			);
			await pool.query('INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id) VALUES ?', [rows]);
			await pool.query('ANALYZE TABLE seleccion, ticket');

			// Count the statements of the cancellation's own connection.
			let statements = 0;
			const patched = new Set<PoolConnection>();
			const counting = Object.create(pool) as Pool;
			counting.getConnection = async () => {
				const conn = await pool.getConnection();
				const original = conn.query;
				conn.query = ((...args: Parameters<typeof original>) => {
					statements++;
					return original.apply(conn, args);
				}) as typeof original;
				patched.add(conn);
				return conn;
			};
			const started = performance.now();
			try {
				const done = await cancelMatch(counting, ctx(), x);
				expect(done).toMatchObject({ selecciones: USERS * (PER_USER - 1), usuarios: USERS, tickets: USERS, ticketsAnulados: 0 });
			} finally {
				for (const conn of patched) delete (conn as unknown as { query?: unknown }).query;
			}
			const elapsed = performance.now() - started;
			process.stdout.write(`cancelación con ${USERS} usuarios y ${USERS * (PER_USER - 1)} selecciones: ${statements} sentencias, ${elapsed.toFixed(0)} ms\n`);
			expect(statements).toBeLessThanOrEqual(30);
			expect(elapsed).toBeLessThan(15_000);

			expect(await states(x)).toEqual({ anulada: USERS * (PER_USER - 1) });
			expect(await states(y)).toEqual({ pendiente: USERS });
			expect(await countPendingSelections(pool, x)).toBe(0);
		});
	});

	describe('access', () => {
		it('401 anonymous, 403 for a bettor, CSRF, a strict body and query, 404 for a missing match', async () => {
			const x = await openMatch();
			expect((await request(app).get(`/admin/partidos/${x}/cancelacion`)).status).toBe(401);
			expect((await request(app).post(`/admin/partidos/${x}/cancelacion/confirmar`).send({ confirmar: true })).status).toBe(401);
			const ana = await bettor();
			expect((await request(app).get(`/admin/partidos/${x}/cancelacion`).set('Cookie', ana.cookie)).status).toBe(403);
			const asBettor = await request(app)
				.post(`/admin/partidos/${x}/cancelacion/confirmar`)
				.set('Cookie', ana.cookie)
				.set('X-CSRF-Token', ana.csrfToken)
				.send({ confirmar: true });
			expect(asBettor.status).toBe(403);
			const noCsrf = await request(app).post(`/admin/partidos/${x}/cancelacion/confirmar`).set('Cookie', api.admin.cookie).send({ confirmar: true });
			expect(noCsrf.status).toBe(403);
			expect(noCsrf.body.error.code).toBe('CSRF_FAILED');
			for (const body of [{}, { confirmar: false }, { confirmar: 'true' }, { confirmar: true, motivo: 'x' }]) {
				expect((await cancel(x, body)).status, JSON.stringify(body)).toBe(400);
			}
			expect((await api.get(`/partidos/${x}/cancelacion?x=1`)).status).toBe(400);
			expect((await api.post(`/partidos/${x}/cancelacion/confirmar?x=1`, { confirmar: true })).status).toBe(400);
			expect((await preview(999_999_999)).status).toBe(404);
			expect((await cancel(999_999_999)).body.error.code).toBe('MATCH_NOT_FOUND');
			expect((await api.post(`/partidos/${x}/estado`, { estado: 'cancelado' })).status).toBe(404);
			expect(await matchState(x)).toBe('programado');
		});
	});
});
