import { randomUUID } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { transactionStats } from '../src/db/transaction.js';
import {
	ACCIONES_AUDITADAS,
	cambios,
	claveProhibida,
	detalleAcotado,
	MAX_DETALLE_BINARIO,
	MAX_DETALLE_BYTES,
	MAX_PROFUNDIDAD_DETALLE,
	sanitize,
	tamanoBinario,
} from '../src/lib/audit.js';
import { AdminInputError, ensureAdmin } from '../src/services/admin-bootstrap.service.js';
import type { AdminActionHooks } from '../src/services/admin-action.js';
import { AUDIT_ORDER_INDEX, auditHooks, auditPageSql, participantAuditHooks } from '../src/services/audit.service.js';
import { confirmPayment } from '../src/services/participant-validation.service.js';
import { insertUser } from '../src/services/users.service.js';
import { createSport } from '../src/services/sports.service.js';
import { createTestApp, testUploadsDir, testUploadsRoot } from './helpers/app.js';
import { PASSWORD, signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, teamBody } from './helpers/catalog.js';
import { DB_INIT_DIR, resetDatabase } from './helpers/db.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);
const iso = (ms: number) => wholeSeconds(ms).toISOString().replace('.000Z', 'Z');

type Session = Awaited<ReturnType<typeof signedInUser>>;

interface AuditRow {
	id: number;
	usuario_id: number;
	codigo: string;
	entidad: string;
	entidad_id: number;
	creado_en: Date;
	detalle: Record<string, unknown> | null;
}

