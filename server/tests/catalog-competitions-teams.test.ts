import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import { type AdminApi, adminApi, created, insertGoal, insertMatch, sportCompetitionTeam, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

describe('admin: competiciones y equipos (BR-001, BR-011)', () => {
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
	const sport = (nombre = 'Fútbol') => created<{ id: number }>(api.post('/deportes', { nombre, permiteEmpate: true }));

	describe('competiciones', () => {
		it('CRUD, filtered by sport', async () => {
			const futbol = await sport();
			const voley = await sport('Vóley');
			const res = await api.post('/competiciones', { deporteId: futbol.id, nombre: 'Torneo Apertura 2026' });
			expect(res.status).toBe(201);
			expect(res.body.data).toEqual({ id: expect.any(Number), deporteId: futbol.id, deporteNombre: 'Fútbol', nombre: 'Torneo Apertura 2026', slug: 'torneo-apertura-2026' });
			const id = res.body.data.id as number;
			await created(api.post('/competiciones', { deporteId: voley.id, nombre: 'Liga Vóley' }));

			expect((await api.get(`/competiciones?deporteId=${futbol.id}`)).body.data.items.map((c: { id: number }) => c.id)).toEqual([id]);
			expect((await api.get('/competiciones?q=voley')).body.data.total).toBe(1);
			expect((await api.patch(`/competiciones/${id}`, { nombre: 'Apertura' })).body.data).toMatchObject({
				nombre: 'Apertura',
				slug: 'torneo-apertura-2026',
			});
			expect((await api.del(`/competiciones/${id}`)).status).toBe(200);
			expect(code(await api.get(`/competiciones/${id}`))).toBe('COMPETITION_NOT_FOUND');
		});

		it('slug is unique per sport, not globally', async () => {
			const futbol = await sport();
			const voley = await sport('Vóley');
			await created(api.post('/competiciones', { deporteId: futbol.id, nombre: 'Apertura' }));

			expect((await api.post('/competiciones', { deporteId: voley.id, nombre: 'Apertura' })).status).toBe(201);
			const dup = await api.post('/competiciones', { deporteId: futbol.id, nombre: 'Otra', slug: 'APERTURA' });
			expect(dup.status).toBe(409);
			expect(code(dup)).toBe('SLUG_TAKEN');
		});

		it('an unknown sport is 404 SPORT_NOT_FOUND, never a 500', async () => {
			expect(code(await api.post('/competiciones', { deporteId: 999999, nombre: 'Liga' }))).toBe('SPORT_NOT_FOUND');
			const futbol = await sport();
			const { id } = await created<{ id: number }>(api.post('/competiciones', { deporteId: futbol.id, nombre: 'Liga' }));
			const res = await api.patch(`/competiciones/${id}`, { deporteId: 999999 });
			expect(res.status).toBe(404);
			expect(code(res)).toBe('SPORT_NOT_FOUND');
		});

		it.each([
			['deporteId as a string', { deporteId: '1', nombre: 'Liga' }, 'deporteId'],
			['deporteId 0', { deporteId: 0, nombre: 'Liga' }, 'deporteId'],
			['missing nombre', { deporteId: 1 }, 'nombre'],
			['unknown field', { deporteId: 1, nombre: 'Liga', temporada: 2026 }, ''],
		])('create with %s -> 400', async (_label, body, path) => {
			const res = await api.post('/competiciones', body);

			expect(res.status).toBe(400);
			expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
		});

		it('moves to another sport only while it has no matches', async () => {
			const { sportId, competitionId, teamId } = await sportCompetitionTeam(api);
			const other = await sport('Futsal');
			expect((await api.patch(`/competiciones/${competitionId}`, { deporteId: other.id })).body.data.deporteId).toBe(other.id);

			const away = await created<{ id: number }>(api.post('/equipos', teamBody(competitionId, { nombre: 'Visita' })));
			await insertMatch(pool, competitionId, teamId, away.id);
			const res = await api.patch(`/competiciones/${competitionId}`, { deporteId: sportId });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'COMPETITION_IN_USE', details: { partidos: 1 } });
		});

		it('delete refuses teams, matches and enrollments, and says which', async () => {
			const { competitionId, teamId } = await sportCompetitionTeam(api);
			const away = await created<{ id: number }>(api.post('/equipos', teamBody(competitionId, { nombre: 'Visita' })));
			await insertMatch(pool, competitionId, teamId, away.id);
			const player = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Ana' }));
			await created(api.post('/planteles', { jugadorId: player.id, equipoId: teamId, numeroCamiseta: 9 }));

			const res = await api.del(`/competiciones/${competitionId}`);

			expect(res.status).toBe(409);
			expect(res.body.error).toEqual({
				code: 'COMPETITION_IN_USE',
				message: 'No se puede borrar la competición: tiene 2 equipos, 1 partido y 1 jugador inscrito.',
				details: { equipos: 2, partidos: 1, inscripciones: 1 },
			});
		});
	});

	describe('equipos', () => {
		it('CRUD with validated crest and color', async () => {
			const { competitionId } = await sportCompetitionTeam(api);
			const res = await api.post('/equipos', teamBody(competitionId, { nombre: 'Boca Juniors', escudo: 'https://cdn.example.com/boca.png' }));
			expect(res.status).toBe(201);
			expect(res.body.data).toEqual({
				id: expect.any(Number),
				competicionId: competitionId,
				competicionNombre: 'Apertura',
				deporteNombre: 'Fútbol',
				nombre: 'Boca Juniors',
				nombreCorto: 'Atlético',
				escudo: 'https://cdn.example.com/boca.png',
				colorAcento: '#a50044',
			});
			const id = res.body.data.id as number;

			const edited = await api.patch(`/equipos/${id}`, { colorAcento: '#0D4B9E', escudo: 'escudos/Boca_Juniors.avif' });
			expect(edited.body.data).toMatchObject({ colorAcento: '#0d4b9e', escudo: 'escudos/Boca_Juniors.avif', nombre: 'Boca Juniors' });
			expect((await api.del(`/equipos/${id}`)).status).toBe(200);
			expect(code(await api.get(`/equipos/${id}`))).toBe('TEAM_NOT_FOUND');
		});

		it('lists by competition, by sport and by name', async () => {
			const a = await sportCompetitionTeam(api, ' A');
			const b = await sportCompetitionTeam(api, ' B');
			const ids = async (q: string) => (await api.get(`/equipos?${q}`)).body.data.items.map((t: { id: number }) => t.id);

			expect(await ids(`competicionId=${a.competitionId}`)).toEqual([a.teamId]);
			expect(await ids(`deporteId=${b.sportId}`)).toEqual([b.teamId]);
			expect(await ids('q=club b')).toEqual([b.teamId]);
		});

		it.each([
			['http URL', { escudo: 'http://cdn.example.com/x.png' }, 'escudo'],
			['javascript URL', { escudo: 'javascript:alert(1)' }, 'escudo'],
			['path with ..', { escudo: 'escudos/../secreto.png' }, 'escudo'],
			['absolute path', { escudo: '/etc/escudo.png' }, 'escudo'],
			['no image extension', { escudo: 'escudos/boca.exe' }, 'escudo'],
			['too long', { escudo: `https://x.com/${'a'.repeat(250)}.png` }, 'escudo'],
			['color name', { colorAcento: 'red' }, 'colorAcento'],
			['short hex', { colorAcento: '#fff' }, 'colorAcento'],
			['long nombreCorto', { nombreCorto: 'x'.repeat(51) }, 'nombreCorto'],
			['competicionId as a string', { competicionId: '1' }, 'competicionId'],
		])('create with %s -> 400', async (_label, overrides, path) => {
			const { competitionId } = await sportCompetitionTeam(api);
			const res = await api.post('/equipos', teamBody(competitionId, overrides));

			expect(res.status).toBe(400);
			expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
		});

		it('an unknown competition is 404 COMPETITION_NOT_FOUND', async () => {
			expect(code(await api.post('/equipos', teamBody(999999)))).toBe('COMPETITION_NOT_FOUND');
		});

		it('changes competition only while nothing ties it to the current one', async () => {
			const a = await sportCompetitionTeam(api, ' A');
			const b = await sportCompetitionTeam(api, ' B');
			expect((await api.patch(`/equipos/${a.teamId}`, { competicionId: b.competitionId })).body.data.competicionId).toBe(b.competitionId);

			const player = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Ana' }));
			await created(api.post('/planteles', { jugadorId: player.id, equipoId: a.teamId, numeroCamiseta: 10 }));
			const res = await api.patch(`/equipos/${a.teamId}`, { competicionId: a.competitionId });

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'TEAM_IN_USE', details: { inscripciones: 1 } });
		});

		it('delete refuses a team with matches, enrollments or goals', async () => {
			const { competitionId, teamId } = await sportCompetitionTeam(api);
			const away = await created<{ id: number }>(api.post('/equipos', teamBody(competitionId, { nombre: 'Visita' })));
			const matchId = await insertMatch(pool, competitionId, teamId, away.id, 'finalizado');
			const player = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Ana' }));
			const enrollment = await created<{ id: number }>(api.post('/planteles', { jugadorId: player.id, equipoId: teamId, numeroCamiseta: 9 }));
			await insertGoal(pool, matchId, teamId, enrollment.id);

			const res = await api.del(`/equipos/${teamId}`);

			expect(res.status).toBe(409);
			expect(res.body.error).toEqual({
				code: 'TEAM_IN_USE',
				message: 'No se puede borrar el equipo: tiene 1 partido, 1 jugador inscrito y 1 gol.',
				details: { partidos: 1, inscripciones: 1, goles: 1 },
			});
			// A team with nothing attached can be deleted.
			expect((await api.del(`/equipos/${away.id}`)).body.error.code).toBe('TEAM_IN_USE');
			const free = await created<{ id: number }>(api.post('/equipos', teamBody(competitionId, { nombre: 'Libre' })));
			expect((await api.del(`/equipos/${free.id}`)).status).toBe(200);
		});
	});
});
