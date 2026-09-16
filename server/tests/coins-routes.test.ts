import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/db/transaction.js';
import { debitSelections, refundSelections } from '../src/services/coins.service.js';
import { validateParticipant } from '../src/services/participant-validation.service.js';
import { createTestApp } from './helpers/app.js';
import { login, registerUser, setUserState, signedInUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';
import { pendingSelections, setPayment } from './helpers/participants.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

describe('coin routes (BR-002, BR-010) and the consistency check', () => {
	let app: Express;
	let pool: Pool;

	/** A validated participant with a session. */
	async function validatedSession() {
		const { body, user } = await registerUser(app);
		await setPayment(pool, user.id, 'confirmado');
		await validateParticipant(pool, { actorId: 0, userId: user.id });
		return { userId: user.id, ...(await login(app, body.email)) };
	}

	const get = (path: string, cookie: string) => request(app).get(path).set('Cookie', cookie);

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
	});

	afterAll(async () => {
		await pool.end();
	});

	describe('GET /monedas/saldo', () => {
		it('returns the same balance as /auth/me', async () => {
			const { cookie, userId } = await validatedSession();
			const ids = await pendingSelections(pool, userId, 3);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, ids));

			const res = await get('/monedas/saldo', cookie);

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ data: { saldoMonedas: 7 } });
			expect((await get('/auth/me', cookie)).body.data.user.saldoMonedas).toBe(7);
		});

		it('a pending participant sees 0', async () => {
			const { cookie } = await signedInUser(app, pool);

			expect((await get('/monedas/saldo', cookie)).body).toEqual({ data: { saldoMonedas: 0 } });
		});

		it('takes no query parameters', async () => {
			const { cookie } = await validatedSession();

			expect((await get('/monedas/saldo?x=1', cookie)).status).toBe(400);
		});
	});

	describe('GET /monedas/movimientos', () => {
		it('lists the own movements, newest first, with type, signed amount, UTC date and selection', async () => {
			const { cookie, userId } = await validatedSession();
			const [a, b] = await pendingSelections(pool, userId, 2);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, [a!, b!]));
			await withTransaction(pool, (conn) => refundSelections(conn, userId, [b!]));
			const other = await validatedSession();

			const res = await get('/monedas/movimientos', cookie);

			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({ page: 1, pageSize: 20, total: 4, totalPages: 1 });
			const items = res.body.data.items as Array<Record<string, unknown>>;
			expect(items.map((m) => [(m.tipo as { codigo: string }).codigo, m.cantidad, (m.seleccion as { id: number } | null)?.id ?? null])).toEqual([
				['devolucion_cancelacion', 1, b],
				['seleccion_confirmada', -1, b],
				['seleccion_confirmada', -1, a],
				['validacion', 10, null],
			]);
			expect(items[0]).toEqual({
				id: expect.any(Number),
				tipo: { codigo: 'devolucion_cancelacion', nombre: 'Devolución por cancelación' },
				cantidad: 1,
				creadoEn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/),
				seleccion: { id: b, ticketId: expect.any(Number), partidoId: expect.any(Number) },
			});
			expect(items.at(-1)!.seleccion).toBeNull();
			// Only their own: the other participant's validation is not among the 4, and they see just theirs.
			expect((await get('/monedas/movimientos', other.cookie)).body.data.total).toBe(1);
		});

		it('orders by date, not by id', async () => {
			const { cookie, userId } = await validatedSession();
			const [a] = await pendingSelections(pool, userId, 1);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, [a!]));
			// Make the validation (lower id) the newest one.
			await pool.query("UPDATE movimiento_moneda m JOIN tipo_movimiento tm ON tm.id = m.tipo_movimiento_id SET m.creado_en = '2030-01-01 00:00:00' WHERE m.usuario_id = ? AND tm.codigo = 'validacion'", [userId]);

			const codes = (await get('/monedas/movimientos', cookie)).body.data.items.map((m: { tipo: { codigo: string } }) => m.tipo.codigo);

			expect(codes).toEqual(['validacion', 'seleccion_confirmada']);
		});

		it('pages', async () => {
			const { cookie, userId } = await validatedSession();
			const ids = await pendingSelections(pool, userId, 5);
			for (const id of ids) await withTransaction(pool, (conn) => debitSelections(conn, userId, [id]));

			const page2 = await get('/monedas/movimientos?pageSize=2&page=2', cookie);
			expect(page2.body.data).toMatchObject({ page: 2, pageSize: 2, total: 6, totalPages: 3 });
			expect(page2.body.data.items.map((m: { seleccion: { id: number } }) => m.seleccion.id)).toEqual([ids[2], ids[1]]);
			expect((await get('/monedas/movimientos?pageSize=2&page=4', cookie)).body.data.items).toEqual([]);
		});

		it('a pending participant has an empty history', async () => {
			const { cookie } = await signedInUser(app, pool);

			expect((await get('/monedas/movimientos', cookie)).body.data).toEqual({ items: [], page: 1, pageSize: 20, total: 0, totalPages: 0 });
		});

		it.each(['x=1', 'usuarioId=1', 'page=0', 'pageSize=101', 'orden=asc'])('?%s -> 400', async (query) => {
			const { cookie } = await validatedSession();
			const res = await get(`/monedas/movimientos?${query}`, cookie);

			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
		});
	});

	describe('access to /monedas', () => {
		it.each(['/monedas/saldo', '/monedas/movimientos'])('%s: 401 without a session', async (path) => {
			const res = await request(app).get(path);

			expect(res.status).toBe(401);
			expect(res.body.error.code).toBe('UNAUTHENTICATED');
		});

		it.each(['/monedas/saldo', '/monedas/movimientos'])(
			'%s: 403 NOT_A_PARTICIPANT for an admin, even one with a validated state',
			async (path) => {
				const { cookie } = await signedInUser(app, pool, { rol: 'admin', estado: 'validado' });
				const res = await get(path, cookie);

				expect(res.status).toBe(403);
				expect(res.body).toEqual({ error: { code: 'NOT_A_PARTICIPANT', message: expect.any(String) } });
			},
		);
	});

	describe('consistency check', () => {
		async function adminCookie() {
			return (await signedInUser(app, pool, { rol: 'admin' })).cookie;
		}

		it('GET /admin/monedas/consistencia: all good after real operations', async () => {
			const { userId } = await validatedSession();
			const ids = await pendingSelections(pool, userId, 4);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, ids));
			await validatedSession();

			const res = await get('/admin/monedas/consistencia', await adminCookie());

			expect(res.status).toBe(200);
			expect(res.body).toEqual({ data: { ok: true, revisados: 2, descuadres: [], adminsConMonedas: [] } });
		});

		it('lists a mismatch provoked by hand, and changes nothing', async () => {
			const { userId } = await validatedSession();
			await pool.query('UPDATE usuario SET saldo_monedas = 15 WHERE id = ?', [userId]);

			const res = await get('/admin/monedas/consistencia', await adminCookie());

			expect(res.body.data).toMatchObject({
				ok: false,
				descuadres: [{ usuarioId: userId, saldo: 15, sumaMovimientos: 10, diferencia: 5, email: expect.any(String), nombre: expect.any(String) }],
			});
			const [[row]] = await pool.query<import('mysql2/promise').RowDataPacket[]>('SELECT saldo_monedas FROM usuario WHERE id = ?', [userId]);
			expect(row!.saldo_monedas).toBe(15);
		});

		it('detects a movement without balance, and an admin with coins', async () => {
			const { userId } = await validatedSession();
			await pool.query('UPDATE usuario SET saldo_monedas = 0 WHERE id = ?', [userId]);
			const { user: adminUser } = await registerUser(app);
			await setUserState(pool, adminUser.id, { rol: 'admin' });
			await pool.query('UPDATE usuario SET saldo_monedas = 4 WHERE id = ?', [adminUser.id]);

			const data = (await get('/admin/monedas/consistencia', await adminCookie())).body.data;

			expect(data.ok).toBe(false);
			expect(data.descuadres).toEqual([expect.objectContaining({ usuarioId: userId, saldo: 0, sumaMovimientos: 10, diferencia: -10 })]);
			expect(data.adminsConMonedas).toEqual([expect.objectContaining({ usuarioId: adminUser.id, saldo: 4, movimientos: 0 })]);
		});

		it('is admin-only and takes no query', async () => {
			expect((await request(app).get('/admin/monedas/consistencia')).status).toBe(401);
			const { cookie } = await validatedSession();
			expect((await get('/admin/monedas/consistencia', cookie)).status).toBe(403);
			expect((await get('/admin/monedas/consistencia?x=1', await adminCookie())).status).toBe(400);
		});

		describe('npm run coins:check', () => {
			function cli() {
				return new Promise<{ code: number | null; stdout: string }>((done, fail) => {
					const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/coins-check.ts'], {
						cwd: serverDir,
						env: { ...process.env, NODE_ENV: 'test' },
					});
					let stdout = '';
					child.stdout.on('data', (chunk) => (stdout += String(chunk)));
					child.on('error', fail);
					child.on('close', (code) => done({ code, stdout }));
					child.stdin.end();
				});
			}

			it('exit 0 when everything adds up', async () => {
				await validatedSession();

				const { code, stdout } = await cli();

				expect(code).toBe(0);
				expect(stdout).toMatch(/1 participante\(s\) revisado\(s\)/);
				expect(stdout).toMatch(/Todo cuadra/);
			});

			it('exit 1 listing the mismatches, without fixing them', async () => {
				const { userId } = await validatedSession();
				await pool.query('UPDATE usuario SET saldo_monedas = 3 WHERE id = ?', [userId]);

				const { code, stdout } = await cli();

				expect(code).toBe(1);
				expect(stdout).toMatch(new RegExp(`DESCUADRE usuario ${userId} .*saldo 3, suma de movimientos 10, diferencia -7`));
				expect(stdout).toMatch(/No se corrigió nada/);
				const [[row]] = await pool.query<import('mysql2/promise').RowDataPacket[]>('SELECT saldo_monedas FROM usuario WHERE id = ?', [userId]);
				expect(row!.saldo_monedas).toBe(3);
			});
		});
	});
});
