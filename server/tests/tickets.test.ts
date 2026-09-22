import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transactionStats } from '../src/db/transaction.js';
import { bettingCloseTime, ticketState } from '../src/lib/betting.js';
import { COSTO_POR_SELECCION, MONEDAS_POR_VALIDACION } from '../src/lib/coins.js';
import { applyCoinMovementsInTransaction } from '../src/services/coins.service.js';
import { checkCoinConsistency } from '../src/services/coins-consistency.service.js';
import { confirmTicket } from '../src/services/tickets.service.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

type Session = Awaited<ReturnType<typeof signedInUser>>;
type Selection =
	| { partidoId: number; tipo: 'resultado_general'; pronostico: 'local_gana' | 'empate' | 'visitante_gana' }
	| { partidoId: number; tipo: 'marcador_exacto'; golesLocal: number; golesVisitante: number };
const general = (partidoId: number, pronostico: 'local_gana' | 'empate' | 'visitante_gana' = 'local_gana'): Selection => ({
	partidoId,
	tipo: 'resultado_general',
	pronostico,
});
const exact = (partidoId: number, golesLocal: number, golesVisitante: number): Selection => ({
	partidoId,
	tipo: 'marcador_exacto',
	golesLocal,
	golesVisitante,
});

describe('ticket confirmation (T-10: BR-019 to BR-025, BR-053, BR-054)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	const s = {} as { futbol: number; voley: number; match: Record<string, number>; missing: number };

	const confirm = (who: Session, selecciones: unknown, key: string | null = randomUUID()) => {
		const req = request(app).post('/apuestas/tickets').set('Cookie', who.cookie).set('X-CSRF-Token', who.csrfToken);
		if (key !== null) req.set('Idempotency-Key', key);
		return req.send({ selecciones });
	};
	const receipt = (who: Session, id: number | string) => request(app).get(`/apuestas/tickets/${id}`).set('Cookie', who.cookie);

	/** A participant validated through the real admin actions: 10 coins with their movement (coins:check stays clean). */
	async function validatedBettor(): Promise<Session> {
		const who = await signedInUser(app, pool);
		expect((await api.post(`/participantes/${who.user.id}/pago/confirmar`, {})).status).toBe(200);
		expect((await api.post(`/participantes/${who.user.id}/validar`, {})).status).toBe(200);
		return who;
	}

	async function counts(userId: number) {
		const [[row]] = await pool.query<RowDataPacket[]>(
			`SELECT (SELECT COUNT(*) FROM ticket WHERE usuario_id = ?) AS tickets,
				(SELECT COUNT(*) FROM seleccion s JOIN ticket t ON t.id = s.ticket_id WHERE t.usuario_id = ?) AS selecciones,
				(SELECT COUNT(*) FROM movimiento_moneda WHERE usuario_id = ?) AS movimientos,
				(SELECT saldo_monedas FROM usuario WHERE id = ?) AS saldo`,
			[userId, userId, userId, userId],
		);
		return { tickets: Number(row!.tickets), selecciones: Number(row!.selecciones), movimientos: Number(row!.movimientos), saldo: Number(row!.saldo) };
	}

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		const post = (path: string, body: unknown) => created<{ id: number }>(api.post(path, body));
		s.futbol = (await post('/deportes', { nombre: 'Fútbol', permiteEmpate: true })).id;
		s.voley = (await post('/deportes', { nombre: 'Vóley', permiteEmpate: false })).id;
		const liga = (await post('/competiciones', { deporteId: s.futbol, nombre: 'Liga' })).id;
		const ligaVoley = (await post('/competiciones', { deporteId: s.voley, nombre: 'Liga Vóley' })).id;
		const A = (await post('/equipos', teamBody(liga, { nombre: 'Alianza' }))).id;
		const B = (await post('/equipos', teamBody(liga, { nombre: 'Boca' }))).id;
		const P = (await post('/equipos', teamBody(ligaVoley, { nombre: 'Pumas' }))).id;
		const Q = (await post('/equipos', teamBody(ligaVoley, { nombre: 'Quilmes' }))).id;
		const now = Date.now();
		s.match = {
			open: await insertMatch(pool, liga, A, B, 'programado', wholeSeconds(now + 3 * DAY)),
			later: await insertMatch(pool, liga, B, A, 'programado', wholeSeconds(now + 5 * DAY)),
			voley: await insertMatch(pool, ligaVoley, P, Q, 'programado', wholeSeconds(now + 2 * DAY)),
			closed: await insertMatch(pool, liga, A, B, 'programado', wholeSeconds(now + 2 * HOUR)),
			live: await insertMatch(pool, liga, B, A, 'en_curso', wholeSeconds(now - HOUR)),
			cancelled: await insertMatch(pool, liga, A, B, 'cancelado', wholeSeconds(now + 4 * DAY)),
		};
		const [[max]] = await pool.query<RowDataPacket[]>('SELECT MAX(id) AS id FROM partido');
		s.missing = Number(max!.id) + 1000;
	});

	afterAll(async () => {
		// Every balance came from real movements: nothing is out of step (npm run coins:check).
		const report = await checkCoinConsistency(pool);
		expect(report).toMatchObject({ ok: true, descuadres: [], adminsConMonedas: [] });
		expect(report.revisados).toBeGreaterThan(0);
		await resetDatabase(pool);
		await pool.end();
	});

	describe('access', () => {
		it('anonymous: 401 on confirm and receipt', async () => {
			expect((await request(app).post('/apuestas/tickets').set('Idempotency-Key', randomUUID()).send({ selecciones: [general(s.match.open!)] })).status).toBe(401);
			expect((await request(app).get('/apuestas/tickets/1')).status).toBe(401);
		});

		it('a pendiente user: 403 USER_NOT_VALIDATED, nothing written', async () => {
			const pending = await signedInUser(app, pool);
			const res = await confirm(pending, [general(s.match.open!)]);
			expect(res.status).toBe(403);
			expect(res.body.error.code).toBe('USER_NOT_VALIDATED');
			expect(await counts(pending.user.id)).toMatchObject({ tickets: 0, movimientos: 0 });
		});

		it('an admin, even marked validado: 403 ADMIN_CANNOT_BET', async () => {
			await pool.query("UPDATE usuario SET estado_usuario_id = (SELECT id FROM estado_usuario WHERE codigo = 'validado') WHERE id = ?", [api.admin.user.id]);
			const res = await confirm(api.admin as Session, [general(s.match.open!)]);
			expect(res.status).toBe(403);
			expect(res.body.error.code).toBe('ADMIN_CANNOT_BET');
			await pool.query("UPDATE usuario SET estado_usuario_id = (SELECT id FROM estado_usuario WHERE codigo = 'pendiente') WHERE id = ?", [api.admin.user.id]);
		});

		it('CSRF: without the token or from a foreign origin, 403 and no ticket', async () => {
			const who = await validatedBettor();
			const noToken = await request(app)
				.post('/apuestas/tickets')
				.set('Cookie', who.cookie)
				.set('Idempotency-Key', randomUUID())
				.send({ selecciones: [general(s.match.open!)] });
			expect(noToken.status).toBe(403);
			expect(noToken.body.error.code).toBe('CSRF_FAILED');
			expect((await confirm(who, [general(s.match.open!)]).set('Origin', 'https://otro.example')).status).toBe(403);
			expect(await counts(who.user.id)).toMatchObject({ tickets: 0, saldo: MONEDAS_POR_VALIDACION });
		});
	});

	describe('confirming', () => {
		it('one selection: 201 with the BR-025 receipt, the selection pending, one coin debited with its selection id', async () => {
			const who = await validatedBettor();
			const res = await confirm(who, [general(s.match.open!, 'empate')]);

			expect(res.status).toBe(201);
			expect(res.headers['cache-control']).toBe('no-store');
			const ticket = res.body.data;
			expect(res.headers.location).toBe(`/apuestas/tickets/${ticket.id}`);
			expect(ticket).toEqual({
				id: expect.any(Number),
				usuario: { id: who.user.id, nombre: expect.any(String) },
				creadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
				estado: 'pendiente',
				cantidadSelecciones: 1,
				monedasUtilizadas: COSTO_POR_SELECCION,
				monedasDevueltas: 0,
				puntosObtenidos: 0,
				selecciones: [
					{
						id: expect.any(Number),
						partido: expect.objectContaining({
							id: s.match.open,
							estado: 'programado',
							local: expect.objectContaining({ equipo: expect.objectContaining({ nombre: 'Alianza' }) }),
							visita: expect.objectContaining({ equipo: expect.objectContaining({ nombre: 'Boca' }) }),
						}),
						resultadoReal: null,
						tipo: 'resultado_general',
						pronostico: 'empate',
						golesLocal: null,
						golesVisitante: null,
						estado: 'pendiente',
						costo: COSTO_POR_SELECCION,
						puntosObtenidos: null,
					},
				],
			});
			expect(Math.abs(new Date(ticket.creadoEn).getTime() - Date.now())).toBeLessThan(10_000);

			const [[row]] = await pool.query<RowDataPacket[]>(
				`SELECT es.codigo AS estado, s.puntos_obtenidos AS puntos, m.cantidad, tm.codigo AS tipo
				FROM seleccion s
				JOIN estado_seleccion es ON es.id = s.estado_seleccion_id
				JOIN movimiento_moneda m ON m.seleccion_id = s.id
				JOIN tipo_movimiento tm ON tm.id = m.tipo_movimiento_id
				WHERE s.ticket_id = ?`,
				[ticket.id],
			);
			expect(row).toMatchObject({ estado: 'pendiente', puntos: null, cantidad: -COSTO_POR_SELECCION, tipo: 'seleccion_confirmada' });
			expect(await counts(who.user.id)).toEqual({ tickets: 1, selecciones: 1, movimientos: 2, saldo: MONEDAS_POR_VALIDACION - 1 });
		});

		it('several matches, contradictory and of both types (BR-017 to BR-019): one ticket, one debit per selection', async () => {
			const who = await validatedBettor();
			const selecciones = [
				general(s.match.open!, 'local_gana'),
				general(s.match.open!, 'empate'),
				general(s.match.open!, 'visitante_gana'),
				exact(s.match.open!, 2, 1),
				exact(s.match.voley!, 3, 1),
				general(s.match.later!, 'empate'),
				general(s.match.later!, 'empate'),
			];
			const res = await confirm(who, selecciones);

			expect(res.status).toBe(201);
			expect(res.body.data).toMatchObject({ cantidadSelecciones: 7, monedasUtilizadas: 7, estado: 'pendiente' });
			expect(
				res.body.data.selecciones.map((x: { partido: { id: number }; tipo: string; pronostico: string | null; golesLocal: number | null }) => [
					x.partido.id,
					x.tipo,
					x.pronostico ?? x.golesLocal,
				]),
			).toEqual([
				[s.match.open, 'resultado_general', 'local_gana'],
				[s.match.open, 'resultado_general', 'empate'],
				[s.match.open, 'resultado_general', 'visitante_gana'],
				[s.match.open, 'marcador_exacto', 2],
				[s.match.voley, 'marcador_exacto', 3],
				[s.match.later, 'resultado_general', 'empate'],
				[s.match.later, 'resultado_general', 'empate'],
			]);
			const [debits] = await pool.query<RowDataPacket[]>(
				`SELECT m.seleccion_id FROM movimiento_moneda m JOIN seleccion s ON s.id = m.seleccion_id
				WHERE s.ticket_id = ? AND m.cantidad = -1 ORDER BY m.seleccion_id`,
				[res.body.data.id],
			);
			expect(debits.map((d) => Number(d.seleccion_id))).toEqual(res.body.data.selecciones.map((x: { id: number }) => x.id));
			expect(await counts(who.user.id)).toMatchObject({ tickets: 1, selecciones: 7, saldo: 3 });
		});

		it.each([
			['a closed match', () => general(s.match.closed!), 'BETTING_CLOSED'],
			['a match in progress', () => general(s.match.live!), 'MATCH_NOT_PROGRAMMED'],
			['a cancelled match', () => general(s.match.cancelled!), 'MATCH_NOT_PROGRAMMED'],
			['a missing match', () => general(s.missing), 'MATCH_NOT_FOUND'],
			['a draw where the sport has none', () => general(s.match.voley!, 'empate'), 'DRAW_NOT_ALLOWED'],
			['a tied exact score where the sport has none', () => exact(s.match.voley!, 1, 1), 'DRAW_NOT_ALLOWED'],
		])('one bad selection (%s) rejects the whole ticket: 409 with the per-selection detail, nothing written', async (_label, bad, code) => {
			const who = await validatedBettor();
			const before = await counts(who.user.id);
			const res = await confirm(who, [general(s.match.open!), bad(), exact(s.match.later!, 0, 0)]);

			expect(res.status).toBe(409);
			expect(res.body.error.code).toBe('TICKET_REJECTED');
			const details = res.body.error.details;
			expect(details).toMatchObject({ valido: false, cantidadSelecciones: 3, costoTotal: 3, saldoActual: 10, saldoSuficiente: true });
			expect(details.selecciones.map((x: { valida: boolean }) => x.valida)).toEqual([true, false, true]);
			expect(details.selecciones[1].errores.map((e: { code: string }) => e.code)).toContain(code);
			expect(await counts(who.user.id)).toEqual(before);
		});

		it('balance (BR-021): exactly enough leaves 0; then one more coin is refused without writing', async () => {
			const who = await validatedBettor();
			const ten = Array.from({ length: MONEDAS_POR_VALIDACION }, (_, i) => exact(s.match.later!, i, 0));
			expect((await confirm(who, ten)).status).toBe(201);
			expect(await counts(who.user.id)).toMatchObject({ saldo: 0, selecciones: 10 });

			const res = await confirm(who, [general(s.match.open!)]);
			expect(res.status).toBe(409);
			expect(res.body.error.code).toBe('TICKET_REJECTED');
			expect(res.body.error.details).toMatchObject({ saldoActual: 0, costoTotal: 1, saldoPosterior: -1, saldoSuficiente: false });
			expect(res.body.error.details.errores).toEqual([{ code: 'INSUFFICIENT_BALANCE', message: expect.any(String) }]);
			expect(await counts(who.user.id)).toMatchObject({ tickets: 1, saldo: 0, selecciones: 10 });
		});

		it('more than the balance in one ticket is refused too', async () => {
			const who = await validatedBettor();
			const eleven = Array.from({ length: MONEDAS_POR_VALIDACION + 1 }, (_, i) => exact(s.match.later!, i, 1));
			const res = await confirm(who, eleven);
			expect(res.status).toBe(409);
			expect(res.body.error.details).toMatchObject({ saldoActual: 10, costoTotal: 11, saldoSuficiente: false });
			expect(await counts(who.user.id)).toMatchObject({ tickets: 0, saldo: 10 });
		});

		it('the close, exactly: accepted 1 ms before it, refused at it', async () => {
			const who = await validatedBettor();
			const [[row]] = await pool.query<RowDataPacket[]>('SELECT fecha_hora FROM partido WHERE id = ?', [s.match.open]);
			const close = bettingCloseTime(row!.fecha_hora as Date).getTime();

			const before = await confirmTicket(pool, who.user.id, randomUUID(), [general(s.match.open!)], new Date(close - 1));
			expect(before.repetido).toBe(false);

			const at = confirmTicket(pool, who.user.id, randomUUID(), [general(s.match.open!)], new Date(close));
			await expect(at).rejects.toMatchObject({ code: 'TICKET_REJECTED' });
			const error = (await at.catch((e: unknown) => e)) as { details: { selecciones: Array<{ errores: Array<{ code: string }> }> } };
			expect(error.details.selecciones[0]!.errores.map((e) => e.code)).toEqual(['BETTING_CLOSED']);
			expect(await counts(who.user.id)).toMatchObject({ tickets: 1, saldo: 9 });
		});

		it('rejects a malformed body with 400, like the preview', async () => {
			const who = await validatedBettor();
			for (const selecciones of [[], [{ partidoId: s.match.open, tipo: 'campeon' }], [{ ...general(s.match.open!), extra: 1 }]]) {
				const res = await confirm(who, selecciones);
				expect(res.status).toBe(400);
				expect(res.body.error.code).toBe('VALIDATION_ERROR');
			}
			const query = await request(app)
				.post('/apuestas/tickets?confirmar=1')
				.set('Cookie', who.cookie)
				.set('X-CSRF-Token', who.csrfToken)
				.set('Idempotency-Key', randomUUID())
				.send({ selecciones: [general(s.match.open!)] });
			expect(query.status).toBe(400);
			expect(await counts(who.user.id)).toMatchObject({ tickets: 0 });
		});

		it('the ticket state is derived from its selections', () => {
			expect(ticketState(['pendiente', 'acertada'])).toBe('pendiente');
			expect(ticketState(['acertada', 'no_acertada', 'anulada'])).toBe('finalizado');
			expect(ticketState(['anulada', 'anulada'])).toBe('anulado');
			expect(ticketState(['no_acertada'])).toBe('finalizado');
		});

		it('points and refunds on the receipt are computed from the selections, not stored', async () => {
			const who = await validatedBettor();
			const res = await confirm(who, [general(s.match.open!), exact(s.match.open!, 1, 0), general(s.match.later!)]);
			const [a, b, c] = res.body.data.selecciones as Array<{ id: number }>;
			// What T-12 and T-16 will do: settle two, void one.
			const setState = (id: number, estado: string, puntos: number | null) =>
				pool.query('UPDATE seleccion SET estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = ?), puntos_obtenidos = ? WHERE id = ?', [estado, puntos, id]);
			await setState(a!.id, 'acertada', 3);
			await setState(b!.id, 'no_acertada', 0);
			expect((await receipt(who, res.body.data.id)).body.data).toMatchObject({ estado: 'pendiente', puntosObtenidos: 3, monedasDevueltas: 0 });
			await setState(c!.id, 'anulada', null);
			// D-003: a voided selection shows a refund only once the coin really came back.
			expect((await receipt(who, res.body.data.id)).body.data).toMatchObject({ estado: 'finalizado', monedasDevueltas: 0 });
			await applyCoinMovementsInTransaction(pool, who.user.id, [{ tipo: 'devolucion_cancelacion', seleccionId: c!.id }]);
			expect((await receipt(who, res.body.data.id)).body.data).toMatchObject({
				estado: 'finalizado',
				puntosObtenidos: 3,
				monedasUtilizadas: 3,
				monedasDevueltas: 1,
			});
		});
	});

	describe('idempotency (BR-054)', () => {
		it.each([
			['missing', null],
			['empty', ''],
			['not a UUID', 'abc'],
			['a UUID with braces', `{${randomUUID()}}`],
			['the nil UUID', '00000000-0000-0000-0000-000000000000'],
			['two keys', `${randomUUID()}, ${randomUUID()}`],
			['too long', `${randomUUID()}0`],
		])('a %s key: 400 IDEMPOTENCY_KEY_INVALID, nothing written', async (_label, key) => {
			const who = await validatedBettor();
			const res = await confirm(who, [general(s.match.open!)], key);
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
			expect(await counts(who.user.id)).toMatchObject({ tickets: 0, saldo: 10 });
		});

		it('the same key and body again: 200 with the same ticket, marked as a replay, nothing new (in any letter case)', async () => {
			const who = await validatedBettor();
			const key = randomUUID();
			const body = [general(s.match.open!), exact(s.match.later!, 2, 2)];
			const first = await confirm(who, body, key.toUpperCase());
			expect(first.status).toBe(201);
			expect(first.headers['idempotent-replayed']).toBeUndefined();
			const after = await counts(who.user.id);

			for (const again of [key, key.toUpperCase(), ` ${key} `]) {
				const res = await confirm(who, body, again);
				expect(res.status).toBe(200);
				expect(res.headers['idempotent-replayed']).toBe('true');
				expect(res.headers.location).toBe(`/apuestas/tickets/${first.body.data.id}`);
				expect(res.body.data).toEqual(first.body.data);
			}
			expect(await counts(who.user.id)).toEqual(after);
			const [[stored]] = await pool.query<RowDataPacket[]>('SELECT clave_idempotencia FROM ticket WHERE id = ?', [first.body.data.id]);
			expect(stored!.clave_idempotencia).toBe(key.toLowerCase());
		});

		it('a replay still answers after the match closed or the balance ran out (it is not evaluated again)', async () => {
			const who = await validatedBettor();
			const key = randomUUID();
			const ten = Array.from({ length: 10 }, (_, i) => exact(s.match.open!, i, 3));
			const first = await confirm(who, ten, key);
			expect(first.status).toBe(201);
			const [[row]] = await pool.query<RowDataPacket[]>('SELECT fecha_hora FROM partido WHERE id = ?', [s.match.open]);
			const late = await confirmTicket(pool, who.user.id, key, ten, bettingCloseTime(row!.fecha_hora as Date));
			expect(late).toMatchObject({ repetido: true, ticket: { id: first.body.data.id } });
		});

		it('the same key with other selections: 409 IDEMPOTENCY_KEY_REUSED, nothing written', async () => {
			const who = await validatedBettor();
			const key = randomUUID();
			const first = await confirm(who, [general(s.match.open!), general(s.match.later!)], key);
			const after = await counts(who.user.id);

			for (const other of [
				[general(s.match.later!), general(s.match.open!)], // same selections, other order
				[general(s.match.open!)],
				[general(s.match.open!, 'empate'), general(s.match.later!)],
			]) {
				const res = await confirm(who, other, key);
				expect(res.status).toBe(409);
				expect(res.body.error).toMatchObject({ code: 'IDEMPOTENCY_KEY_REUSED', details: { ticketId: first.body.data.id } });
			}
			expect(await counts(who.user.id)).toEqual(after);
		});

		it('a rejected confirmation does not use up its key', async () => {
			const who = await validatedBettor();
			const key = randomUUID();
			expect((await confirm(who, [general(s.match.closed!)], key)).status).toBe(409);
			const retry = await confirm(who, [general(s.match.open!)], key);
			expect(retry.status).toBe(201);
		});

		it("keys are per user: another user's same key creates that user's own ticket", async () => {
			const [one, two] = [await validatedBettor(), await validatedBettor()];
			const key = randomUUID();
			const a = await confirm(one, [general(s.match.open!)], key);
			const b = await confirm(two, [general(s.match.open!)], key);
			expect([a.status, b.status]).toEqual([201, 201]);
			expect(a.body.data.id).not.toBe(b.body.data.id);
		});

		it('the same key sent many times at once (double click, retries): exactly one ticket and one debit', async () => {
			const who = await validatedBettor();
			const key = randomUUID();
			const body = [general(s.match.open!), exact(s.match.later!, 1, 1)];
			const results = await Promise.all(Array.from({ length: 12 }, () => confirm(who, body, key)));

			expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 201]);
			expect(new Set(results.map((r) => r.body.data.id)).size).toBe(1);
			expect(await counts(who.user.id)).toEqual({ tickets: 1, selecciones: 2, movimientos: 3, saldo: 8 });
		});

		it('a deadlock retry does not break the key: the retried confirmation creates the ticket once', async () => {
			const who = await validatedBettor();
			const key = randomUUID();
			const before = { ...transactionStats };
			// A heavier transaction that locks the match first and then wants the user: a real lock cycle
			// with the confirmation (user, then match). InnoDB rolls back the lighter one, the confirmation,
			// and withTransaction runs it again.
			const blocker = await pool.getConnection();
			try {
				await blocker.beginTransaction();
				for (let i = 0; i < 30; i++) {
					await blocker.query("INSERT INTO deporte (nombre, slug, permite_empate) VALUES (?, ?, TRUE)", [`Peso ${i}`, `peso-${key}-${i}`]);
				}
				await blocker.query('SELECT id FROM partido WHERE id = ? FOR UPDATE', [s.match.later]);
				const confirming = confirm(who, [general(s.match.later!)], key).then((r) => r);
				await new Promise((resolve) => setTimeout(resolve, 400)); // the confirmation now holds the user and waits for the match
				await blocker.query('SELECT id FROM usuario WHERE id = ? FOR UPDATE', [who.user.id]);
				await blocker.rollback();
				const res = await confirming;

				expect(res.status).toBe(201);
				expect(transactionStats.deadlockRetries).toBeGreaterThan(before.deadlockRetries);
				expect(await counts(who.user.id)).toEqual({ tickets: 1, selecciones: 1, movimientos: 2, saldo: 9 });
				expect((await confirm(who, [general(s.match.later!)], key)).status).toBe(200);
			} finally {
				blocker.release();
			}
		});
	});

	describe('concurrency (BR-021, BR-053)', () => {
		it('many tickets at once with a tight balance: only the ones that fit pass, the balance never goes negative', async () => {
			const who = await validatedBettor();
			const results = await Promise.all(Array.from({ length: 15 }, (_, i) => confirm(who, [exact(s.match.later!, i, 0)])));

			const statuses = results.map((r) => r.status);
			expect(statuses.filter((x) => x === 201)).toHaveLength(MONEDAS_POR_VALIDACION);
			expect(statuses.filter((x) => x === 409)).toHaveLength(5);
			for (const r of results.filter((x) => x.status === 409)) {
				expect(r.body.error.details.errores).toEqual([{ code: 'INSUFFICIENT_BALANCE', message: expect.any(String) }]);
			}
			expect(await counts(who.user.id)).toEqual({ tickets: 10, selecciones: 10, movimientos: 11, saldo: 0 });
		});
	});

	describe('receipt (BR-025)', () => {
		it('the owner reads the same ticket the confirmation returned', async () => {
			const who = await validatedBettor();
			const created = await confirm(who, [general(s.match.open!), exact(s.match.voley!, 2, 0)]);
			const res = await receipt(who, created.body.data.id);
			expect(res.status).toBe(200);
			expect(res.headers['cache-control']).toBe('no-store');
			expect(res.body.data).toEqual(created.body.data);
		});

		it('anyone else, an admin included, gets the same 404 as for a ticket that does not exist', async () => {
			const owner = await validatedBettor();
			const other = await validatedBettor();
			const pending = await signedInUser(app, pool);
			const ticket = await confirm(owner, [general(s.match.open!)]);
			const [[max]] = await pool.query<RowDataPacket[]>('SELECT MAX(id) AS id FROM ticket');

			const missing = await receipt(owner, Number(max!.id) + 1000);
			expect(missing.status).toBe(404);
			expect(missing.body).toEqual({ error: { code: 'TICKET_NOT_FOUND', message: expect.any(String) } });
			for (const who of [other, pending, api.admin as Session]) {
				const res = await receipt(who, ticket.body.data.id);
				expect(res.status).toBe(404);
				expect(res.body).toEqual(missing.body);
			}
		});

		it('400 for a bad id or a query string', async () => {
			const who = await validatedBettor();
			expect((await receipt(who, 'abc')).status).toBe(400);
			expect((await receipt(who, '1?x=1')).status).toBe(400);
		});
	});
});
