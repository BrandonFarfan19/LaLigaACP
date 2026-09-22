import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MAX_FILAS_TOP, POSICIONES_TOP, rankParticipants, type RankingScore } from '../src/lib/ranking.js';
import { getRanking, RANKING_TOP_SQL } from '../src/services/ranking.service.js';
import { createTestApp } from './helpers/app.js';
import { login, registerUser, setUserState } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const HOUR = 60 * 60 * 1000;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

type Estado = 'pendiente' | 'acertada' | 'no_acertada' | 'anulada';
/** A settled (or not) selection, forced straight into the database: the ranking only reads state and points. */
type Forced = [Estado, number | null];
const HIT3: Forced = ['acertada', 3];
const HIT1: Forced = ['acertada', 1];
const MISS: Forced = ['no_acertada', 0];
const PENDING: Forced = ['pendiente', null];
const VOID: Forced = ['anulada', null];

describe('pool ranking (T-15: BR-041 to BR-044)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	const s = {} as { liga: number; A: number; B: number; match: number; cat: Record<string, number> };

	interface Person {
		id: number;
		nombre: string;
		email: string;
		cookie?: string;
	}

	/** A registered user in the given role and state; with `session`, logged in too. */
	async function person(
		nombre: string,
		{ rol = 'apostador', estado = 'validado', session = false }: { rol?: 'apostador' | 'admin'; estado?: 'pendiente' | 'validado'; session?: boolean } = {},
	): Promise<Person> {
		const { body, user } = await registerUser(app, { nombre });
		await setUserState(pool, user.id, { rol, estado });
		const who: Person = { id: user.id, nombre, email: body.email };
		if (session) who.cookie = (await login(app, body.email)).cookie;
		return who;
	}

	async function newTicket(userId: number): Promise<number> {
		const [ticket] = await pool.query<ResultSetHeader>(
			'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, UTC_TIMESTAMP(), ?, SHA2(UUID(), 256))',
			[userId, randomUUID()],
		);
		return ticket.insertId;
	}

	/** One ticket of `userId` with these selections (general result, local wins) on the test match. */
	async function bets(userId: number, selections: Forced[]): Promise<number[]> {
		const ticketId = await newTicket(userId);
		const [res] = await pool.query<ResultSetHeader>(
			`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id, puntos_obtenidos) VALUES ?`,
			[selections.map(([estado, puntos]) => [ticketId, s.match, s.cat['tipo:resultado_general'], s.cat['resultado:local_gana'], s.cat[`estado:${estado}`], puntos])],
		);
		return selections.map((_, i) => res.insertId + i);
	}

	const ranking = (who?: Person) => {
		const req = request(app).get('/ranking');
		return who?.cookie ? req.set('Cookie', who.cookie) : req;
	};
	const adminRanking = async (query = '') => (await api.get(`/polla/ranking${query}`)).body.data;
	/** The admin's full list as `[posicion, nombre, puntos, aciertos]`. */
	const table = async () =>
		(await adminRanking('?pageSize=100')).items.map((r: { posicion: number; participante: { nombre: string }; puntos: number; aciertos: number }) => [
			r.posicion,
			r.participante.nombre,
			r.puntos,
			r.aciertos,
		]);

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
		s.match = await insertMatch(pool, s.liga, s.A, s.B, 'en_curso', wholeSeconds(Date.now() - 2 * HOUR));
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

	describe('the rule (lib/ranking.ts)', () => {
		it('points, then hits; a full tie shares its position and the next one skips (1, 1, 3); name and id only order a tie', () => {
			const scores: RankingScore[] = [
				{ id: 5, nombre: 'Eva', puntos: 6, aciertos: 2 },
				{ id: 2, nombre: 'beto', puntos: 6, aciertos: 2 },
				{ id: 9, nombre: 'Álvaro', puntos: 6, aciertos: 3 },
				{ id: 1, nombre: 'Zoe', puntos: 7, aciertos: 1 },
				{ id: 3, nombre: 'Beto', puntos: 6, aciertos: 2 },
				{ id: 4, nombre: 'Ana', puntos: 0, aciertos: 0 },
			];
			expect(rankParticipants(scores).map((r) => [r.posicion, r.id])).toEqual([
				[1, 1],
				[2, 9],
				[3, 2],
				[3, 3],
				[3, 5],
				[6, 4],
			]);
		});
	});

	describe('order and positions', () => {
		it('by points, then by hits, with shared positions for full ties', async () => {
			const zoe = await person('Zoe');
			const ana = await person('Ana');
			const beto = await person('Beto');
			const carla = await person('Carla');
			const dani = await person('Dani');
			await bets(zoe.id, [HIT3, HIT3, MISS]); // 6 points, 2 hits
			await bets(ana.id, [HIT3, HIT3]); // 6, 2: full tie with Zoe
			await bets(beto.id, [HIT3, HIT1, HIT1, HIT1]); // 6, 4: same points, more hits
			await bets(carla.id, [HIT3, HIT3, HIT1]); // 7, 3
			await bets(dani.id, [HIT3]);
			await bets(dani.id, [HIT3, PENDING, VOID, MISS]); // 6, 2 over two tickets: ties Zoe and Ana

			expect(await table()).toEqual([
				[1, 'Carla', 7, 3],
				[2, 'Beto', 6, 4],
				[3, 'Ana', 6, 2],
				[3, 'Dani', 6, 2],
				[3, 'Zoe', 6, 2],
			]);
			const res = await ranking(await person('Mirón', { estado: 'pendiente', session: true }));
			expect(res.status).toBe(200);
			expect(res.body.data.top.map((r: { posicion: number; participante: { nombre: string } }) => [r.posicion, r.participante.nombre])).toEqual([
				[1, 'Carla'],
				[2, 'Beto'],
				[3, 'Ana'],
				[3, 'Dani'],
				[3, 'Zoe'],
			]);
			expect(res.body.data).toMatchObject({ participantes: 5, posicionesTop: POSICIONES_TOP, propia: null });
		});

		it('the top shows positions 1 to 10: everyone tied at 10 gets in, position 13 does not', async () => {
			const people: Person[] = [];
			for (let i = 1; i <= 13; i++) people.push(await person(`P${String(i).padStart(2, '0')}`, { session: i === 13 }));
			// P01..P09: 9..1 hits of 3 points; P10..P12: one 1-point hit each (tied at 10); P13: nothing.
			for (let i = 0; i < 9; i++) await bets(people[i]!.id, Array.from({ length: 9 - i }, () => HIT3));
			for (let i = 9; i < 12; i++) await bets(people[i]!.id, [HIT1]);
			const data = (await ranking(people[12])).body.data;
			expect(data.top).toHaveLength(12);
			expect(data.top.map((r: { posicion: number }) => r.posicion)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 10]);
			expect(data.top.map((r: { participante: { nombre: string } }) => r.participante.nombre).slice(9)).toEqual(['P10', 'P11', 'P12']);
			expect(data.propia).toMatchObject({ posicion: 13, participante: { nombre: 'P13' }, puntos: 0, aciertos: 0, enTop: false, esPropia: true });
			expect(data.participantes).toBe(13);
		});

		it('a tie across the whole pool: everyone is first, and all of them are in the top', async () => {
			for (let i = 0; i < 12; i++) await bets((await person(`Igual ${i}`)).id, [HIT1]);
			const data = (await ranking(await person('Mira', { estado: 'pendiente', session: true }))).body.data;
			expect(data.top).toHaveLength(12);
			expect(new Set(data.top.map((r: { posicion: number }) => r.posicion))).toEqual(new Set([1]));
			expect(data.topSinMostrar).toBe(0);
		});

		it(`a pool just opened (everyone at 0): at most ${MAX_FILAS_TOP} rows, the rest counted, your own row apart`, async () => {
			const TOTAL = MAX_FILAS_TOP + 12;
			const [roles] = await pool.query<RowDataPacket[]>(
				`SELECT (SELECT id FROM rol WHERE codigo = 'apostador') AS rol, (SELECT id FROM estado_usuario WHERE codigo = 'validado') AS validado,
					(SELECT id FROM estado_pago WHERE codigo = 'confirmado') AS pago`,
			);
			const { rol, validado, pago } = roles[0]!;
			await pool.query('INSERT INTO usuario (rol_id, estado_usuario_id, estado_pago_id, nombre, email, password_hash, creado_en) VALUES ?', [
				Array.from({ length: TOTAL - 1 }, (_, i) => [rol, validado, pago, `Abierta ${String(i).padStart(3, '0')}`, `abierta${i}@liga.test`, 'x', new Date()]),
			]);
			const last = await person('Zzz última', { session: true });
			const data = (await ranking(last)).body.data;
			expect(data).toMatchObject({ participantes: TOTAL, maxFilasTop: MAX_FILAS_TOP, topSinMostrar: TOTAL - MAX_FILAS_TOP });
			expect(data.top).toHaveLength(MAX_FILAS_TOP);
			expect(data.top.every((r: { posicion: number }) => r.posicion === 1)).toBe(true);
			expect(data.top.at(-1).participante.nombre).toBe(`Abierta ${String(MAX_FILAS_TOP - 1).padStart(3, '0')}`);
			expect(data.propia).toMatchObject({ posicion: 1, participante: { nombre: 'Zzz última' }, enTop: true, enLista: false });
			const body = JSON.stringify((await ranking(last)).body);
			expect(body.length).toBeLessThan(10_000);
		});

		it('names inside a tie follow Spanish rules (ñ after n, case and accents ignored), in SQL and in lib/ranking.ts', async () => {
			const names = ['Nuza', 'Ñandú', 'nuño', 'Nuñez', 'Oscar', 'Nz', 'ana', 'Álvaro', 'Ana', 'alba', 'Ñu', 'nu', 'Chelo', 'llama', 'Zoë', 'zoe'];
			const people: Person[] = [];
			for (const nombre of names) people.push(await person(nombre));
			for (const who of people) await bets(who.id, [HIT1]);
			const expected = rankParticipants(people.map((p) => ({ id: p.id, nombre: p.nombre, puntos: 1, aciertos: 1 })));
			expect((await table()).map((row: unknown[]) => row[1])).toEqual(expected.map((r) => r.nombre));
			expect(expected.map((r) => r.nombre)).toEqual([
				'alba',
				'Álvaro',
				'ana',
				'Ana',
				'Chelo',
				'llama',
				'nu',
				'Nuñez',
				'nuño',
				'Nuza',
				'Nz',
				'Ñandú',
				'Ñu',
				'Oscar',
				'Zoë',
				'zoe',
			]);
		});

		it('validated participants with no bets, or nothing settled, are ranked with 0', async () => {
			const lucas = await person('Lucas');
			const nadie = await person('Nadie');
			const espera = await person('Espera');
			await bets(lucas.id, [HIT1]);
			await bets(espera.id, [PENDING, VOID, MISS]);
			expect(await table()).toEqual([
				[1, 'Lucas', 1, 1],
				[2, 'Espera', 0, 0],
				[2, 'Nadie', 0, 0],
			]);
			expect(nadie.id).toBeGreaterThan(0);
		});
	});

	describe('who is ranked', () => {
		it('admins and pending users are never ranked, even with (forced) winning selections', async () => {
			const real = await person('Real');
			await bets(real.id, [HIT1]);
			const admin = await person('Jefa', { rol: 'admin', session: true });
			await bets(admin.id, [HIT3, HIT3, HIT3]);
			const pending = await person('Pendiente', { estado: 'pendiente', session: true });
			await bets(pending.id, [HIT3, HIT3]);
			const adminValidated = await person('Jefe validado', { rol: 'admin', estado: 'validado' });
			await bets(adminValidated.id, [HIT3]);

			expect(await table()).toEqual([[1, 'Real', 1, 1]]);
			for (const who of [admin, pending]) {
				const res = await ranking(who);
				expect(res.status).toBe(200);
				expect(res.body.data).toEqual({
					top: [{ posicion: 1, participante: { nombre: 'Real' }, puntos: 1, aciertos: 1, esPropia: false }],
					propia: null,
					participantes: 1,
					posicionesTop: POSICIONES_TOP,
					maxFilasTop: MAX_FILAS_TOP,
					topSinMostrar: 0,
				});
			}
			// The pool's figures cover every apostador (like the participants table), never an admin:
			// Real's 1 and the pending user's forced 6, not the admins' 9.
			const stats = (await api.get('/polla/estadisticas')).body.data;
			expect(stats).toMatchObject({ puntos: 7, aciertos: 3, participantes: { inscritos: 2, validados: 1, pendientes: 1 } });
		});

		it('your own row: in the top it is marked; outside it comes apart', async () => {
			const first = await person('Primera', { session: true });
			await bets(first.id, [HIT3]);
			const own = (await ranking(first)).body.data;
			expect(own.top[0]).toMatchObject({ participante: { nombre: 'Primera' }, esPropia: true });
			expect(own.propia).toEqual({ posicion: 1, participante: { nombre: 'Primera' }, puntos: 3, aciertos: 1, esPropia: true, enTop: true, enLista: true });

			for (let i = 0; i < 11; i++) await bets((await person(`Otro ${String(i).padStart(2, '0')}`)).id, [HIT3, HIT1]);
			const later = (await ranking(first)).body.data;
			expect(later.top.map((r: { esPropia: boolean }) => r.esPropia)).not.toContain(true);
			expect(later.propia).toEqual({ posicion: 12, participante: { nombre: 'Primera' }, puntos: 3, aciertos: 1, esPropia: true, enTop: false, enLista: false });
		});
	});

	describe('always up to date (BR-044)', () => {
		it('confirming a result moves the ranking at once; a (forced) void takes the points away', async () => {
			const ana = await person('Ana', { session: true });
			const beto = await person('Beto', { session: true });
			// Pending bets on a match whose time is over: Ana on the exact score 2-1, Beto on local wins.
			await pool.query(
				`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_goles_local, pronostico_goles_visitante, estado_seleccion_id)
				VALUES (?, ?, ?, 2, 1, ?)`,
				[await newTicket(ana.id), s.match, s.cat['tipo:marcador_exacto'], s.cat['estado:pendiente']],
			);
			const [betoPick] = await bets(beto.id, [PENDING]); // local_gana, pending
			expect((await ranking(ana)).body.data.top.map((r: { posicion: number; puntos: number }) => [r.posicion, r.puntos])).toEqual([
				[1, 0],
				[1, 0],
			]);

			expect((await api.put(`/partidos/${s.match}/resultado`, { golesLocal: 2, golesVisitante: 1 })).status).toBe(200);
			expect((await api.post(`/partidos/${s.match}/resultado/confirmar`, { confirmar: true, golesLocal: 2, golesVisitante: 1 })).status).toBe(200);
			const after = (await ranking(ana)).body.data;
			expect(after.top.map((r: { posicion: number; participante: { nombre: string }; puntos: number; aciertos: number }) => [
				r.posicion,
				r.participante.nombre,
				r.puntos,
				r.aciertos,
			])).toEqual([
				[1, 'Ana', 3, 1],
				[1, 'Beto', 3, 1],
			]);

			// Forced: Beto's selection voided (T-16 will do this for real on a cancelled match).
			await pool.query('UPDATE seleccion SET estado_seleccion_id = ?, puntos_obtenidos = NULL WHERE id = ?', [s.cat['estado:anulada'], betoPick]);
			expect(await table()).toEqual([
				[1, 'Ana', 3, 1],
				[2, 'Beto', 0, 0],
			]);
			expect((await ranking(beto)).body.data.propia).toMatchObject({ posicion: 2, puntos: 0, aciertos: 0 });

			// Same definitions as "Mis apuestas" (T-11).
			for (const who of [ana, beto]) {
				const own = (await ranking(who)).body.data.propia;
				const summary = (await request(app).get('/apuestas/mis-apuestas/resumen').set('Cookie', who.cookie!)).body.data;
				expect({ puntos: summary.puntos, aciertos: summary.aciertos }, who.nombre).toEqual({ puntos: own.puntos, aciertos: own.aciertos });
			}
		});
	});

	describe('access and privacy', () => {
		it('401 without a session; 400 with any query string; responses are no-store', async () => {
			expect((await request(app).get('/ranking')).status).toBe(401);
			const who = await person('Curioso', { session: true });
			const withQuery = await request(app).get('/ranking?top=50').set('Cookie', who.cookie!);
			expect(withQuery.status).toBe(400);
			const ok = await ranking(who);
			expect(ok.status).toBe(200);
			expect(ok.headers['cache-control']).toBe('no-store');
			expect((await request(app).get('/public/ranking')).status).toBe(404);
		});

		it('never shows an email, a balance, a state or an id', async () => {
			const who = await person('Discreta', { session: true });
			await pool.query('UPDATE usuario SET saldo_monedas = 7 WHERE id = ?', [who.id]);
			await bets(who.id, [HIT3]);
			const other = await person('Otra');
			await bets(other.id, [HIT1]);
			const body = (await ranking(who)).body;
			const text = JSON.stringify(body);
			for (const leak of [who.email, other.email, '@', 'saldo', 'email', 'estado', 'usuarioId', '"id"']) {
				expect(text, leak).not.toContain(leak);
			}
			const keys = new Set<string>();
			const walk = (value: unknown) => {
				if (Array.isArray(value)) value.forEach(walk);
				else if (value && typeof value === 'object') {
					for (const [k, v] of Object.entries(value)) {
						keys.add(k);
						walk(v);
					}
				}
			};
			walk(body);
			expect([...keys].sort()).toEqual(
				['data', 'top', 'propia', 'participantes', 'posicionesTop', 'posicion', 'participante', 'nombre', 'puntos', 'aciertos', 'esPropia', 'enTop', 'enLista', 'topSinMostrar', 'maxFilasTop'].sort(),
			);
		});

		it('admin routes: 401 anonymous, 403 for a participant, strict query', async () => {
			const bettor = await person('Apostador', { session: true });
			for (const path of ['/admin/polla/ranking', '/admin/polla/estadisticas']) {
				expect((await request(app).get(path)).status, path).toBe(401);
				expect((await request(app).get(path).set('Cookie', bettor.cookie!)).status, path).toBe(403);
			}
			for (const query of ['?x=1', '?page=0', '?pageSize=101', '?page=a', '?page=1&page=2']) {
				expect((await api.get(`/polla/ranking${query}`)).status, query).toBe(400);
			}
			expect((await api.get('/polla/estadisticas?x=1')).status).toBe(400);
		});
	});

	describe('admin views (BR-001)', () => {
		it('the whole ranking, paginated, with each participant’s id', async () => {
			const people: Person[] = [];
			for (let i = 0; i < 5; i++) people.push(await person(`N${i}`));
			for (let i = 0; i < 5; i++) await bets(people[i]!.id, Array.from({ length: 5 - i }, () => HIT1));
			const page2 = await adminRanking('?page=2&pageSize=2');
			expect(page2).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
			expect(page2.items).toEqual([
				{ posicion: 3, empatados: 1, participante: { id: people[2]!.id, nombre: 'N2' }, puntos: 3, aciertos: 3 },
				{ posicion: 4, empatados: 1, participante: { id: people[3]!.id, nombre: 'N3' }, puntos: 2, aciertos: 2 },
			]);
			expect(await adminRanking('?page=9&pageSize=2')).toMatchObject({ items: [], total: 5, totalPages: 3 });
			// `1e2` and `0x10` are not whole numbers written in digits (T-21 fix).
			for (const bad of ['page=1e2', 'pageSize=0x10']) {
				const res = await api.get(`/polla/ranking?${bad}`);
				expect(res.status, bad).toBe(400);
			}
			await resetDatabase(pool);
			api = await adminApi(app, pool);
			expect(await adminRanking()).toMatchObject({ items: [], total: 0, totalPages: 0 });
		});

		it('each row says how many share its position, even when the tie is split across pages (T-21 fix)', async () => {
			// Four tied at the top, then one alone: with two rows per page, no page sees the whole tie.
			const people: Person[] = [];
			for (let i = 0; i < 5; i++) people.push(await person(`E${i}`));
			for (let i = 0; i < 4; i++) await bets(people[i]!.id, [HIT1]);
			const shared = async (query: string) =>
				(await adminRanking(query)).items.map((row: { posicion: number; empatados: number }) => [row.posicion, row.empatados]);

			expect(await shared('?page=1&pageSize=2')).toEqual([[1, 4], [1, 4]]);
			// The second half of the same tie still knows it is shared.
			expect(await shared('?page=2&pageSize=2')).toEqual([[1, 4], [1, 4]]);
			expect(await shared('?page=3&pageSize=2')).toEqual([[5, 1]]);
		});

		it('pool figures: participants, tickets and selections by state, coins and points, participants only', async () => {
			const a = await person('A');
			const b = await person('B');
			await person('Sin validar', { estado: 'pendiente' });
			const admin = await person('Admin', { rol: 'admin', estado: 'validado' });
			await pool.query('UPDATE usuario SET saldo_monedas = 5 WHERE id IN (?)', [[a.id, b.id]]);
			await bets(a.id, [HIT3, MISS]); // finalizado
			await bets(a.id, [PENDING, HIT1]); // pendiente
			await bets(b.id, [VOID, VOID]); // anulado
			await bets(admin.id, [HIT3, HIT3, PENDING]); // never counted
			const res = await api.get('/polla/estadisticas');
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({
				participantes: { inscritos: 3, validados: 2, pendientes: 1 },
				tickets: { total: 3, pendiente: 1, finalizado: 1, anulado: 1 },
				selecciones: { total: 6, pendiente: 1, acertada: 2, no_acertada: 1, anulada: 2 },
				monedasUtilizadas: 6,
				// D-003: B's selections were voided by hand, with no refund movement.
				monedasDevueltas: 0,
				monedasDisponibles: 10,
				puntos: 4,
				aciertos: 2,
			});
			await resetDatabase(pool);
			api = await adminApi(app, pool);
			expect((await api.get('/polla/estadisticas')).body.data).toMatchObject({
				participantes: { inscritos: 0, validados: 0, pendientes: 0 },
				tickets: { total: 0, pendiente: 0, finalizado: 0, anulado: 0 },
				puntos: 0,
			});
		});
	});

	describe('volume', () => {
		it('300 participants and 30000 selections: one statement with covering indexes, and the same positions as the rule', async () => {
			const USERS = 300;
			const TICKETS_PER_USER = 10;
			const PER_TICKET = 10;
			let seed = 42;
			const random = () => {
				seed = (seed * 1103515245 + 12345) % 2 ** 31;
				return seed / 2 ** 31;
			};
			const [roles] = await pool.query<RowDataPacket[]>(
				`SELECT (SELECT id FROM rol WHERE codigo = 'apostador') AS rol,
					(SELECT id FROM estado_usuario WHERE codigo = 'validado') AS validado,
					(SELECT id FROM estado_pago WHERE codigo = 'confirmado') AS pago`,
			);
			const { rol, validado, pago } = roles[0]!;
			const [users] = await pool.query<ResultSetHeader>(
				'INSERT INTO usuario (rol_id, estado_usuario_id, estado_pago_id, nombre, email, password_hash, saldo_monedas, creado_en) VALUES ?',
				[Array.from({ length: USERS }, (_, i) => [rol, validado, pago, `V${String(i).padStart(4, '0')}`, `v${i}@vol.test`, 'x', 0, new Date()])],
			);
			const userIds = Array.from({ length: USERS }, (_, i) => users.insertId + i);
			const [tickets] = await pool.query<ResultSetHeader>(
				'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES ?',
				[userIds.flatMap((u) => Array.from({ length: TICKETS_PER_USER }, () => [u, new Date(), randomUUID(), 'a'.repeat(64)]))],
			);
			const expected = new Map<number, RankingScore>(userIds.map((id, i) => [id, { id, nombre: `V${String(i).padStart(4, '0')}`, puntos: 0, aciertos: 0 }]));
			const rows: unknown[][] = [];
			for (let t = 0; t < USERS * TICKETS_PER_USER; t++) {
				const owner = expected.get(userIds[Math.floor(t / TICKETS_PER_USER)]!)!;
				for (let k = 0; k < PER_TICKET; k++) {
					const roll = random();
					const forced: Forced = roll < 0.1 ? HIT3 : roll < 0.15 ? HIT1 : roll < 0.6 ? MISS : roll < 0.9 ? PENDING : VOID;
					if (forced[0] === 'acertada') {
						owner.puntos += forced[1]!;
						owner.aciertos += 1;
					}
					rows.push([tickets.insertId + t, s.match, s.cat['tipo:resultado_general'], s.cat['resultado:local_gana'], s.cat[`estado:${forced[0]}`], forced[1]]);
				}
			}
			for (let i = 0; i < rows.length; i += 5000) {
				await pool.query(
					'INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id, puntos_obtenidos) VALUES ?',
					[rows.slice(i, i + 5000)],
				);
			}
			await pool.query('ANALYZE TABLE seleccion, ticket, usuario');

			const who = userIds[USERS - 1]!;
			const timings: number[] = [];
			let result = await getRanking(pool, who);
			for (let i = 0; i < 5; i++) {
				const started = performance.now();
				result = await getRanking(pool, who);
				timings.push(performance.now() - started);
			}
			timings.sort((a, b) => a - b);
			process.stdout.write(`ranking con ${USERS} participantes y ${rows.length} selecciones: mediana ${timings[2]!.toFixed(1)} ms\n`);
			expect(timings[2]).toBeLessThan(2000);

			const rule = rankParticipants([...expected.values()]);
			expect(result.participantes).toBe(USERS);
			expect(result.top.map((r) => [r.posicion, r.participante.nombre, r.puntos, r.aciertos])).toEqual(
				rule.filter((r) => r.posicion <= POSICIONES_TOP).map((r) => [r.posicion, r.nombre, r.puntos, r.aciertos]),
			);
			const own = rule.find((r) => r.id === who)!;
			expect(result.propia).toMatchObject({ posicion: own.posicion, puntos: own.puntos, aciertos: own.aciertos });
			const full = await adminRanking('?pageSize=100&page=2');
			expect(full.items.map((r: { participante: { id: number }; posicion: number }) => [r.participante.id, r.posicion])).toEqual(
				rule.slice(100, 200).map((r) => [r.id, r.posicion]),
			);

			// The plan: selections and tickets read from their indexes alone.
			const [plan] = await pool.query<RowDataPacket[]>(`EXPLAIN ${RANKING_TOP_SQL}`, [MAX_FILAS_TOP, who]);
			const byTable = Object.fromEntries(plan.map((r) => [r.table, r]));
			expect(byTable.s).toMatchObject({ key: 'idx_seleccion_ticket_estado', type: 'ref' });
			expect(String(byTable.s.Extra)).toContain('Using index');
			expect(String(byTable.t.Extra)).toContain('Using index');
		});
	});
});
