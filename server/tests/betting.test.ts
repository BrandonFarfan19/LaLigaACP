import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/db/transaction.js';
import {
	bettingCloseTime,
	HORAS_CIERRE_APUESTAS,
	MAX_GOLES_PRONOSTICO,
	MAX_SELECCIONES_POR_TICKET,
	resultOfScore,
} from '../src/lib/betting.js';
import { COSTO_POR_SELECCION } from '../src/lib/coins.js';
import { compareByProximity } from '../src/lib/match-order.js';
import { evaluateTicketInTransaction, listBettingMatches, previewTicket } from '../src/services/betting.service.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';
import { canInspectLocks, locksHeldBy } from './helpers/locks.js';

const SECOND = 1000;
const HOUR = 60 * 60 * SECOND;
const DAY = 24 * HOUR;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / SECOND) * SECOND);

type Session = Awaited<ReturnType<typeof signedInUser>>;
type Selection =
	| { partidoId: number; tipo: 'resultado_general'; pronostico: string }
	| { partidoId: number; tipo: 'marcador_exacto'; golesLocal: number; golesVisitante: number };

const general = (partidoId: number, pronostico: string): Selection => ({ partidoId, tipo: 'resultado_general', pronostico });
const exact = (partidoId: number, golesLocal: number, golesVisitante: number): Selection => ({
	partidoId,
	tipo: 'marcador_exacto',
	golesLocal,
	golesVisitante,
});

