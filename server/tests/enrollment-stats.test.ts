import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { translateDbError } from '../src/lib/db-errors.js';
import { createTestApp } from './helpers/app.js';
import { type AdminApi, adminApi, created, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

/**
 * C-05 (D-034): a player's statistics per enrollment, with the attribute set
 * of the sport's profile (football: 6, volleyball: 5), each 0 to 99, the whole
 * set or nothing.
 */

const FUTBOL = { disparo: 80, pase: 75, fuerza: 60, defensa: 0, velocidad: 99, dribbling: 88 };
const VOLEY = { mate: 90, saque: 70, recepcion: 65, armado: 50, bloqueo: 40 };

const FUTBOL_PROFILE = {
	codigo: 'futbol',
	nombre: 'Fútbol',
	atributos: [
		{ codigo: 'disparo', nombre: 'Disparo' },
		{ codigo: 'pase', nombre: 'Pase' },
		{ codigo: 'fuerza', nombre: 'Fuerza' },
		{ codigo: 'defensa', nombre: 'Defensa' },
		{ codigo: 'velocidad', nombre: 'Velocidad' },
		{ codigo: 'dribbling', nombre: 'Dribbling' },
	],
};

describe('player statistics per enrollment (C-05, D-034)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		api = await adminApi(app, pool);
	});

	afterAll(async () => {
		await pool.end();
	});

	const code = (res: { body: { error?: { code: string } } }) => res.body.error?.code;
	const paths = (res: { body: { error?: { details?: Array<{ path: string }> } } }) => (res.body.error?.details ?? []).map((d) => d.path).sort();

	/** Sport (with that profile) → competition → team → player → enrollment. */
	async function enrollment(perfilEstadistico: string | null, suffix = '') {
		const sport = await created<{ id: number }>(api.post('/deportes', { nombre: `Deporte${suffix}`, permiteEmpate: true, perfilEstadistico }));
		const competition = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: `Torneo${suffix}` }));
		const team = await created<{ id: number }>(api.post('/equipos', teamBody(competition.id, { nombre: `Club${suffix}` })));
		const player = await created<{ id: number }>(api.post('/jugadores', { nombre: `Ana${suffix}` }));
		const plantel = await created<{ id: number }>(api.post('/planteles', { jugadorId: player.id, equipoId: team.id, numeroCamiseta: 9 }));
		return { sportId: sport.id, teamId: team.id, playerId: player.id, id: plantel.id };
	}

	const auditCount = async () => Number(((await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM auditoria'))[0][0] as RowDataPacket).n);
	const stored = async (plantelId: number) =>
		Number(((await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM plantel_estadistica WHERE plantel_id = ?', [plantelId]))[0][0] as RowDataPacket).n);

	describe('a sport chooses its profile', () => {
		it('by codigo on create and edit; the lists and the read give it back', async () => {
			const res = await api.post('/deportes', { nombre: 'Fútbol femenino', permiteEmpate: true, perfilEstadistico: 'futbol' });
			expect(res.status).toBe(201);
			expect(res.body.data).toMatchObject({ perfilEstadistico: 'futbol', perfilEstadisticoNombre: 'Fútbol' });
			const id = res.body.data.id as number;

			expect((await api.patch(`/deportes/${id}`, { perfilEstadistico: 'voley' })).body.data).toMatchObject({ perfilEstadistico: 'voley', perfilEstadisticoNombre: 'Vóley' });
			expect((await api.get(`/deportes/${id}`)).body.data.perfilEstadistico).toBe('voley');
			expect((await api.patch(`/deportes/${id}`, { perfilEstadistico: null })).body.data).toMatchObject({ perfilEstadistico: null, perfilEstadisticoNombre: null });
			expect((await api.get('/deportes')).body.data.items[0]).toMatchObject({ id, perfilEstadistico: null });
			// Without the field, a new sport has none.
			expect((await created(api.post('/deportes', { nombre: 'Ajedrez', permiteEmpate: true }))).perfilEstadistico).toBeNull();
		});

		it.each([
			['an unknown profile', 'rugby'],
			['a name instead of a code', 'Fútbol'],
			['a number', 1],
			['an empty text', ''],
		])('%s is a 400 on perfilEstadistico', async (_label, perfilEstadistico) => {
			const res = await api.post('/deportes', { nombre: 'X', permiteEmpate: true, perfilEstadistico });

			expect(res.status).toBe(400);
			expect(paths(res)).toEqual(['perfilEstadistico']);
			expect((await api.get('/deportes')).body.data.total).toBe(0);
		});

		it('the profile does not change while any of its enrollments has statistics (409 STATS_PROFILE_LOCKED)', async () => {
			const e = await enrollment('futbol');
			await api.put(`/planteles/${e.id}/estadisticas`, { valores: FUTBOL });

			const res = await api.patch(`/deportes/${e.sportId}`, { perfilEstadistico: 'voley' });
			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'STATS_PROFILE_LOCKED', details: { inscripcionesConEstadisticas: 1 } });
			expect(code(await api.patch(`/deportes/${e.sportId}`, { perfilEstadistico: null }))).toBe('STATS_PROFILE_LOCKED');
			expect((await api.get(`/deportes/${e.sportId}`)).body.data.perfilEstadistico).toBe('futbol');

			// The same profile, or another field, is not a change of profile.
			expect((await api.patch(`/deportes/${e.sportId}`, { nombre: 'Fútbol 7', perfilEstadistico: 'futbol' })).status).toBe(200);

			await api.del(`/planteles/${e.id}/estadisticas`);
			expect((await api.patch(`/deportes/${e.sportId}`, { perfilEstadistico: 'voley' })).body.data.perfilEstadistico).toBe('voley');
		});
	});

	describe('GET /admin/planteles/:id/estadisticas', () => {
		it('says the profile and that nothing is loaded yet', async () => {
			const e = await enrollment('futbol');

			const res = await api.get(`/planteles/${e.id}/estadisticas`);
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({ plantelId: e.id, perfil: FUTBOL_PROFILE, valores: null });
		});

		it('a sport without a profile has neither', async () => {
			const e = await enrollment(null);

			expect((await api.get(`/planteles/${e.id}/estadisticas`)).body.data).toEqual({ plantelId: e.id, perfil: null, valores: null });
		});

		it('404 for a missing enrollment, 400 for an id that isn\'t one or a query string, and only for an admin', async () => {
			expect(code(await api.get('/planteles/999999/estadisticas'))).toBe('ENROLLMENT_NOT_FOUND');
			expect((await api.get('/planteles/abc/estadisticas')).status).toBe(400);
			const e = await enrollment('futbol');
			expect((await api.get(`/planteles/${e.id}/estadisticas?x=1`)).status).toBe(400);
			expect((await request(app).get(`/admin/planteles/${e.id}/estadisticas`)).status).toBe(401);
		});
	});

	describe('PUT /admin/planteles/:id/estadisticas', () => {
		it('stores the whole set, in the profile order, and the list says the enrollment has them', async () => {
			const e = await enrollment('futbol');
			const shuffled = Object.fromEntries(Object.entries(FUTBOL).reverse());

			const res = await api.put(`/planteles/${e.id}/estadisticas`, { valores: shuffled });
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({ plantelId: e.id, perfil: FUTBOL_PROFILE, valores: FUTBOL });
			expect(Object.keys(res.body.data.valores)).toEqual(FUTBOL_PROFILE.atributos.map((a) => a.codigo));
			expect((await api.get(`/planteles/${e.id}/estadisticas`)).body.data.valores).toEqual(FUTBOL);
			expect((await api.get(`/planteles?equipoId=${e.teamId}`)).body.data.items[0].tieneEstadisticas).toBe(true);
			expect((await api.get(`/planteles/${e.id}`)).body.data.tieneEstadisticas).toBe(true);

			// Replacing it.
			const again = await api.put(`/planteles/${e.id}/estadisticas`, { valores: { ...FUTBOL, pase: 1 } });
			expect(again.body.data.valores).toEqual({ ...FUTBOL, pase: 1 });
			expect(await stored(e.id)).toBe(6);
		});

		it('volleyball takes its five attributes', async () => {
			const e = await enrollment('voley');

			const res = await api.put(`/planteles/${e.id}/estadisticas`, { valores: VOLEY });
			expect(res.status).toBe(200);
			expect(res.body.data.perfil.atributos.map((a: { nombre: string }) => a.nombre)).toEqual(['Mate', 'Saque', 'Recepción', 'Armado', 'Bloqueo']);
			expect(res.body.data.valores).toEqual(VOLEY);
		});

		it.each([
			['a missing attribute', { disparo: 1, pase: 1, fuerza: 1, defensa: 1, velocidad: 1 }, ['valores.dribbling']],
			['an attribute of another profile', { ...FUTBOL, mate: 50 }, ['valores.mate']],
			['a code no profile has', { ...FUTBOL, xyz: 50 }, ['valores.xyz']],
			['the other sport\'s whole set', VOLEY, ['valores.armado', 'valores.bloqueo', 'valores.defensa', 'valores.disparo', 'valores.dribbling', 'valores.fuerza', 'valores.mate', 'valores.pase', 'valores.recepcion', 'valores.saque', 'valores.velocidad']],
			['a decimal', { ...FUTBOL, pase: 50.5 }, ['valores.pase']],
			['100', { ...FUTBOL, pase: 100 }, ['valores.pase']],
			['a negative value', { ...FUTBOL, pase: -1 }, ['valores.pase']],
			['a number as text', { ...FUTBOL, pase: '80' }, ['valores.pase']],
			['null as a value', { ...FUTBOL, pase: null }, ['valores.pase']],
			['nothing at all', {}, ['valores.defensa', 'valores.disparo', 'valores.dribbling', 'valores.fuerza', 'valores.pase', 'valores.velocidad']],
		])('%s -> 400, and nothing is written', async (_label, valores, expected) => {
			const e = await enrollment('futbol');

			const res = await api.put(`/planteles/${e.id}/estadisticas`, { valores });
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
			expect(paths(res)).toEqual(expected);
			expect(await stored(e.id)).toBe(0);
		});

		it.each([
			['no valores', {}],
			['valores as a list', { valores: [80, 75] }],
			['an unknown field', { valores: FUTBOL, perfil: 'futbol' }],
			['more than 20 codes', { valores: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`a${i}`, 1])) }],
		])('a malformed body (%s) -> 400', async (_label, body) => {
			const e = await enrollment('futbol');

			const res = await api.put(`/planteles/${e.id}/estadisticas`, body);
			expect(res.status).toBe(400);
			expect(await stored(e.id)).toBe(0);
		});

		it('a sport without a profile takes none: 409 SPORT_WITHOUT_STATS', async () => {
			const e = await enrollment(null);

			const res = await api.put(`/planteles/${e.id}/estadisticas`, { valores: FUTBOL });
			expect(res.status).toBe(409);
			expect(code(res)).toBe('SPORT_WITHOUT_STATS');
			expect(await stored(e.id)).toBe(0);
		});

		it('404 for a missing enrollment', async () => {
			expect(code(await api.put('/planteles/999999/estadisticas', { valores: FUTBOL }))).toBe('ENROLLMENT_NOT_FOUND');
		});

		it('the same set again changes nothing and is not audited (D-004)', async () => {
			const e = await enrollment('futbol');
			await api.put(`/planteles/${e.id}/estadisticas`, { valores: FUTBOL });
			const records = await auditCount();

			const res = await api.put(`/planteles/${e.id}/estadisticas`, { valores: Object.fromEntries(Object.entries(FUTBOL).reverse()) });
			expect(res.status).toBe(200);
			expect(res.body.data.valores).toEqual(FUTBOL);
			expect(await auditCount()).toBe(records);
		});

		it('the database refuses a value outside 0-99 on its own (CHECK), as a 400', async () => {
			const e = await enrollment('futbol');
			const error = await pool
				.query("INSERT INTO plantel_estadistica (plantel_id, estadistica_id, valor) SELECT ?, id, 100 FROM estadistica WHERE codigo = 'pase'", [e.id])
				.then(() => null, (err: unknown) => err);

			expect(translateDbError(error)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
		});
	});

	describe('DELETE /admin/planteles/:id/estadisticas', () => {
		it('removes the whole set; with nothing loaded it answers the same and records nothing', async () => {
			const e = await enrollment('futbol');
			await api.put(`/planteles/${e.id}/estadisticas`, { valores: FUTBOL });

			const res = await api.del(`/planteles/${e.id}/estadisticas`);
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({ plantelId: e.id, perfil: FUTBOL_PROFILE, valores: null });
			expect(await stored(e.id)).toBe(0);
			expect((await api.get(`/planteles/${e.id}`)).body.data.tieneEstadisticas).toBe(false);

			const records = await auditCount();
			expect((await api.del(`/planteles/${e.id}/estadisticas`)).status).toBe(200);
			expect(await auditCount()).toBe(records);
			expect(code(await api.del('/planteles/999999/estadisticas'))).toBe('ENROLLMENT_NOT_FOUND');
		});
	});

	describe('no cascade', () => {
		it('an enrollment with statistics is not deleted until they are removed (409 ENROLLMENT_IN_USE)', async () => {
			const e = await enrollment('futbol');
			await api.put(`/planteles/${e.id}/estadisticas`, { valores: FUTBOL });

			const res = await api.del(`/planteles/${e.id}`);
			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'ENROLLMENT_IN_USE', details: { estadisticas: 6 } });
			expect(res.body.error.message).toMatch(/estadísticas/);

			await api.del(`/planteles/${e.id}/estadisticas`);
			expect((await api.del(`/planteles/${e.id}`)).status).toBe(200);
		});

		it('the foreign key catches it too, without the check (lib/db-errors.ts)', async () => {
			const e = await enrollment('futbol');
			await api.put(`/planteles/${e.id}/estadisticas`, { valores: FUTBOL });
			const error = await pool.query('DELETE FROM plantel WHERE id = ?', [e.id]).then(() => null, (err: unknown) => err);

			expect(translateDbError(error)).toMatchObject({ status: 409, code: 'ENROLLMENT_IN_USE' });
		});
	});

	describe('public team page', () => {
		it('carries the profile and each player\'s values, null for those without', async () => {
			const e = await enrollment('futbol');
			const other = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Bea' }));
			await created(api.post('/planteles', { jugadorId: other.id, equipoId: e.teamId, numeroCamiseta: 3 }));
			await api.put(`/planteles/${e.id}/estadisticas`, { valores: FUTBOL });

			const res = await request(app).get(`/public/equipos/${e.teamId}`);
			expect(res.status).toBe(200);
			expect(res.body.data.deporte.perfilEstadistico).toEqual(FUTBOL_PROFILE);
			expect(res.body.data.plantel.map((p: { nombre: string; estadisticas: unknown }) => [p.nombre, p.estadisticas])).toEqual([
				['Bea', null],
				['Ana', FUTBOL],
			]);
		});

		it('a sport without a profile: null profile and no values', async () => {
			const e = await enrollment(null);

			const res = await request(app).get(`/public/equipos/${e.teamId}`);
			expect(res.body.data.deporte.perfilEstadistico).toBeNull();
			expect(res.body.data.plantel[0].estadisticas).toBeNull();
		});
	});
});
