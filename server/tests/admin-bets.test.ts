import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyCoinMovementsInTransaction } from '../src/services/coins.service.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const DAY = 24 * 60 * 60 * 1000;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

type Session = Awaited<ReturnType<typeof signedInUser>>;

/** Every key the query may return: the history's, plus the participant. Never an email, balance, key or fingerprint. */
const ALLOWED_KEYS = new Set([
	'data', 'items', 'page', 'pageSize', 'total', 'totalPages',
	'usuario', 'ticket', 'id', 'creadoEn', 'estado', 'cantidadSelecciones', 'monedasUtilizadas', 'monedasDevueltas', 'puntosObtenidos',
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

describe('admin query of the bets placed (T-21, BR-001)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	let ana: Session;
	let beto: Session;
	const s = {} as { futbol: number; voley: number; liga: number; m1: number; m2: number; m3: number; t: Record<string, number>; sel: Record<string, number> };

	const list = async (query = '') => {
		const res = await api.get(`/polla/apuestas${query}`);
		expect(res.status, JSON.stringify(res.body)).toBe(200);
		return res.body.data as {
			items: Array<{ id: number; usuario: { id: number; nombre: string }; ticket: { id: number; estado: string; monedasDevueltas: number }; estado: string }>;
			total: number;
			totalPages: number;
			page: number;
		};
	};
	const ids = async (query = '') => (await list(query)).items.map((x) => x.id);

	async function validatedBettor(nombre: string): Promise<Session> {
		const who = await signedInUser(app, pool);
		await pool.query('UPDATE usuario SET nombre = ? WHERE id = ?', [nombre, who.user.id]);
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

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		const post = (path: string, body: unknown) => created<{ id: number }>(api.post(path, body));
		s.futbol = (await post('/deportes', { nombre: 'Fútbol', permiteEmpate: true })).id;
		s.voley = (await post('/deportes', { nombre: 'Vóley', permiteEmpate: false })).id;
		s.liga = (await post('/competiciones', { deporteId: s.futbol, nombre: 'Liga' })).id;
		const ligaVoley = (await post('/competiciones', { deporteId: s.voley, nombre: 'Liga Vóley' })).id;
		const team = async (comp: number, nombre: string) => (await post('/equipos', teamBody(comp, { nombre }))).id;
		const [A, B, P, Q] = [await team(s.liga, 'Alianza'), await team(s.liga, 'Boca'), await team(ligaVoley, 'Pumas'), await team(ligaVoley, 'Quilmes')];
		const soon = (days: number) => wholeSeconds(Date.now() + days * DAY);
		s.m1 = await insertMatch(pool, s.liga, A!, B!, 'programado', soon(3));
		s.m2 = await insertMatch(pool, s.liga, B!, A!, 'programado', soon(4));
		s.m3 = await insertMatch(pool, ligaVoley, P!, Q!, 'programado', soon(5));

		ana = await validatedBettor('Ana');
		beto = await validatedBettor('Beto');
		const t1 = await confirm(ana, [general(s.m1, 'local_gana'), general(s.m2, 'empate')]);
		const t2 = await confirm(ana, [general(s.m3, 'local_gana')]);
		const t3 = await confirm(beto, [general(s.m2, 'visitante_gana')]);
		s.t = { t1: t1.id, t2: t2.id, t3: t3.id };
		s.sel = { a1: t1.selecciones[0]!.id, a2: t1.selecciones[1]!.id, a3: t2.selecciones[0]!.id, b1: t3.selecciones[0]!.id };
		for (const [key, date] of [['t1', '2026-01-01T10:00:00Z'], ['t2', '2026-02-01T10:00:00Z'], ['t3', '2026-03-01T10:00:00Z']] as const) {
			await pool.query('UPDATE ticket SET creado_en = ? WHERE id = ?', [new Date(date), s.t[key]]);
		}
		// m2 cancelled by hand: its selections voided with their refund (D-003).
		await pool.query("UPDATE partido SET estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = 'cancelado') WHERE id = ?", [s.m2]);
		for (const [sel, who] of [[s.sel.a2!, ana], [s.sel.b1!, beto]] as const) {
			await pool.query("UPDATE seleccion SET estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = 'anulada') WHERE id = ?", [sel]);
			await applyCoinMovementsInTransaction(pool, who.user.id, [{ tipo: 'devolucion_cancelacion', seleccionId: sel }]);
		}

		// An admin with a ticket loaded by hand (only possible that way): never listed.
		const [ticket] = await pool.query<ResultSetHeader>(
			'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, UTC_TIMESTAMP(), ?, ?)',
			[api.admin.user.id, randomUUID(), 'a'.repeat(64)],
		);
		await pool.query(
			`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id)
			VALUES (?, ?, (SELECT id FROM tipo_apuesta WHERE codigo = 'resultado_general'),
				(SELECT id FROM resultado_general WHERE codigo = 'local_gana'), (SELECT id FROM estado_seleccion WHERE codigo = 'pendiente'))`,
			[ticket.insertId, s.m1],
		);
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	it('needs an admin session: 401 without one, 403 for a participant', async () => {
		expect((await request(app).get('/admin/polla/apuestas')).status).toBe(401);
		const res = await request(app).get('/admin/polla/apuestas').set('Cookie', ana.cookie);
		expect(res.status).toBe(403);
	});

	it('lists every participant selection, newest ticket first, with its ticket and participant; never an admin', async () => {
		const data = await list();
		expect(data.total).toBe(4);
		expect(data.items.map((x) => x.id)).toEqual([s.sel.b1, s.sel.a3, s.sel.a1, s.sel.a2]);
		const [beto1, , a1, a2] = data.items;
		expect(beto1!.usuario).toEqual({ id: beto.user.id, nombre: 'Beto' });
		expect(beto1!.ticket).toMatchObject({ id: s.t.t3, estado: 'anulado', monedasDevueltas: 1 });
		expect(a1!.usuario).toEqual({ id: ana.user.id, nombre: 'Ana' });
		expect(a1!.ticket).toMatchObject({ id: s.t.t1, estado: 'pendiente', monedasDevueltas: 1 });
		expect(a2!.estado).toBe('anulada');
		expect(data.items.every((x) => x.usuario.id !== api.admin.user.id)).toBe(true);
	});

	it('the same rows as the participant sees in "Mis apuestas", apart from the participant', async () => {
		const own = await request(app).get('/apuestas/mis-apuestas').set('Cookie', ana.cookie);
		const admin = await list(`?usuarioId=${ana.user.id}`);
		expect(admin.items.map(({ usuario, ...row }) => (expect(usuario.id).toBe(ana.user.id), row))).toEqual(own.body.data.items);
	});

	it('filters by participant, match, ticket, state, ticket state, sport, competition and dates', async () => {
		expect(await ids(`?usuarioId=${beto.user.id}`)).toEqual([s.sel.b1]);
		expect(await ids(`?usuarioId=${api.admin.user.id}`)).toEqual([]);
		expect(await ids(`?partidoId=${s.m2}`)).toEqual([s.sel.b1, s.sel.a2]);
		expect(await ids(`?ticketId=${s.t.t1}`)).toEqual([s.sel.a1, s.sel.a2]);
		expect(await ids('?estado=anulada')).toEqual([s.sel.b1, s.sel.a2]);
		expect(await ids('?estadoTicket=anulado')).toEqual([s.sel.b1]);
		expect(await ids('?estadoTicket=pendiente')).toEqual([s.sel.a3, s.sel.a1, s.sel.a2]);
		expect(await ids(`?deporteId=${s.voley}`)).toEqual([s.sel.a3]);
		expect(await ids(`?competicionId=${s.liga}`)).toEqual([s.sel.b1, s.sel.a1, s.sel.a2]);
		expect(await ids('?desde=2026-01-15T00:00:00Z&hasta=2026-02-15T00:00:00Z')).toEqual([s.sel.a3]);
		expect(await ids(`?usuarioId=${ana.user.id}&estado=pendiente&deporteId=${s.futbol}`)).toEqual([s.sel.a1]);
	});

	it('paginates', async () => {
		const first = await list('?pageSize=3');
		expect(first).toMatchObject({ page: 1, total: 4, totalPages: 2 });
		expect(first.items).toHaveLength(3);
		const second = await list('?pageSize=3&page=2');
		expect(second.items.map((x) => x.id)).toEqual([s.sel.a2]);
		expect((await list('?page=9')).items).toEqual([]);
	});

	it('never returns an email, a balance, the idempotency key or the fingerprint', async () => {
		const res = await api.get('/polla/apuestas');
		const unexpected = [...keysOf(res.body)].filter((key) => !ALLOWED_KEYS.has(key));
		expect(unexpected).toEqual([]);
		const text = JSON.stringify(res.body);
		expect(text).not.toContain(ana.user.email);
		expect(text).not.toContain('a'.repeat(64));
	});

	it('refuses unknown or invalid parameters (400) and is never cached', async () => {
		for (const query of ['?foo=1', '?usuarioId=abc', '?estado=ganada', '?estadoTicket=x', '?desde=2026-01-01', '?desde=2026-02-01T00:00:00Z&hasta=2026-01-01T00:00:00Z', '?pageSize=101', '?usuarioId=1&usuarioId=2']) {
			const res = await api.get(`/polla/apuestas${query}`);
			expect(res.status, query).toBe(400);
			expect(res.body.error.code, query).toBe('VALIDATION_ERROR');
		}
		const ok = await api.get('/polla/apuestas');
		expect(ok.headers['cache-control']).toContain('no-store');
	});

	it('is read only: no write route', async () => {
		expect((await api.post('/polla/apuestas', {})).status).toBe(404);
		expect((await api.del('/polla/apuestas')).status).toBe(404);
	});
});
