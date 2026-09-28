import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { lockRowsById } from '../src/db/locks.js';
import { transactionStats, withTransaction } from '../src/db/transaction.js';
import { PREMIO_MARCADOR_EXACTO, PREMIO_RESULTADO_GENERAL, SALDO_MAXIMO } from '../src/lib/coins.js';
import { countPendingSelections } from '../src/services/bets-match-probe.service.js';
import { type LockedWinners, matchSettlement, settleMatchSelections } from '../src/services/bets-settlement.service.js';
import { checkCoinConsistency } from '../src/services/coins-consistency.service.js';
import { confirmationStats, confirmResult, type ResultDeps, type SettlementPreparer } from '../src/services/results.service.js';
import { createTestApp } from './helpers/app.js';
import { registerUser, setUserState, signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

type Session = Awaited<ReturnType<typeof signedInUser>>;
type Pick =
	| { partidoId: number; tipo: 'resultado_general'; pronostico: 'local_gana' | 'empate' | 'visitante_gana' }
	| { partidoId: number; tipo: 'marcador_exacto'; golesLocal: number; golesVisitante: number };
const general = (partidoId: number, pronostico: 'local_gana' | 'empate' | 'visitante_gana'): Pick => ({ partidoId, tipo: 'resultado_general', pronostico });
const exact = (partidoId: number, golesLocal: number, golesVisitante: number): Pick => ({ partidoId, tipo: 'marcador_exacto', golesLocal, golesVisitante });

/**
 * C-09 (BR-057, D-038): a right forecast also pays coins, 1 for the general
 * result and 2 for the exact score, automatically when the admin confirms the
 * result, in that same transaction.
 */
describe('prizes for right forecasts (C-09: BR-057, D-038)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	const s = {} as { liga: number; A: number; B: number };

	const ctx = () => ({ actorId: api.admin.user.id as number });
	const deps = (overrides: Partial<ResultDeps> = {}): ResultDeps => ({ countPendingSelections, ...matchSettlement, ...overrides });
	const confirmBody = (golesLocal: number, golesVisitante: number) => ({ confirmar: true as const, golesLocal, golesVisitante });

	const openMatch = (days = 3, extraSeconds = 0) =>
		insertMatch(pool, s.liga, s.A, s.B, 'programado', wholeSeconds(Date.now() + days * DAY + extraSeconds * 1000));
	/** Time passes: the match started two hours ago, with its score loaded. */
	async function played(id: number, goles: [number, number]) {
		await pool.query(
			"UPDATE partido SET fecha_hora = ?, estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = 'en_curso') WHERE id = ?",
			[wholeSeconds(Date.now() - 2 * HOUR), id],
		);
		await pool.query('UPDATE partido_equipo SET goles = IF(es_visita, ?, ?) WHERE partido_id = ?', [goles[1], goles[0], id]);
	}

	async function bettor(): Promise<Session> {
		const who = await signedInUser(app, pool);
		expect((await api.post(`/participantes/${who.user.id}/pago/confirmar`, {})).status).toBe(200);
		expect((await api.post(`/participantes/${who.user.id}/validar`, {})).status).toBe(200);
		return who;
	}
	const placeTicket = (who: Session, selecciones: Pick[]) =>
		request(app).post('/apuestas/tickets').set('Cookie', who.cookie).set('X-CSRF-Token', who.csrfToken).set('Idempotency-Key', randomUUID()).send({ selecciones });
	async function ticket(who: Session, selecciones: Pick[]): Promise<number> {
		const res = await placeTicket(who, selecciones);
		if (res.status !== 201) throw new Error(`ticket: ${res.status} ${JSON.stringify(res.body)}`);
		return res.body.data.id as number;
	}
	const receipt = (who: Session, id: number) => request(app).get(`/apuestas/tickets/${id}`).set('Cookie', who.cookie);
	const balance = async (userId: number) => {
		const [[row]] = await pool.query<RowDataPacket[]>('SELECT saldo_monedas FROM usuario WHERE id = ?', [userId]);
		return Number(row!.saldo_monedas);
	};
	/** The user's prize movements: [codigo, cantidad], by selection. */
	const prizesOf = async (userId: number) => {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT tm.codigo, m.cantidad FROM movimiento_moneda m JOIN tipo_movimiento tm ON tm.id = m.tipo_movimiento_id
			WHERE m.usuario_id = ? AND tm.codigo LIKE 'premio\\_%' ORDER BY m.seleccion_id`,
			[userId],
		);
		return rows.map((r) => [String(r.codigo), Number(r.cantidad)]);
	};
	async function matchState(id: number) {
		const [[row]] = await pool.query<RowDataPacket[]>('SELECT ep.codigo FROM partido p JOIN estado_partido ep ON ep.id = p.estado_partido_id WHERE p.id = ?', [id]);
		return String(row!.codigo);
	}
	async function snapshot() {
		const [[row]] = await pool.query<RowDataPacket[]>(
			`SELECT (SELECT GROUP_CONCAT(CONCAT(s.id, ':', s.estado_seleccion_id, ':', COALESCE(s.puntos_obtenidos, '-')) ORDER BY s.id) FROM seleccion s) AS selecciones,
				(SELECT COUNT(*) FROM movimiento_moneda) AS movimientos,
				(SELECT GROUP_CONCAT(CONCAT(id, ':', saldo_monedas) ORDER BY id) FROM usuario) AS saldos,
				(SELECT GROUP_CONCAT(CONCAT(id, ':', estado_partido_id) ORDER BY id) FROM partido) AS partidos,
				(SELECT COUNT(*) FROM auditoria) AS auditoria`,
		);
		return row;
	}
	const consistent = async () => expect(await checkCoinConsistency(pool)).toMatchObject({ ok: true, descuadres: [], adminsConMonedas: [] });

	beforeAll(() => {
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
		await consistent();
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('what pays, and how much', () => {
		it('the amounts live in lib/coins.ts: 1 for a general result, 2 for an exact score', () => {
			expect([PREMIO_RESULTADO_GENERAL, PREMIO_MARCADOR_EXACTO]).toEqual([1, 2]);
		});

		it('a right winner pays 1, a right exact score 2, a miss 0; paid by the confirmation itself, with nothing else to approve', async () => {
			const ana = await bettor();
			const x = await openMatch();
			const t = await ticket(ana, [general(x, 'local_gana'), exact(x, 2, 1), general(x, 'empate'), exact(x, 1, 0)]);
			await played(x, [2, 1]);

			const res = await api.post(`/partidos/${x}/resultado/confirmar`, confirmBody(2, 1));
			expect(res.status).toBe(200);
			expect(res.body.data.premios).toEqual({ selecciones: 2, monedas: 3, participantes: 1 });
			// 10 - 4 debits + 1 + 2.
			expect(await balance(ana.user.id)).toBe(9);
			expect(await prizesOf(ana.user.id)).toEqual([
				['premio_resultado_general', 1],
				['premio_marcador_exacto', 2],
			]);
			const body = (await receipt(ana, t)).body.data;
			expect(body.monedasGanadas).toBe(3);
			expect(body.selecciones.map((x: { monedasGanadas: number }) => x.monedasGanadas)).toEqual([1, 2, 0, 0]);
			// The session read shows the new balance: the navbar counter updates on its next read.
			expect((await request(app).get('/auth/me').set('Cookie', ana.cookie)).body.data.user.saldoMonedas).toBe(9);
		});

		it('a right draw pays 1 (and 1 point); a wrong draw pays nothing', async () => {
			const [ana, beto] = [await bettor(), await bettor()];
			const x = await openMatch();
			await ticket(ana, [general(x, 'empate')]);
			await ticket(beto, [general(x, 'local_gana'), exact(x, 0, 0)]);
			await played(x, [1, 1]);
			const confirmed = await confirmResult(pool, ctx(), x, confirmBody(1, 1), deps());
			expect(confirmed.premios).toEqual({ selecciones: 1, monedas: 1, participantes: 1 });
			expect(await prizesOf(ana.user.id)).toEqual([['premio_resultado_general', 1]]);
			expect(await prizesOf(beto.user.id)).toEqual([]);
			expect([await balance(ana.user.id), await balance(beto.user.id)]).toEqual([10, 8]);
		});

		it('several participants, repeated picks: each right selection pays on its own', async () => {
			const [ana, beto, carla] = [await bettor(), await bettor(), await bettor()];
			const x = await openMatch();
			await ticket(ana, [general(x, 'visitante_gana'), general(x, 'visitante_gana')]);
			await ticket(beto, [exact(x, 0, 2)]);
			await ticket(carla, [exact(x, 0, 1), general(x, 'empate')]);
			await played(x, [0, 2]);
			const confirmed = await confirmResult(pool, ctx(), x, confirmBody(0, 2), deps());
			expect(confirmed.premios).toEqual({ selecciones: 3, monedas: 4, participantes: 2 });
			expect([await balance(ana.user.id), await balance(beto.user.id), await balance(carla.user.id)]).toEqual([10, 11, 8]);
		});

		it('voided, already settled and admin-account selections get nothing; matches confirmed before C-09 are never paid', async () => {
			const ana = await bettor();
			const x = await openMatch();
			const old = await openMatch(4);
			const t = await ticket(ana, [general(x, 'local_gana'), general(x, 'local_gana'), general(old, 'local_gana')]);
			const [[voided], [settled]] = await Promise.all([
				pool.query<RowDataPacket[]>('SELECT id FROM seleccion WHERE ticket_id = ? AND partido_id = ? ORDER BY id LIMIT 1', [t, x]),
				pool.query<RowDataPacket[]>('SELECT id FROM seleccion WHERE ticket_id = ? AND partido_id = ?', [t, old]),
			]);
			// By hand: one voided (no refund) and, on the other match, one settled right as before C-09, with no prize.
			await pool.query("UPDATE seleccion SET estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = 'anulada') WHERE id = ?", [voided[0]!.id]);
			await played(old, [3, 0]);
			await pool.query(
				"UPDATE seleccion SET estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = 'acertada'), puntos_obtenidos = 3 WHERE id = ?",
				[settled[0]!.id],
			);
			await pool.query("UPDATE partido SET estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = 'finalizado') WHERE id = ?", [old]);
			// And an admin account's right pick (loaded by hand: admins never bet).
			const admin2 = await registerUser(app);
			await setUserState(pool, admin2.user.id, { rol: 'admin' });
			const [adminTicket] = await pool.query<import('mysql2/promise').ResultSetHeader>(
				'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, UTC_TIMESTAMP(), UUID(), SHA2(UUID(), 256))',
				[admin2.user.id],
			);
			await pool.query(
				`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id)
				SELECT ?, ?, ta.id, rg.id, es.id FROM tipo_apuesta ta, resultado_general rg, estado_seleccion es
				WHERE ta.codigo = 'resultado_general' AND rg.codigo = 'local_gana' AND es.codigo = 'pendiente'`,
				[adminTicket.insertId, x],
			);

			await played(x, [1, 0]);
			const confirmed = await confirmResult(pool, ctx(), x, confirmBody(1, 0), deps());
			// Only the one live pick of the participant.
			expect(confirmed.premios).toEqual({ selecciones: 1, monedas: 1, participantes: 1 });
			expect(await prizesOf(ana.user.id)).toEqual([['premio_resultado_general', 1]]);
			expect(await prizesOf(admin2.user.id)).toEqual([]);
			const [[adminPick]] = await pool.query<RowDataPacket[]>(
				'SELECT es.codigo FROM seleccion s JOIN estado_seleccion es ON es.id = s.estado_seleccion_id WHERE s.ticket_id = ?',
				[adminTicket.insertId],
			);
			expect(adminPick!.codigo).toBe('acertada');
			// The old match's hit stays unpaid (D-038: not retroactive), and its receipt says so.
			const body = (await receipt(ana, t)).body.data;
			expect(body.selecciones.map((x: { estado: string; monedasGanadas: number }) => [x.estado, x.monedasGanadas])).toEqual([
				['anulada', 0],
				['acertada', 1],
				['acertada', 0],
			]);
			expect(body.monedasGanadas).toBe(1);
		});
	});

	describe('never twice, all or nothing', () => {
		it('a second confirmation is refused and pays nothing; a deadlock retry pays once', async () => {
			const ana = await bettor();
			const x = await openMatch();
			await ticket(ana, [exact(x, 2, 2)]);
			await played(x, [2, 2]);
			let calls = 0;
			const flaky: ResultDeps['settle'] = async (conn, match, prepared) => {
				calls++;
				const summary = await settleMatchSelections(conn, match, prepared as LockedWinners);
				if (calls === 1) throw Object.assign(new Error('deadlock simulado'), { errno: 1213, sqlState: '40001' });
				return summary.premios;
			};
			const retries = transactionStats.deadlockRetries;
			const confirmed = await confirmResult(pool, ctx(), x, confirmBody(2, 2), deps({ settle: flaky }));
			expect(transactionStats.deadlockRetries).toBe(retries + 1);
			expect(confirmed.premios).toEqual({ selecciones: 1, monedas: 2, participantes: 1 });
			await expect(confirmResult(pool, ctx(), x, confirmBody(2, 2), deps())).rejects.toMatchObject({ code: 'RESULT_ALREADY_CONFIRMED' });
			expect(await prizesOf(ana.user.id)).toEqual([['premio_marcador_exacto', 2]]);
			expect(await balance(ana.user.id)).toBe(11);
		});

		it('if the payment fails, nothing is confirmed: match, selections, balances and audit stay as they were', async () => {
			const ana = await bettor();
			const x = await openMatch();
			const t = await ticket(ana, [general(x, 'local_gana')]);
			await played(x, [1, 0]);
			// A prize already there for that selection (hand-loaded data): the database refuses the second one.
			await pool.query(
				`INSERT INTO movimiento_moneda (usuario_id, tipo_movimiento_id, seleccion_id, cantidad, creado_en)
				SELECT ?, tm.id, s.id, 1, UTC_TIMESTAMP() FROM tipo_movimiento tm, seleccion s WHERE tm.codigo = 'premio_resultado_general' AND s.ticket_id = ?`,
				[ana.user.id, t],
			);
			await pool.query('UPDATE usuario SET saldo_monedas = saldo_monedas + 1 WHERE id = ?', [ana.user.id]);
			const before = await snapshot();
			const res = await api.post(`/partidos/${x}/resultado/confirmar`, confirmBody(1, 0));
			expect(res.status).toBe(409);
			expect(res.body.error.code).toBe('MOVEMENT_ALREADY_APPLIED');
			expect(await snapshot()).toEqual(before);
			expect(await matchState(x)).toBe('en_curso');
		});

		it('SALDO_MAXIMO: a prize past the maximum balance is a 409 BALANCE_LIMIT_EXCEEDED, never a 500, and nothing is confirmed', async () => {
			const ana = await bettor();
			const x = await openMatch();
			await ticket(ana, [exact(x, 3, 0)]);
			await played(x, [3, 0]);
			// A balance one coin short of the maximum, set by hand (no movement could carry that many coins),
			// and put back at the end so coins:check agrees again.
			const real = await balance(ana.user.id);
			await pool.query('UPDATE usuario SET saldo_monedas = ? WHERE id = ?', [SALDO_MAXIMO - 1, ana.user.id]);
			const before = await snapshot();
			try {
				const res = await api.post(`/partidos/${x}/resultado/confirmar`, confirmBody(3, 0));
				expect(res.status).toBe(409);
				expect(res.body.error).toMatchObject({ code: 'BALANCE_LIMIT_EXCEEDED', details: { participantes: 1, saldoMaximo: SALDO_MAXIMO } });
				expect(JSON.stringify(res.body)).not.toContain(String(ana.user.id));
				expect(await snapshot()).toEqual(before);
				expect(await matchState(x)).toBe('en_curso');
			} finally {
				await pool.query('UPDATE usuario SET saldo_monedas = ? WHERE id = ?', [real, ana.user.id]);
			}
			// With room in the balance, the same confirmation goes through.
			expect((await api.post(`/partidos/${x}/resultado/confirmar`, confirmBody(3, 0))).status).toBe(200);
			expect(await balance(ana.user.id)).toBe(real + 2);
		});
	});

	describe('lock order: usuario → partido', () => {
		it('locking the winners holds exactly their rows: the admin row stays free for the audit record (stress-test deadlock)', async () => {
			const [ana, beto] = [await bettor(), await bettor()];
			const done = new Error('fin');
			await expect(
				withTransaction(pool, async (conn) => {
					await lockRowsById(conn, 'usuario', [beto.user.id, ana.user.id], 'UPDATE');
					// Another transaction takes what an audit insert takes on the admin's row, without waiting.
					const other = await pool.getConnection();
					try {
						await other.query('SET SESSION innodb_lock_wait_timeout = 1');
						await other.beginTransaction();
						await other.query('SELECT id FROM usuario WHERE id = ? FOR SHARE', [api.admin.user.id]);
						await other.rollback();
					} finally {
						await other.query('SET SESSION innodb_lock_wait_timeout = DEFAULT');
						other.release();
					}
					throw done;
				}),
			).rejects.toBe(done);
		});

		it('a bettor that shows up before the match is locked makes the confirmation start over, and gets paid too', async () => {
			const [ana, late] = [await bettor(), await bettor()];
			const x = await openMatch();
			await ticket(ana, [general(x, 'local_gana')]);
			// The late bettor's pick is placed while its betting was still open, then parked as another match's.
			const parking = await openMatch(5);
			const lateTicket = await ticket(late, [general(parking, 'local_gana')]);
			await played(x, [2, 0]);

			let moved = false;
			const prepare: SettlementPreparer = async (conn, matchId, result) => {
				const locked = await matchSettlement.prepareSettlement(conn, matchId, result);
				if (!moved) {
					moved = true;
					// Committed by another connection after the winners were locked, before the match lock.
					await pool.query('UPDATE seleccion SET partido_id = ? WHERE ticket_id = ?', [x, lateTicket]);
				}
				return locked;
			};
			const restarts = confirmationStats.restarts;
			const confirmed = await confirmResult(pool, ctx(), x, confirmBody(2, 0), deps({ prepareSettlement: prepare }));
			expect(confirmationStats.restarts).toBe(restarts + 1);
			expect(confirmed.premios).toEqual({ selecciones: 2, monedas: 2, participantes: 2 });
			expect(await prizesOf(late.user.id)).toEqual([['premio_resultado_general', 1]]);
		});

		it(`new bettors on every attempt: after 3 tries it is 409 CONCURRENT_UPDATE and nothing is confirmed`, async () => {
			const ana = await bettor();
			const x = await openMatch();
			await ticket(ana, [general(x, 'local_gana')]);
			const parking = await openMatch(5);
			const late = [await bettor(), await bettor(), await bettor()];
			const lateTickets: number[] = [];
			for (const who of late) lateTickets.push(await ticket(who, [general(parking, 'local_gana')]));
			await played(x, [1, 0]);
			const before = await snapshot();

			let attempt = 0;
			const prepare: SettlementPreparer = async (conn, matchId, result) => {
				const locked = await matchSettlement.prepareSettlement(conn, matchId, result);
				await pool.query('UPDATE seleccion SET partido_id = ? WHERE ticket_id = ?', [x, lateTickets[attempt++]]);
				return locked;
			};
			await expect(confirmResult(pool, ctx(), x, confirmBody(1, 0), deps({ prepareSettlement: prepare }))).rejects.toMatchObject({
				status: 409,
				code: 'CONCURRENT_UPDATE',
			});
			expect(attempt).toBe(3);
			expect(await matchState(x)).toBe('en_curso');
			// Only the parked picks moved (the test did that); no coin, no settlement, no audit record.
			const after = await snapshot();
			expect({ ...after, selecciones: null }).toEqual({ ...before, selecciones: null });
		});

		it('confirmations, new tickets of the winners and a cancellation at the same time: no deadlock, everyone paid once', async () => {
			const people = [await bettor(), await bettor(), await bettor()];
			for (let round = 0; round < 3; round++) {
				const x = await openMatch(3, round);
				const y = await openMatch(4, round);
				const z = await openMatch(5, round);
				for (const who of people) await ticket(who, [general(x, 'local_gana'), exact(y, 1, 1), general(z, 'empate')]);
				await played(x, [1, 0]);
				await played(y, [1, 1]);
				const open = await openMatch(6, round);
				const deadlocks = { ...transactionStats };
				const [a, b, c, ...placed] = await Promise.all([
					api.post(`/partidos/${x}/resultado/confirmar`, confirmBody(1, 0)),
					api.post(`/partidos/${y}/resultado/confirmar`, confirmBody(1, 1)),
					api.post(`/partidos/${z}/cancelacion/confirmar`, { confirmar: true }),
					...people.map((who) => placeTicket(who, [general(open, 'visitante_gana')])),
				]);
				expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
				expect(a.body.data.premios).toEqual({ selecciones: 3, monedas: 3, participantes: 3 });
				expect(b.body.data.premios).toEqual({ selecciones: 3, monedas: 6, participantes: 3 });
				expect(placed.map((p) => p.status)).toEqual([201, 201, 201]);
				expect(transactionStats.deadlocksExhausted).toBe(deadlocks.deadlocksExhausted);
			}
			// Per round: 3 + 1 debits, +1 +2 prizes and 1 refunded.
			for (const who of people) expect(await balance(who.user.id)).toBe(10 + 3 * (-4 + 1 + 2 + 1));
		});
	});

	describe('what each screen reads', () => {
		it('the audit record carries the counts, never who got what or a balance', async () => {
			const ana = await bettor();
			const x = await openMatch();
			await ticket(ana, [general(x, 'local_gana'), exact(x, 1, 0)]);
			await played(x, [1, 0]);
			expect((await api.post(`/partidos/${x}/resultado/confirmar`, confirmBody(1, 0))).status).toBe(200);
			const [[row]] = await pool.query<RowDataPacket[]>(
				`SELECT CAST(au.detalle AS CHAR) AS detalle FROM auditoria au JOIN accion_auditoria a ON a.id = au.accion_id
				WHERE a.codigo = 'confirmacion_resultado' AND au.entidad_id = ?`,
				[x],
			);
			const detalle = JSON.parse(String(row!.detalle));
			expect(detalle).toEqual({ marcador: { golesLocal: 1, golesVisitante: 0 }, premios: { selecciones: 2, monedas: 3, participantes: 1 } });
			expect(String(row!.detalle)).not.toMatch(/usuario|saldo/i);
		});

		it('my bets, its summary, the admin bets query and the pool figures add up the real prize movements; everyone’s bets show no coins', async () => {
			const [ana, beto] = [await bettor(), await bettor()];
			const x = await openMatch();
			await ticket(ana, [general(x, 'local_gana'), exact(x, 2, 0)]);
			await ticket(beto, [general(x, 'empate')]);
			await played(x, [2, 0]);
			expect((await api.post(`/partidos/${x}/resultado/confirmar`, confirmBody(2, 0))).status).toBe(200);

			const mine = await request(app).get('/apuestas/mis-apuestas').set('Cookie', ana.cookie);
			expect(mine.body.data.items.map((i: { monedasGanadas: number; ticket: { monedasGanadas: number } }) => [i.monedasGanadas, i.ticket.monedasGanadas])).toEqual([
				[1, 3],
				[2, 3],
			]);
			expect((await request(app).get('/apuestas/mis-apuestas/resumen').set('Cookie', ana.cookie)).body.data.monedasGanadas).toBe(3);
			expect((await request(app).get('/apuestas/mis-apuestas/resumen').set('Cookie', beto.cookie)).body.data.monedasGanadas).toBe(0);

			const adminBets = (await api.get('/polla/apuestas')).body.data.items as Array<{ usuario: { id: number }; monedasGanadas: number }>;
			expect(adminBets.filter((b) => b.usuario.id === ana.user.id).map((b) => b.monedasGanadas).sort()).toEqual([1, 2]);
			expect((await api.get('/polla/estadisticas')).body.data.monedasGanadas).toBe(3);

			const everyone = await request(app).get('/apuestas/participantes').set('Cookie', ana.cookie);
			expect(everyone.status).toBe(200);
			expect(everyone.body.data.items).toHaveLength(3);
			expect(JSON.stringify(everyone.body)).not.toMatch(/monedas|ganadas/i);
		});
	});
});