describe('audit log (T-17: NFR-006)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;

	async function auditRows(afterId = 0): Promise<AuditRow[]> {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT au.id, au.usuario_id, a.codigo, a.entidad, au.entidad_id, au.creado_en, au.detalle
			FROM auditoria au JOIN accion_auditoria a ON a.id = au.accion_id WHERE au.id > ? ORDER BY au.id`,
			[afterId],
		);
		return rows as AuditRow[];
	}
	const lastId = async () => Number((await pool.query<RowDataPacket[]>('SELECT COALESCE(MAX(id), 0) AS id FROM auditoria'))[0][0]!.id);

	/**
	 * Runs one admin request and checks it left exactly one record with that
	 * code, entity id, author and a fresh UTC date. Returns the record's detail.
	 */
	async function audited(req: Promise<request.Response>, codigo: string, entidadId: (body: { data: { id?: number } }) => number, status = [200, 201]) {
		const before = await lastId();
		const res = await req;
		expect(status, JSON.stringify(res.body)).toContain(res.status);
		const rows = await auditRows(before);
		expect(rows.map((r) => r.codigo), codigo).toEqual([codigo]);
		const [row] = rows;
		expect(row!.usuario_id).toBe(api.admin.user.id);
		expect(Number(row!.entidad_id)).toBe(entidadId(res.body));
		expect(Math.abs(new Date(row!.creado_en).getTime() - Date.now())).toBeLessThan(10_000);
		expect(row!.entidad).toBe(Object.values(ACCIONES_AUDITADAS).find((a) => a.codigo === codigo)!.entidad);
		return row!.detalle!;
	}
	/** A request that must leave no record. */
	async function notAudited(req: Promise<request.Response>, status: number) {
		const before = await lastId();
		const res = await req;
		expect(res.status, JSON.stringify(res.body)).toBe(status);
		expect(await auditRows(before)).toEqual([]);
		return res;
	}
	const bodyId = (body: { data: { id?: number } }) => body.data.id!;

	beforeAll(async () => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		api = await adminApi(app, pool);
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
		rmSync(testUploadsRoot, { recursive: true, force: true });
	});

	describe('the catalog', () => {
		it('every audited action has its code in 02-catalogos.sql with the same entity, and every code is used', async () => {
			const [rows] = await pool.query<RowDataPacket[]>('SELECT codigo, entidad FROM accion_auditoria ORDER BY codigo');
			const inDb = Object.fromEntries(rows.map((r) => [r.codigo, r.entidad]));
			const inCode = Object.fromEntries(Object.values(ACCIONES_AUDITADAS).map((a) => [a.codigo, a.entidad]));
			expect(inDb).toEqual(inCode);
			// The five of NFR-006 are there.
			for (const codigo of ['validacion_usuario', 'modificacion_partido', 'registro_resultado', 'confirmacion_resultado', 'cancelacion_partido']) {
				expect(inDb[codigo], codigo).toBeDefined();
			}
			expect(readFileSync(resolve(DB_INIT_DIR, '01-schema.sql'), 'utf8')).toMatch(/detalle\s+JSON/);
		});
	});

	describe('every admin action writes exactly one record', () => {
		it('catalog, matches, results, goals, media, cancellation and deletions', async () => {
			// Sports catalog (T-06).
			let sportId = 0;
			const d1 = await audited(
				api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }).then((r) => ((sportId = r.body.data.id), r)),
				'alta_deporte',
				bodyId,
			);
			expect(d1).toMatchObject({ nuevo: { nombre: 'Fútbol', permiteEmpate: true } });
			const d2 = await audited(api.patch(`/deportes/${sportId}`, { nombre: 'Fútbol 11' }), 'modificacion_deporte', bodyId);
			expect(d2).toEqual({ cambios: { nombre: { antes: 'Fútbol', despues: 'Fútbol 11' } } });

			let compId = 0;
			await audited(api.post('/competiciones', { deporteId: sportId, nombre: 'Liga' }).then((r) => ((compId = r.body.data.id), r)), 'alta_competicion', bodyId);
			expect(await audited(api.patch(`/competiciones/${compId}`, { nombre: 'Liga 2026' }), 'modificacion_competicion', bodyId)).toMatchObject({
				cambios: { nombre: { antes: 'Liga', despues: 'Liga 2026' } },
			});
			const teams: number[] = [];
			for (const nombre of ['Alianza', 'Boca']) {
				await audited(api.post('/equipos', teamBody(compId, { nombre })).then((r) => (teams.push(r.body.data.id), r)), 'alta_equipo', bodyId);
			}
			expect(await audited(api.patch(`/equipos/${teams[0]}`, { colorAcento: '#00FF00' }), 'modificacion_equipo', bodyId)).toMatchObject({
				cambios: { colorAcento: { despues: '#00ff00' } },
			});
			let playerId = 0;
			await audited(api.post('/jugadores', { nombre: 'Ana Pérez' }).then((r) => ((playerId = r.body.data.id), r)), 'alta_jugador', bodyId);
			await audited(api.patch(`/jugadores/${playerId}`, { nombre: 'Ana Pérez Ruiz' }), 'modificacion_jugador', bodyId);
			let enrollmentId = 0;
			await audited(
				api.post('/planteles', { jugadorId: playerId, equipoId: teams[0], numeroCamiseta: 9 }).then((r) => ((enrollmentId = r.body.data.id), r)),
				'alta_plantel',
				bodyId,
			);
			expect(await audited(api.patch(`/planteles/${enrollmentId}`, { numeroCamiseta: 10 }), 'modificacion_plantel', bodyId)).toMatchObject({
				cambios: { numeroCamiseta: { antes: 9, despues: 10 } },
			});

			// Matches (T-07). NFR-006: "Modificación de partido".
			const body = { competicionId: compId, localId: teams[0], visitaId: teams[1], jornada: 1, fechaHora: iso(Date.now() + 3 * DAY), sede: 'Estadio' };
			let matchId = 0;
			await audited(api.post('/partidos', body).then((r) => ((matchId = r.body.data.id), r)), 'alta_partido', bodyId);
			expect(await audited(api.patch(`/partidos/${matchId}`, { sede: 'Nuevo estadio' }), 'modificacion_partido', bodyId)).toEqual({
				cambios: { sede: { antes: 'Estadio', despues: 'Nuevo estadio' } },
			});

			// Results (T-12). NFR-006: "Registro de resultado" and "Confirmación definitiva de resultado".
			await pool.query('UPDATE partido SET fecha_hora = ? WHERE id = ?', [wholeSeconds(Date.now() - 2 * HOUR), matchId]);
			const matchIdOf = () => matchId;
			expect(await audited(api.put(`/partidos/${matchId}/resultado`, { golesLocal: 2, golesVisitante: 1 }), 'registro_resultado', matchIdOf)).toEqual({
				marcador: { golesLocal: 2, golesVisitante: 1 },
				anterior: { golesLocal: null, golesVisitante: null },
			});

			// Goals and media (T-13).
			let goalId = 0;
			await audited(
				api.post(`/partidos/${matchId}/goles`, { jugadorId: playerId, equipoId: teams[0], minuto: 10 }).then((r) => ((goalId = r.body.data.id), r)),
				'alta_gol',
				bodyId,
			);
			expect(await audited(api.patch(`/partidos/${matchId}/goles/${goalId}`, { minuto: 11 }), 'modificacion_gol', bodyId)).toMatchObject({
				cambios: { minuto: { antes: 10, despues: 11 } },
			});
			expect(
				await audited(api.put(`/partidos/${matchId}/goles/${goalId}/video`, { url: 'https://youtu.be/dQw4w9WgXcQ' }), 'modificacion_gol', bodyId),
			).toMatchObject({ cambios: { video: { antes: null } } });
			await audited(api.del(`/partidos/${matchId}/goles/${goalId}/video`), 'modificacion_gol', bodyId);
			// The goal's image: only the public field `imagen` changes, never the internal file name (`archivo`).
			const image = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#1a6' } }).jpeg().toBuffer();
			const uploaded = await audited(
				request(app)
					.put(`/admin/partidos/${matchId}/goles/${goalId}/imagen`)
					.set('Cookie', api.admin.cookie)
					.set('X-CSRF-Token', api.admin.csrfToken)
					.attach('imagen', image, { filename: 'gol.jpg', contentType: 'image/jpeg' }),
				'modificacion_gol',
				bodyId,
			);
			expect(Object.keys(uploaded.cambios as object)).toEqual(['imagen']);
			expect(uploaded).toMatchObject({ cambios: { imagen: { antes: null, despues: expect.stringMatching(/^\/admin\/archivos\/[0-9a-f]{32}\.webp$/) } } });
			expect(JSON.stringify(uploaded)).not.toContain('archivo"');
			const removed = await audited(api.del(`/partidos/${matchId}/goles/${goalId}/imagen`), 'modificacion_gol', bodyId);
			expect(Object.keys(removed.cambios as object)).toEqual(['imagen']);
			await audited(api.del(`/partidos/${matchId}/goles/${goalId}`), 'borrado_gol', () => goalId);
			let mediaId = 0;
			await audited(
				api.post(`/partidos/${matchId}/multimedia/videos`, { url: 'https://vimeo.com/1234' }).then((r) => ((mediaId = r.body.data.id), r)),
				'alta_multimedia',
				bodyId,
			);
			await audited(api.del(`/partidos/${matchId}/multimedia/${mediaId}`), 'borrado_multimedia', () => mediaId);

			expect(
				await audited(
					api.post(`/partidos/${matchId}/resultado/confirmar`, { confirmar: true, golesLocal: 2, golesVisitante: 1 }),
					'confirmacion_resultado',
					matchIdOf,
				),
			).toEqual({ marcador: { golesLocal: 2, golesVisitante: 1 } });

			// Cancellation (T-16). NFR-006: "Cancelación de partido".
			let otherId = 0;
			await audited(api.post('/partidos', { ...body, jornada: 2 }).then((r) => ((otherId = r.body.data.id), r)), 'alta_partido', bodyId);
			const cancelled = await audited(api.post(`/partidos/${otherId}/cancelacion/confirmar`, { confirmar: true }), 'cancelacion_partido', () => otherId);
			expect(cancelled).toEqual({
				estadoAnterior: 'programado',
				selecciones: 0,
				monedasDevueltas: 0,
				seleccionesSinDevolucion: { total: 0, sinDebito: 0, cuentaAdministrador: 0 },
				usuarios: 0,
				tickets: 0,
				ticketsAnulados: 0,
			});

			// Deletions: the rows are gone, their records stay (no cascade).
			const deleted = await audited(api.del(`/partidos/${otherId}`), 'borrado_partido', () => otherId);
			expect(deleted).toMatchObject({ anterior: { id: otherId, estado: 'cancelado', jornada: 2 } });
			let spareSport = 0;
			await audited(api.post('/deportes', { nombre: 'Vóley', permiteEmpate: false }).then((r) => ((spareSport = r.body.data.id), r)), 'alta_deporte', bodyId);
			let spareComp = 0;
			await audited(api.post('/competiciones', { deporteId: spareSport, nombre: 'Copa' }).then((r) => ((spareComp = r.body.data.id), r)), 'alta_competicion', bodyId);
			let spareTeam = 0;
			await audited(api.post('/equipos', teamBody(spareComp, { nombre: 'Cristal' })).then((r) => ((spareTeam = r.body.data.id), r)), 'alta_equipo', bodyId);
			let sparePlayer = 0;
			await audited(api.post('/jugadores', { nombre: 'Bea' }).then((r) => ((sparePlayer = r.body.data.id), r)), 'alta_jugador', bodyId);
			let spareEnrollment = 0;
			await audited(
				api.post('/planteles', { jugadorId: sparePlayer, equipoId: spareTeam, numeroCamiseta: 5 }).then((r) => ((spareEnrollment = r.body.data.id), r)),
				'alta_plantel',
				bodyId,
			);
			await audited(api.del(`/planteles/${spareEnrollment}`), 'borrado_plantel', () => spareEnrollment);
			await audited(api.del(`/jugadores/${sparePlayer}`), 'borrado_jugador', () => sparePlayer);
			await audited(api.del(`/equipos/${spareTeam}`), 'borrado_equipo', () => spareTeam);
			await audited(api.del(`/competiciones/${spareComp}`), 'borrado_competicion', () => spareComp);
			expect(await audited(api.del(`/deportes/${spareSport}`), 'borrado_deporte', () => spareSport)).toMatchObject({
				anterior: { id: spareSport, nombre: 'Vóley' },
			});
			const [[kept]] = await pool.query<RowDataPacket[]>(
				"SELECT COUNT(*) AS n FROM auditoria au JOIN accion_auditoria a ON a.id = au.accion_id WHERE a.entidad = 'deporte' AND au.entidad_id = ?",
				[spareSport],
			);
			expect(Number(kept!.n)).toBe(2);

			// Every code of the catalog was used by this walk, except the participant ones (next test).
			const used = new Set((await auditRows()).map((r) => r.codigo));
			const expected = Object.values(ACCIONES_AUDITADAS).map((a) => a.codigo).filter((c) => !['validacion_usuario', 'confirmacion_pago', 'reversion_pago', 'creacion_administrador', 'promocion_administrador'].includes(c));
			expect([...used].sort()).toEqual([...new Set(expected)].sort());
		});

		it('participants: confirm and revert a payment, validate (NFR-006: "Validación de usuario")', async () => {
			const who = await signedInUser(app, pool);
			const id = () => who.user.id;
			expect(await audited(api.post(`/participantes/${who.user.id}/pago/confirmar`, {}), 'confirmacion_pago', id)).toEqual({
				estadoPago: { antes: 'pendiente', despues: 'confirmado' },
			});
			expect(await audited(api.post(`/participantes/${who.user.id}/pago/revertir`, {}), 'reversion_pago', id)).toEqual({
				estadoPago: { antes: 'confirmado', despues: 'pendiente' },
			});
			await audited(api.post(`/participantes/${who.user.id}/pago/confirmar`, {}), 'confirmacion_pago', id);
			const validated = await audited(api.post(`/participantes/${who.user.id}/validar`, {}), 'validacion_usuario', id);
			expect(validated).toMatchObject({ estadoValidacion: { antes: 'pendiente', despues: 'validado' }, monedasAsignadas: 10 });
		});
	});

	describe('only what happened is recorded', () => {
		it('refused operations leave no record', async () => {
			const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
			await notAudited(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }), 409);
			await notAudited(api.post('/deportes', { nombre: '', permiteEmpate: true }), 400);
			await notAudited(api.patch(`/deportes/999999999`, { nombre: 'X' }), 404);
			const comp = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Liga' }));
			await notAudited(api.del(`/deportes/${sport.id}`), 409);
			const who = await signedInUser(app, pool);
			await notAudited(api.post(`/participantes/${who.user.id}/validar`, {}), 409);
			await notAudited(api.post(`/participantes/${api.admin.user.id}/pago/confirmar`, {}), 404);
			const [a, b] = [
				await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'A' }))),
				await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'B' }))),
			];
			const match = await created<{ id: number }>(
				api.post('/partidos', { competicionId: comp.id, localId: a.id, visitaId: b.id, jornada: 1, fechaHora: iso(Date.now() + DAY), sede: 'X' }),
			);
			await notAudited(api.put(`/partidos/${match.id}/resultado`, { golesLocal: 1, golesVisitante: 0 }), 409);
			await notAudited(api.post(`/partidos/${match.id}/resultado/confirmar`, { confirmar: false }), 400);
			expect((await api.post(`/partidos/${match.id}/cancelacion/confirmar`, { confirmar: true })).status).toBe(200);
			await notAudited(api.post(`/partidos/${match.id}/cancelacion/confirmar`, { confirmar: true }), 409);
			await notAudited(api.patch(`/partidos/${match.id}`, { sede: 'Y' }), 409);
			// Without CSRF, nothing runs.
			await notAudited(request(app).post('/admin/deportes').set('Cookie', api.admin.cookie).send({ nombre: 'Tenis', permiteEmpate: false }), 403);
			// Reads leave nothing either.
			await notAudited(api.get('/deportes'), 200);
			await notAudited(api.get(`/partidos/${match.id}/cancelacion`), 200);
		});

		it('an audit insert that fails rolls the action back', async () => {
			const bettor = await signedInUser(app, pool, { estado: 'validado' });
			// The author is not an admin: the audit refuses it, and the sport isn't created.
			await expect(
				createSport(pool, { actorId: bettor.user.id, hooks: auditHooks }, { nombre: 'Rugby', permiteEmpate: true }),
			).rejects.toThrow(/administrador/);
			const [sports] = await pool.query<RowDataPacket[]>("SELECT id FROM deporte WHERE nombre = 'Rugby'");
			expect(sports).toEqual([]);

			const target = await signedInUser(app, pool);
			await expect(confirmPayment(pool, { actorId: bettor.user.id, userId: target.user.id }, participantAuditHooks)).rejects.toThrow(/administrador/);
			const [[state]] = await pool.query<RowDataPacket[]>(
				'SELECT ep.codigo FROM usuario u JOIN estado_pago ep ON ep.id = u.estado_pago_id WHERE u.id = ?',
				[target.user.id],
			);
			expect(state!.codigo).toBe('pendiente');

			// The catalog code is missing: the HTTP action answers 500 and changes nothing.
			const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
			await pool.query("UPDATE accion_auditoria SET codigo = 'alta_deporte_x' WHERE codigo = 'alta_deporte'");
			try {
				const res = await api.post('/deportes', { nombre: 'Hockey', permiteEmpate: true });
				expect(res.status).toBe(500);
				expect(res.body.error.code).toBe('INTERNAL_ERROR');
				expect(JSON.stringify(res.body)).not.toMatch(/accion_auditoria|alta_deporte/);
			} finally {
				await pool.query("UPDATE accion_auditoria SET codigo = 'alta_deporte' WHERE codigo = 'alta_deporte_x'");
				quiet.mockRestore();
			}
			const [hockey] = await pool.query<RowDataPacket[]>("SELECT id FROM deporte WHERE nombre = 'Hockey'");
			expect(hockey).toEqual([]);
			expect(await auditRows()).toEqual([]);
		});

		it('a deadlock retry leaves exactly one record', async () => {
			let calls = 0;
			const flaky: AdminActionHooks = {
				inTransaction: async (conn, outcome) => {
					calls++;
					await auditHooks.inTransaction!(conn, outcome);
					if (calls === 1) throw Object.assign(new Error('deadlock simulado'), { errno: 1213, sqlState: '40001' });
				},
			};
			const retries = transactionStats.deadlockRetries;
			const sport = await createSport(pool, { actorId: api.admin.user.id, hooks: flaky }, { nombre: 'Básquet', permiteEmpate: false });
			expect(calls).toBe(2);
			expect(transactionStats.deadlockRetries).toBe(retries + 1);
			const rows = await auditRows();
			expect(rows.map((r) => [r.codigo, Number(r.entidad_id)])).toEqual([['alta_deporte', sport.id]]);
		});
	});

	describe('reading the log', () => {
		it('newest first, paginated, with filters; the admin shows as id and name only', async () => {
			const other = await adminApi(app, pool);
			const first = api;
			const s1 = await created<{ id: number }>(first.post('/deportes', { nombre: 'Uno', permiteEmpate: true }));
			const s2 = await created<{ id: number }>(other.post('/deportes', { nombre: 'Dos', permiteEmpate: true }));
			await first.patch(`/deportes/${s1.id}`, { nombre: 'Uno bis' });
			const comp = await created<{ id: number }>(other.post('/competiciones', { deporteId: s2.id, nombre: 'Liga' }));
			const all = rowsOf(await first.get('/auditoria'));
			expect(all.map((r) => r.accion.codigo)).toEqual(['alta_competicion', 'modificacion_deporte', 'alta_deporte', 'alta_deporte']);
			expect(all[0]).toMatchObject({
				id: expect.any(Number),
				fecha: expect.stringMatching(/Z$/),
				accion: { codigo: 'alta_competicion', nombre: 'Alta de competición' },
				entidad: 'competicion',
				entidadId: comp.id,
				administrador: { id: other.admin.user.id, nombre: expect.any(String) },
				detalle: { nuevo: expect.objectContaining({ nombre: 'Liga' }) },
			});
			expect(Object.keys(all[0]!.administrador).sort()).toEqual(['id', 'nombre']);

			const page = (await first.get('/auditoria?page=2&pageSize=3')).body.data;
			expect(page).toMatchObject({ page: 2, pageSize: 3, total: 4, totalPages: 2 });
			expect(page.items.map((r: { accion: { codigo: string } }) => r.accion.codigo)).toEqual(['alta_deporte']);

			const filtered = async (query: string) => rowsOf(await first.get(`/auditoria?${query}`)).map((r) => [r.accion.codigo, r.entidadId]);
			expect(await filtered('accion=alta_deporte')).toEqual([
				['alta_deporte', s2.id],
				['alta_deporte', s1.id],
			]);
			expect(await filtered('entidad=deporte')).toHaveLength(3);
			expect(await filtered(`entidad=deporte&entidadId=${s1.id}`)).toEqual([
				['modificacion_deporte', s1.id],
				['alta_deporte', s1.id],
			]);
			expect(await filtered(`usuarioId=${other.admin.user.id}`)).toEqual([
				['alta_competicion', comp.id],
				['alta_deporte', s2.id],
			]);
			const hourAgo = iso(Date.now() - HOUR);
			const inAnHour = iso(Date.now() + HOUR);
			expect(await filtered(`desde=${encodeURIComponent(hourAgo)}&hasta=${encodeURIComponent(inAnHour)}`)).toHaveLength(4);
			expect(await filtered(`desde=${encodeURIComponent(inAnHour)}`)).toEqual([]);
			expect(await filtered(`hasta=${encodeURIComponent(hourAgo)}`)).toEqual([]);
		});

		it.each([
			'?x=1',
			'?accion=borrar_todo',
			'?entidad=ticket',
			'?entidadId=3',
			'?entidad=deporte&entidadId=abc',
			'?usuarioId=-1',
			'?desde=2026-01-01',
			'?desde=2026-03-01T00:00:00Z&hasta=2026-02-01T00:00:00Z',
			'?page=0',
			'?pageSize=101',
			'?accion=alta_deporte&accion=alta_equipo',
		])('rejects %s with 400', async (query) => {
			const res = await api.get(`/auditoria${query}`);
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
		});

		it('401 anonymous, 403 for a bettor; there is no route that writes, edits or deletes records', async () => {
			expect((await request(app).get('/admin/auditoria')).status).toBe(401);
			const bettor = await signedInUser(app, pool, { estado: 'validado' });
			expect((await request(app).get('/admin/auditoria').set('Cookie', bettor.cookie)).status).toBe(403);
			await created(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
			const [[row]] = await pool.query<RowDataPacket[]>('SELECT id FROM auditoria');
			for (const path of ['/auditoria', `/auditoria/${row!.id}`]) {
				expect((await api.post(path, { accion: 'x' })).status, `POST ${path}`).toBe(404);
				expect((await api.put(path, {})).status, `PUT ${path}`).toBe(404);
				expect((await api.patch(path, {})).status, `PATCH ${path}`).toBe(404);
				expect((await api.del(path)).status, `DELETE ${path}`).toBe(404);
			}
			expect((await api.get(`/auditoria/${row!.id}`)).status).toBe(404);
			expect(rowsOf(await api.get('/auditoria'))).toHaveLength(1);
		});
	});

	describe('texts with emoji (T-17 fix)', () => {
		const EMOJI = '😀';
		// 15 + 184 + 2 (the emoji, two UTF-16 units) + 4: the old cut at 200 units split the emoji.
		const photo = (letters: number) => `https://x.test/${'f'.repeat(letters)}${EMOJI}.png`;

		it('the reported case: a player photo and a team crest whose cut falls inside an emoji are created, edited and audited', async () => {
			for (const letters of [184, 185, 183]) {
				const res = await api.post('/jugadores', { nombre: `Emoji ${letters}`, foto: photo(letters) });
				expect(res.status, `${letters}: ${JSON.stringify(res.body)}`).toBe(201);
				const [row] = await auditRows((await lastId()) - 1);
				expect(row!.codigo).toBe('alta_jugador');
				const foto = (row!.detalle as { nuevo: { foto: string } }).nuevo.foto;
				expect(foto).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
				expect(Array.from(foto.replace(/…$/, '')).length).toBeLessThanOrEqual(200);
			}
			const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
			const comp = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Liga' }));
			const team = await api.post('/equipos', teamBody(comp.id, { nombre: 'Emoji FC', escudo: photo(184) }));
			expect(team.status, JSON.stringify(team.body)).toBe(201);
			const edited = await audited(api.patch(`/equipos/${team.body.data.id}`, { escudo: photo(183) }), 'modificacion_equipo', bodyId);
			expect(edited).toMatchObject({ cambios: { escudo: { antes: expect.any(String), despues: expect.any(String) } } });
		});

		it('an emoji at every position around the cut, and lone halves, always make valid JSON for MySQL', async () => {
			const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
			const samples: string[] = [];
			for (let n = 190; n <= 205; n++) samples.push(`${'a'.repeat(n)}${EMOJI}${'b'.repeat(10)}`, `${EMOJI.repeat(n)}`, `${'a'.repeat(n)}👨\u200D👩\u200D👧\u200D👦z`);
			samples.push('\uD83D', 'x\uDE00y', `${'a'.repeat(199)}\uD83D`, '\uDE00\uD83D');
			for (const text of samples) {
				const detail = detalleAcotado({ texto: text, [`clave${text.slice(0, 3)}`]: 1 });
				const json = JSON.stringify(detail);
				expect(json, text.slice(0, 20)).not.toMatch(lone);
				const [[row]] = await pool.query<RowDataPacket[]>('SELECT JSON_VALID(?) AS ok, CAST(? AS JSON) AS j', [json, json]);
				expect(row!.ok).toBe(1);
			}
			expect(sanitize('\uD83D')).toBe('�');
			expect(sanitize(`${'a'.repeat(199)}${EMOJI}${EMOJI}`)).toBe(`${'a'.repeat(199)}${EMOJI}…`);
		});
	});

	describe('edits that change nothing (D-004)', () => {
		it('a PATCH with the same values answers as before and leaves no record, for every editable entity', async () => {
			const sport = await created<{ id: number; nombre: string; permiteEmpate: boolean }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
			const comp = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Liga' }));
			const teamA = await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'Alianza' })));
			const teamB = await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'Boca' })));
			const player = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Ana', foto: 'jugadores/ana.webp' }));
			const enrollment = await created<{ id: number }>(api.post('/planteles', { jugadorId: player.id, equipoId: teamA.id, numeroCamiseta: 9 }));
			const fecha = iso(Date.now() + 3 * DAY);
			const match = await created<{ id: number }>(
				api.post('/partidos', { competicionId: comp.id, localId: teamA.id, visitaId: teamB.id, jornada: 1, fechaHora: fecha, sede: 'Estadio' }),
			);

			const same = async (path: string, body: object, expected: object) => {
				const res = await notAudited(api.patch(path, body), 200);
				expect(res.body.data, path).toMatchObject(expected);
			};
			await same(`/deportes/${sport.id}`, { nombre: 'Fútbol', permiteEmpate: true }, { nombre: 'Fútbol', permiteEmpate: true });
			await same(`/competiciones/${comp.id}`, { nombre: 'Liga', deporteId: sport.id }, { nombre: 'Liga' });
			await same(`/equipos/${teamA.id}`, { nombre: 'Alianza', colorAcento: '#A50044' }, { nombre: 'Alianza' });
			await same(`/jugadores/${player.id}`, { nombre: 'Ana', foto: 'jugadores/ana.webp' }, { nombre: 'Ana' });
			await same(`/planteles/${enrollment.id}`, { numeroCamiseta: 9 }, { numeroCamiseta: 9 });
			await same(`/partidos/${match.id}`, { sede: 'Estadio', jornada: 1, fechaHora: fecha }, { sede: 'Estadio', jornada: 1 });

			// Goals: the same minute, and the same video twice.
			await pool.query('UPDATE partido SET fecha_hora = ? WHERE id = ?', [wholeSeconds(Date.now() - 2 * HOUR), match.id]);
			expect((await api.put(`/partidos/${match.id}/resultado`, { golesLocal: 1, golesVisitante: 0 })).status).toBe(200);
			const goal = await created<{ id: number }>(api.post(`/partidos/${match.id}/goles`, { jugadorId: player.id, equipoId: teamA.id, minuto: 5 }));
			await same(`/partidos/${match.id}/goles/${goal.id}`, { minuto: 5 }, { minuto: 5 });
			const video = { url: 'https://youtu.be/dQw4w9WgXcQ' };
			await audited(api.put(`/partidos/${match.id}/goles/${goal.id}/video`, video), 'modificacion_gol', bodyId);
			await notAudited(api.put(`/partidos/${match.id}/goles/${goal.id}/video`, video), 200);

			// The same score registered again (D-004 extended); another score records.
			await notAudited(api.put(`/partidos/${match.id}/resultado`, { golesLocal: 1, golesVisitante: 0 }), 200);
			expect(await audited(api.put(`/partidos/${match.id}/resultado`, { golesLocal: 2, golesVisitante: 0 }), 'registro_resultado', () => match.id)).toEqual({
				marcador: { golesLocal: 2, golesVisitante: 0 },
				anterior: { golesLocal: 1, golesVisitante: 0 },
			});
			await notAudited(api.put(`/partidos/${match.id}/resultado`, { golesLocal: 2, golesVisitante: 0 }), 200);

			// A real change still records.
			expect(await audited(api.patch(`/deportes/${sport.id}`, { nombre: 'Fútbol 5' }), 'modificacion_deporte', bodyId)).toEqual({
				cambios: { nombre: { antes: 'Fútbol', despues: 'Fútbol 5' } },
			});
		});

		it('a change past character 200 is a change (second fix): compared on the real values, marked recortado', async () => {
			const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
			const comp = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Liga' }));
			const base = `https://x.test/${'a'.repeat(190)}`;
			const exact = [`${base}/uno.png`, `${base}/otro-archivo.png`];
			// The same 205-character start, then a change at position 200, 201, 204, or only in the ending.
			const at = (index: number) => `${base.slice(0, index)}b${base.slice(index + 1)}/uno.png`;
			const values = [...exact, at(200), at(201), at(204), `${base}/uno.webp`, `${base}/uno.png`];
			const cut = `${base.slice(0, 200)}…`;

			for (const [kind, path, field, code] of [
				['jugador', '/jugadores', 'foto', 'modificacion_jugador'],
				['equipo', '/equipos', 'escudo', 'modificacion_equipo'],
			] as const) {
				const first = kind === 'jugador' ? { nombre: 'Ana', foto: values[0] } : teamBody(comp.id, { nombre: 'Alianza', escudo: values[0] });
				const row = await created<{ id: number }>(api.post(path, first));
				for (const [i, value] of values.entries()) {
					if (i === 0) continue;
					expect(value.length, value).toBeLessThanOrEqual(255);
					const detail = await audited(api.patch(`${path}/${row.id}`, { [field]: value }), code, bodyId);
					expect(detail, `${kind} ${i}`).toEqual({ cambios: { [field]: { antes: cut, despues: cut, recortado: true } } });
					const [[stored]] = await pool.query<RowDataPacket[]>(`SELECT ${field} AS v FROM ${kind} WHERE id = ?`, [row.id]);
					expect(stored!.v).toBe(value);
				}
				// Sending the current long value again is still no change.
				await notAudited(api.patch(`${path}/${row.id}`, { [field]: values.at(-1) }), 200);
				// A change before character 200 shows both values (cut), still marked.
				const early = `https://y.test/${'a'.repeat(190)}/uno.png`;
				expect(await audited(api.patch(`${path}/${row.id}`, { [field]: early }), code, bodyId)).toEqual({
					cambios: { [field]: { antes: cut, despues: `${early.slice(0, 200)}…`, recortado: true } },
				});
				// Back to a short value: only the long side was cut. Between two short values nothing is marked.
				expect(await audited(api.patch(`${path}/${row.id}`, { [field]: 'fotos/corta.png' }), code, bodyId)).toEqual({
					cambios: { [field]: { antes: `${early.slice(0, 200)}…`, despues: 'fotos/corta.png', recortado: true } },
				});
				expect(await audited(api.patch(`${path}/${row.id}`, { [field]: 'fotos/otra.png' }), code, bodyId)).toEqual({
					cambios: { [field]: { antes: 'fotos/corta.png', despues: 'fotos/otra.png' } },
				});
			}
			expect(cambios({ t: `${'x'.repeat(200)}1` }, { t: `${'x'.repeat(200)}2` })).toEqual({
				t: { antes: `${'x'.repeat(200)}…`, despues: `${'x'.repeat(200)}…`, recortado: true },
			});
			expect(cambios({ t: 'x'.repeat(300) }, { t: 'x'.repeat(300) })).toEqual({});
		});
	});

	describe('details keep only stored fields (second fix)', () => {
		it('no cierreApuestas, deporteId, team or player names, lado, embedUrl or derived result', async () => {
			const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
			const comp = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Liga' }));
			const teamA = await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'Alianza' })));
			const teamB = await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'Boca' })));
			const player = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Ana' }));
			const before = await lastId();
			const enrollment = await created<{ id: number }>(api.post('/planteles', { jugadorId: player.id, equipoId: teamA.id, numeroCamiseta: 9 }));
			const fecha = Date.now() + 3 * DAY;
			const match = await created<{ id: number }>(
				api.post('/partidos', { competicionId: comp.id, localId: teamA.id, visitaId: teamB.id, jornada: 1, fechaHora: iso(fecha), sede: 'Estadio' }),
			);

			// Postponing: only fechaHora changes.
			const later = iso(fecha + DAY);
			expect(await audited(api.patch(`/partidos/${match.id}`, { fechaHora: later }), 'modificacion_partido', bodyId)).toEqual({
				cambios: { fechaHora: { antes: new Date(iso(fecha)).toISOString(), despues: new Date(later).toISOString() } },
			});

			await pool.query('UPDATE partido SET fecha_hora = ? WHERE id = ?', [wholeSeconds(Date.now() - 2 * HOUR), match.id]);
			await api.put(`/partidos/${match.id}/resultado`, { golesLocal: 1, golesVisitante: 0 });
			const goal = await created<{ id: number }>(api.post(`/partidos/${match.id}/goles`, { jugadorId: player.id, equipoId: teamA.id, minuto: 5 }));
			await api.put(`/partidos/${match.id}/goles/${goal.id}/video`, { url: 'https://youtu.be/dQw4w9WgXcQ' });
			await api.post(`/partidos/${match.id}/multimedia/videos`, { url: 'https://vimeo.com/1234' });
			await api.post(`/partidos/${match.id}/resultado/confirmar`, { confirmar: true, golesLocal: 1, golesVisitante: 0 });

			const details = Object.fromEntries((await auditRows(before)).map((r) => [r.codigo, r.detalle]));
			expect(Object.keys((details.alta_plantel as { nuevo: object }).nuevo).sort()).toEqual(['competicionId', 'equipoId', 'id', 'jugadorId', 'numeroCamiseta']);
			expect(details.alta_plantel).toMatchObject({ nuevo: { id: enrollment.id } });
			expect(Object.keys((details.alta_partido as { nuevo: object }).nuevo).sort()).toEqual(
				['competicionId', 'estado', 'fechaHora', 'id', 'jornada', 'local', 'sede', 'visita'],
			);
			expect(details.alta_partido).toMatchObject({ nuevo: { local: { equipoId: teamA.id, goles: null }, visita: { equipoId: teamB.id, goles: null } } });
			expect(Object.keys((details.alta_gol as { nuevo: object }).nuevo).sort()).toEqual(['equipoId', 'id', 'imagen', 'minuto', 'partidoId', 'plantelId', 'video']);
			expect(details.modificacion_gol).toEqual({ cambios: { video: { antes: null, despues: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } } });
			expect(details.alta_multimedia).toMatchObject({ nuevo: { imagen: null, video: 'https://vimeo.com/1234' } });
			expect(Object.keys((details.alta_multimedia as { nuevo: object }).nuevo).sort()).toEqual(['creadoEn', 'id', 'imagen', 'video']);
			expect(details.confirmacion_resultado).toEqual({ marcador: { golesLocal: 1, golesVisitante: 0 } });
			const text = JSON.stringify(details);
			for (const computed of ['cierreApuestas', 'deporteId', 'Alianza', 'Boca', '"Ana"', 'lado', 'embedUrl', 'plataforma', '"resultado"', 'jugadorNombre', 'equipoNombre', 'competicionNombre', 'deporteNombre']) {
				expect(text, computed).not.toContain(computed);
			}
		});
	});

	describe('admin:create (D-005)', () => {
		it('creating and promoting an admin leave one record each, with the account as author and entity; nothing when it was already one', async () => {
			const secret = 'clave-del-admin-2026';
			const before = await lastId();
			const createdAdmin = await ensureAdmin(pool, { email: 'nueva.admin@liga.test', nombre: 'Nueva Admin', password: secret });
			expect(createdAdmin.action).toBe('created');
			let rows = await auditRows(before);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ codigo: 'creacion_administrador', entidad: 'usuario', usuario_id: createdAdmin.user.id, entidad_id: createdAdmin.user.id });
			expect(rows[0]!.detalle).toEqual({ origen: 'comando admin:create', operacion: 'creacion' });

			const account = await signedInUser(app, pool);
			const afterCreate = await lastId();
			expect((await ensureAdmin(pool, { email: account.user.email, password: 'se-ignora-123' })).action).toBe('promoted');
			rows = await auditRows(afterCreate);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ codigo: 'promocion_administrador', usuario_id: account.user.id, entidad_id: account.user.id });
			expect(rows[0]!.detalle).toEqual({ origen: 'comando admin:create', operacion: 'promocion' });

			const afterPromote = await lastId();
			expect((await ensureAdmin(pool, { email: account.user.email })).action).toBe('unchanged');
			expect((await ensureAdmin(pool, { email: 'nueva.admin@liga.test', password: secret })).action).toBe('unchanged');
			expect(await auditRows(afterPromote)).toEqual([]);

			// A refused promotion records nothing either.
			const player = await signedInUser(app, pool);
			await api.post(`/participantes/${player.user.id}/pago/confirmar`, {});
			const afterRefusal = await lastId();
			await expect(ensureAdmin(pool, { email: player.user.email })).rejects.toBeInstanceOf(AdminInputError);
			expect(await auditRows(afterRefusal)).toEqual([]);

			const [dump] = await pool.query<RowDataPacket[]>('SELECT CAST(detalle AS CHAR) AS d FROM auditoria');
			const text = dump.map((r) => String(r.d)).join('\n');
			expect(text).not.toContain(secret);
			expect(text).not.toContain('se-ignora-123');
			expect(text).not.toContain('@');
			// The records show up in the log with the new admin as author.
			const listed = rowsOf(await api.get('/auditoria?accion=creacion_administrador'));
			expect(listed.map((r) => [r.entidadId, r.administrador.id])).toEqual([[createdAdmin.user.id, createdAdmin.user.id]]);
		});

		it('losing a race (second fix): the loser answers unchanged or a clear message, never the driver text, and records nothing', async () => {
			// Creation lost to another run: the other admin appears while this one asks for the password.
			const before = await lastId();
			const lost = await ensureAdmin(pool, {
				email: 'carrera@liga.test',
				nombre: 'Carrera',
				password: async () => {
					expect((await ensureAdmin(pool, { email: 'carrera@liga.test', nombre: 'Otra', password: 'clave-ganadora-1' })).action).toBe('created');
					return 'clave-perdedora-1';
				},
			});
			expect(lost).toMatchObject({ action: 'unchanged', passwordIgnored: true, user: { nombre: 'Otra', rol: 'admin' } });
			expect((await auditRows(before)).map((r) => r.codigo)).toEqual(['creacion_administrador']);

			// Creation lost to a registration: that account is never promoted silently.
			const afterFirst = await lastId();
			const refused = ensureAdmin(pool, {
				email: 'registrada@liga.test',
				nombre: 'Admin',
				password: async () => {
					await insertUser(pool, { nombre: 'Participante', email: 'registrada@liga.test', passwordHash: 'x', rol: 'apostador' }, new Date());
					return 'clave-perdedora-2';
				},
			});
			await expect(refused).rejects.toBeInstanceOf(AdminInputError);
			await expect(refused).rejects.toThrow(/Ya existe una cuenta con el correo registrada@liga\.test.*no es administrador\. No se cambió nada/);
			await expect(refused).rejects.not.toThrow(/Duplicate/);
			const [[registered]] = await pool.query<RowDataPacket[]>(
				"SELECT u.nombre, r.codigo FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.email = 'registrada@liga.test'",
			);
			expect(registered).toMatchObject({ nombre: 'Participante', codigo: 'apostador' });

			// Promotion lost to another promotion: this run's UPDATE waits on the other's lock, then finds an admin.
			const account = await signedInUser(app, pool);
			const other = await pool.getConnection();
			try {
				await other.beginTransaction();
				await other.query("UPDATE usuario SET rol_id = (SELECT id FROM rol WHERE codigo = 'admin') WHERE id = ?", [account.user.id]);
				const promotion = ensureAdmin(pool, { email: account.user.email });
				await new Promise((done) => setTimeout(done, 300));
				await other.commit();
				expect(await promotion).toMatchObject({ action: 'unchanged', user: { id: account.user.id, rol: 'admin' } });
			} finally {
				other.release();
			}
			expect(await auditRows(afterFirst)).toEqual([]);
		});

		it('if the audit record fails, the admin is not created', async () => {
			await pool.query("UPDATE accion_auditoria SET codigo = 'creacion_administrador_x' WHERE codigo = 'creacion_administrador'");
			try {
				await expect(ensureAdmin(pool, { email: 'sin.rastro@liga.test', nombre: 'Sin Rastro', password: 'clave-segura-999' })).rejects.toThrow(/accion_auditoria/);
			} finally {
				await pool.query("UPDATE accion_auditoria SET codigo = 'creacion_administrador' WHERE codigo = 'creacion_administrador_x'");
			}
			const [users] = await pool.query<RowDataPacket[]>("SELECT id FROM usuario WHERE email = 'sin.rastro@liga.test'");
			expect(users).toEqual([]);
		});
	});

	describe('forbidden keys and size limits (T-17 fix)', () => {
		it('drops every variant of a secret or personal key, and keeps ordinary ones', () => {
			const forbidden = [
				'password', 'Password', 'passwordHash', 'contraseña', 'Contrasena', 'CONTRASEÑA', 'pwd', 'userPwd', 'hash',
				'token', 'Token', 'TOKEN', 'accessToken', 'refresh_token', 'x-auth-token', 'csrf', 'X-CSRF-Token', 'csrfToken',
				'secret', 'clientSecret', 'client_secret', 'email', 'Email', 'e-mail', 'E_MAIL', 'mail', 'correo', 'apiKey', 'API_KEY',
				'api-key', 'ApiKey', 'authorization', 'Authorization', 'credencial', 'Credenciales', 'credential', 'credentials',
				'pin', 'PIN', 'userPin', 'user_pin', 'pin-code', 'pinCode', 'clave', 'claveIdempotencia', 'huella', 'cookie', 'sesion', 'sessionId', 'saldoMonedas',
			];
			// Glued or unusual spellings of the same words (second fix: matched as whole words, not substrings).
			forbidden.push(
				'userpassword', 'accesstoken', 'passwordhash', 'apikey', 'APIKey', 'XCSRFToken', 'xsrfToken', 'session_id', 'sessionid',
				'password2', 'new-password', 'correoElectronico', 'emailAddress', 'secreto', 'Huellas', 'idempotencyKey', 'Cookies',
				'passwd', 'passphrase', 'pass', 'hashed', 'saldo', 'user.email', 'authorizationHeader', 'myPin',
				// Mixed case and more glued spellings (final notes of T-17).
				'SeSiOn', 'PaSsWoRd', 'tOkEn', 'emailaddress', 'correoelectronico', 'pinnumber', 'privatekey', 'privateKey', 'PRIVATE_KEY',
			);
			for (const key of forbidden) expect(claveProhibida(key), key).toBe(true);
			const allowed = [
				'nombre', 'sede', 'escudo', 'foto', 'video', 'imagen', 'jornada', 'estadoPago', 'monedasAsignadas', 'movimientoId', 'spin', 'opinion',
				'shipping', 'origen', 'operacion',
				// Legitimate keys the substring rule dropped (tester_liga_2).
				'hashtag', 'passport', 'compass', 'secretaria', 'emailVerificado', 'mailing', 'clavel',
				'hashtags', 'bypass', 'Passport_number', 'mailingList', 'claveles', 'secretario', 'tokenizer', 'pinata', 'spinner', 'passage',
			];
			for (const key of allowed) expect(claveProhibida(key), key).toBe(false);
			// A flag like emailVerificado is kept only with a boolean value: with text it could hold the email itself.
			expect(claveProhibida('emailVerificado', true)).toBe(false);
			expect(claveProhibida('passwordRequired', null)).toBe(false);
			expect(claveProhibida('emailVerificado', 'ana@liga.test')).toBe(true);
			expect(sanitize({ emailVerificado: 'ana@liga.test', emailConfirmado: false })).toEqual({ emailConfirmado: false });
			const input = Object.fromEntries([...forbidden, ...allowed].map((key) => [key, key === 'emailVerificado' ? true : 'x']));
			expect(Object.keys(sanitize({ nested: input }) as { nested: object }).length).toBe(1);
			expect(Object.keys((sanitize({ nested: input }) as { nested: object }).nested).sort()).toEqual([...allowed].sort());
		});

		it('the binary size estimate is never below what MySQL stores', async () => {
			let seed = 7;
			const random = () => {
				seed = (seed * 1103515245 + 12345) % 2 ** 31;
				return seed / 2 ** 31;
			};
			const build = (depth: number): unknown => {
				const r = random();
				if (depth > 4 || r < 0.3) {
					const s = random();
					return s < 0.2 ? null : s < 0.4 ? Math.floor(random() * 1e6) - 5e5 : s < 0.5 ? random() * 1000 : s < 0.6 ? true : 'ñ😀x'.repeat(Math.floor(random() * 30));
				}
				if (r < 0.6) return Array.from({ length: Math.floor(random() * 12) }, () => build(depth + 1));
				return Object.fromEntries(Array.from({ length: Math.floor(random() * 12) }, (_, i) => [`k${i}${'é'.repeat(i % 3)}`, build(depth + 1)]));
			};
			for (let i = 0; i < 60; i++) {
				const value = { v: build(0) };
				const [[row]] = await pool.query<RowDataPacket[]>('SELECT JSON_STORAGE_SIZE(CAST(? AS JSON)) AS size', [JSON.stringify(value)]);
				expect(tamanoBinario(value), JSON.stringify(value).slice(0, 80)).toBeGreaterThanOrEqual(Number(row!.size));
			}
		});

		it('nested arrays over 4 KB binary (under 3000 bytes of text) and 150 levels deep are cut before the database sees them', async () => {
			const wide = Object.fromEntries(Array.from({ length: 43 }, (_, i) => [`k${i}`, Array.from({ length: 20 }, () => [])]));
			const wideText = JSON.stringify({ d: wide });
			expect(Buffer.byteLength(wideText)).toBeLessThan(MAX_DETALLE_BYTES);
			const [[raw]] = await pool.query<RowDataPacket[]>('SELECT JSON_STORAGE_SIZE(CAST(? AS JSON)) AS size', [wideText]);
			expect(Number(raw!.size)).toBeGreaterThan(4096);

			let deep: unknown = 'fondo';
			for (let i = 0; i < 150; i++) deep = [deep];
			const deepText = JSON.stringify({ d: deep });
			await expect(pool.query('SELECT CAST(? AS JSON)', [deepText])).rejects.toMatchObject({ errno: 3157 });

			const [[accion]] = await pool.query<RowDataPacket[]>("SELECT id FROM accion_auditoria WHERE codigo = 'alta_deporte'");
			for (const detail of [{ d: wide }, { d: deep }, { a: deep, b: wide, c: 'x'.repeat(5000) }]) {
				const bounded = detalleAcotado(detail);
				expect(tamanoBinario(bounded)).toBeLessThanOrEqual(MAX_DETALLE_BINARIO);
				await pool.query('INSERT INTO auditoria (usuario_id, accion_id, entidad_id, creado_en, detalle) VALUES (?, ?, 1, UTC_TIMESTAMP(), CAST(? AS JSON))', [
					api.admin.user.id,
					accion!.id,
					JSON.stringify(bounded),
				]);
			}
			const boundedDeep = JSON.stringify(detalleAcotado({ d: deep }));
			expect(boundedDeep.split('[').length - 1).toBeLessThanOrEqual(MAX_PROFUNDIDAD_DETALLE);
			expect(boundedDeep).toContain('…');
			expect(detalleAcotado({ d: wide })).toMatchObject({ recortado: true });
		});
	});

	describe('the log query uses its index (T-17 fix)', () => {
		it('with 60 000 records: no filter, or only dates, reads idx_auditoria_fecha backwards with no sort', async () => {
			const [acciones] = await pool.query<RowDataPacket[]>('SELECT id FROM accion_auditoria');
			const start = Date.now() - 60 * DAY;
			for (let batch = 0; batch < 6; batch++) {
				const rows = Array.from({ length: 10_000 }, (_, i) => {
					const n = batch * 10_000 + i;
					return [api.admin.user.id, acciones[n % acciones.length]!.id, (n % 500) + 1, new Date(start + n * 60_000), '{}'];
				});
				await pool.query('INSERT INTO auditoria (usuario_id, accion_id, entidad_id, creado_en, detalle) VALUES ?', [rows]);
			}
			await pool.query('ANALYZE TABLE auditoria');
			const middle = new Date(start + 30 * DAY);
			for (const [where, params, offset] of [
				['', [], 0],
				['', [], 50_000],
				['WHERE au.creado_en >= ?', [middle], 0],
				['WHERE au.creado_en >= ? AND au.creado_en <= ?', [middle, new Date()], 20_000],
			] as const) {
				const [plan] = await pool.query<RowDataPacket[]>(`EXPLAIN ${auditPageSql(where, true)}`, [...params, 20, offset]);
				expect(plan, `${where} ${offset}`).toHaveLength(1);
				expect(plan[0], `${where} ${offset}`).toMatchObject({ key: AUDIT_ORDER_INDEX });
				expect(String(plan[0]!.Extra), `${where} ${offset}`).toContain('Backward index scan');
				expect(String(plan[0]!.Extra), `${where} ${offset}`).not.toContain('filesort');
			}
			const timings: number[] = [];
			for (const query of ['', '?page=2500', `?desde=${encodeURIComponent(middle.toISOString())}`]) {
				const started = performance.now();
				const res = await api.get(`/auditoria${query}`);
				timings.push(performance.now() - started);
				expect(res.status).toBe(200);
				expect(res.body.data.total).toBeGreaterThan(10_000);
			}
			process.stdout.write(`auditoría con 60 000 registros: ${timings.map((t) => t.toFixed(0)).join(', ')} ms por HTTP\n`);
			const first = rowsOf(await api.get('/auditoria?pageSize=3'));
			const dates = first.map((r) => r.fecha);
			expect([...dates].sort().reverse()).toEqual(dates);
		});
	});

	describe('privacy of the detail', () => {
		it('no password, hash, token, key or email ever reaches the log', async () => {
			const who = await signedInUser(app, pool);
			await api.post(`/participantes/${who.user.id}/pago/confirmar`, {});
			await api.post(`/participantes/${who.user.id}/validar`, {});
			const bettor = await request(app).get('/auth/me').set('Cookie', who.cookie);
			const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
			const comp = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Liga' }));
			const [a, b] = [
				await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'A' }))),
				await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'B' }))),
			];
			const match = await created<{ id: number }>(
				api.post('/partidos', { competicionId: comp.id, localId: a.id, visitaId: b.id, jornada: 1, fechaHora: iso(Date.now() + 3 * DAY), sede: 'X' }),
			);
			const key = randomUUID();
			const ticket = await request(app)
				.post('/apuestas/tickets')
				.set('Cookie', who.cookie)
				.set('X-CSRF-Token', who.csrfToken)
				.set('Idempotency-Key', key)
				.send({ selecciones: [{ partidoId: match.id, tipo: 'resultado_general', pronostico: 'local_gana' }] });
			expect(ticket.status).toBe(201);
			await api.post(`/partidos/${match.id}/cancelacion/confirmar`, { confirmar: true });

			const [[stored]] = await pool.query<RowDataPacket[]>('SELECT password_hash AS hash FROM usuario WHERE id = ?', [who.user.id]);
			const hash = String(stored!.hash);
			const [dump] = await pool.query<RowDataPacket[]>('SELECT CAST(detalle AS CHAR) AS d FROM auditoria');
			expect(dump.length).toBeGreaterThanOrEqual(8);
			const text = dump.map((r) => String(r.d)).join('\n');
			const secrets = [PASSWORD, hash, '$argon2', who.csrfToken, api.admin.csrfToken, key, who.user.email, bettor.body.data.user.email, who.cookie.split('=')[1]!];
			for (const secret of secrets) expect(text, secret.slice(0, 12)).not.toContain(secret);
			expect(text).not.toMatch(/password|hash|token|clave|huella|email|saldo/i);
			// Nor in the answer of the log.
			const listed = JSON.stringify((await api.get('/auditoria?pageSize=100')).body);
			for (const secret of secrets) expect(listed).not.toContain(secret);
			expect(listed).not.toContain('@');
		});

		it('sanitize, changes and the size cap', () => {
			expect(
				sanitize({ nombre: 'x', password: 'p', passwordHash: 'h', token: 't', claveIdempotencia: 'k', email: 'a@b', saldoMonedas: 3, fecha: new Date(0), nested: { csrfToken: 'z', ok: 1 } }),
			).toEqual({ nombre: 'x', fecha: '1970-01-01T00:00:00.000Z', nested: { ok: 1 } });
			expect((sanitize('a'.repeat(500)) as string).length).toBeLessThanOrEqual(201);
			expect(cambios({ a: 1, b: { c: 1 }, same: 2 }, { a: 2, b: { c: 2 }, same: 2, d: 'nuevo' })).toEqual({
				a: { antes: 1, despues: 2 },
				b: { antes: { c: 1 }, despues: { c: 2 } },
				d: { antes: null, despues: 'nuevo' },
			});
			const huge = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`campo${i}`, 'x'.repeat(150)]));
			const cut = detalleAcotado({ cambios: huge });
			expect(cut).toMatchObject({ recortado: true });
			expect(Buffer.byteLength(JSON.stringify(cut))).toBeLessThanOrEqual(MAX_DETALLE_BYTES);
			const small = { marcador: { golesLocal: 1, golesVisitante: 0 } };
			expect(detalleAcotado(small)).toEqual(small);
		});
	});
});

interface ListedRecord {
	id: number;
	fecha: string;
	accion: { codigo: string; nombre: string };
	entidad: string;
	entidadId: number;
	administrador: { id: number; nombre: string };
	detalle: Record<string, unknown>;
}

function rowsOf(res: request.Response): ListedRecord[] {
	if (res.status !== 200) throw new Error(`auditoría: ${res.status} ${JSON.stringify(res.body)}`);
	return res.body.data.items as ListedRecord[];
}
