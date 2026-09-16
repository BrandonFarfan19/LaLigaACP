import express, { type Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { withTransaction } from '../src/db/transaction.js';
import { translateDbError } from '../src/lib/db-errors.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import type { AdminActionOutcome } from '../src/services/admin-action.js';
import { createSport, deleteSport, updateSport } from '../src/services/sports.service.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, sportCompetitionTeam } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const RESOURCES = ['deportes', 'competiciones', 'equipos', 'jugadores', 'planteles'];

describe('sports catalog: access, strict input, MySQL errors and audit hook', () => {
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

	describe('access', () => {
		it.each(RESOURCES)('/admin/%s: 401 without a session on every method', async (resource) => {
			for (const req of [
				request(app).get(`/admin/${resource}`),
				request(app).get(`/admin/${resource}/1`),
				request(app).post(`/admin/${resource}`).send({}),
				request(app).patch(`/admin/${resource}/1`).send({}),
				request(app).delete(`/admin/${resource}/1`),
			]) {
				const res = await req;
				expect(res.status).toBe(401);
				expect(res.body.error.code).toBe('UNAUTHENTICATED');
			}
		});

		it.each(RESOURCES)('/admin/%s: 403 for an apostador, even validated', async (resource) => {
			const user = await signedInUser(app, pool, { estado: 'validado' });
			const withUser = (req: request.Test) => req.set('Cookie', user.cookie).set('X-CSRF-Token', user.csrfToken);

			for (const req of [
				withUser(request(app).get(`/admin/${resource}`)),
				withUser(request(app).post(`/admin/${resource}`)).send({}),
				withUser(request(app).patch(`/admin/${resource}/1`)).send({}),
				withUser(request(app).delete(`/admin/${resource}/1`)),
			]) {
				const res = await req;
				expect(res.status).toBe(403);
				expect(res.body.error.code).toBe('FORBIDDEN');
			}
		});

		it('writes need the CSRF token, and nothing changes without it', async () => {
			const noToken = (req: request.Test) => req.set('Cookie', api.admin.cookie);
			const { sportId } = await sportCompetitionTeam(api);

			for (const req of [
				noToken(request(app).post('/admin/deportes')).send({ nombre: 'Rugby', permiteEmpate: true }),
				noToken(request(app).patch(`/admin/deportes/${sportId}`)).send({ nombre: 'Cambiado' }),
				noToken(request(app).delete(`/admin/deportes/${sportId}`)),
			]) {
				const res = await req;
				expect(res.status).toBe(403);
				expect(res.body.error.code).toBe('CSRF_FAILED');
			}
			expect((await api.get('/deportes')).body.data.items).toEqual([expect.objectContaining({ nombre: 'Fútbol' })]);
		});
	});

	describe('strict query and ids', () => {
		it.each([
			['/deportes?rol=admin', 'rol'],
			['/competiciones?deporte=1', 'deporte'],
			['/equipos?competicionId=abc', 'competicionId'],
			['/jugadores?equipoId=0', 'equipoId'],
			['/planteles?jugadorId=1e3', 'jugadorId'],
			['/deportes?permiteEmpate=si', 'permiteEmpate'],
			['/equipos?pageSize=101', 'pageSize'],
			['/deportes/1?x=1', ''],
		])('GET %s -> 400', async (path, field) => {
			const res = await api.get(path);

			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
			expect(JSON.stringify(res.body.error.details)).toContain(field);
		});

		it.each(RESOURCES)('/admin/%s: writes with a query string or a bad id are 400', async (resource) => {
			expect((await api.post(`/${resource}?x=1`, {})).status).toBe(400);
			for (const id of ['abc', '0', '-1', '1.5']) {
				expect((await api.patch(`/${resource}/${id}`, { nombre: 'X' })).status).toBe(400);
				expect((await api.del(`/${resource}/${id}`)).status).toBe(400);
			}
		});
	});

	describe('MySQL errors are translated in one place (lib/db-errors.ts)', () => {
		/** Runs raw SQL on the test database and returns the MySQL error it raises. */
		async function mysqlError(sql: string, params: unknown[] = []): Promise<unknown> {
			try {
				await pool.query(sql, params);
			} catch (error) {
				return error;
			}
			throw new Error('se esperaba un error de MySQL');
		}

		it.each([
			['1062 on a known UNIQUE', "INSERT INTO deporte (nombre, slug, permite_empate) VALUES ('A', 'dup', 1), ('B', 'dup', 1)", 409, 'SLUG_TAKEN'],
			['1452 on a known FK', "INSERT INTO competicion (deporte_id, nombre, slug) VALUES (999999, 'X', 'x')", 404, 'SPORT_NOT_FOUND'],
			['1452 on an unmapped FK', 'INSERT INTO ticket (usuario_id, creado_en) VALUES (999999, UTC_TIMESTAMP())', 409, 'INVALID_REFERENCE'],
			['1406 value too long', "INSERT INTO deporte (nombre, slug, permite_empate) VALUES (REPEAT('x', 300), 'largo', 1)", 400, 'VALIDATION_ERROR'],
		])('%s', async (_label, sql, status, code) => {
			const translated = translateDbError(await mysqlError(sql));

			expect(translated).toMatchObject({ status, code });
		});

		it('1452 on the composite FK (enrollment whose competition is not the team’s)', async () => {
			const a = await sportCompetitionTeam(api, ' A');
			const b = await sportCompetitionTeam(api, ' B');
			const player = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Ana' }));
			const error = await mysqlError(
				'INSERT INTO plantel (jugador_id, equipo_id, competicion_id, numero_camiseta) VALUES (?, ?, ?, 1)',
				[player.id, a.teamId, b.competitionId],
			);

			expect(translateDbError(error)).toMatchObject({ status: 409, code: 'COMPETITION_MISMATCH' });
		});

		it('1451 on a known FK (delete a referenced sport bypassing the service check)', async () => {
			const { sportId } = await sportCompetitionTeam(api);

			expect(translateDbError(await mysqlError('DELETE FROM deporte WHERE id = ?', [sportId]))).toMatchObject({
				status: 409,
				code: 'SPORT_IN_USE',
			});
		});

		it('a route whose query violates a constraint answers 409 in the envelope, never 500 or the driver text', async () => {
			const { sportId } = await sportCompetitionTeam(api);
			const consoleError = vi.spyOn(console, 'error');
			const bare = express();
			bare.get('/boom', async () => {
				await pool.query('DELETE FROM deporte WHERE id = ?', [sportId]);
			});
			bare.use(errorHandler);

			const res = await request(bare).get('/boom');

			expect(res.status).toBe(409);
			expect(res.body).toEqual({ error: { code: 'SPORT_IN_USE', message: expect.any(String) } });
			expect(JSON.stringify(res.body)).not.toMatch(/FOREIGN KEY|CONSTRAINT|la_liga_acp|`|fk_/);
			expect(consoleError).not.toHaveBeenCalled();
			consoleError.mockRestore();
		});

		it('non-MySQL errors are not translated', () => {
			expect(translateDbError(new Error('otra cosa'))).toBeUndefined();
			expect(translateDbError({ errno: 1062 })).toBeUndefined();
		});
	});

	describe('audit hook (T-17)', () => {
		it('create, edit and delete report their outcome inside the transaction', async () => {
			const seen: AdminActionOutcome[] = [];
			const hooks = { inTransaction: async (_conn: unknown, outcome: AdminActionOutcome) => void seen.push(outcome) };
			const ctx = { actorId: api.admin.user.id, hooks };

			const sport = await createSport(pool, ctx, { nombre: 'Rugby', permiteEmpate: true });
			await updateSport(pool, ctx, sport.id, { nombre: 'Rugby 7' });
			await deleteSport(pool, ctx, sport.id);

			expect(seen).toEqual([
				{ action: 'crear_deporte', entity: 'deporte', actorId: api.admin.user.id, id: sport.id, before: null, after: sport },
				{
					action: 'editar_deporte',
					entity: 'deporte',
					actorId: api.admin.user.id,
					id: sport.id,
					before: sport,
					after: { ...sport, nombre: 'Rugby 7' },
				},
				{
					action: 'borrar_deporte',
					entity: 'deporte',
					actorId: api.admin.user.id,
					id: sport.id,
					before: { ...sport, nombre: 'Rugby 7' },
					after: null,
				},
			]);
		});

		it('a failing hook rolls the action back', async () => {
			const failing = { actorId: 1, hooks: { inTransaction: async () => Promise.reject(new Error('auditoría caída')) } };

			await expect(createSport(pool, failing, { nombre: 'Rugby', permiteEmpate: true })).rejects.toThrow('auditoría caída');
			expect((await api.get('/deportes')).body.data.total).toBe(0);
			// The transaction helper is untouched by it.
			await expect(withTransaction(pool, async () => 'ok')).resolves.toBe('ok');
		});
	});

	it('created() helper sanity: the flow sport -> competition -> team works end to end', async () => {
		const ids = await sportCompetitionTeam(api);
		expect(await created(api.post('/jugadores', { nombre: 'Ana' }))).toMatchObject({ nombre: 'Ana' });
		expect(ids.teamId).toEqual(expect.any(Number));
	});
});
