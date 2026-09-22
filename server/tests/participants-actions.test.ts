import express, { type Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MONEDAS_POR_VALIDACION } from '../src/lib/coins.js';
import { createRequireAuth, requireBettor } from '../src/middleware/auth.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { validateParticipant } from '../src/services/participant-validation.service.js';
import { createTestApp, env } from './helpers/app.js';
import { login, registerUser, setUserState, signedInUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';
import { setPayment, userState } from './helpers/participants.js';

describe('participant actions (BR-006, BR-008, §23)', () => {
	let app: Express;
	let pool: Pool;
	let admin: Awaited<ReturnType<typeof signedInUser>>;

	const post = (path: string, who: { cookie: string; csrfToken: string } = admin) =>
		request(app).post(`/admin/participantes${path}`).set('Cookie', who.cookie).set('X-CSRF-Token', who.csrfToken);
	const confirm = (id: number | string) => post(`/${id}/pago/confirmar`);
	const revert = (id: number | string) => post(`/${id}/pago/revertir`);
	const validate = (id: number | string) => post(`/${id}/validar`);

	const conflict = (code: string) => ({ error: { code, message: expect.any(String) } });

	async function pendingUser() {
		return (await registerUser(app)).user;
	}

	async function paidUser() {
		const user = await pendingUser();
		await setPayment(pool, user.id, 'confirmado');
		return user;
	}

	async function validationMovements(userId: number) {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT m.cantidad, m.seleccion_id, tm.codigo
			FROM movimiento_moneda m JOIN tipo_movimiento tm ON tm.id = m.tipo_movimiento_id
			WHERE m.usuario_id = ?`,
			[userId],
		);
		return rows;
	}

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		admin = await signedInUser(app, pool, { rol: 'admin' });
	});

	afterAll(async () => {
		await pool.end();
	});

	describe('confirm payment', () => {
		it('pendiente -> confirmado, nothing else changes', async () => {
			const user = await pendingUser();
			const res = await confirm(user.id);

			expect(res.status).toBe(200);
			expect(res.body.data.participante).toMatchObject({
				id: user.id,
				estadoPago: 'confirmado',
				estadoValidacion: 'pendiente',
				saldoMonedas: 0,
				puntos: 0,
			});
			expect(await userState(pool, user.id)).toEqual({
				estadoValidacion: 'pendiente',
				estadoPago: 'confirmado',
				saldo: 0,
				movimientos: 0,
				sumaMovimientos: 0,
			});
		});

		it('twice -> 409 PAYMENT_ALREADY_CONFIRMED', async () => {
			const user = await paidUser();
			const res = await confirm(user.id);

			expect(res.status).toBe(409);
			expect(res.body).toEqual(conflict('PAYMENT_ALREADY_CONFIRMED'));
		});
	});

	describe('revert payment', () => {
		it('confirmado -> pendiente while the user is still pending', async () => {
			const user = await paidUser();
			const res = await revert(user.id);

			expect(res.status).toBe(200);
			expect(res.body.data.participante).toMatchObject({ estadoPago: 'pendiente', estadoValidacion: 'pendiente' });
		});

		it('a payment that is not confirmed -> 409 PAYMENT_NOT_CONFIRMED', async () => {
			const user = await pendingUser();

			expect((await revert(user.id)).body).toEqual(conflict('PAYMENT_NOT_CONFIRMED'));
		});

		it('never for a validated user: 409 USER_ALREADY_VALIDATED, payment stays confirmed', async () => {
			const user = await paidUser();
			await validate(user.id);

			const res = await revert(user.id);

			expect(res.status).toBe(409);
			expect(res.body).toEqual(conflict('USER_ALREADY_VALIDATED'));
			expect(await userState(pool, user.id)).toMatchObject({ estadoPago: 'confirmado', estadoValidacion: 'validado' });
		});
	});

	describe('validate', () => {
		it('without a confirmed payment -> 409 PAYMENT_NOT_CONFIRMED, no effects', async () => {
			const user = await pendingUser();
			const res = await validate(user.id);

			expect(res.status).toBe(409);
			expect(res.body).toEqual(conflict('PAYMENT_NOT_CONFIRMED'));
			expect(await userState(pool, user.id)).toEqual({
				estadoValidacion: 'pendiente',
				estadoPago: 'pendiente',
				saldo: 0,
				movimientos: 0,
				sumaMovimientos: 0,
			});
		});

		it('validates, adds 10 coins and records one +10 validacion movement', async () => {
			expect(MONEDAS_POR_VALIDACION).toBe(10);
			const user = await paidUser();

			const res = await validate(user.id);

			expect(res.status).toBe(200);
			expect(res.body.data.participante).toMatchObject({
				id: user.id,
				estadoValidacion: 'validado',
				estadoPago: 'confirmado',
				saldoMonedas: MONEDAS_POR_VALIDACION,
			});
			expect(await userState(pool, user.id)).toEqual({
				estadoValidacion: 'validado',
				estadoPago: 'confirmado',
				saldo: 10,
				movimientos: 1,
				sumaMovimientos: 10,
			});
			expect(await validationMovements(user.id)).toEqual([{ cantidad: 10, seleccion_id: null, codigo: 'validacion' }]);
		});

		it('twice -> 409 USER_ALREADY_VALIDATED and no second movement', async () => {
			const user = await paidUser();
			await validate(user.id);

			const res = await validate(user.id);

			expect(res.status).toBe(409);
			expect(res.body).toEqual(conflict('USER_ALREADY_VALIDATED'));
			expect(await userState(pool, user.id)).toMatchObject({ saldo: 10, movimientos: 1 });
		});

		it('the database refuses a second +10 even if the state was reset by hand, and rolls everything back', async () => {
			const user = await paidUser();
			await validate(user.id);
			await setUserState(pool, user.id, { estado: 'pendiente' });

			const res = await validate(user.id);

			expect(res.status).toBe(409);
			expect(res.body).toEqual(conflict('USER_ALREADY_VALIDATED'));
			// The UPDATE of the same transaction was rolled back: still pending, still 10.
			expect(await userState(pool, user.id)).toMatchObject({ estadoValidacion: 'pendiente', saldo: 10, movimientos: 1 });
		});

		it('only assigns the coins once under concurrent requests', async () => {
			for (let round = 0; round < 3; round++) {
				const user = await paidUser();

				const responses = await Promise.all(Array.from({ length: 8 }, () => validate(user.id)));

				const statuses = responses.map((res) => res.status).sort();
				expect(statuses).toEqual([200, 409, 409, 409, 409, 409, 409, 409]);
				for (const res of responses.filter((r) => r.status === 409)) {
					expect(res.body).toEqual(conflict('USER_ALREADY_VALIDATED'));
				}
				expect(await userState(pool, user.id)).toEqual({
					estadoValidacion: 'validado',
					estadoPago: 'confirmado',
					saldo: 10,
					movimientos: 1,
					sumaMovimientos: 10,
				});
			}
		});

		it('concurrent payment confirmations: one wins, the rest get 409', async () => {
			const user = await pendingUser();

			const statuses = (await Promise.all(Array.from({ length: 6 }, () => confirm(user.id)))).map((r) => r.status);

			expect(statuses.filter((s) => s === 200)).toHaveLength(1);
			expect(statuses.filter((s) => s === 409)).toHaveLength(5);
		});
	});

	describe('effect on the validated user', () => {
		it('/auth/me shows validado and 10 coins on the next request, and requireBettor lets them through', async () => {
			const { body, user } = await registerUser(app);
			const session = await login(app, body.email);
			const bettingApp = express();
			bettingApp.get('/apostar', createRequireAuth(pool, env), requireBettor, (_req, res) => {
				res.json({ data: 'ok' });
			});
			bettingApp.use(errorHandler);

			expect((await request(bettingApp).get('/apostar').set('Cookie', session.cookie)).status).toBe(403);

			await confirm(user.id);
			await validate(user.id);

			const me = await request(app).get('/auth/me').set('Cookie', session.cookie);
			expect(me.body.data.user).toMatchObject({ estadoValidacion: 'validado', estadoPago: 'confirmado', saldoMonedas: 10 });
			expect((await request(bettingApp).get('/apostar').set('Cookie', session.cookie)).status).toBe(200);
		});
	});

	describe('inputs and permissions', () => {
		it.each(['pago/confirmar', 'pago/revertir', 'validar'])('%s on a missing user -> 404 USER_NOT_FOUND', async (action) => {
			const res = await post(`/999999999/${action}`);

			expect(res.status).toBe(404);
			expect(res.body).toEqual(conflict('USER_NOT_FOUND'));
		});

		it.each(['abc', '0', '-1', '1e3', '0x10', '1.5', '99999999999999999'])('id %s -> 400', async (id) => {
			const res = await validate(id);

			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
		});

		describe('admins are not participants', () => {
			const actions = ['pago/confirmar', 'pago/revertir', 'validar'];

			it.each(actions)('%s on another admin -> 404 NOT_A_PARTICIPANT, no effects', async (action) => {
				const other = await signedInUser(app, pool, { rol: 'admin' });
				// Whatever state the admin account has, it must not matter.
				await setPayment(pool, other.user.id, action === 'pago/confirmar' ? 'pendiente' : 'confirmado');

				const res = await post(`/${other.user.id}/${action}`);

				expect(res.status).toBe(404);
				expect(res.body).toEqual(conflict('NOT_A_PARTICIPANT'));
				expect(await userState(pool, other.user.id)).toMatchObject({ estadoValidacion: 'pendiente', saldo: 0, movimientos: 0 });
			});

			it.each(actions)('%s on themselves -> 404 NOT_A_PARTICIPANT', async (action) => {
				await setPayment(pool, admin.user.id, 'confirmado');
				const res = await post(`/${admin.user.id}/${action}`);

				expect(res.status).toBe(404);
				expect(res.body).toEqual(conflict('NOT_A_PARTICIPANT'));
				expect(await userState(pool, admin.user.id)).toMatchObject({
					estadoValidacion: 'pendiente',
					estadoPago: 'confirmado',
					saldo: 0,
				});
			});

			it('an apostador promoted to admin mid-flow can no longer be validated', async () => {
				const user = await paidUser();
				await setUserState(pool, user.id, { rol: 'admin' });

				expect((await validate(user.id)).body).toEqual(conflict('NOT_A_PARTICIPANT'));
				expect(await userState(pool, user.id)).toMatchObject({ saldo: 0, movimientos: 0 });
			});
		});

		it.each(['pago/confirmar', 'pago/revertir', 'validar'])('%s: 401 without session, 403 for an apostador', async (action) => {
			const target = await paidUser();

			expect((await request(app).post(`/admin/participantes/${target.id}/${action}`)).status).toBe(401);
			const apostador = await signedInUser(app, pool, { estado: 'validado' });
			const res = await post(`/${target.id}/${action}`, apostador);
			expect(res.status).toBe(403);
			expect(res.body.error.code).toBe('FORBIDDEN');
			expect(await userState(pool, target.id)).toMatchObject({ estadoPago: 'confirmado', estadoValidacion: 'pendiente' });
		});

		it('requires the CSRF token', async () => {
			const user = await paidUser();
			const res = await request(app).post(`/admin/participantes/${user.id}/validar`).set('Cookie', admin.cookie);

			expect(res.status).toBe(403);
			expect(res.body.error.code).toBe('CSRF_FAILED');
			expect(await userState(pool, user.id)).toMatchObject({ estadoValidacion: 'pendiente', saldo: 0 });
		});
	});

	describe('hook for the audit (T-17)', () => {
		it('runs inside the transaction with the outcome', async () => {
			const user = await paidUser();
			const seen: unknown[] = [];

			await validateParticipant(
				pool,
				{ actorId: admin.user.id, userId: user.id },
				{
					inTransaction: async (conn, outcome) => {
						// Sees the uncommitted change through the same connection.
						const [rows] = await conn.query<RowDataPacket[]>('SELECT saldo_monedas FROM usuario WHERE id = ?', [user.id]);
						seen.push({ action: outcome.action, actorId: outcome.actorId, saldo: rows[0]!.saldo_monedas });
						expect(outcome.movimientoId).toEqual(expect.any(Number));
					},
				},
			);

			expect(seen).toEqual([{ action: 'validar', actorId: admin.user.id, saldo: 10 }]);
		});

		it('a failing hook rolls the whole validation back', async () => {
			const user = await paidUser();

			await expect(
				validateParticipant(
					pool,
					{ actorId: admin.user.id, userId: user.id },
					{
						inTransaction: async () => {
							throw new Error('fallo de auditoría');
						},
					},
				),
			).rejects.toThrow('fallo de auditoría');

			expect(await userState(pool, user.id)).toEqual({
				estadoValidacion: 'pendiente',
				estadoPago: 'confirmado',
				saldo: 0,
				movimientos: 0,
				sumaMovimientos: 0,
			});
		});
	});
});
