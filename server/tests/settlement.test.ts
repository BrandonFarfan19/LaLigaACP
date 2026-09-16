import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type TransactionConnection, transactionStats, withTransaction } from '../src/db/transaction.js';
import { type OfficialResult, resultOfScore, type ResultadoGeneralCodigo } from '../src/lib/match-result.js';
import {
	type Forecast,
	PUNTOS_EMPATE,
	PUNTOS_FALLO,
	PUNTOS_GANADOR,
	PUNTOS_MARCADOR_EXACTO,
	settleSelection,
} from '../src/lib/points.js';
import { countPendingSelections } from '../src/services/bets-match-probe.service.js';
import { LOTE_LIQUIDACION, settleMatchBets, settleMatchSelections } from '../src/services/bets-settlement.service.js';
import { checkCoinConsistency } from '../src/services/coins-consistency.service.js';
import { confirmResult, type MatchSettler, type ResultDeps } from '../src/services/results.service.js';
import { createTestApp } from './helpers/app.js';
import { registerUser, signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';
import { canInspectLocks, locksHeldBy } from './helpers/locks.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

type Session = Awaited<ReturnType<typeof signedInUser>>;
type Estado = 'pendiente' | 'acertada' | 'no_acertada' | 'anulada';

const general = (pronostico: ResultadoGeneralCodigo): Forecast => ({ tipo: 'resultado_general', pronostico });
const exact = (golesLocal: number, golesVisitante: number): Forecast => ({ tipo: 'marcador_exacto', golesLocal, golesVisitante });
const result = (golesLocal: number, golesVisitante: number): OfficialResult => ({
	golesLocal,
	golesVisitante,
	resultado: resultOfScore(golesLocal, golesVisitante),
});

describe('settling bets (T-14: BR-034 to BR-040)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	const s = {} as { liga: number; A: number; B: number; user: number; cat: Record<string, number> };

	const deps = (settle: MatchSettler = settleMatchBets): ResultDeps => ({ countPendingSelections, settle });
	const ctx = () => ({ actorId: api.admin.user.id as number });

	/** A match that started two hours ago (its time is over), with the score loaded, ready to confirm. */
	async function endedMatch(golesLocal: number | null = null, golesVisitante: number | null = null): Promise<number> {
		const id = await insertMatch(pool, s.liga, s.A, s.B, 'en_curso', wholeSeconds(Date.now() - 2 * HOUR));
		if (golesLocal !== null) await loadScore(id, golesLocal, golesVisitante!);
		return id;
	}
	const loadScore = (id: number, golesLocal: number, golesVisitante: number) =>
		pool.query('UPDATE partido_equipo SET goles = IF(es_visita, ?, ?) WHERE partido_id = ?', [golesVisitante, golesLocal, id]);

	async function insertTicket(userId = s.user): Promise<number> {
		const [ticket] = await pool.query<ResultSetHeader>(
			'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, UTC_TIMESTAMP(), ?, SHA2(UUID(), 256))',
			[userId, randomUUID()],
		);
		return ticket.insertId;
	}

	const selectionRow = (ticketId: number, matchId: number, forecast: Forecast, estado: Estado = 'pendiente', puntos: number | null = null) => [
		ticketId,
		matchId,
		s.cat[`tipo:${forecast.tipo}`],
		forecast.tipo === 'resultado_general' ? s.cat[`resultado:${forecast.pronostico}`] : null,
		forecast.tipo === 'marcador_exacto' ? forecast.golesLocal : null,
		forecast.tipo === 'marcador_exacto' ? forecast.golesVisitante : null,
		s.cat[`estado:${estado}`],
		puntos,
	];

	/** Inserts the selections in one statement and returns their ids, in order. */
	async function insertSelections(rows: unknown[][]): Promise<number[]> {
		const [res] = await pool.query<ResultSetHeader>(
			`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id,
				pronostico_goles_local, pronostico_goles_visitante, estado_seleccion_id, puntos_obtenidos) VALUES ?`,
			[rows],
		);
		return rows.map((_, i) => res.insertId + i);
	}

	async function selections(ids: readonly number[]): Promise<Array<{ id: number; estado: Estado; puntos: number | null }>> {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT s.id, es.codigo AS estado, s.puntos_obtenidos AS puntos
			FROM seleccion s JOIN estado_seleccion es ON es.id = s.estado_seleccion_id WHERE s.id IN (?) ORDER BY s.id`,
			[ids],
		);
		return rows.map((r) => ({ id: Number(r.id), estado: r.estado as Estado, puntos: r.puntos === null ? null : Number(r.puntos) }));
	}

	async function coinTotals() {
		const [[row]] = await pool.query<RowDataPacket[]>(
			'SELECT (SELECT COUNT(*) FROM movimiento_moneda) AS movimientos, (SELECT COALESCE(SUM(saldo_monedas), 0) FROM usuario) AS saldos',
		);
		return { movimientos: Number(row!.movimientos), saldos: Number(row!.saldos) };
	}

	async function matchState(id: number): Promise<string> {
		const [[row]] = await pool.query<RowDataPacket[]>(
			'SELECT ep.codigo FROM partido p JOIN estado_partido ep ON ep.id = p.estado_partido_id WHERE p.id = ?',
			[id],
		);
		return String(row!.codigo);
	}

	const confirmBody = (golesLocal: number, golesVisitante: number) => ({ confirmar: true as const, golesLocal, golesVisitante });

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
		s.user = (await registerUser(app)).user.id;
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT CONCAT('estado:', codigo) AS k, id FROM estado_seleccion
			UNION ALL SELECT CONCAT('tipo:', codigo), id FROM tipo_apuesta
			UNION ALL SELECT CONCAT('resultado:', codigo), id FROM resultado_general`,
		);
		s.cat = Object.fromEntries(rows.map((r) => [String(r.k), Number(r.id)]));
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('the rule (table 27, lib/points.ts)', () => {
		it.each([
			['local wins, bet local', general('local_gana'), result(2, 1), 'acertada', PUNTOS_GANADOR],
			['away wins, bet away', general('visitante_gana'), result(0, 3), 'acertada', PUNTOS_GANADOR],
			['draw, bet draw', general('empate'), result(1, 1), 'acertada', PUNTOS_EMPATE],
			['0-0, bet draw', general('empate'), result(0, 0), 'acertada', PUNTOS_EMPATE],
			['local wins, bet draw', general('empate'), result(2, 1), 'no_acertada', PUNTOS_FALLO],
			['local wins, bet away', general('visitante_gana'), result(2, 1), 'no_acertada', PUNTOS_FALLO],
			['draw, bet local', general('local_gana'), result(2, 2), 'no_acertada', PUNTOS_FALLO],
			['exact 2-1', exact(2, 1), result(2, 1), 'acertada', PUNTOS_MARCADOR_EXACTO],
			['exact 0-0', exact(0, 0), result(0, 0), 'acertada', PUNTOS_MARCADOR_EXACTO],
			['exact 3-3', exact(3, 3), result(3, 3), 'acertada', PUNTOS_MARCADOR_EXACTO],
			['right winner, wrong score', exact(3, 1), result(2, 1), 'no_acertada', PUNTOS_FALLO],
			['sides swapped', exact(1, 2), result(2, 1), 'no_acertada', PUNTOS_FALLO],
			['right draw, wrong score', exact(1, 1), result(0, 0), 'no_acertada', PUNTOS_FALLO],
			['one side right only', exact(2, 0), result(2, 1), 'no_acertada', PUNTOS_FALLO],
		] as const)('%s', (_label, forecast, official, estado, puntos) => {
			expect(settleSelection(forecast, official)).toEqual({ estado, puntos });
		});

		it('the values of table 27', () => {
			expect([PUNTOS_GANADOR, PUNTOS_EMPATE, PUNTOS_MARCADOR_EXACTO, PUNTOS_FALLO]).toEqual([3, 1, 3, 0]);
		});
	});

	describe('confirming a result settles its pending selections', () => {
		const SCORES: Array<[number, number]> = [[2, 1], [1, 2], [0, 0], [3, 3], [0, 4]];
		const FORECASTS: Forecast[] = [
			general('local_gana'),
			general('empate'),
			general('visitante_gana'),
			exact(0, 0),
			exact(1, 1),
			exact(2, 1),
			exact(1, 2),
			exact(3, 3),
			exact(0, 4),
			exact(4, 0),
			exact(2, 0),
		];

		it.each(SCORES)('%i-%i: every selection gets what settleSelection says (SQL and TypeScript agree)', async (local, visita) => {
			const id = await endedMatch(local, visita);
			const ticket = await insertTicket();
			const ids = await insertSelections(FORECASTS.map((f) => selectionRow(ticket, id, f)));

			const confirmed = await confirmResult(pool, ctx(), id, confirmBody(local, visita), deps());
			expect(confirmed.resultado).toEqual(result(local, visita));
			const rows = await selections(ids);
			rows.forEach((row, i) => {
				expect({ estado: row.estado, puntos: row.puntos }, JSON.stringify(FORECASTS[i])).toEqual(settleSelection(FORECASTS[i]!, result(local, visita)));
			});
			// Exactly one general result and one exact score hit (every score above is in FORECASTS).
			expect(rows.filter((r) => r.estado === 'acertada')).toHaveLength(2);
			expect(await matchState(id)).toBe('finalizado');
		});

		it('BR-038: each selection on its own; a winner and the exact score in one ticket add up, a winner alone does not', async () => {
			const id = await endedMatch(2, 1);
			const both = await insertTicket();
			const winnerOnly = await insertTicket();
			const [winner, score, lonely] = await insertSelections([
				selectionRow(both, id, general('local_gana')),
				selectionRow(both, id, exact(2, 1)),
				selectionRow(winnerOnly, id, general('local_gana')),
			]);
			await confirmResult(pool, ctx(), id, confirmBody(2, 1), deps());
			expect(await selections([winner!, score!, lonely!])).toEqual([
				{ id: winner, estado: 'acertada', puntos: 3 },
				{ id: score, estado: 'acertada', puntos: 3 },
				{ id: lonely, estado: 'acertada', puntos: 3 },
			]);
			const [points] = await pool.query<RowDataPacket[]>(
				'SELECT ticket_id, SUM(puntos_obtenidos) AS puntos FROM seleccion WHERE ticket_id IN (?) GROUP BY ticket_id ORDER BY ticket_id',
				[[both, winnerOnly]],
			);
			expect(points.map((p) => Number(p.puntos))).toEqual([6, 3]);
		});

		it('repeated and contradictory selections are settled one by one', async () => {
			const id = await endedMatch(1, 1);
			const ticket = await insertTicket();
			const ids = await insertSelections([
				selectionRow(ticket, id, general('empate')),
				selectionRow(ticket, id, general('empate')),
				selectionRow(ticket, id, general('local_gana')),
				selectionRow(ticket, id, general('visitante_gana')),
				selectionRow(ticket, id, exact(1, 1)),
				selectionRow(ticket, id, exact(1, 1)),
			]);
			await confirmResult(pool, ctx(), id, confirmBody(1, 1), deps());
			expect((await selections(ids)).map((r) => [r.estado, r.puntos])).toEqual([
				['acertada', 1],
				['acertada', 1],
				['no_acertada', 0],
				['no_acertada', 0],
				['acertada', 3],
				['acertada', 3],
			]);
		});

		it('voided or already settled selections, and the ticket’s selections on other matches, stay as they are', async () => {
			const id = await endedMatch(2, 0);
			const other = await endedMatch(2, 0);
			const ticket = await insertTicket();
			const ids = await insertSelections([
				selectionRow(ticket, id, general('local_gana'), 'anulada'),
				selectionRow(ticket, id, general('local_gana'), 'no_acertada', 0),
				selectionRow(ticket, id, exact(1, 0), 'acertada', 3),
				selectionRow(ticket, other, general('local_gana')),
				selectionRow(ticket, other, exact(2, 0)),
				selectionRow(ticket, id, general('local_gana')),
			]);
			const before = await selections(ids);
			await confirmResult(pool, ctx(), id, confirmBody(2, 0), deps());
			const after = await selections(ids);
			expect(after.slice(0, 5)).toEqual(before.slice(0, 5));
			expect(after[5]).toMatchObject({ estado: 'acertada', puntos: 3 });
			expect(await countPendingSelections(pool, other)).toBe(2);
			expect(await matchState(other)).toBe('en_curso');
		});

		it('a match without bets confirms fine; the settler changes nothing', async () => {
			const id = await endedMatch(0, 0);
			const elsewhere = await endedMatch();
			const [kept] = await insertSelections([selectionRow(await insertTicket(), elsewhere, general('empate'))]);
			await confirmResult(pool, ctx(), id, confirmBody(0, 0), deps());
			expect(await selections([kept!])).toEqual([{ id: kept, estado: 'pendiente', puntos: null }]);
		});

		it('BR-039: points never move coins', async () => {
			const id = await endedMatch(3, 0);
			const ticket = await insertTicket();
			await insertSelections([selectionRow(ticket, id, general('local_gana')), selectionRow(ticket, id, exact(3, 0))]);
			const before = await coinTotals();
			await confirmResult(pool, ctx(), id, confirmBody(3, 0), deps());
			expect(await coinTotals()).toEqual(before);
		});
	});

	describe('transactions', () => {
		it('a failing settlement (or anything after it) rolls the whole confirmation back', async () => {
			const id = await endedMatch(1, 0);
			const ids = await insertSelections([selectionRow(await insertTicket(), id, general('local_gana'))]);
			const failing: MatchSettler = async (conn, match) => {
				await settleMatchBets(conn, match);
				throw new Error('falla después de liquidar');
			};
			await expect(confirmResult(pool, ctx(), id, confirmBody(1, 0), deps(failing))).rejects.toThrow('falla después de liquidar');
			expect(await matchState(id)).toBe('en_curso');
			expect(await selections(ids)).toEqual([{ id: ids[0], estado: 'pendiente', puntos: null }]);

			// It can be confirmed again, and then it settles.
			await confirmResult(pool, ctx(), id, confirmBody(1, 0), deps());
			expect(await selections(ids)).toEqual([{ id: ids[0], estado: 'acertada', puntos: 3 }]);
		});

		it('a deadlock retry settles once: the first attempt’s work is undone and redone', async () => {
			const id = await endedMatch(0, 1);
			const ticket = await insertTicket();
			const ids = await insertSelections([selectionRow(ticket, id, general('visitante_gana')), selectionRow(ticket, id, exact(0, 1))]);
			let calls = 0;
			const summaries: number[] = [];
			const flaky: MatchSettler = async (conn, match) => {
				calls++;
				summaries.push((await settleMatchSelections(conn, match)).liquidadas);
				if (calls === 1) throw Object.assign(new Error('deadlock simulado'), { errno: 1213, sqlState: '40001' });
			};
			const retries = transactionStats.deadlockRetries;
			await confirmResult(pool, ctx(), id, confirmBody(0, 1), deps(flaky));
			expect(calls).toBe(2);
			expect(transactionStats.deadlockRetries).toBe(retries + 1);
			// The second attempt found both pending again (the first one was rolled back).
			expect(summaries).toEqual([2, 2]);
			expect(await selections(ids)).toEqual([
				{ id: ids[0], estado: 'acertada', puntos: 3 },
				{ id: ids[1], estado: 'acertada', puntos: 3 },
			]);
		});

		it('idempotent inside the transaction: a second run settles nothing and changes nothing', async () => {
			const id = await endedMatch(2, 2);
			const ids = await insertSelections([selectionRow(await insertTicket(), id, general('empate'))]);
			const twice: MatchSettler = async (conn, match) => {
				expect(await settleMatchSelections(conn, match)).toEqual({ liquidadas: 1, acertadas: 1, puntos: 1 });
				expect(await settleMatchSelections(conn, match)).toEqual({ liquidadas: 0, acertadas: 0, puntos: 0 });
			};
			await confirmResult(pool, ctx(), id, confirmBody(2, 2), deps(twice));
			expect(await selections(ids)).toEqual([{ id: ids[0], estado: 'acertada', puntos: 1 }]);
		});

		it('refuses to run outside a transaction', async () => {
			const conn = await pool.getConnection();
			try {
				await expect(
					settleMatchSelections(conn as TransactionConnection, { id: 1, competicionId: s.liga, ...result(1, 0) }),
				).rejects.toThrow(/withTransaction/);
			} finally {
				conn.release();
			}
		});

		it.skipIf(!canInspectLocks)('locks only the settled selections, by primary key, and a ticket can still add selections meanwhile', async () => {
			const id = await endedMatch(1, 0);
			const open = await insertMatch(pool, s.liga, s.B, s.A, 'programado', wholeSeconds(Date.now() + 3 * DAY));
			const ticket = await insertTicket();
			const pending = await insertSelections([
				selectionRow(ticket, id, general('local_gana')),
				selectionRow(ticket, open, general('empate')),
				selectionRow(ticket, id, exact(0, 0)),
			]);
			await insertSelections([selectionRow(ticket, id, general('empate'), 'anulada')]);
			const rollback = new Error('rollback');
			await expect(
				withTransaction(pool, async (conn) => {
					await conn.query('SELECT id FROM partido FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE', [id]);
					await settleMatchSelections(conn, { id, competicionId: s.liga, ...result(1, 0) });
					const [[me]] = await conn.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
					const locks = (await locksHeldBy(Number(me!.id))).filter((l) => l.tabla === 'seleccion' && l.tipo === 'RECORD');
					expect(locks.map((l) => [l.indice, l.modo, Number(l.dato)])).toEqual([
						['PRIMARY', 'X,REC_NOT_GAP', pending[0]],
						['PRIMARY', 'X,REC_NOT_GAP', pending[2]],
					]);

					// Another transaction adds a selection to the same ticket, on another match, without waiting.
					const other = await pool.getConnection();
					try {
						await other.query('SET SESSION innodb_lock_wait_timeout = 1');
						await other.beginTransaction();
						await other.query(
							`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id)
							VALUES (?, ?, ?, ?, ?)`,
							[ticket, open, s.cat['tipo:resultado_general'], s.cat['resultado:local_gana'], s.cat['estado:pendiente']],
						);
						await other.rollback();
					} finally {
						await other.query('SET SESSION innodb_lock_wait_timeout = DEFAULT');
						other.release();
					}
					throw rollback;
				}),
			).rejects.toBe(rollback);
		});
	});

	describe('volume', () => {
		it('thousands of pending selections: a handful of statements', async () => {
			const TOTAL = 5000;
			const id = await endedMatch(2, 1);
			const other = await endedMatch();
			const tickets: number[] = [];
			for (let i = 0; i < 100; i++) tickets.push(await insertTicket());
			const cycle = [general('local_gana'), general('empate'), general('visitante_gana'), exact(2, 1), exact(1, 1)];
			const rows = Array.from({ length: TOTAL }, (_, i) => selectionRow(tickets[i % 100]!, id, cycle[i % cycle.length]!));
			// A few settled and voided ones on the match, and pending ones elsewhere, that must not change.
			rows.push(selectionRow(tickets[0]!, id, general('empate'), 'anulada'), selectionRow(tickets[0]!, other, general('empate')));
			await insertSelections(rows);

			// The pending read goes through the new index.
			const [plan] = await pool.query<RowDataPacket[]>(
				'EXPLAIN SELECT id FROM seleccion WHERE partido_id = ? AND estado_seleccion_id = ? ORDER BY id',
				[id, s.cat['estado:pendiente']],
			);
			expect(plan[0]).toMatchObject({ key: 'idx_seleccion_partido_estado', type: 'ref' });

			let statements = 0;
			const counting: MatchSettler = async (conn, match) => {
				const original = conn.query;
				conn.query = ((...args: Parameters<typeof original>) => {
					statements++;
					return original.apply(conn, args);
				}) as typeof original;
				try {
					expect(await settleMatchSelections(conn, match)).toEqual({ liquidadas: TOTAL, acertadas: 2000, puntos: 6000 });
				} finally {
					// Back to the prototype's method.
					delete (conn as unknown as { query?: unknown }).query;
				}
			};
			const started = performance.now();
			await confirmResult(pool, ctx(), id, confirmBody(2, 1), deps(counting));
			const elapsed = performance.now() - started;
			// Catalogs, the pending ids, one UPDATE per batch and the totals.
			expect(statements).toBe(3 + Math.ceil(TOTAL / LOTE_LIQUIDACION));
			expect(elapsed).toBeLessThan(10_000);

			const [summary] = await pool.query<RowDataPacket[]>(
				`SELECT s.partido_id, es.codigo AS estado, COUNT(*) AS n, SUM(s.puntos_obtenidos) AS puntos
				FROM seleccion s JOIN estado_seleccion es ON es.id = s.estado_seleccion_id
				GROUP BY s.partido_id, es.codigo ORDER BY s.partido_id, es.codigo`,
			);
			expect(summary.map((r) => [Number(r.partido_id), r.estado, Number(r.n), r.puntos === null ? null : Number(r.puntos)])).toEqual([
				[id, 'acertada', 2000, 6000],
				[id, 'anulada', 1, null],
				[id, 'no_acertada', 3000, 0],
				[other, 'pendiente', 1, null],
			]);
		});
	});

	describe('concurrency', () => {
		/** A participant validated through the real admin actions (10 coins with their movement). */
		async function validatedBettor(): Promise<Session> {
			const who = await signedInUser(app, pool);
			expect((await api.post(`/participantes/${who.user.id}/pago/confirmar`, {})).status).toBe(200);
			expect((await api.post(`/participantes/${who.user.id}/validar`, {})).status).toBe(200);
			return who;
		}
		const placeTicket = (who: Session, selecciones: unknown) =>
			request(app)
				.post('/apuestas/tickets')
				.set('Cookie', who.cookie)
				.set('X-CSRF-Token', who.csrfToken)
				.set('Idempotency-Key', randomUUID())
				.send({ selecciones });

		it('parallel confirmations of one match settle it once; tickets on other matches go through meanwhile', async () => {
			const bettors = await Promise.all([validatedBettor(), validatedBettor(), validatedBettor()]);
			for (let round = 0; round < 3; round++) {
				const id = await endedMatch(1, 0);
				const open = await insertMatch(pool, s.liga, s.A, s.B, 'programado', wholeSeconds(Date.now() + 3 * DAY + round * HOUR));
				const ticket = await insertTicket();
				const ids = await insertSelections([
					selectionRow(ticket, id, general('local_gana')),
					selectionRow(ticket, id, exact(1, 0)),
					selectionRow(ticket, id, general('empate')),
				]);
				let settled = 0;
				const tracking: MatchSettler = async (conn, match) => {
					settled += (await settleMatchSelections(conn, match)).liquidadas;
				};
				const deadlocks = { ...transactionStats };
				const [confirmations, tickets] = await Promise.all([
					Promise.allSettled(Array.from({ length: 6 }, () => confirmResult(pool, ctx(), id, confirmBody(1, 0), deps(tracking)))),
					Promise.all([
						...bettors.map((who) => placeTicket(who, [{ partidoId: open, tipo: 'resultado_general', pronostico: 'local_gana' }])),
						// A ticket on the match being confirmed: its betting closed long ago.
						placeTicket(bettors[0]!, [{ partidoId: id, tipo: 'resultado_general', pronostico: 'local_gana' }]),
					]),
				]);
				expect(confirmations.filter((c) => c.status === 'fulfilled')).toHaveLength(1);
				for (const c of confirmations) {
					if (c.status === 'rejected') expect(c.reason).toMatchObject({ code: 'RESULT_ALREADY_CONFIRMED' });
				}
				expect(settled).toBe(3);
				expect((await selections(ids)).map((r) => [r.estado, r.puntos])).toEqual([
					['acertada', 3],
					['acertada', 3],
					['no_acertada', 0],
				]);
				expect(tickets.slice(0, 3).map((t) => t.status)).toEqual([201, 201, 201]);
				expect(tickets[3]).toMatchObject({ status: 409, body: { error: { code: 'TICKET_REJECTED' } } });
				expect(transactionStats).toEqual(deadlocks);
			}
			// Confirmations moved no coins: every balance still matches its movements.
			expect(await checkCoinConsistency(pool)).toMatchObject({ ok: true, descuadres: [] });
		});

		it('two matches sharing tickets, confirmed at the same time: each settles its own selections, no deadlocks', async () => {
			const tickets: number[] = [];
			for (let i = 0; i < 20; i++) tickets.push(await insertTicket());
			for (let round = 0; round < 3; round++) {
				const x = await endedMatch(2, 0);
				const y = await endedMatch(0, 0);
				const rows = tickets.flatMap((t) => [
					selectionRow(t, x, general('local_gana')),
					selectionRow(t, y, general('empate')),
					selectionRow(t, x, exact(0, 0)),
					selectionRow(t, y, exact(0, 0)),
				]);
				await insertSelections(rows);
				const deadlocks = { ...transactionStats };
				await Promise.all([
					confirmResult(pool, ctx(), x, confirmBody(2, 0), deps()),
					confirmResult(pool, ctx(), y, confirmBody(0, 0), deps()),
				]);
				expect(transactionStats).toEqual(deadlocks);
				const [totals] = await pool.query<RowDataPacket[]>(
					`SELECT partido_id, COUNT(*) AS n, SUM(puntos_obtenidos) AS puntos,
						SUM(estado_seleccion_id = ?) AS pendientes
					FROM seleccion WHERE partido_id IN (?) GROUP BY partido_id ORDER BY partido_id`,
					[s.cat['estado:pendiente'], [x, y]],
				);
				expect(totals.map((r) => [Number(r.n), Number(r.puntos), Number(r.pendientes)])).toEqual([
					[40, 20 * 3, 0],
					[40, 20 * (1 + 3), 0],
				]);
			}
		});
	});

	describe('what the bettor sees (HTTP)', () => {
		it('receipt, my bets and the summary show states, points and the ticket state; the balance does not change', async () => {
			const who = await signedInUser(app, pool);
			expect((await api.post(`/participantes/${who.user.id}/pago/confirmar`, {})).status).toBe(200);
			expect((await api.post(`/participantes/${who.user.id}/validar`, {})).status).toBe(200);
			const first = await insertMatch(pool, s.liga, s.A, s.B, 'programado', wholeSeconds(Date.now() + 3 * DAY));
			const second = await insertMatch(pool, s.liga, s.B, s.A, 'programado', wholeSeconds(Date.now() + 4 * DAY));
			const placed = await request(app)
				.post('/apuestas/tickets')
				.set('Cookie', who.cookie)
				.set('X-CSRF-Token', who.csrfToken)
				.set('Idempotency-Key', randomUUID())
				.send({
					selecciones: [
						{ partidoId: first, tipo: 'resultado_general', pronostico: 'local_gana' },
						{ partidoId: first, tipo: 'marcador_exacto', golesLocal: 2, golesVisitante: 1 },
						{ partidoId: first, tipo: 'resultado_general', pronostico: 'empate' },
						{ partidoId: second, tipo: 'resultado_general', pronostico: 'empate' },
					],
				});
			expect(placed.status).toBe(201);
			const ticketId = placed.body.data.id as number;

			// Time passes: both matches were played.
			await pool.query('UPDATE partido SET fecha_hora = ? WHERE id IN (?)', [wholeSeconds(Date.now() - 2 * HOUR), [first, second]]);
			const receipt = () => request(app).get(`/apuestas/tickets/${ticketId}`).set('Cookie', who.cookie);

			expect((await api.put(`/partidos/${first}/resultado`, { golesLocal: 2, golesVisitante: 1 })).status).toBe(200);
			expect((await api.get(`/partidos/${first}/resultado`)).body.data.seleccionesPendientes).toBe(3);
			const confirmed = await api.post(`/partidos/${first}/resultado/confirmar`, confirmBody(2, 1));
			expect(confirmed.status).toBe(200);
			expect((await api.get(`/partidos/${first}/resultado`)).body.data.seleccionesPendientes).toBe(0);

			let body = (await receipt()).body.data;
			expect(body).toMatchObject({ estado: 'pendiente', puntosObtenidos: 6, monedasUtilizadas: 4, monedasDevueltas: 0 });
			expect(body.selecciones.map((x: { estado: string; puntosObtenidos: number | null }) => [x.estado, x.puntosObtenidos])).toEqual([
				['acertada', 3],
				['acertada', 3],
				['no_acertada', 0],
				['pendiente', null],
			]);
			expect(body.selecciones[0].resultadoReal).toEqual({ golesLocal: 2, golesVisitante: 1, resultado: 'local_gana' });

			expect((await api.put(`/partidos/${second}/resultado`, { golesLocal: 0, golesVisitante: 0 })).status).toBe(200);
			expect((await api.post(`/partidos/${second}/resultado/confirmar`, confirmBody(0, 0))).status).toBe(200);
			body = (await receipt()).body.data;
			expect(body).toMatchObject({ estado: 'finalizado', puntosObtenidos: 7 });
			expect(body.selecciones[3]).toMatchObject({ estado: 'acertada', puntosObtenidos: 1 });

			const list = await request(app).get('/apuestas/mis-apuestas').set('Cookie', who.cookie);
			expect(list.status).toBe(200);
			expect(list.body.data.items.map((x: { estado: string; puntosObtenidos: number }) => [x.estado, x.puntosObtenidos])).toEqual([
				['acertada', 3],
				['acertada', 3],
				['no_acertada', 0],
				['acertada', 1],
			]);
			expect(list.body.data.items[0].ticket).toMatchObject({ estado: 'finalizado', puntosObtenidos: 7 });
			const hits = await request(app).get('/apuestas/mis-apuestas?estado=acertada').set('Cookie', who.cookie);
			expect(hits.body.data.total).toBe(3);

			const summary = await request(app).get('/apuestas/mis-apuestas/resumen').set('Cookie', who.cookie);
			expect(summary.body.data).toMatchObject({
				tickets: { total: 1, pendiente: 0, finalizado: 1, anulado: 0 },
				selecciones: { total: 4, pendiente: 0, acertada: 3, no_acertada: 1, anulada: 0 },
				monedasUtilizadas: 4,
				monedasDevueltas: 0,
				puntos: 7,
				aciertos: 3,
			});

			// BR-039: 10 coins, 4 spent, nothing earned by the points.
			const me = await request(app).get('/monedas/saldo').set('Cookie', who.cookie);
			expect(me.body.data.saldoMonedas).toBe(6);
			expect(await checkCoinConsistency(pool)).toMatchObject({ ok: true, descuadres: [] });
		});
	});
});