describe('selections and betting close (T-09: BR-014 to BR-021, BR-051, BR-052)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	let bettor: Session;
	let pending: Session;
	const s = {} as {
		futbol: number;
		voley: number;
		liga: number;
		ligaVoley: number;
		team: Record<string, number>;
		match: Record<string, number>;
		missing: number;
	};

	const setBalance = (saldo: number) => pool.query('UPDATE usuario SET saldo_monedas = ? WHERE id = ?', [saldo, bettor.user.id]);
	const preview = (selecciones: unknown, who: Session = bettor) =>
		request(app).post('/apuestas/vista-previa').set('Cookie', who.cookie).set('X-CSRF-Token', who.csrfToken).send({ selecciones });
	const matches = (query = '', who: Session = bettor) => request(app).get(`/apuestas/partidos${query}`).set('Cookie', who.cookie);

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
			s.team[key] = (await post('/equipos', teamBody(comp, { nombre, nombreCorto: nombre.slice(0, 5) }))).id;
		}

		const now = Date.now();
		const at = (ms: number) => wholeSeconds(now + ms);
		const A = s.team.A!;
		const B = s.team.B!;
		s.match = {};
		s.match.open = await insertMatch(pool, s.liga, A, B, 'programado', at(3 * DAY));
		s.match.later = await insertMatch(pool, s.liga, B, A, 'programado', at(10 * DAY));
		s.match.voley = await insertMatch(pool, s.ligaVoley, s.team.P!, s.team.Q!, 'programado', at(2 * DAY));
		// Margins of five minutes around the close, for the HTTP tests (the exact edge is tested on the service).
		s.match.justOpen = await insertMatch(pool, s.liga, A, B, 'programado', at(DAY + 5 * 60 * SECOND));
		s.match.justClosed = await insertMatch(pool, s.liga, B, A, 'programado', at(DAY - 5 * 60 * SECOND));
		s.match.soon = await insertMatch(pool, s.liga, A, B, 'programado', at(2 * HOUR));
		s.match.live = await insertMatch(pool, s.liga, A, B, 'en_curso', at(-HOUR));
		s.match.finished = await insertMatch(pool, s.liga, B, A, 'finalizado', at(-3 * DAY));
		await pool.query('UPDATE partido_equipo SET goles = IF(es_visita, 1, 2) WHERE partido_id = ?', [s.match.finished]);
		s.match.cancelled = await insertMatch(pool, s.liga, A, B, 'cancelado', at(4 * DAY));
		const [[max]] = await pool.query<RowDataPacket[]>('SELECT MAX(id) AS id FROM partido');
		s.missing = Number(max!.id) + 1000;

		bettor = await signedInUser(app, pool, { estado: 'validado' });
		pending = await signedInUser(app, pool);
	});

	beforeEach(async () => {
		await setBalance(10);
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('access (BR-002, BR-005, BR-001)', () => {
		it('anonymous: 401 on both routes', async () => {
			expect((await request(app).get('/apuestas/partidos')).status).toBe(401);
			const res = await request(app).post('/apuestas/vista-previa').send({ selecciones: [general(s.match.open!, 'local_gana')] });
			expect(res.status).toBe(401);
			expect(res.body.error.code).toBe('UNAUTHENTICATED');
		});

		it('a pendiente user sees the same match list (T-19), but cannot preview: 403 USER_NOT_VALIDATED', async () => {
			const listed = await matches('', pending);
			expect(listed.status).toBe(200);
			expect(listed.body.data).toEqual((await matches()).body.data);
			const res = await preview([general(s.match.open!, 'local_gana')], pending);
			expect(res.status).toBe(403);
			expect(res.body.error.code).toBe('USER_NOT_VALIDATED');
		});

		it('an admin, even marked validado: 403 on both (NOT_A_PARTICIPANT for the list, ADMIN_CANNOT_BET for the preview)', async () => {
			const admin = { ...api.admin } as Session;
			await pool.query("UPDATE usuario SET estado_usuario_id = (SELECT id FROM estado_usuario WHERE codigo = 'validado') WHERE id = ?", [admin.user.id]);
			const listed = await matches('', admin);
			expect(listed.status).toBe(403);
			expect(listed.body.error.code).toBe('NOT_A_PARTICIPANT');
			const res = await preview([general(s.match.open!, 'local_gana')], admin);
			expect(res.status).toBe(403);
			expect(res.body.error.code).toBe('ADMIN_CANNOT_BET');
		});

		it('the preview is a POST under CSRF: without the token, 403 CSRF_FAILED', async () => {
			const res = await request(app)
				.post('/apuestas/vista-previa')
				.set('Cookie', bettor.cookie)
				.send({ selecciones: [general(s.match.open!, 'local_gana')] });
			expect(res.status).toBe(403);
			expect(res.body.error.code).toBe('CSRF_FAILED');

			const foreign = await preview([general(s.match.open!, 'local_gana')]).set('Origin', 'https://otro.example');
			expect(foreign.status).toBe(403);
		});

		it('answers are private: no-store', async () => {
			expect((await matches()).headers['cache-control']).toBe('no-store');
			expect((await preview([general(s.match.open!, 'local_gana')])).headers['cache-control']).toBe('no-store');
		});
	});

	describe('match list (BR-051, BR-052, BR-013, BR-014)', () => {
		type Item = {
			id: number;
			fechaHora: string;
			estado: string;
			deporte: { id: number; permiteEmpate: boolean };
			local: { equipo: { id: number; nombre: string }; goles: number | null };
			apuesta: {
				estado: string;
				cierre: string;
				pronosticosAdmitidos: {
					resultadoGeneral: string[];
					marcadorExacto: { golesMinimos: number; golesMaximos: number; admiteEmpate: boolean };
				};
			};
		};
		const items = async (query = '') => {
			const res = await matches(query);
			expect(res.status, JSON.stringify(res.body)).toBe(200);
			return res.body.data.items as Item[];
		};

		it('lists every match with its betting state, in proximity order', async () => {
			const list = await items('?pageSize=100');
			const byId = new Map(list.map((m) => [m.id, m]));

			expect(list).toHaveLength(Object.keys(s.match).length);
			expect(
				Object.fromEntries(Object.entries(s.match).map(([key, id]) => [key, byId.get(id)!.apuesta.estado])),
			).toEqual({
				open: 'disponible',
				later: 'disponible',
				voley: 'disponible',
				justOpen: 'disponible',
				justClosed: 'cerrada',
				soon: 'cerrada',
				live: 'en_curso',
				finished: 'finalizado',
				cancelled: 'cancelado',
			});
			const now = new Date();
			const sorted = [...list].sort((a, b) =>
				compareByProximity({ id: a.id, fechaHora: new Date(a.fechaHora) }, { id: b.id, fechaHora: new Date(b.fechaHora) }, now),
			);
			expect(list.map((m) => m.id)).toEqual(sorted.map((m) => m.id));
			expect(list[0]!.id).toBe(s.match.soon);
		});

		it('each match carries its close (fechaHora - 24 h) and the forecasts its sport admits', async () => {
			const byId = new Map((await items('?pageSize=100')).map((m) => [m.id, m]));
			for (const m of byId.values()) {
				expect(new Date(m.apuesta.cierre).getTime()).toBe(new Date(m.fechaHora).getTime() - HORAS_CIERRE_APUESTAS * HOUR);
			}
			expect(byId.get(s.match.open!)!.apuesta.pronosticosAdmitidos).toEqual({
				resultadoGeneral: ['local_gana', 'empate', 'visitante_gana'],
				marcadorExacto: { golesMinimos: 0, golesMaximos: MAX_GOLES_PRONOSTICO, admiteEmpate: true },
			});
			// BR-015: no draw offered in a sport that always has a winner.
			expect(byId.get(s.match.voley!)!.apuesta.pronosticosAdmitidos).toEqual({
				resultadoGeneral: ['local_gana', 'visitante_gana'],
				marcadorExacto: { golesMinimos: 0, golesMaximos: MAX_GOLES_PRONOSTICO, admiteEmpate: false },
			});
			// Same match card as the public fixture: teams embedded, score only once finished.
			expect(byId.get(s.match.finished!)!.local).toMatchObject({ equipo: { id: s.team.B }, goles: 2 });
			expect(byId.get(s.match.live!)!.local.goles).toBeNull();
		});

		it('filters by sport, competition, dates and betting state', async () => {
			const ids = async (q: string) => (await items(q)).map((m) => m.id).sort((a, b) => a - b);
			const sorted = (...list: Array<number | undefined>) => (list as number[]).sort((a, b) => a - b);

			expect(await ids(`?deporteId=${s.voley}`)).toEqual([s.match.voley]);
			expect(await ids(`?competicionId=${s.ligaVoley}`)).toEqual([s.match.voley]);
			expect(await ids('?estadoApuesta=disponible')).toEqual(sorted(s.match.open, s.match.later, s.match.voley, s.match.justOpen));
			expect(await ids(`?estadoApuesta=disponible&deporteId=${s.futbol}`)).toEqual(sorted(s.match.open, s.match.later, s.match.justOpen));
			expect(await ids('?estadoApuesta=cerrada')).toEqual(sorted(s.match.justClosed, s.match.soon));
			expect(await ids('?estadoApuesta=en_curso')).toEqual([s.match.live]);
			expect(await ids('?estadoApuesta=finalizado')).toEqual([s.match.finished]);
			expect(await ids('?estadoApuesta=cancelado')).toEqual([s.match.cancelled]);

			const desde = wholeSeconds(Date.now() + 2.5 * DAY).toISOString();
			const hasta = wholeSeconds(Date.now() + 5 * DAY).toISOString();
			expect(await ids(`?desde=${desde}&hasta=${hasta}`)).toEqual(sorted(s.match.open, s.match.cancelled));
			expect(await ids(`?desde=${desde}&hasta=${hasta}&estadoApuesta=disponible`)).toEqual([s.match.open]);
		});

		it('pages', async () => {
			const res = await matches('?pageSize=2&page=2');
			expect(res.body.data).toMatchObject({ page: 2, pageSize: 2, total: Object.keys(s.match).length });
			expect(res.body.data.items).toHaveLength(2);
		});

		it.each([
			'?estadoApuesta=abierta',
			'?deporteId=abc',
			'?desde=2026-01-01',
			'?desde=2026-02-01T00:00:00Z&hasta=2026-01-01T00:00:00Z',
			'?equipoId=1',
			'?pageSize=101',
		])('rejects %s with 400', async (query) => {
			const res = await matches(query);
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
		});

		it('the exact close on the service: open 1 ms before, closed at the close', async () => {
			const [[row]] = await pool.query<RowDataPacket[]>('SELECT fecha_hora FROM partido WHERE id = ?', [s.match.open]);
			const close = bettingCloseTime(row!.fecha_hora as Date).getTime();
			const state = async (now: number) => {
				const page = await listBettingMatches(pool, { page: 1, pageSize: 100 }, new Date(now));
				const available = await listBettingMatches(pool, { page: 1, pageSize: 100, estadoApuesta: 'disponible' }, new Date(now));
				const closed = await listBettingMatches(pool, { page: 1, pageSize: 100, estadoApuesta: 'cerrada' }, new Date(now));
				return {
					estado: page.items.find((m) => m.id === s.match.open)!.apuesta.estado,
					inAvailable: available.items.some((m) => m.id === s.match.open),
					inClosed: closed.items.some((m) => m.id === s.match.open),
				};
			};

			expect(await state(close - 1)).toEqual({ estado: 'disponible', inAvailable: true, inClosed: false });
			expect(await state(close)).toEqual({ estado: 'cerrada', inAvailable: false, inClosed: true });
			expect(await state(close + 1)).toEqual({ estado: 'cerrada', inAvailable: false, inClosed: true });
		});
	});

	describe('ticket preview (BR-015 to BR-021, BR-023)', () => {
		type Evaluated = {
			valido: boolean;
			selecciones: Array<{
				indice: number;
				valida: boolean;
				errores: Array<{ code: string }>;
				repiteA: number | null;
				costo: number;
				partido: { id: number; apuesta: { estado: string } } | null;
			}>;
			cantidadSelecciones: number;
			costoPorSeleccion: number;
			costoTotal: number;
			saldoActual: number;
			saldoPosterior: number;
			saldoSuficiente: boolean;
			errores: Array<{ code: string }>;
		};
		const evaluate = async (selecciones: Selection[]) => {
			const res = await preview(selecciones);
			expect(res.status, JSON.stringify(res.body)).toBe(200);
			return res.body.data as Evaluated;
		};
		const codes = (e: Evaluated) => e.selecciones.map((sel) => sel.errores.map((x) => x.code));

		it('accepts every forecast of both bet types on an open match', async () => {
			const e = await evaluate([
				general(s.match.open!, 'local_gana'),
				general(s.match.open!, 'empate'),
				general(s.match.open!, 'visitante_gana'),
				exact(s.match.open!, 2, 1),
				exact(s.match.open!, 0, 0),
				exact(s.match.open!, 0, MAX_GOLES_PRONOSTICO),
			]);

			expect(e.valido).toBe(true);
			expect(codes(e)).toEqual([[], [], [], [], [], []]);
			expect(e.selecciones[0]).toMatchObject({
				indice: 0,
				partidoId: s.match.open,
				tipo: 'resultado_general',
				pronostico: 'local_gana',
				golesLocal: null,
				golesVisitante: null,
				costo: COSTO_POR_SELECCION,
				valida: true,
				repiteA: null,
				partido: { id: s.match.open, apuesta: { estado: 'disponible' }, local: { equipo: { nombre: 'Alianza' } } },
			});
			expect(e.selecciones[3]).toMatchObject({ tipo: 'marcador_exacto', pronostico: null, golesLocal: 2, golesVisitante: 1 });
		});

		it('draws: allowed in football; refused in volleyball, as a result and as a tied exact score', async () => {
			const e = await evaluate([
				general(s.match.voley!, 'empate'),
				exact(s.match.voley!, 2, 2),
				exact(s.match.voley!, 0, 0),
				general(s.match.voley!, 'local_gana'),
				general(s.match.voley!, 'visitante_gana'),
				exact(s.match.voley!, 3, 1),
			]);

			expect(codes(e)).toEqual([['DRAW_NOT_ALLOWED'], ['DRAW_NOT_ALLOWED'], ['DRAW_NOT_ALLOWED'], [], [], []]);
			expect(e.valido).toBe(false);
			expect(resultOfScore(2, 2)).toBe('empate');
		});

		it('several selections on one match, contradictory and of both types, each costing one coin (BR-017, BR-018, BR-020)', async () => {
			const e = await evaluate([
				general(s.match.open!, 'local_gana'),
				general(s.match.open!, 'empate'),
				general(s.match.open!, 'visitante_gana'),
				exact(s.match.open!, 2, 1),
				general(s.match.later!, 'empate'),
			]);

			expect(e).toMatchObject({
				valido: true,
				cantidadSelecciones: 5,
				costoPorSeleccion: COSTO_POR_SELECCION,
				costoTotal: 5 * COSTO_POR_SELECCION,
				saldoActual: 10,
				saldoPosterior: 5,
				saldoSuficiente: true,
				errores: [],
			});
		});

		it('an identical selection repeated is allowed, costs again, and points at the first one', async () => {
			const e = await evaluate([
				general(s.match.open!, 'empate'),
				exact(s.match.open!, 1, 0),
				general(s.match.open!, 'empate'),
				exact(s.match.open!, 1, 0),
				exact(s.match.open!, 0, 1),
				general(s.match.open!, 'empate'),
			]);

			expect(e.valido).toBe(true);
			expect(e.costoTotal).toBe(6);
			expect(e.selecciones.map((x) => x.repiteA)).toEqual([null, null, 0, 1, null, 0]);
		});

		it('refuses matches that are closed, started, finished, cancelled or missing, each with its reason', async () => {
			const e = await evaluate([
				general(s.match.justClosed!, 'local_gana'),
				general(s.match.soon!, 'local_gana'),
				general(s.match.live!, 'local_gana'),
				exact(s.match.finished!, 2, 1),
				general(s.match.cancelled!, 'local_gana'),
				general(s.missing, 'local_gana'),
				general(s.match.justOpen!, 'local_gana'),
			]);

			expect(codes(e)).toEqual([
				['BETTING_CLOSED'],
				['BETTING_CLOSED'],
				['MATCH_NOT_PROGRAMMED'],
				['MATCH_NOT_PROGRAMMED'],
				['MATCH_NOT_PROGRAMMED'],
				['MATCH_NOT_FOUND'],
				[],
			]);
			expect(e.selecciones.map((x) => x.partido?.apuesta.estado ?? null)).toEqual([
				'cerrada',
				'cerrada',
				'en_curso',
				'finalizado',
				'cancelado',
				null,
				'disponible',
			]);
			expect(e.valido).toBe(false);
			// Invalid selections still count in the cost shown: the ticket as sent.
			expect(e.costoTotal).toBe(7);
		});

		it('the closed message has no raw date: the close goes in its own field', async () => {
			const res = await preview([general(s.match.justClosed!, 'local_gana')]);
			const [error] = res.body.data.selecciones[0].errores;
			expect(error).toEqual({ code: 'BETTING_CLOSED', message: expect.any(String), cierre: res.body.data.selecciones[0].partido.apuesta.cierre });
			expect(error.message).not.toMatch(/\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}/);
			expect(error.message).toContain('24 horas');
		});

		it('reports every problem of a selection at once', async () => {
			await pool.query("UPDATE partido SET estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = 'en_curso') WHERE id = ?", [s.match.voley]);
			try {
				const e = await evaluate([general(s.match.voley!, 'empate')]);
				expect(codes(e)).toEqual([['MATCH_NOT_PROGRAMMED', 'DRAW_NOT_ALLOWED']]);
			} finally {
				await pool.query("UPDATE partido SET estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = 'programado') WHERE id = ?", [s.match.voley]);
			}
		});

		it('balance (BR-021): enough, exactly enough, and short', async () => {
			const three = [general(s.match.open!, 'local_gana'), general(s.match.open!, 'empate'), exact(s.match.open!, 1, 1)];

			await setBalance(10);
			expect(await evaluate(three)).toMatchObject({ valido: true, saldoActual: 10, costoTotal: 3, saldoPosterior: 7, saldoSuficiente: true });

			await setBalance(3);
			expect(await evaluate(three)).toMatchObject({ valido: true, saldoActual: 3, saldoPosterior: 0, saldoSuficiente: true, errores: [] });

			await setBalance(2);
			const short = await evaluate(three);
			expect(short).toMatchObject({ valido: false, saldoActual: 2, saldoPosterior: -1, saldoSuficiente: false });
			expect(short.errores).toEqual([{ code: 'INSUFFICIENT_BALANCE', message: expect.any(String) }]);
			// The selections themselves are fine: only the balance fails.
			expect(short.selecciones.every((x) => x.valida)).toBe(true);

			await setBalance(0);
			expect((await evaluate([general(s.match.open!, 'local_gana')])).saldoSuficiente).toBe(false);
		});

		it(`takes up to ${MAX_SELECCIONES_POR_TICKET} selections, not one more, nor an empty list`, async () => {
			await setBalance(MAX_SELECCIONES_POR_TICKET);
			const many = Array.from({ length: MAX_SELECCIONES_POR_TICKET }, (_, i) => exact(s.match.open!, i, 0));
			expect(await evaluate(many)).toMatchObject({ valido: true, cantidadSelecciones: MAX_SELECCIONES_POR_TICKET, saldoPosterior: 0 });

			for (const list of [[...many, exact(s.match.open!, 0, 1)], []]) {
				const res = await preview(list);
				expect(res.status).toBe(400);
				expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'selecciones' })]);
			}
		});

		it.each([
			['no body', undefined],
			['not a list', { partidoId: 1 }],
			['an unknown tipo', [{ partidoId: 1, tipo: 'campeon', pronostico: 'local_gana' }]],
			['an unknown forecast', [{ partidoId: 1, tipo: 'resultado_general', pronostico: 'gana_local' }]],
			['a forecast in uppercase', [{ partidoId: 1, tipo: 'resultado_general', pronostico: 'EMPATE' }]],
			['a score on a general bet', [{ partidoId: 1, tipo: 'resultado_general', pronostico: 'empate', golesLocal: 1 }]],
			['a forecast on an exact bet', [{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: 1, golesVisitante: 1, pronostico: 'empate' }]],
			['a missing side', [{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: 1 }]],
			['negative goals', [{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: -1, golesVisitante: 0 }]],
			['too many goals', [{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: MAX_GOLES_PRONOSTICO + 1, golesVisitante: 0 }]],
			['fractional goals', [{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: 1.5, golesVisitante: 0 }]],
			['goals as text', [{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: '1', golesVisitante: 0 }]],
			['a text match id', [{ partidoId: '1', tipo: 'resultado_general', pronostico: 'empate' }]],
			['a zero match id', [{ partidoId: 0, tipo: 'resultado_general', pronostico: 'empate' }]],
			['a missing tipo', [{ partidoId: 1, pronostico: 'empate' }]],
			['an extra key', [{ partidoId: 1, tipo: 'resultado_general', pronostico: 'empate', monto: 5 }]],
		])('400 VALIDATION_ERROR for %s', async (_label, selecciones) => {
			const res = await preview(selecciones);
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
		});

		it('400 for extra top-level keys and for any query string', async () => {
			const extra = await request(app)
				.post('/apuestas/vista-previa')
				.set('Cookie', bettor.cookie)
				.set('X-CSRF-Token', bettor.csrfToken)
				.send({ selecciones: [general(s.match.open!, 'empate')], costo: 0 });
			expect(extra.status).toBe(400);

			const query = await request(app)
				.post('/apuestas/vista-previa?confirmar=true')
				.set('Cookie', bettor.cookie)
				.set('X-CSRF-Token', bettor.csrfToken)
				.send({ selecciones: [general(s.match.open!, 'empate')] });
			expect(query.status).toBe(400);
		});

		it('writes nothing: no ticket, selection, movement or audit row, and the balance stays', async () => {
			const snapshot = async () => {
				const [[row]] = await pool.query<RowDataPacket[]>(
					`SELECT (SELECT COUNT(*) FROM ticket) AS tickets, (SELECT COUNT(*) FROM seleccion) AS selecciones,
						(SELECT COUNT(*) FROM movimiento_moneda) AS movimientos, (SELECT COUNT(*) FROM auditoria) AS auditoria,
						(SELECT saldo_monedas FROM usuario WHERE id = ?) AS saldo`,
					[bettor.user.id],
				);
				return row;
			};
			const before = await snapshot();

			for (let i = 0; i < 3; i++) {
				expect((await preview([general(s.match.open!, 'local_gana'), exact(s.match.later!, 1, 0)])).status).toBe(200);
			}
			await preview([general(s.missing, 'empate')]);

			expect(await snapshot()).toEqual(before);
		});

		it('the exact close on the service: valid 1 ms before, BETTING_CLOSED at and after it', async () => {
			const [[row]] = await pool.query<RowDataPacket[]>('SELECT fecha_hora FROM partido WHERE id = ?', [s.match.open]);
			const close = bettingCloseTime(row!.fecha_hora as Date).getTime();
			const at = async (now: number) =>
				(await previewTicket(pool, bettor.user.id, [{ partidoId: s.match.open!, tipo: 'resultado_general', pronostico: 'local_gana' }], new Date(now)))
					.selecciones[0]!.errores.map((x) => x.code);

			expect(await at(close - 1)).toEqual([]);
			expect(await at(close)).toEqual(['BETTING_CLOSED']);
			expect(await at(close + 1)).toEqual(['BETTING_CLOSED']);
		});
	});

	describe('evaluation inside a transaction (for T-10)', () => {
		const sel = () => [{ partidoId: s.match.open!, tipo: 'resultado_general' as const, pronostico: 'empate' as const }];

		it('gives the same answer as the preview', async () => {
			const inside = await withTransaction(pool, (conn) => evaluateTicketInTransaction(conn, bettor.user.id, sel()));
			const outside = await previewTicket(pool, bettor.user.id, sel());
			expect(inside).toEqual(outside);
		});

		it('refuses a connection outside withTransaction, by rejecting', async () => {
			const conn = await pool.getConnection();
			try {
				// Deliberately the wrong kind of connection.
				// It rejects the promise (like the coin functions), it does not throw synchronously.
				const result = evaluateTicketInTransaction(conn as never, bettor.user.id, sel());
				expect(result).toBeInstanceOf(Promise);
				await expect(result).rejects.toThrow(/withTransaction/);
			} finally {
				conn.release();
			}
		});

		it.skipIf(!canInspectLocks)(
			'takes only record locks on primary keys: user X, then its matches, competitions and sports S (no index or gap locks, whatever the plan)',
			async () => {
				const [[comps]] = await pool.query<RowDataPacket[]>(
					'SELECT (SELECT competicion_id FROM partido WHERE id = ?) AS liga, (SELECT competicion_id FROM partido WHERE id = ?) AS voley',
					[s.match.open, s.match.voley],
				);
				const held = await withTransaction(pool, async (conn) => {
					await evaluateTicketInTransaction(conn, bettor.user.id, [
						{ partidoId: s.match.voley!, tipo: 'marcador_exacto', golesLocal: 1, golesVisitante: 0 },
						...sel(),
						{ partidoId: s.match.live!, tipo: 'resultado_general', pronostico: 'local_gana' },
					]);
					const [[me]] = await conn.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
					return locksHeldBy(Number(me!.id));
				});

				const records = held.filter((l) => l.tipo === 'RECORD');
				expect(records.every((l) => l.indice === 'PRIMARY'), JSON.stringify(records)).toBe(true);
				const mine = (tabla: string) =>
					records
						.filter((l) => l.tabla === tabla)
						.map((l) => `${l.dato} ${l.modo}`)
						.sort();
				const shared = (...ids: unknown[]) => ids.map((id) => `${id} S,REC_NOT_GAP`).sort();
				expect(mine('usuario')).toEqual([`${bettor.user.id} X,REC_NOT_GAP`]);
				expect(mine('partido')).toEqual(shared(s.match.open, s.match.voley, s.match.live));
				expect(mine('competicion')).toEqual(shared(comps!.liga, comps!.voley));
				expect(mine('deporte')).toEqual(shared(s.futbol, s.voley));
				expect(new Set(records.map((l) => l.tabla))).toEqual(new Set(['usuario', 'partido', 'competicion', 'deporte']));
			},
		);

		it.skipIf(!canInspectLocks)('a missing match id takes no gap lock, and a new match can be created meanwhile', async () => {
			const other = await pool.getConnection();
			try {
				await withTransaction(pool, async (conn) => {
					await evaluateTicketInTransaction(conn, bettor.user.id, [...sel(), { partidoId: s.missing, tipo: 'resultado_general', pronostico: 'empate' }]);
					const [[me]] = await conn.query<RowDataPacket[]>('SELECT CONNECTION_ID() AS id');
					const held = await locksHeldBy(Number(me!.id));
					const records = held.filter((l) => l.tipo === 'RECORD');
					expect(records.filter((l) => l.tabla === 'partido').map((l) => `${l.dato} ${l.modo}`)).toEqual([`${s.match.open} S,REC_NOT_GAP`]);
					expect(records.some((l) => /GAP/.test(l.modo) && !/REC_NOT_GAP/.test(l.modo)), JSON.stringify(records)).toBe(false);
					expect(records.some((l) => String(l.dato).includes('supremum')), JSON.stringify(records)).toBe(false);

					// Another transaction inserts a match (past the last id) without waiting.
					await other.query('SET SESSION innodb_lock_wait_timeout = 1');
					await other.beginTransaction();
					const [[comp]] = await other.query<RowDataPacket[]>('SELECT competicion_id FROM partido WHERE id = ?', [s.match.open]);
					await other.query(
						`INSERT INTO partido (competicion_id, estado_partido_id, jornada, fecha_hora, sede)
						SELECT ?, id, 1, UTC_TIMESTAMP(), 'Nuevo' FROM estado_partido WHERE codigo = 'programado'`,
						[comp!.competicion_id],
					);
					await other.rollback();
				});
			} finally {
				await other.query('SET SESSION innodb_lock_wait_timeout = DEFAULT');
				other.release();
			}
		});

		it('locks the user (for the debit) and the match and sport rows until the transaction ends', async () => {
			const other = await pool.getConnection();
			const tryLock = async (sql: string, id: number) => {
				try {
					await other.query(`${sql} NOWAIT`, [id]);
					return 'free';
				} catch (error) {
					return (error as { code?: string }).code;
				}
			};
			try {
				await withTransaction(pool, async (conn) => {
					await evaluateTicketInTransaction(conn, bettor.user.id, [
						...sel(),
						{ partidoId: s.match.voley!, tipo: 'marcador_exacto', golesLocal: 1, golesVisitante: 0 },
					]);
					await other.beginTransaction();
					expect(await tryLock('SELECT id FROM usuario WHERE id = ? FOR SHARE', bettor.user.id)).toBe('ER_LOCK_NOWAIT');
					expect(await tryLock('SELECT id FROM partido WHERE id = ? FOR UPDATE', s.match.open!)).toBe('ER_LOCK_NOWAIT');
					expect(await tryLock('SELECT id FROM partido WHERE id = ? FOR UPDATE', s.match.voley!)).toBe('ER_LOCK_NOWAIT');
					expect(await tryLock('SELECT id FROM deporte WHERE id = ? FOR UPDATE', s.voley)).toBe('ER_LOCK_NOWAIT');
					// Shared locks let another ticket read the same match meanwhile.
					expect(await tryLock('SELECT id FROM partido WHERE id = ? FOR SHARE', s.match.open!)).toBe('free');
					// A match not in the ticket is not locked.
					expect(await tryLock('SELECT id FROM partido WHERE id = ? FOR UPDATE', s.match.later!)).toBe('free');
					await other.rollback();
				});
				await other.beginTransaction();
				expect(await tryLock('SELECT id FROM partido WHERE id = ? FOR UPDATE', s.match.open!)).toBe('free');
				await other.rollback();
			} finally {
				other.release();
			}
		});
	});

	it('modules: Polla reads Informativo, and no Informativo file imports Polla', () => {
		const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
		const informativo = [
			...['sports', 'competitions', 'teams', 'players', 'enrollments', 'matches', 'public'].map((n) => `services/${n}.service.ts`),
			'services/catalog-query.ts',
			'routes/catalog.route.ts',
			'routes/public.route.ts',
			'controllers/catalog.controller.ts',
			...readdirSync(resolve(src, 'schemas')).filter((f) => !f.startsWith('betting')).map((f) => `schemas/${f}`),
		];
		for (const file of informativo) {
			const code = readFileSync(resolve(src, file), 'utf8');
			expect(code, file).not.toMatch(/from '[^']*(services\/|\.\/)(betting|bets-|coins?)[^']*'/);
			expect(code, file).not.toMatch(/from '[^']*betting\.(schema|route|controller)[^']*'/);
		}
		const polla = readFileSync(resolve(src, 'services/betting.service.ts'), 'utf8');
		expect(polla).toMatch(/from '\.\/public\.service\.js'/);
	});
});
