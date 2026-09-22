import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import { type AdminApi, adminApi, created, insertDrawBet, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

describe('admin: deportes (BR-001, BR-011, BR-015, BR-048)', () => {
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

	describe('CRUD', () => {
		it('creates, reads, lists, edits and deletes', async () => {
			const res = await api.post('/deportes', { nombre: '  Fútbol  ', permiteEmpate: true });
			expect(res.status).toBe(201);
			expect(res.body).toEqual({ data: { id: expect.any(Number), nombre: 'Fútbol', slug: 'futbol', permiteEmpate: true } });
			const id = res.body.data.id as number;

			expect((await api.get(`/deportes/${id}`)).body.data).toEqual(res.body.data);

			await created(api.post('/deportes', { nombre: 'Vóley', permiteEmpate: false }));
			const list = await api.get('/deportes');
			expect(list.body.data).toMatchObject({ page: 1, pageSize: 20, total: 2, totalPages: 1 });
			expect(list.body.data.items.map((d: { nombre: string }) => d.nombre)).toEqual(['Fútbol', 'Vóley']);

			const edited = await api.patch(`/deportes/${id}`, { nombre: 'Fútbol 11' });
			expect(edited.status).toBe(200);
			// Renaming keeps the slug.
			expect(edited.body.data).toMatchObject({ nombre: 'Fútbol 11', slug: 'futbol', permiteEmpate: true });

			const removed = await api.del(`/deportes/${id}`);
			expect(removed.status).toBe(200);
			expect(removed.body).toEqual({ data: { id } });
			expect(code(await api.get(`/deportes/${id}`))).toBe('SPORT_NOT_FOUND');
		});

		it('filters by name/slug and by permiteEmpate, and pages', async () => {
			for (const [nombre, permiteEmpate] of [['Fútbol', true], ['Básquet', false], ['Vóley', false], ['Futsal', true]] as const) {
				await created(api.post('/deportes', { nombre, permiteEmpate }));
			}
			const names = async (q: string) => (await api.get(`/deportes?${q}`)).body.data.items.map((d: { nombre: string }) => d.nombre);

			expect(await names('q=fut')).toEqual(['Fútbol', 'Futsal']);
			expect(await names('permiteEmpate=false')).toEqual(['Básquet', 'Vóley']);
			expect(await names('pageSize=2&page=2')).toEqual(['Futsal', 'Vóley']);
		});

		it.each([
			['missing nombre', { permiteEmpate: true }, 'nombre'],
			['blank nombre', { nombre: '   ', permiteEmpate: true }, 'nombre'],
			['long nombre', { nombre: 'x'.repeat(101), permiteEmpate: true }, 'nombre'],
			['missing permiteEmpate', { nombre: 'Rugby' }, 'permiteEmpate'],
			['string permiteEmpate', { nombre: 'Rugby', permiteEmpate: 'true' }, 'permiteEmpate'],
			['unknown field', { nombre: 'Rugby', permiteEmpate: true, id: 5 }, ''],
		])('create with %s -> 400', async (_label, body, path) => {
			const res = await api.post('/deportes', body);

			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
			expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
		});

		it('an empty PATCH is a 400', async () => {
			const { id } = await created<{ id: number }>(api.post('/deportes', { nombre: 'Rugby', permiteEmpate: true }));

			expect((await api.patch(`/deportes/${id}`, {})).status).toBe(400);
		});

		it('unknown ids: 404 SPORT_NOT_FOUND on read, edit and delete', async () => {
			expect(code(await api.get('/deportes/999999'))).toBe('SPORT_NOT_FOUND');
			expect(code(await api.patch('/deportes/999999', { nombre: 'X' }))).toBe('SPORT_NOT_FOUND');
			expect(code(await api.del('/deportes/999999'))).toBe('SPORT_NOT_FOUND');
		});
	});

	describe('slugs', () => {
		it('generates, normalizes and keeps them unique', async () => {
			expect((await created(api.post('/deportes', { nombre: 'Fútbol 5 – Salón', permiteEmpate: true }))).slug).toBe('futbol-5-salon');
			expect((await created(api.post('/deportes', { nombre: 'Otro', slug: '  Ñandú  Básquet!! ', permiteEmpate: false }))).slug).toBe(
				'nandu-basquet',
			);

			const dup = await api.post('/deportes', { nombre: 'Fútbol 5 salón', permiteEmpate: true });
			expect(dup.status).toBe(409);
			expect(dup.body).toEqual({ error: { code: 'SLUG_TAKEN', message: expect.any(String) } });

			const other = await created<{ id: number }>(api.post('/deportes', { nombre: 'Tenis', permiteEmpate: false }));
			expect(code(await api.patch(`/deportes/${other.id}`, { slug: 'futbol-5-salon' }))).toBe('SLUG_TAKEN');
			expect((await api.patch(`/deportes/${other.id}`, { slug: 'Tenis de Mesa' })).body.data.slug).toBe('tenis-de-mesa');
		});

		it('rejects a name or slug with no letters or digits', async () => {
			// A name with letters but none a slug can keep: the derived slug is empty.
			for (const body of [{ nombre: '漢字', permiteEmpate: true }, { nombre: 'Golf', slug: '---', permiteEmpate: true }]) {
				const res = await api.post('/deportes', body);
				expect(res.status).toBe(400);
				expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'slug' })]);
			}
			// Since the T-08 follow-up, a name without letters or digits is rejected on its own.
			const signs = await api.post('/deportes', { nombre: '¡¡!!', permiteEmpate: true });
			expect(signs.status).toBe(400);
			expect(signs.body.error.details).toEqual([expect.objectContaining({ path: 'nombre' })]);
		});
	});

	describe('permite_empate (BR-015)', () => {
		async function sportWithMatch(estado: 'programado' | 'en_curso' | 'finalizado' | 'cancelado' = 'programado') {
			const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
			const competition = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Liga' }));
			const home = await created<{ id: number }>(api.post('/equipos', teamBody(competition.id, { nombre: 'Local' })));
			const away = await created<{ id: number }>(api.post('/equipos', teamBody(competition.id, { nombre: 'Visita' })));
			const matchId = await insertMatch(pool, competition.id, home.id, away.id, estado);
			return { sportId: sport.id, matchId };
		}

		it('can change while every match is programado and nobody bet', async () => {
			const { sportId } = await sportWithMatch();

			const res = await api.patch(`/deportes/${sportId}`, { permiteEmpate: false });

			expect(res.status).toBe(200);
			expect(res.body.data.permiteEmpate).toBe(false);
		});

		it.each(['en_curso', 'finalizado', 'cancelado'] as const)('is locked once a match is %s', async (estado) => {
			const { sportId } = await sportWithMatch(estado);

			const res = await api.patch(`/deportes/${sportId}`, { permiteEmpate: false, nombre: 'Otro nombre' });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'DRAW_RULE_LOCKED', details: { motivos: [expect.stringMatching(/partido/)] } });
			// Nothing of the PATCH applied.
			expect((await api.get(`/deportes/${sportId}`)).body.data).toMatchObject({ nombre: 'Fútbol', permiteEmpate: true });
		});

		it('is locked when a programado match already has bets (Polla guard)', async () => {
			const { sportId, matchId } = await sportWithMatch();
			await insertDrawBet(app, pool, matchId);

			const res = await api.patch(`/deportes/${sportId}`, { permiteEmpate: false });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'DRAW_RULE_LOCKED', details: { motivos: ['sus partidos tienen 1 apuesta'] } });
		});

		it('other fields still change on a locked sport, and sending the same value is fine', async () => {
			const { sportId } = await sportWithMatch('finalizado');

			const res = await api.patch(`/deportes/${sportId}`, { nombre: 'Fútbol 11', permiteEmpate: true });

			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({ nombre: 'Fútbol 11', permiteEmpate: true });
		});
	});

	describe('delete', () => {
		it('refuses a sport with competitions: 409 SPORT_IN_USE with the count', async () => {
			const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
			await created(api.post('/competiciones', { deporteId: sport.id, nombre: 'Apertura' }));
			await created(api.post('/competiciones', { deporteId: sport.id, nombre: 'Clausura' }));

			const res = await api.del(`/deportes/${sport.id}`);

			expect(res.status).toBe(409);
			expect(res.body.error).toEqual({
				code: 'SPORT_IN_USE',
				message: 'No se puede borrar el deporte: tiene 2 competiciones.',
				details: { competiciones: 2 },
			});
			expect((await api.get(`/deportes/${sport.id}`)).status).toBe(200);
		});
	});
});
