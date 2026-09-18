import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ESTADOS_TICKET, ticketStateCondition, ticketStateFromCounts } from '../src/lib/betting.js';
import { applyCoinMovementsInTransaction } from '../src/services/coins.service.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const DAY = 24 * 60 * 60 * 1000;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

type Session = Awaited<ReturnType<typeof signedInUser>>;

/** Every key the history may return. Anything else (email, saldo, clave, huella...) fails the privacy test. */
const ALLOWED_KEYS = new Set([
	'data', 'items', 'page', 'pageSize', 'total', 'totalPages',
	'ticket', 'id', 'creadoEn', 'estado', 'cantidadSelecciones', 'monedasUtilizadas', 'monedasDevueltas', 'puntosObtenidos',
	'partido', 'competicion', 'deporte', 'nombre', 'slug', 'permiteEmpate', 'jornada', 'fechaHora', 'sede',
	'local', 'visita', 'equipo', 'goles', 'competicionId', 'nombreCorto', 'escudo', 'colorAcento',
	'resultadoReal', 'golesLocal', 'golesVisitante', 'resultado', 'tipo', 'pronostico', 'costo',
]);

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			into.add(k);
			keysOf(v, into);
		}
	}
	return into;
}

describe('my bets (T-11: BR-026, BR-027, BR-025, BR-029)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	let ana: Session;
	let beto: Session;
	const s = {} as {
		futbol: number;
		voley: number;
		liga: number;
		copa: number;
		match: Record<string, number>;
		ticket: Record<string, number>;
		sel: Record<string, number>;
		betoTicket: number;
	};

	const history = (query = '', who: Session = ana) => request(app).get(`/apuestas/mis-apuestas${query}`).set('Cookie', who.cookie);
	const summary = (who: Session = ana) => request(app).get('/apuestas/mis-apuestas/resumen').set('Cookie', who.cookie);
	const ids = async (query: string) => {
		const res = await history(query);
		expect(res.status, JSON.stringify(res.body)).toBe(200);
		return res.body.data.items.map((x: { id: number }) => x.id);
	};

	async function validatedBettor(): Promise<Session> {
		const who = await signedInUser(app, pool);
		await api.post(`/participantes/${who.user.id}/pago/confirmar`, {});
		await api.post(`/participantes/${who.user.id}/validar`, {});
		return who;
	}

	async function confirm(who: Session, selecciones: unknown[]): Promise<{ id: number; selecciones: Array<{ id: number }> }> {
		const res = await request(app)
			.post('/apuestas/tickets')
			.set('Cookie', who.cookie)
			.set('X-CSRF-Token', who.csrfToken)
			.set('Idempotency-Key', randomUUID())
			.send({ selecciones });
		if (res.status !== 201) throw new Error(`ticket: ${res.status} ${JSON.stringify(res.body)}`);
		return res.body.data;
	}

	const general = (partidoId: number, pronostico: string) => ({ partidoId, tipo: 'resultado_general', pronostico });
	const exact = (partidoId: number, golesLocal: number, golesVisitante: number) => ({ partidoId, tipo: 'marcador_exacto', golesLocal, golesVisitante });

	/** What T-14 and T-16 do, by hand. Voiding also refunds the coin, as a cancellation does (D-003: refunds come from the movements). */
	const setSelection = async (id: number, estado: string, puntos: number | null) => {
		await pool.query('UPDATE seleccion SET estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = ?), puntos_obtenidos = ? WHERE id = ?', [estado, puntos, id]);
		if (estado !== 'anulada') return;
		const [[owner]] = await pool.query<RowDataPacket[]>('SELECT t.usuario_id FROM seleccion s JOIN ticket t ON t.id = s.ticket_id WHERE s.id = ?', [id]);
		await applyCoinMovementsInTransaction(pool, Number(owner!.usuario_id), [{ tipo: 'devolucion_cancelacion', seleccionId: id }]);
	};
	const setMatch = (id: number, estado: string) =>
		pool.query('UPDATE partido SET estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = ?) WHERE id = ?', [estado, id]);
	const setScore = (id: number, local: number | null, visita: number | null) =>
		pool.query('UPDATE partido_equipo SET goles = IF(es_visita, ?, ?) WHERE partido_id = ?', [visita, local, id]);

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		const post = (path: string, body: unknown) => created<{ id: number }>(api.post(path, body));
		s.futbol = (await post('/deportes', { nombre: 'Fútbol', permiteEmpate: true })).id;
		s.voley = (await post('/deportes', { nombre: 'Vóley', permiteEmpate: false })).id;
		s.liga = (await post('/competiciones', { deporteId: s.futbol, nombre: 'Liga' })).id;
		s.copa = (await post('/competiciones', { deporteId: s.futbol, nombre: 'Copa' })).id;
		const ligaVoley = (await post('/competiciones', { deporteId: s.voley, nombre: 'Liga Vóley' })).id;
		const team = async (comp: number, nombre: string) => (await post('/equipos', teamBody(comp, { nombre }))).id;
		const [A, B, C, D, P, Q] = [
			await team(s.liga, 'Alianza'),
			await team(s.liga, 'Boca'),
			await team(s.copa, 'Cristal'),
			await team(s.copa, 'Deportivo'),
			await team(ligaVoley, 'Pumas'),
			await team(ligaVoley, 'Quilmes'),
		];
		const soon = (days: number) => wholeSeconds(Date.now() + days * DAY);
		s.match = {
			m1: await insertMatch(pool, s.liga, A!, B!, 'programado', soon(3)),
			m2: await insertMatch(pool, s.copa, C!, D!, 'programado', soon(4)),
			m3: await insertMatch(pool, ligaVoley, P!, Q!, 'programado', soon(5)),
			m4: await insertMatch(pool, s.liga, B!, A!, 'programado', soon(6)),
		};

		ana = await validatedBettor();
		beto = await validatedBettor();
		const { m1, m2, m3, m4 } = s.match as Record<string, number>;
		const t1 = await confirm(ana, [general(m1!, 'local_gana'), exact(m1!, 2, 1)]);
		const t2 = await confirm(ana, [general(m2!, 'empate'), general(m3!, 'local_gana'), general(m4!, 'local_gana')]);
		const t3 = await confirm(ana, [general(m2!, 'visitante_gana')]);
		const t4 = await confirm(ana, [general(m1!, 'empate')]);
		s.betoTicket = (await confirm(beto, [general(m1!, 'visitante_gana')])).id;
		s.ticket = { t1: t1.id, t2: t2.id, t3: t3.id, t4: t4.id };
		const [s1, s2] = t1.selecciones.map((x) => x.id);
		const [s3, s4, s5] = t2.selecciones.map((x) => x.id);
		s.sel = { s1: s1!, s2: s2!, s3: s3!, s4: s4!, s5: s5!, s6: t3.selecciones[0]!.id, s7: t4.selecciones[0]!.id };

		// Dates set by hand so the order and the date filter are exact.
		for (const [key, date] of [['t1', '2026-01-01T10:00:00Z'], ['t2', '2026-02-01T10:00:00Z'], ['t3', '2026-03-01T10:00:00Z'], ['t4', '2026-04-01T10:00:00Z']] as const) {
			await pool.query('UPDATE ticket SET creado_en = ? WHERE id = ?', [new Date(date), s.ticket[key]]);
		}
		// m1 finished 2-1: s1 and s2 right (+3 each), s7 (draw) wrong.
		await setScore(m1!, 2, 1);
		await setMatch(m1!, 'finalizado');
		await setSelection(s.sel.s1!, 'acertada', 3);
		await setSelection(s.sel.s2!, 'acertada', 3);
		await setSelection(s.sel.s7!, 'no_acertada', 0);
		// m2 cancelled: s3 and s6 voided.
		await setMatch(m2!, 'cancelado');
		await setSelection(s.sel.s3!, 'anulada', null);
		await setSelection(s.sel.s6!, 'anulada', null);
		// m4 "finished" with only one side loaded: no real result yet, s5 still pending.
		await setScore(m4!, 3, null);
		await setMatch(m4!, 'finalizado');
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('access', () => {
		it('anonymous: 401', async () => {
			expect((await request(app).get('/apuestas/mis-apuestas')).status).toBe(401);
			expect((await request(app).get('/apuestas/mis-apuestas/resumen')).status).toBe(401);
		});

		it('an admin: 403 NOT_A_PARTICIPANT, like /monedas', async () => {
			for (const res of [await history('', api.admin as Session), await summary(api.admin as Session)]) {
				expect(res.status).toBe(403);
				expect(res.body.error.code).toBe('NOT_A_PARTICIPANT');
			}
		});

		it('a pendiente user: an empty history and a summary of zeros', async () => {
			const pending = await signedInUser(app, pool);
			const list = await history('', pending);
			expect(list.status).toBe(200);
			expect(list.body.data).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
			const sum = await summary(pending);
			expect(sum.status).toBe(200);
			expect(sum.body.data).toEqual({
				tickets: { total: 0, pendiente: 0, finalizado: 0, anulado: 0 },
				selecciones: { total: 0, pendiente: 0, acertada: 0, no_acertada: 0, anulada: 0 },
				monedasUtilizadas: 0,
				monedasDevueltas: 0,
				puntos: 0,
				aciertos: 0,
			});
		});

		it('answers are private: no-store', async () => {
			expect((await history()).headers['cache-control']).toBe('no-store');
			expect((await summary()).headers['cache-control']).toBe('no-store');
		});
	});

	describe('history', () => {
		it('newest ticket first, selections in the order they were placed', async () => {
			const { s1, s2, s3, s4, s5, s6, s7 } = s.sel;
			expect(await ids('')).toEqual([s7, s6, s3, s4, s5, s1, s2]);
		});

		it('each row has what BR-026 asks for, computed like the receipt', async () => {
			const items = (await history()).body.data.items as Array<Record<string, any>>;
			const bySel = new Map(items.map((x) => [x.id, x]));

			expect(bySel.get(s.sel.s2)).toEqual({
				id: s.sel.s2,
				ticket: {
					id: s.ticket.t1,
					creadoEn: '2026-01-01T10:00:00.000Z',
					estado: 'finalizado',
					cantidadSelecciones: 2,
					monedasUtilizadas: 2,
					monedasDevueltas: 0,
					puntosObtenidos: 6,
				},
				partido: expect.objectContaining({
					id: s.match.m1,
					estado: 'finalizado',
					competicion: expect.objectContaining({ id: s.liga, nombre: 'Liga' }),
					deporte: expect.objectContaining({ id: s.futbol, nombre: 'Fútbol' }),
					local: { equipo: expect.objectContaining({ nombre: 'Alianza' }), goles: 2 },
					visita: { equipo: expect.objectContaining({ nombre: 'Boca' }), goles: 1 },
				}),
				resultadoReal: { golesLocal: 2, golesVisitante: 1, resultado: 'local_gana' },
				tipo: 'marcador_exacto',
				pronostico: null,
				golesLocal: 2,
				golesVisitante: 1,
				estado: 'acertada',
				costo: 1,
				puntosObtenidos: 3,
			});
			expect(bySel.get(s.sel.s7)).toMatchObject({
				tipo: 'resultado_general',
				pronostico: 'empate',
				estado: 'no_acertada',
				puntosObtenidos: 0,
				resultadoReal: { resultado: 'local_gana' },
				ticket: { id: s.ticket.t4, estado: 'finalizado', puntosObtenidos: 0 },
			});
			expect(bySel.get(s.sel.s6)).toMatchObject({
				estado: 'anulada',
				puntosObtenidos: null,
				resultadoReal: null,
				partido: { estado: 'cancelado' },
				ticket: { id: s.ticket.t3, estado: 'anulado', monedasUtilizadas: 1, monedasDevueltas: 1 },
			});
			for (const key of ['s3', 's4', 's5']) {
				expect(bySel.get(s.sel[key])!.ticket).toEqual({
					id: s.ticket.t2,
					creadoEn: '2026-02-01T10:00:00.000Z',
					estado: 'pendiente',
					cantidadSelecciones: 3,
					monedasUtilizadas: 3,
					monedasDevueltas: 1,
					puntosObtenidos: 0,
				});
			}
		});

		it('the real result only shows once the match is finished with both sides loaded (BR-049)', async () => {
			const items = (await history()).body.data.items as Array<Record<string, any>>;
			const bySel = new Map(items.map((x) => [x.id, x]));
			// m4 is finalizado with one side only: no result, no goals shown.
			expect(bySel.get(s.sel.s5)).toMatchObject({
				estado: 'pendiente',
				resultadoReal: null,
				partido: { estado: 'finalizado', local: { goles: null }, visita: { goles: null } },
			});
			// m3 is still programado.
			expect(bySel.get(s.sel.s4)).toMatchObject({ resultadoReal: null, partido: { estado: 'programado' } });
		});

		it('the ticket totals match the receipt of each ticket', async () => {
			const items = (await history()).body.data.items as Array<{ ticket: Record<string, unknown> }>;
			for (const id of Object.values(s.ticket)) {
				const receipt = (await request(app).get(`/apuestas/tickets/${id}`).set('Cookie', ana.cookie)).body.data;
				const row = items.find((x) => x.ticket.id === id)!;
				const { usuario: _u, selecciones, ...totals } = receipt;
				expect(row.ticket).toEqual(totals);
				expect(selecciones.map((x: { id: number }) => x.id)).toEqual(items.filter((x) => x.ticket.id === id).map((x) => (x as unknown as { id: number }).id));
			}
		});

		it('filters: selection state, ticket state, ticket, match, sport, competition and dates', async () => {
			const { s1, s2, s3, s4, s5, s6, s7 } = s.sel;
			expect(await ids('?estado=acertada')).toEqual([s1, s2]);
			expect(await ids('?estado=no_acertada')).toEqual([s7]);
			expect(await ids('?estado=anulada')).toEqual([s6, s3]);
			expect(await ids('?estado=pendiente')).toEqual([s4, s5]);
			expect(await ids('?estadoTicket=pendiente')).toEqual([s3, s4, s5]);
			expect(await ids('?estadoTicket=finalizado')).toEqual([s7, s1, s2]);
			expect(await ids('?estadoTicket=anulado')).toEqual([s6]);
			expect(await ids(`?ticketId=${s.ticket.t2}`)).toEqual([s3, s4, s5]);
			expect(await ids(`?partidoId=${s.match.m2}`)).toEqual([s6, s3]);
			expect(await ids(`?deporteId=${s.voley}`)).toEqual([s4]);
			expect(await ids(`?competicionId=${s.copa}`)).toEqual([s6, s3]);
			expect(await ids('?desde=2026-02-01T00:00:00Z&hasta=2026-03-01T23:59:59Z')).toEqual([s6, s3, s4, s5]);
			expect(await ids('?desde=2026-04-01T10:00:00Z')).toEqual([s7]);
			expect(await ids('?hasta=2026-01-01T10:00:00-00:00')).toEqual([s1, s2]);
			expect(await ids('?estado=anulada&estadoTicket=pendiente')).toEqual([s3]);
			expect(await ids(`?estado=acertada&partidoId=${s.match.m2}`)).toEqual([]);
			expect(await ids(`?ticketId=${s.betoTicket}`)).toEqual([]);
		});

		it('pages, with the total of the filtered rows', async () => {
			const { s1, s4, s5 } = s.sel;
			const page2 = await history('?pageSize=3&page=2');
			expect(page2.body.data).toMatchObject({ page: 2, pageSize: 3, total: 7, totalPages: 3 });
			expect(page2.body.data.items.map((x: { id: number }) => x.id)).toEqual([s4, s5, s1]);
			const beyond = await history('?pageSize=3&page=9');
			expect(beyond.body.data).toMatchObject({ items: [], total: 7, totalPages: 3 });
			const filtered = await history('?estadoTicket=pendiente&pageSize=2&page=2');
			expect(filtered.body.data).toMatchObject({ total: 3, totalPages: 2 });
			expect(filtered.body.data.items.map((x: { id: number }) => x.id)).toEqual([s5]);
		});

		it.each([
			'?usuarioId=1',
			'?estado=ganada',
			'?estado=ACERTADA',
			'?estadoTicket=cerrado',
			'?partidoId=abc',
			'?ticketId=0',
			'?desde=2026-01-01',
			'?desde=2026-03-01T00:00:00Z&hasta=2026-02-01T00:00:00Z',
			'?pageSize=101',
			'?page=0',
			'?orden=asc',
		])('rejects %s with 400', async (query) => {
			const res = await history(query);
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('summary', () => {
		it('exact figures, with the ranking\'s definition of aciertos', async () => {
			const res = await summary();
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({
				tickets: { total: 4, pendiente: 1, finalizado: 2, anulado: 1 },
				selecciones: { total: 7, pendiente: 2, acertada: 2, no_acertada: 1, anulada: 2 },
				monedasUtilizadas: 7,
				monedasDevueltas: 2,
				puntos: 6,
				aciertos: 2,
			});
		});

		it('rejects any query string', async () => {
			expect((await request(app).get('/apuestas/mis-apuestas/resumen?x=1').set('Cookie', ana.cookie)).status).toBe(400);
		});

		it("another user's summary counts only that user's ticket", async () => {
			expect((await summary(beto)).body.data).toMatchObject({
				tickets: { total: 1, pendiente: 1 },
				selecciones: { total: 1, pendiente: 1 },
				monedasUtilizadas: 1,
				puntos: 0,
			});
		});
	});

	describe('privacy', () => {
		it("never shows another user's bets, keys, fingerprints, emails or balances", async () => {
			const mine = await history('?pageSize=100');
			const theirs = await history('?pageSize=100', beto);
			expect(theirs.body.data.items.map((x: { ticket: { id: number } }) => x.ticket.id)).toEqual([s.betoTicket]);
			expect(mine.body.data.items.map((x: { ticket: { id: number } }) => x.ticket.id)).not.toContain(s.betoTicket);

			const [[keys]] = await pool.query<RowDataPacket[]>('SELECT clave_idempotencia, huella_solicitud FROM ticket WHERE id = ?', [s.ticket.t1]);
			for (const res of [mine, theirs, await summary(), await summary(beto)]) {
				const extra = [...keysOf(res.body)].filter((k) => !ALLOWED_KEYS.has(k) && !/^(pendiente|finalizado|anulado|acertada|no_acertada|anulada|tickets|selecciones|puntos|aciertos)$/.test(k));
				expect(extra).toEqual([]);
				const text = JSON.stringify(res.body);
				expect(text).not.toContain(String(keys!.clave_idempotencia));
				expect(text).not.toContain(String(keys!.huella_solicitud));
				expect(text).not.toMatch(/@liga\.test|saldo|email|usuario/i);
			}
		});
	});

	it('under concurrent writes, the summary and each page stay coherent with themselves', async () => {
		const cora = await validatedBettor();
		const m3 = s.match.m3!;
		const states = ['pendiente', 'acertada', 'no_acertada', 'anulada'];
		// A writer that keeps adding tickets (1 to 3 selections) and moving selections between states.
		const addTicket = async (n: number) => {
			const [t] = await pool.query<import('mysql2/promise').ResultSetHeader>(
				'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, UTC_TIMESTAMP(), UUID(), SHA2(UUID(), 256))',
				[cora.user.id],
			);
			for (let i = 0; i < n; i++) {
				await pool.query(
					`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id)
					SELECT ?, ?, ta.id, rg.id, es.id FROM tipo_apuesta ta, resultado_general rg, estado_seleccion es
					WHERE ta.codigo = 'resultado_general' AND rg.codigo = 'local_gana' AND es.codigo = 'pendiente'`,
					[t.insertId, m3],
				);
			}
		};
		let writing = true;
		const writer = (async () => {
			for (let round = 0; writing && round < 400; round++) {
				if (round < 30) await addTicket(1 + (round % 3)); // at most 60 rows: every page check applies
				const estado = states[round % states.length]!;
				await pool.query(
					`UPDATE seleccion s JOIN ticket t ON t.id = s.ticket_id
					SET s.estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = ?), s.puntos_obtenidos = ?
					WHERE t.usuario_id = ? AND MOD(s.id, 3) = ?`,
					[estado, estado === 'acertada' ? 3 : estado === 'no_acertada' ? 0 : null, cora.user.id, round % 3],
				);
			}
		})();

		try {
			for (let i = 0; i < 40; i++) {
				const [sum, list] = await Promise.all([summary(cora), history('?pageSize=100', cora)]);
				const d = sum.body.data;
				const sel = d.selecciones;
				expect(sel.total).toBe(sel.pendiente + sel.acertada + sel.no_acertada + sel.anulada);
				expect(d.tickets.total).toBe(d.tickets.pendiente + d.tickets.finalizado + d.tickets.anulado);
				expect(d.aciertos).toBe(sel.acertada);
				expect(d.monedasUtilizadas).toBe(sel.total);
				// D-003: this writer voids by hand and never refunds, so nothing came back.
				expect(d.monedasDevueltas).toBe(0);

				const page = list.body.data;
				if (page.total <= 100) expect(page.items.length).toBe(page.total);
				const byTicket = new Map<number, Array<{ estado: string; ticket: { estado: string; cantidadSelecciones: number } }>>();
				for (const row of page.items) byTicket.set(row.ticket.id, [...(byTicket.get(row.ticket.id) ?? []), row]);
				for (const rows of byTicket.values()) {
					if (page.total > 100) break;
					expect(rows[0]!.ticket.cantidadSelecciones).toBe(rows.length);
					const counts = {
						total: rows.length,
						pendientes: rows.filter((r) => r.estado === 'pendiente').length,
						anuladas: rows.filter((r) => r.estado === 'anulada').length,
					};
					expect(rows[0]!.ticket.estado).toBe(ticketStateFromCounts(counts));
				}
			}
		} finally {
			writing = false;
			await writer;
		}
	});

	it('the SQL ticket state is the same rule as ticketStateFromCounts, for every combination', async () => {
		for (let total = 0; total <= 3; total++) {
			for (let pendientes = 0; pendientes <= total; pendientes++) {
				for (let anuladas = 0; anuladas + pendientes <= total; anuladas++) {
					const expected = ticketStateFromCounts({ total, pendientes, anuladas });
					const conditions = ESTADOS_TICKET.map((estado) => `(${ticketStateCondition(estado, 'agg')}) AS \`${estado}\``).join(', ');
					const [[row]] = await pool.query<RowDataPacket[]>(
						`SELECT ${conditions} FROM (SELECT ? AS total, ? AS pendientes, ? AS anuladas) agg`,
						[total, pendientes, anuladas],
					);
					for (const estado of ESTADOS_TICKET) {
						expect(Number(row![estado]), `${estado} con ${total}/${pendientes}/${anuladas}`).toBe(estado === expected ? 1 : 0);
					}
				}
			}
		}
	});
});
