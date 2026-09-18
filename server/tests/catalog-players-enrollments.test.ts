import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import { type AdminApi, adminApi, created, insertGoal, insertMatch, sportCompetitionTeam, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

describe('admin: jugadores y planteles (BR-001, EsquemaBD D2/D4)', () => {
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
	const player = (nombre: string, foto?: string | null) =>
		created<{ id: number }>(api.post('/jugadores', foto === undefined ? { nombre } : { nombre, foto }));

	describe('jugadores', () => {
		it('CRUD, with an optional photo that null removes', async () => {
			const res = await api.post('/jugadores', { nombre: 'Lionel Messi', foto: 'https://cdn.example.com/messi.jpg' });
			expect(res.status).toBe(201);
			expect(res.body.data).toEqual({ id: expect.any(Number), nombre: 'Lionel Messi', foto: 'https://cdn.example.com/messi.jpg' });
			const id = res.body.data.id as number;

			expect((await api.patch(`/jugadores/${id}`, { nombre: 'Leo Messi' })).body.data.foto).toBe('https://cdn.example.com/messi.jpg');
			expect((await api.patch(`/jugadores/${id}`, { foto: null })).body.data).toEqual({ id, nombre: 'Leo Messi', foto: null });
			expect((await player('Sin foto')).id).toEqual(expect.any(Number));
			expect((await api.del(`/jugadores/${id}`)).status).toBe(200);
			expect(code(await api.get(`/jugadores/${id}`))).toBe('PLAYER_NOT_FOUND');
		});

		it('lists by name, team and competition', async () => {
			const a = await sportCompetitionTeam(api, ' A');
			const b = await sportCompetitionTeam(api, ' B');
			const ana = await player('Ana');
			const beto = await player('Beto');
			await player('Carla');
			await created(api.post('/planteles', { jugadorId: ana.id, equipoId: a.teamId, numeroCamiseta: 1 }));
			await created(api.post('/planteles', { jugadorId: beto.id, equipoId: b.teamId, numeroCamiseta: 1 }));
			const names = async (q: string) => (await api.get(`/jugadores?${q}`)).body.data.items.map((p: { nombre: string }) => p.nombre);

			expect(await names('')).toEqual(['Ana', 'Beto', 'Carla']);
			expect(await names('q=ar')).toEqual(['Carla']);
			expect(await names(`equipoId=${a.teamId}`)).toEqual(['Ana']);
			expect(await names(`competicionId=${b.competitionId}`)).toEqual(['Beto']);
		});

		it.each([
			['http photo', { nombre: 'X', foto: 'http://x.com/a.png' }, 'foto'],
			['non-image photo', { nombre: 'X', foto: 'fotos/a.txt' }, 'foto'],
			['blank name', { nombre: ' ' }, 'nombre'],
			['unknown field', { nombre: 'X', equipoId: 1 }, ''],
		])('create with %s -> 400', async (_label, body, path) => {
			const res = await api.post('/jugadores', body);

			expect(res.status).toBe(400);
			expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
		});

		it('delete refuses an enrolled player; after removing the enrollment it works', async () => {
			const { teamId } = await sportCompetitionTeam(api);
			const ana = await player('Ana');
			const enrollment = await created<{ id: number }>(api.post('/planteles', { jugadorId: ana.id, equipoId: teamId, numeroCamiseta: 7 }));

			const res = await api.del(`/jugadores/${ana.id}`);
			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'PLAYER_IN_USE', details: { inscripciones: 1 } });

			expect((await api.del(`/planteles/${enrollment.id}`)).status).toBe(200);
			expect((await api.del(`/jugadores/${ana.id}`)).status).toBe(200);
		});
	});

	describe('planteles', () => {
		it('enrolls a player; the competition comes from the team', async () => {
			const { competitionId, teamId } = await sportCompetitionTeam(api);
			const ana = await player('Ana');

			const res = await api.post('/planteles', { jugadorId: ana.id, equipoId: teamId, numeroCamiseta: 10 });

			expect(res.status).toBe(201);
			expect(res.body.data).toEqual({
				id: expect.any(Number),
				jugadorId: ana.id,
				jugadorNombre: 'Ana',
				equipoId: teamId,
				equipoNombre: 'Club',
				competicionId: competitionId,
				competicionNombre: 'Apertura',
				deporteNombre: 'Fútbol',
				numeroCamiseta: 10,
			});
			expect((await api.get(`/planteles?equipoId=${teamId}`)).body.data.total).toBe(1);
			expect((await api.get(`/planteles?jugadorId=${ana.id}&competicionId=${competitionId}`)).body.data.total).toBe(1);
			expect((await api.get(`/planteles/${res.body.data.id}`)).body.data).toEqual(res.body.data);
		});

		it('searches by player or team name (T-21), with % and _ taken literally, and rejects a long text', async () => {
			const a = await sportCompetitionTeam(api, ' Norte');
			const b = await sportCompetitionTeam(api, ' Sur');
			const ana = await player('Ana María');
			const beto = await player('Beto_1');
			await created(api.post('/planteles', { jugadorId: ana.id, equipoId: a.teamId, numeroCamiseta: 1 }));
			await created(api.post('/planteles', { jugadorId: beto.id, equipoId: b.teamId, numeroCamiseta: 2 }));
			const found = async (query: string) => {
				const res = await api.get(`/planteles?${query}`);
				expect(res.status, JSON.stringify(res.body)).toBe(200);
				return (res.body.data.items as Array<{ jugadorNombre: string }>).map((x) => x.jugadorNombre).sort();
			};

			expect(await found('q=mar')).toEqual(['Ana María']);
			expect(await found(`q=${encodeURIComponent('club sur')}`)).toEqual(['Beto_1']);
			expect(await found('q=club')).toEqual(['Ana María', 'Beto_1']);
			expect(await found(`q=club&equipoId=${a.teamId}`)).toEqual(['Ana María']);
			expect(await found('q=_')).toEqual(['Beto_1']);
			expect(await found('q=%25')).toEqual([]);
			expect((await api.get(`/planteles?q=${'x'.repeat(101)}`)).status).toBe(400);
		});

		it('a player only once per competition (another team of it: 409), but in another competition fine', async () => {
			const a = await sportCompetitionTeam(api, ' A');
			const b = await sportCompetitionTeam(api, ' B');
			const rival = await created<{ id: number }>(api.post('/equipos', teamBody(a.competitionId, { nombre: 'Rival' })));
			const ana = await player('Ana');
			await created(api.post('/planteles', { jugadorId: ana.id, equipoId: a.teamId, numeroCamiseta: 10 }));

			const again = await api.post('/planteles', { jugadorId: ana.id, equipoId: rival.id, numeroCamiseta: 11 });
			expect(again.status).toBe(409);
			expect(again.body.error).toMatchObject({ code: 'PLAYER_ALREADY_ENROLLED', details: { equipoId: a.teamId } });
			expect((await api.post('/planteles', { jugadorId: ana.id, equipoId: b.teamId, numeroCamiseta: 10 })).status).toBe(201);
		});

		it('a shirt number is unique within the team (UNIQUE equipo_id, numero_camiseta)', async () => {
			const { competitionId, teamId } = await sportCompetitionTeam(api);
			const rival = await created<{ id: number }>(api.post('/equipos', teamBody(competitionId, { nombre: 'Rival' })));
			const ana = await player('Ana');
			const beto = await player('Beto');
			await created(api.post('/planteles', { jugadorId: ana.id, equipoId: teamId, numeroCamiseta: 10 }));

			const clash = await api.post('/planteles', { jugadorId: beto.id, equipoId: teamId, numeroCamiseta: 10 });
			expect(clash.status).toBe(409);
			expect(clash.body.error).toMatchObject({ code: 'SHIRT_NUMBER_TAKEN', details: { jugadorId: ana.id } });
			// Same number in another team is fine.
			expect((await api.post('/planteles', { jugadorId: beto.id, equipoId: rival.id, numeroCamiseta: 10 })).status).toBe(201);
		});

		it('crossing competitions is rejected: 409 COMPETITION_MISMATCH', async () => {
			const a = await sportCompetitionTeam(api, ' A');
			const b = await sportCompetitionTeam(api, ' B');
			const ana = await player('Ana');

			const res = await api.post('/planteles', {
				jugadorId: ana.id,
				equipoId: a.teamId,
				competicionId: b.competitionId,
				numeroCamiseta: 9,
			});

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'COMPETITION_MISMATCH', details: { competicionDelEquipo: a.competitionId } });
			expect(
				(await api.post('/planteles', { jugadorId: ana.id, equipoId: a.teamId, competicionId: a.competitionId, numeroCamiseta: 9 })).status,
			).toBe(201);
		});

		it('unknown team or player: 404', async () => {
			const { teamId } = await sportCompetitionTeam(api);
			const ana = await player('Ana');

			expect(code(await api.post('/planteles', { jugadorId: ana.id, equipoId: 999999, numeroCamiseta: 1 }))).toBe('TEAM_NOT_FOUND');
			expect(code(await api.post('/planteles', { jugadorId: 999999, equipoId: teamId, numeroCamiseta: 1 }))).toBe('PLAYER_NOT_FOUND');
			expect(code(await api.get('/planteles/999999'))).toBe('ENROLLMENT_NOT_FOUND');
		});

		it.each([
			['shirt 0', { numeroCamiseta: 0 }, 'numeroCamiseta'],
			['shirt 100', { numeroCamiseta: 100 }, 'numeroCamiseta'],
			['shirt 7.5', { numeroCamiseta: 7.5 }, 'numeroCamiseta'],
			['shirt as a string', { numeroCamiseta: '7' }, 'numeroCamiseta'],
			['unknown field', { posicion: 'arquero' }, ''],
		])('create with %s -> 400', async (_label, overrides, path) => {
			const res = await api.post('/planteles', { jugadorId: 1, equipoId: 1, numeroCamiseta: 5, ...overrides });

			expect(res.status).toBe(400);
			expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
		});

		it('only the shirt number can change: no transfers (D4)', async () => {
			const { competitionId, teamId } = await sportCompetitionTeam(api);
			const rival = await created<{ id: number }>(api.post('/equipos', teamBody(competitionId, { nombre: 'Rival' })));
			const ana = await player('Ana');
			const beto = await player('Beto');
			const enrollment = await created<{ id: number }>(api.post('/planteles', { jugadorId: ana.id, equipoId: teamId, numeroCamiseta: 10 }));
			await created(api.post('/planteles', { jugadorId: beto.id, equipoId: teamId, numeroCamiseta: 5 }));

			expect((await api.patch(`/planteles/${enrollment.id}`, { numeroCamiseta: 8 })).body.data.numeroCamiseta).toBe(8);
			expect(code(await api.patch(`/planteles/${enrollment.id}`, { numeroCamiseta: 5 }))).toBe('SHIRT_NUMBER_TAKEN');
			expect(code(await api.patch(`/planteles/${enrollment.id}`, { equipoId: rival.id }))).toBe('TRANSFER_NOT_ALLOWED');
			expect(code(await api.patch(`/planteles/${enrollment.id}`, { jugadorId: beto.id }))).toBe('TRANSFER_NOT_ALLOWED');
			// Sending the same team is not a transfer.
			expect((await api.patch(`/planteles/${enrollment.id}`, { equipoId: teamId, numeroCamiseta: 11 })).status).toBe(200);
			expect((await api.get(`/planteles/${enrollment.id}`)).body.data).toMatchObject({ equipoId: teamId, numeroCamiseta: 11 });
		});

		it('delete refuses an enrollment with goals', async () => {
			const { competitionId, teamId } = await sportCompetitionTeam(api);
			const away = await created<{ id: number }>(api.post('/equipos', teamBody(competitionId, { nombre: 'Visita' })));
			const matchId = await insertMatch(pool, competitionId, teamId, away.id, 'finalizado');
			const ana = await player('Ana');
			const enrollment = await created<{ id: number }>(api.post('/planteles', { jugadorId: ana.id, equipoId: teamId, numeroCamiseta: 9 }));
			await insertGoal(pool, matchId, teamId, enrollment.id);

			const res = await api.del(`/planteles/${enrollment.id}`);

			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'ENROLLMENT_IN_USE', details: { goles: 1 } });
			expect((await api.del(`/jugadores/${ana.id}`)).body.error).toMatchObject({
				code: 'PLAYER_IN_USE',
				details: { inscripciones: 1, goles: 1 },
			});
		});
	});
});
