import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareByProximity } from '../src/lib/match-order.js';
import { createTestApp, env } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertDrawBet, insertGoal, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const HOUR = 60 * 60 * 1000;
const GOAL_IMAGE = `${'a'.repeat(32)}.webp`;
const MATCH_IMAGE = `${'b'.repeat(32)}.webp`;
const LIVE_IMAGE = `${'c'.repeat(32)}.webp`;
const DAY = 24 * HOUR;

/** Every key the public API may return. Anything else (email, saldo, csrfToken...) fails the privacy test. */
const ALLOWED_KEYS = new Set([
	'data', 'error', 'code', 'message', 'details', 'path',
	'items', 'page', 'pageSize', 'total', 'totalPages',
	'id', 'nombre', 'slug', 'permiteEmpate', 'deporte', 'competicion', 'competicionId',
	'nombreCorto', 'escudo', 'colorAcento',
	'jornada', 'fechaHora', 'estado', 'sede', 'local', 'visita', 'equipo', 'goles', 'resultado',
	'minuto', 'equipoId', 'jugador', 'foto', 'imagen', 'video', 'plataforma', 'url', 'embedUrl',
	'multimedia', 'imagenes', 'videos', 'tipo', 'creadoEn',
	'filas', 'posicion', 'jugados', 'ganados', 'empatados', 'perdidos', 'golesAFavor', 'golesEnContra', 'diferencia', 'puntos',
	'plantel', 'jugadorId', 'numeroCamiseta',
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

describe('public API (T-08: BR-013, BR-048 to BR-050)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	/** Everything the scenario created. */
	const s = {} as {
		futbol: number;
		voley: number;
		liga: number;
		copa: number;
		ligaVoley: number;
		team: Record<string, number>;
		match: Record<string, number>;
		players: Record<string, number>;
		enrollments: Record<string, number>;
	};

	const get = (path: string) => request(app).get(`/public${path}`);

	/** Sets the score and finishes the match straight in the database (T-12 does this for real). */
	async function finish(matchId: number, home: number, away: number) {
		await pool.query('UPDATE partido_equipo SET goles = IF(es_visita, ?, ?) WHERE partido_id = ?', [away, home, matchId]);
		await pool.query("UPDATE partido SET estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = 'finalizado') WHERE id = ?", [matchId]);
	}

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		const post = <T = { id: number }>(path: string, body: unknown) => created<T>(api.post(path, body));

		s.futbol = (await post('/deportes', { nombre: 'Fútbol', permiteEmpate: true })).id;
		s.voley = (await post('/deportes', { nombre: 'Vóley', permiteEmpate: false })).id;
		s.liga = (await post('/competiciones', { deporteId: s.futbol, nombre: 'Liga 1' })).id;
		s.copa = (await post('/competiciones', { deporteId: s.futbol, nombre: 'Copa' })).id;
		s.ligaVoley = (await post('/competiciones', { deporteId: s.voley, nombre: 'Liga Vóley' })).id;

		s.team = {};
		const team = async (key: string, competicionId: number, nombre: string) => {
			s.team[key] = (await post('/equipos', teamBody(competicionId, { nombre, nombreCorto: nombre.slice(0, 6), escudo: `escudos/${key}.webp` }))).id;
		};
		for (const [key, nombre] of [['A', 'Alianza'], ['B', 'Boca'], ['C', 'Cristal'], ['D', 'Deportivo'], ['E', 'Emelec']]) {
			await team(key, s.liga, nombre);
		}
		for (const [key, nombre] of [['X', 'Xolos'], ['Y', 'Yaracuy'], ['W', 'Wanderers'], ['V', 'Vélez'], ['zeta', 'Zeta'], ['beta', 'Beta'], ['alfa', 'alfa'], ['clon1', 'Clon'], ['clon2', 'Clon']]) {
			await team(key, s.copa, nombre);
		}
		await team('P', s.ligaVoley, 'Pumas');
		await team('Q', s.ligaVoley, 'Quilmes');

		// Liga 1: C 4 pts (+2), A 4 pts (0), D 1 pt (0), B 1 pt (-2), E without matches.
		const past = (days: number) => new Date(Date.now() - days * DAY);
		s.match = {};
		s.match.AB = await insertMatch(pool, s.liga, s.team.A!, s.team.B!, 'programado', past(20));
		await finish(s.match.AB, 2, 0);
		s.match.BC = await insertMatch(pool, s.liga, s.team.B!, s.team.C!, 'programado', past(15));
		await finish(s.match.BC, 1, 1);
		s.match.CA = await insertMatch(pool, s.liga, s.team.C!, s.team.A!, 'programado', past(10));
		await finish(s.match.CA, 3, 1);
		s.match.AD = await insertMatch(pool, s.liga, s.team.A!, s.team.D!, 'programado', past(5));
		await finish(s.match.AD, 0, 0);
		// Not finished: its (already loaded) score must be ignored and hidden.
		s.match.BDlive = await insertMatch(pool, s.liga, s.team.B!, s.team.D!, 'en_curso', new Date(Date.now() - HOUR));
		await pool.query('UPDATE partido_equipo SET goles = 9 WHERE partido_id = ?', [s.match.BDlive]);
		s.match.CEcancel = await insertMatch(pool, s.liga, s.team.C!, s.team.E!, 'cancelado', new Date(Date.now() + 2 * DAY));
		s.match.DCsoon = (await post('/partidos', { competicionId: s.liga, localId: s.team.D, visitaId: s.team.C, jornada: 6, fechaHora: new Date(Math.floor((Date.now() + 3 * HOUR) / 1000) * 1000).toISOString(), sede: 'Matute' })).id;
		s.match.EAlater = (await post('/partidos', { competicionId: s.liga, localId: s.team.E, visitaId: s.team.A, jornada: 7, fechaHora: new Date(Math.floor((Date.now() + 9 * DAY) / 1000) * 1000).toISOString(), sede: 'Nacional' })).id;
		await insertDrawBet(app, pool, s.match.DCsoon);

		// Copa: X (3, +2, gf 3) before Y (3, +2, gf 2); zeros by name then id; W (gf 1) before V (gf 0).
		s.match.XW = await insertMatch(pool, s.copa, s.team.X!, s.team.W!, 'programado', past(3));
		await finish(s.match.XW, 3, 1);
		s.match.YV = await insertMatch(pool, s.copa, s.team.Y!, s.team.V!, 'programado', past(2));
		await finish(s.match.YV, 2, 0);

		s.match.PQ = await insertMatch(pool, s.ligaVoley, s.team.P!, s.team.Q!, 'programado', new Date(Date.now() + DAY));

		// Squad and goals.
		s.players = {};
		s.enrollments = {};
		for (const [key, nombre, equipo, numero] of [['ana', 'Ana Pérez', 'A', 9], ['bea', 'Bea Soto', 'A', 1], ['cris', 'Cris Ruiz', 'C', 10]] as const) {
			s.players[key] = (await post('/jugadores', { nombre, foto: key === 'ana' ? 'https://cdn.example.com/ana.jpg' : undefined })).id;
			s.enrollments[key] = (await post('/planteles', { jugadorId: s.players[key], equipoId: s.team[equipo], numeroCamiseta: numero })).id;
		}
		await insertGoal(pool, s.match.CA, s.team.C!, s.enrollments.cris!);
		await insertGoal(pool, s.match.CA, s.team.A!, s.enrollments.ana!);
		// Media as T-13 stores it: a server-made file name and a normalized video link.
		await pool.query('UPDATE gol SET minuto = 77, imagen = ? WHERE plantel_id = ?', [GOAL_IMAGE, s.enrollments.cris]);
		await pool.query('UPDATE gol SET minuto = 12, video = ? WHERE plantel_id = ?', ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', s.enrollments.ana]);
		await pool.query(
			'INSERT INTO multimedia_partido (partido_id, imagen, video, creado_en) VALUES (?, ?, NULL, UTC_TIMESTAMP()), (?, NULL, ?, UTC_TIMESTAMP()), (?, ?, NULL, UTC_TIMESTAMP())',
			[s.match.CA, MATCH_IMAGE, s.match.CA, 'https://vimeo.com/76979871', s.match.BDlive, LIVE_IMAGE],
		);
		// A goal already loaded on the live match: hidden until it's finished.
		const liveHome = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Delantero Boca' }));
		const liveEnrollment = await created<{ id: number }>(api.post('/planteles', { jugadorId: liveHome.id, equipoId: s.team.B, numeroCamiseta: 7 }));
		await insertGoal(pool, s.match.BDlive, s.team.B!, liveEnrollment.id);
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('deportes y competiciones (BR-048)', () => {
		it('lists every sport with permiteEmpate, by name', async () => {
			const res = await get('/deportes');

			expect(res.status).toBe(200);
			expect(res.body).toEqual({
				data: [
					{ id: s.futbol, nombre: 'Fútbol', slug: 'futbol', permiteEmpate: true },
					{ id: s.voley, nombre: 'Vóley', slug: 'voley', permiteEmpate: false },
				],
			});
		});

		it('lists competitions with their sport, filterable and paginated', async () => {
			const all = await get('/competiciones');
			expect(all.body.data).toMatchObject({ total: 3, page: 1 });
			expect(all.body.data.items[0]).toEqual({
				id: s.copa,
				nombre: 'Copa',
				slug: 'copa',
				deporte: { id: s.futbol, nombre: 'Fútbol', slug: 'futbol', permiteEmpate: true },
			});

			expect((await get(`/competiciones?deporteId=${s.voley}`)).body.data.items.map((c: { id: number }) => c.id)).toEqual([s.ligaVoley]);
			const page2 = await get('/competiciones?pageSize=2&page=2');
			expect(page2.body.data.items.map((c: { id: number }) => c.id)).toEqual([s.ligaVoley]);
			expect((await get(`/competiciones/${s.liga}`)).body.data).toMatchObject({ id: s.liga, nombre: 'Liga 1', deporte: { id: s.futbol } });
		});

		it('lists the teams of a competition, by name', async () => {
			const res = await get(`/competiciones/${s.liga}/equipos`);

			expect(res.body.data.map((t: { nombre: string }) => t.nombre)).toEqual(['Alianza', 'Boca', 'Cristal', 'Deportivo', 'Emelec']);
			expect(res.body.data[0]).toEqual({
				id: s.team.A,
				competicionId: s.liga,
				nombre: 'Alianza',
				nombreCorto: 'Alianz',
				escudo: 'escudos/A.webp',
				colorAcento: '#a50044',
			});
		});
	});

	describe('fixture (BR-049, BR-013)', () => {
		it('orders by proximity and shows everything needed to render a card', async () => {
			const res = await get(`/partidos?competicionId=${s.liga}`);

			expect(res.status).toBe(200);
			const items = res.body.data.items as Array<{ id: number; fechaHora: string }>;
			expect(items.map((m) => m.id)).toEqual([
				s.match.DCsoon,
				s.match.CEcancel,
				s.match.EAlater,
				s.match.BDlive,
				s.match.AD,
				s.match.CA,
				s.match.BC,
				s.match.AB,
			]);
			const sorted = [...items].map((m) => ({ id: m.id, fechaHora: new Date(m.fechaHora) })).sort((a, b) => compareByProximity(a, b, new Date()));
			expect(sorted.map((m) => m.id)).toEqual(items.map((m) => m.id));

			const soon = res.body.data.items[0];
			expect(soon).toEqual({
				id: s.match.DCsoon,
				competicion: { id: s.liga, nombre: 'Liga 1', slug: 'liga-1' },
				deporte: { id: s.futbol, nombre: 'Fútbol', slug: 'futbol', permiteEmpate: true },
				jornada: 6,
				fechaHora: expect.stringMatching(/Z$/),
				estado: 'programado',
				sede: 'Matute',
				local: { equipo: expect.objectContaining({ id: s.team.D, nombre: 'Deportivo', escudo: 'escudos/D.webp' }), goles: null },
				visita: { equipo: expect.objectContaining({ id: s.team.C, nombre: 'Cristal' }), goles: null },
				resultado: null,
			});
		});

		it('shows goals only for finished matches; cancelled ones stay listed with their state', async () => {
			const items = (await get(`/partidos?competicionId=${s.liga}`)).body.data.items as Array<{
				id: number;
				estado: string;
				local: { goles: number | null };
				visita: { goles: number | null };
			}>;
			const byId = new Map(items.map((m) => [m.id, m]));

			expect(byId.get(s.match.CA!)).toMatchObject({ estado: 'finalizado', resultado: 'local_gana', local: { goles: 3 }, visita: { goles: 1 } });
			expect(byId.get(s.match.BDlive!)).toMatchObject({ estado: 'en_curso', resultado: null, local: { goles: null }, visita: { goles: null } });
			expect(byId.get(s.match.CEcancel!)).toMatchObject({ estado: 'cancelado', local: { goles: null } });
		});

		it('filters by sport, team, state, jornada and dates, and pages', async () => {
			const ids = async (q: string) => (await get(`/partidos?${q}`)).body.data.items.map((m: { id: number }) => m.id);

			expect(await ids(`deporteId=${s.voley}`)).toEqual([s.match.PQ]);
			expect(await ids(`equipoId=${s.team.E}`)).toEqual([s.match.CEcancel, s.match.EAlater]);
			expect(await ids('estado=finalizado&competicionId=' + s.copa)).toEqual([s.match.YV, s.match.XW]);
			expect(await ids(`jornada=6`)).toEqual([s.match.DCsoon]);
			const desde = new Date(Math.floor((Date.now() + HOUR) / 1000) * 1000).toISOString();
			const hasta = new Date(Math.floor((Date.now() + 5 * DAY) / 1000) * 1000).toISOString();
			expect(await ids(`desde=${desde}&hasta=${hasta}`)).toEqual([s.match.DCsoon, s.match.PQ, s.match.CEcancel]);

			const page = await get(`/partidos?competicionId=${s.liga}&pageSize=3&page=2`);
			expect(page.body.data).toMatchObject({ page: 2, pageSize: 3, total: 8, totalPages: 3 });
			expect(page.body.data.items.map((m: { id: number }) => m.id)).toEqual([s.match.BDlive, s.match.AD, s.match.CA]);
		});

		it('match detail: goals with scorer, team, minute and media once finished, in minute order', async () => {
			const res = await get(`/partidos/${s.match.CA}`);

			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({ id: s.match.CA, estado: 'finalizado', local: { goles: 3 }, visita: { goles: 1 } });
			expect(res.body.data.goles).toEqual([
				{
					id: expect.any(Number),
					minuto: 12,
					equipoId: s.team.A,
					jugador: { id: s.players.ana, nombre: 'Ana Pérez', foto: 'https://cdn.example.com/ana.jpg' },
					imagen: null,
					video: {
						plataforma: 'youtube',
						id: 'dQw4w9WgXcQ',
						url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
						embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
					},
				},
				{
					id: expect.any(Number),
					minuto: 77,
					equipoId: s.team.C,
					jugador: { id: s.players.cris, nombre: 'Cris Ruiz', foto: null },
					imagen: `/public/archivos/${GOAL_IMAGE}`,
					video: null,
				},
			]);
			// T-13: the match's own images and videos, under the same rule.
			expect(res.body.data.multimedia).toEqual({
				imagenes: [{ id: expect.any(Number), tipo: 'imagen', url: `/public/archivos/${MATCH_IMAGE}`, creadoEn: expect.any(String) }],
				videos: [
					{
						id: expect.any(Number),
						tipo: 'video',
						creadoEn: expect.any(String),
						video: { plataforma: 'vimeo', id: '76979871', url: 'https://vimeo.com/76979871', embedUrl: 'https://player.vimeo.com/video/76979871' },
					},
				],
			});
		});

		it('match detail hides goals of a match that is not finished', async () => {
			const res = await get(`/partidos/${s.match.BDlive}`);

			expect(res.body.data).toMatchObject({ estado: 'en_curso', goles: null, multimedia: null, local: { goles: null }, visita: { goles: null } });
			expect(JSON.stringify(res.body)).not.toContain('Delantero Boca');
			expect(JSON.stringify(res.body)).not.toContain(LIVE_IMAGE);
		});
	});

	describe('posiciones (BR-050)', () => {
		const table = async (competitionId: number) =>
			(await get(`/competiciones/${competitionId}/posiciones`)).body.data as {
				competicion: { id: number };
				filas: Array<Record<string, unknown> & { equipo: { id: number; nombre: string } }>;
			};

		it('counts only finished matches, 3/1/0, with zeros for teams without matches', async () => {
			const data = await table(s.liga);

			expect(data.competicion).toMatchObject({ id: s.liga, nombre: 'Liga 1', deporte: { id: s.futbol } });
			const rows = data.filas.map(({ equipo, ...rest }) => ({ equipo: equipo.nombre, ...rest }));
			expect(rows).toEqual([
				{ posicion: 1, equipo: 'Cristal', jugados: 2, ganados: 1, empatados: 1, perdidos: 0, golesAFavor: 4, golesEnContra: 2, diferencia: 2, puntos: 4 },
				{ posicion: 2, equipo: 'Alianza', jugados: 3, ganados: 1, empatados: 1, perdidos: 1, golesAFavor: 3, golesEnContra: 3, diferencia: 0, puntos: 4 },
				{ posicion: 3, equipo: 'Deportivo', jugados: 1, ganados: 0, empatados: 1, perdidos: 0, golesAFavor: 0, golesEnContra: 0, diferencia: 0, puntos: 1 },
				{ posicion: 4, equipo: 'Boca', jugados: 2, ganados: 0, empatados: 1, perdidos: 1, golesAFavor: 1, golesEnContra: 3, diferencia: -2, puntos: 1 },
				{ posicion: 5, equipo: 'Emelec', jugados: 0, ganados: 0, empatados: 0, perdidos: 0, golesAFavor: 0, golesEnContra: 0, diferencia: 0, puntos: 0 },
			]);
			expect(data.filas[0]!.equipo).toEqual(expect.objectContaining({ id: s.team.C, escudo: 'escudos/C.webp', colorAcento: '#a50044' }));
		});

		it('breaks ties by goal difference, goals for, name (case-insensitive) and id', async () => {
			const data = await table(s.copa);

			expect(data.filas.map((f) => f.equipo.id)).toEqual([
				s.team.X, // 3 pts, +2, 3 gf
				s.team.Y, // 3 pts, +2, 2 gf
				s.team.alfa, // 0 pts, 0: by name
				s.team.beta,
				s.team.clon1, // same name: by id
				s.team.clon2,
				s.team.zeta,
				s.team.W, // 0 pts, -2, 1 gf
				s.team.V, // 0 pts, -2, 0 gf
			]);
			expect(s.team.clon1!).toBeLessThan(s.team.clon2!);
			expect(data.filas.map((f) => f.posicion)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		});

		it('a competition without teams has an empty table', async () => {
			const empty = await created<{ id: number }>(api.post('/competiciones', { deporteId: s.voley, nombre: 'Vacía' }));

			expect((await table(empty.id)).filas).toEqual([]);
			await api.del(`/competiciones/${empty.id}`);
		});

		it('a finished match with only one side loaded shows no score anywhere and does not count (T-08 follow-up)', async () => {
			const comp = await created<{ id: number }>(api.post('/competiciones', { deporteId: s.voley, nombre: 'A medias' }));
			const home = await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'Local medio' })));
			const away = await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'Visita media' })));
			const half = await insertMatch(pool, comp.id, home.id, away.id, 'finalizado', new Date(Date.now() - DAY));
			await pool.query('UPDATE partido_equipo SET goles = IF(es_visita, NULL, 4) WHERE partido_id = ?', [half]);
			try {
				const [fixture] = (await get(`/partidos?competicionId=${comp.id}`)).body.data.items;
				expect(fixture).toMatchObject({ id: half, estado: 'finalizado', local: { goles: null }, visita: { goles: null } });
				expect((await get(`/partidos?equipoId=${home.id}`)).body.data.items[0]).toMatchObject({ local: { goles: null } });

				const detail = (await get(`/partidos/${half}`)).body.data;
				expect(detail).toMatchObject({ estado: 'finalizado', goles: null, local: { goles: null }, visita: { goles: null } });

				expect((await table(comp.id)).filas.map((f) => [f.jugados, f.golesAFavor, f.puntos])).toEqual([[0, 0, 0], [0, 0, 0]]);

				// The other side missing instead: same answer.
				await pool.query('UPDATE partido_equipo SET goles = IF(es_visita, 4, NULL) WHERE partido_id = ?', [half]);
				expect((await get(`/partidos/${half}`)).body.data).toMatchObject({ goles: null, local: { goles: null }, visita: { goles: null } });
			} finally {
				await pool.query('DELETE FROM partido_equipo WHERE partido_id = ?', [half]);
				await pool.query('DELETE FROM partido WHERE id = ?', [half]);
				await api.del(`/equipos/${home.id}`);
				await api.del(`/equipos/${away.id}`);
				await api.del(`/competiciones/${comp.id}`);
			}
		});
	});

	describe('equipo', () => {
		it('by numeric id, with its competition, sport and squad by shirt number', async () => {
			const res = await get(`/equipos/${s.team.A}`);

			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({
				id: s.team.A,
				competicionId: s.liga,
				nombre: 'Alianza',
				nombreCorto: 'Alianz',
				escudo: 'escudos/A.webp',
				colorAcento: '#a50044',
				competicion: { id: s.liga, nombre: 'Liga 1', slug: 'liga-1' },
				deporte: { id: s.futbol, nombre: 'Fútbol', slug: 'futbol', permiteEmpate: true },
				plantel: [
					{ jugadorId: s.players.bea, nombre: 'Bea Soto', foto: null, numeroCamiseta: 1 },
					{ jugadorId: s.players.ana, nombre: 'Ana Pérez', foto: 'https://cdn.example.com/ana.jpg', numeroCamiseta: 9 },
				],
			});
			expect((await get(`/equipos/${s.team.E}`)).body.data.plantel).toEqual([]);
		});
	});

	describe('errors and validation', () => {
		it.each([
			['/competiciones/999999', 'COMPETITION_NOT_FOUND'],
			['/competiciones/999999/equipos', 'COMPETITION_NOT_FOUND'],
			['/competiciones/999999/posiciones', 'COMPETITION_NOT_FOUND'],
			['/partidos/999999', 'MATCH_NOT_FOUND'],
			['/equipos/999999', 'TEAM_NOT_FOUND'],
			['/no-existe', 'NOT_FOUND'],
		])('GET %s -> 404 %s, not cached', async (path, codeName) => {
			const res = await get(path);

			expect(res.status).toBe(404);
			expect(res.body.error.code).toBe(codeName);
			expect(res.headers['cache-control']).toBe('no-store');
		});

		it.each([
			['/deportes?x=1'],
			['/competiciones?rol=admin'],
			['/competiciones/1/posiciones?temporada=2026'],
			['/equipos/1?incluir=usuarios'],
			['/partidos?equipoId=abc'],
			['/partidos?jornada=0'],
			['/partidos?estado=suspendido'],
			['/partidos?desde=2026-01-01'],
			['/partidos?pageSize=101'],
			['/partidos/abc'],
			['/equipos/0'],
			['/competiciones/1e3'],
		])('GET %s -> 400', async (path) => {
			const res = await get(path);

			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
		});

		it('only GET: writes on /public are 404', async () => {
			expect((await request(app).post('/public/deportes').send({ nombre: 'X' })).status).toBe(404);
			expect((await request(app).delete(`/public/equipos/${s.team.A}`)).status).toBe(404);
		});
	});

	describe('privacy and sessions', () => {
		const PATHS = () => [
			'/deportes',
			'/competiciones',
			`/competiciones/${s.liga}`,
			`/competiciones/${s.liga}/equipos`,
			`/competiciones/${s.liga}/posiciones`,
			'/partidos',
			`/partidos/${s.match.CA}`,
			`/partidos/${s.match.DCsoon}`,
			`/equipos/${s.team.A}`,
		];

		it('no response has anything outside the public fields (no users, sessions, coins, bets or audit)', async () => {
			for (const path of PATHS()) {
				const res = await get(path);
				expect(res.status, path).toBe(200);
				const extra = [...keysOf(res.body)].filter((k) => !ALLOWED_KEYS.has(k));
				expect(extra, path).toEqual([]);
				expect(JSON.stringify(res.body), path).not.toMatch(/@liga\.test|argon2|csrf|saldo|apuesta|seleccion|movimiento|auditoria/i);
				expect(res.headers['set-cookie'], path).toBeUndefined();
			}
		});

		it('works without a session, and answers the same with one (admin or participant)', async () => {
			const admin = api.admin.cookie;
			const participant = (await signedInUser(app, pool, { estado: 'validado' })).cookie;
			for (const path of PATHS()) {
				const anonymous = await get(path);
				for (const cookie of [admin, participant]) {
					const withSession = await get(path).set('Cookie', cookie);
					expect(withSession.status, path).toBe(200);
					expect(withSession.body, path).toEqual(anonymous.body);
				}
			}
		});

		it('successes are publicly cacheable for 30 s; private routes never are', async () => {
			const ok = await get('/deportes');
			expect(ok.headers['cache-control']).toBe('public, max-age=30');

			expect((await request(app).get('/auth/me').set('Cookie', api.admin.cookie)).headers['cache-control']).toBe('no-store');
			expect((await request(app).get('/admin/deportes').set('Cookie', api.admin.cookie)).headers['cache-control']).toBe('no-store');
			expect((await request(app).get('/health')).headers['cache-control']).toBe('no-store');
		});

		it('CORS: the frontend origin is allowed, like the rest of the API', async () => {
			const res = await get('/deportes').set('Origin', env.corsOrigin);

			expect(res.headers['access-control-allow-origin']).toBe(env.corsOrigin);
		});
	});

	describe('rate limit', () => {
		it('has its own limit, and does not use up the global one', async () => {
			const limited = createTestApp({
				rateLimit: { ...env.rateLimit, max: 1 },
				publicRateLimit: { ...env.publicRateLimit, max: 3 },
			});
			try {
				for (let i = 0; i < 3; i++) expect((await request(limited.app).get('/public/deportes')).status).toBe(200);
				const blocked = await request(limited.app).get('/public/deportes');
				expect(blocked.status).toBe(429);
				expect(blocked.body.error.code).toBe('RATE_LIMITED');
				expect(blocked.headers['cache-control']).toBe('no-store');
				// The global budget (1) is still untouched.
				expect((await request(limited.app).get('/no-existe')).status).toBe(404);
				expect((await request(limited.app).get('/no-existe')).status).toBe(429);
			} finally {
				await limited.pool.end();
			}
		});

		it('defaults: roomier than the global limit', () => {
			const perMinute = (l: { windowMs: number; max: number }) => (l.max * 60_000) / l.windowMs;
			expect(perMinute(env.publicRateLimit)).toBeGreaterThan(perMinute(env.rateLimit));
		});
	});

	it('Informativo only: the public service and routes import nothing from Polla, Auditoría or accounts', () => {
		const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
		for (const file of ['services/public.service.ts', 'routes/public.route.ts', 'schemas/public.schema.ts']) {
			const code = readFileSync(resolve(src, file), 'utf8');
			const imports = [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
			for (const imported of imports) {
				expect(imported, `${file} imports ${imported}`).not.toMatch(/bets-|betting|coin|participant|admin-|auth|users|session|audit/);
			}
		}
	});
});
