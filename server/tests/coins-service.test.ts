import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/db/transaction.js';
import { COSTO_POR_SELECCION, DEVOLUCION_POR_SELECCION, MONEDAS_POR_VALIDACION, MOVIMIENTOS } from '../src/lib/coins.js';
import { HttpError } from '../src/lib/http-error.js';
import {
	applyCoinMovements,
	applyCoinMovementsInTransaction,
	CoinMovementError,
	debitSelections,
	grantValidationCoins,
	refundSelections,
} from '../src/services/coins.service.js';
import { checkCoinConsistency } from '../src/services/coins-consistency.service.js';
import { validateParticipant } from '../src/services/participant-validation.service.js';
import { createTestApp } from './helpers/app.js';
import { registerUser, setUserState } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';
import { pendingSelections, setPayment, userState } from './helpers/participants.js';

describe('coin service (BR-009, BR-020 to BR-022, BR-046, BR-055, table 28)', () => {
	let app: Express;
	let pool: Pool;

	/** A participant validated through T-04's real flow: 10 coins, one movement. */
	async function validatedUser() {
		const { user } = await registerUser(app);
		await setPayment(pool, user.id, 'confirmado');
		await validateParticipant(pool, { actorId: 0, userId: user.id });
		return user.id;
	}

	async function movementsOf(userId: number) {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT tm.codigo, m.cantidad, m.seleccion_id AS seleccionId
			FROM movimiento_moneda m JOIN tipo_movimiento tm ON tm.id = m.tipo_movimiento_id
			WHERE m.usuario_id = ? ORDER BY m.id`,
			[userId],
		);
		return rows.map((row) => ({ codigo: row.codigo, cantidad: row.cantidad, seleccionId: row.seleccionId }));
	}

	/** Runs `fn` and returns the error it throws (or fails the test). */
	async function errorOf(fn: () => Promise<unknown>): Promise<unknown> {
		try {
			await fn();
		} catch (error) {
			return error;
		}
		throw new Error('se esperaba un error');
	}

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
	});

	afterAll(async () => {
		await pool.end();
	});

	it('amounts and signs live in lib/coins.ts', () => {
		expect(MOVIMIENTOS).toEqual({
			validacion: { cantidad: MONEDAS_POR_VALIDACION, conSeleccion: false },
			seleccion_confirmada: { cantidad: -COSTO_POR_SELECCION, conSeleccion: true },
			devolucion_cancelacion: { cantidad: DEVOLUCION_POR_SELECCION, conSeleccion: true },
		});
		expect([MONEDAS_POR_VALIDACION, COSTO_POR_SELECCION, DEVOLUCION_POR_SELECCION]).toEqual([10, 1, 1]);
	});

	describe('valid movements', () => {
		it('debits a batch of selections in one go: 10 - 3 = 7 (BR-022)', async () => {
			const userId = await validatedUser();
			const [a, b, c] = await pendingSelections(pool, userId, 3);

			const result = await withTransaction(pool, (conn) => debitSelections(conn, userId, [a!, b!, c!]));

			expect(result).toMatchObject({ saldoAnterior: 10, saldoNuevo: 7 });
			expect(result.movimientoIds).toHaveLength(3);
			expect(await userState(pool, userId)).toMatchObject({ saldo: 7, movimientos: 4, sumaMovimientos: 7 });
			expect(await movementsOf(userId)).toEqual([
				{ codigo: 'validacion', cantidad: 10, seleccionId: null },
				{ codigo: 'seleccion_confirmada', cantidad: -1, seleccionId: a },
				{ codigo: 'seleccion_confirmada', cantidad: -1, seleccionId: b },
				{ codigo: 'seleccion_confirmada', cantidad: -1, seleccionId: c },
			]);
		});

		it('refunds only the given selections (BR-046, BR-047)', async () => {
			const userId = await validatedUser();
			const [a, b, c] = await pendingSelections(pool, userId, 3);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, [a!, b!, c!]));

			const result = await withTransaction(pool, (conn) => refundSelections(conn, userId, [b!]));

			expect(result).toMatchObject({ saldoAnterior: 7, saldoNuevo: 8 });
			expect((await movementsOf(userId)).at(-1)).toEqual({ codigo: 'devolucion_cancelacion', cantidad: 1, seleccionId: b });
			expect(await userState(pool, userId)).toMatchObject({ saldo: 8, sumaMovimientos: 8 });
		});

		it('refunding the full debit restores the balance, and refunding again is refused', async () => {
			const userId = await validatedUser();
			const [a] = await pendingSelections(pool, userId, 1);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, [a!]));
			await withTransaction(pool, (conn) => refundSelections(conn, userId, [a!]));

			const error = await errorOf(() => withTransaction(pool, (conn) => refundSelections(conn, userId, [a!])));

			expect(error).toMatchObject({ status: 409, code: 'MOVEMENT_ALREADY_APPLIED', details: { selecciones: [a] } });
			expect(String((error as Error).message)).toBe('Esa selección ya se había devuelto.');
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 3, sumaMovimientos: 10 });
		});

		it('a debit that leaves exactly 0 is fine', async () => {
			const userId = await validatedUser();
			const ids = await pendingSelections(pool, userId, 10);

			expect((await applyCoinMovementsInTransaction(pool, userId, ids.map((seleccionId) => ({ tipo: 'seleccion_confirmada', seleccionId })))).saldoNuevo).toBe(0);
		});
	});

	describe('insufficient balance (BR-009, BR-021)', () => {
		it('409 INSUFFICIENT_BALANCE, and nothing of the batch is written', async () => {
			const userId = await validatedUser();
			const ids = await pendingSelections(pool, userId, 11);

			const error = await errorOf(() => withTransaction(pool, (conn) => debitSelections(conn, userId, ids)));

			expect(error).toBeInstanceOf(HttpError);
			expect(error).toMatchObject({ status: 409, code: 'INSUFFICIENT_BALANCE', details: { saldo: 10, requerido: 11 } });
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 1 });
		});

		it('a pending participant (0 coins) cannot be debited', async () => {
			const { user } = await registerUser(app);
			const [id] = await pendingSelections(pool, user.id, 1);

			expect(await errorOf(() => withTransaction(pool, (conn) => debitSelections(conn, user.id, [id!])))).toMatchObject({
				code: 'INSUFFICIENT_BALANCE',
			});
			expect(await userState(pool, user.id)).toMatchObject({ saldo: 0, movimientos: 0 });
		});
	});

	describe('refunds only give back coins that were spent (BR-046, BR-055)', () => {
		it('a selection never debited: 409 SELECTION_NOT_DEBITED, no coin created', async () => {
			const userId = await validatedUser();
			const [a] = await pendingSelections(pool, userId, 1);

			const error = await errorOf(() => withTransaction(pool, (conn) => refundSelections(conn, userId, [a!])));

			expect(error).toMatchObject({ status: 409, code: 'SELECTION_NOT_DEBITED', details: { selecciones: [a] } });
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 1 });
		});

		it('a mixed batch (one debited, one not) is refused entirely', async () => {
			const userId = await validatedUser();
			const [debited, never] = await pendingSelections(pool, userId, 2);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, [debited!]));

			const error = await errorOf(() => withTransaction(pool, (conn) => refundSelections(conn, userId, [debited!, never!])));

			expect(error).toMatchObject({ code: 'SELECTION_NOT_DEBITED', details: { selecciones: [never] } });
			expect(await userState(pool, userId)).toMatchObject({ saldo: 9, movimientos: 2, sumaMovimientos: 9 });
		});

		it('the same selection twice in one refund batch is refused, nothing refunded', async () => {
			const userId = await validatedUser();
			const [a] = await pendingSelections(pool, userId, 1);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, [a!]));

			const error = await errorOf(() => withTransaction(pool, (conn) => refundSelections(conn, userId, [a!, a!])));

			expect(error).toMatchObject({ code: 'MOVEMENT_ALREADY_APPLIED', details: { selecciones: [a] } });
			// Never refunded before: the message says it's repeated in the batch, not "already refunded".
			expect(String((error as Error).message)).toBe('La misma selección aparece más de una vez en la devolución.');
			expect(await userState(pool, userId)).toMatchObject({ saldo: 9, movimientos: 2 });
		});

		it('parallel refunds of the same debited selection: exactly one passes', async () => {
			const userId = await validatedUser();
			const [a] = await pendingSelections(pool, userId, 1);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, [a!]));

			const results = await Promise.allSettled(
				Array.from({ length: 6 }, () => withTransaction(pool, (conn) => refundSelections(conn, userId, [a!]))),
			);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 3, sumaMovimientos: 10 });
		});

		it('a movement of another user does not count as a debit', async () => {
			const userId = await validatedUser();
			const otherId = await validatedUser();
			const [mine] = await pendingSelections(pool, userId, 1);
			// Forged by hand: a debit of "mine" recorded under the other user.
			await pool.query(
				"INSERT INTO movimiento_moneda (usuario_id, tipo_movimiento_id, seleccion_id, cantidad, creado_en) SELECT ?, id, ?, -1, UTC_TIMESTAMP() FROM tipo_movimiento WHERE codigo = 'seleccion_confirmada'",
				[otherId, mine],
			);

			expect(await errorOf(() => withTransaction(pool, (conn) => refundSelections(conn, userId, [mine!])))).toMatchObject({
				code: 'SELECTION_NOT_DEBITED',
			});
		});
	});

	describe('atomic batch', () => {
		it('if the caller’s transaction fails after the movements, none of them remains', async () => {
			const userId = await validatedUser();
			const ids = await pendingSelections(pool, userId, 3);

			const error = await errorOf(() =>
				withTransaction(pool, async (conn) => {
					await debitSelections(conn, userId, ids);
					throw new Error('falla después de debitar (p. ej. al crear el ticket)');
				}),
			);

			expect(String(error)).toMatch(/falla después/);
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 1 });
		});

		it('a movement already applied rolls the whole batch back: 409 MOVEMENT_ALREADY_APPLIED', async () => {
			const userId = await validatedUser();
			const [a, b] = await pendingSelections(pool, userId, 2);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, [a!]));

			const error = await errorOf(() => withTransaction(pool, (conn) => debitSelections(conn, userId, [b!, a!])));

			expect(error).toMatchObject({ status: 409, code: 'MOVEMENT_ALREADY_APPLIED' });
			expect(await userState(pool, userId)).toMatchObject({ saldo: 9, movimientos: 2 });
		});

		it('the same selection twice in one batch is also refused', async () => {
			const userId = await validatedUser();
			const [a] = await pendingSelections(pool, userId, 1);

			expect(await errorOf(() => withTransaction(pool, (conn) => debitSelections(conn, userId, [a!, a!])))).toMatchObject({
				code: 'MOVEMENT_ALREADY_APPLIED',
			});
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 1 });
		});
	});

	describe('types and selections (EsquemaBD D19)', () => {
		it.each([
			['a debit without a selection', [{ tipo: 'seleccion_confirmada' }]],
			['a refund without a selection', [{ tipo: 'devolucion_cancelacion', seleccionId: null }]],
			['a validation with a selection', [{ tipo: 'validacion', seleccionId: 1 }]],
			['an unknown type', [{ tipo: 'regalo' }]],
			['toString as a type', [{ tipo: 'toString' }]],
			['constructor as a type', [{ tipo: 'constructor' }]],
			['__proto__ as a type', [{ tipo: '__proto__' }]],
			['hasOwnProperty as a type, with a selection', [{ tipo: 'hasOwnProperty', seleccionId: 1 }]],
			['a non-string type', [{ tipo: 42 }]],
			['an invalid selection id', [{ tipo: 'seleccion_confirmada', seleccionId: 0 }]],
			['an empty batch', []],
		])('refuses %s, before touching anything', async (_label, movements) => {
			const userId = await validatedUser();

			const error = await errorOf(() =>
				withTransaction(pool, (conn) => applyCoinMovements(conn, userId, movements as never)),
			);

			expect(error).toBeInstanceOf(CoinMovementError);
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 1 });
		});

		it.each(['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf'])(
			'%s is reported as an unknown type, never as a catalog or D19 problem',
			async (tipo) => {
				const userId = await validatedUser();

				for (const seleccionId of [undefined, 1]) {
					const error = await errorOf(() =>
						withTransaction(pool, (conn) => applyCoinMovements(conn, userId, [{ tipo, seleccionId } as never])),
					);
					expect(error).toBeInstanceOf(CoinMovementError);
					expect(String(error)).toMatch(`Tipo de movimiento desconocido: ${tipo}.`);
				}
			},
		);

		it('refuses a selection of another user, or one that does not exist', async () => {
			const userId = await validatedUser();
			const otherId = await validatedUser();
			const [foreign] = await pendingSelections(pool, otherId, 1);

			for (const ids of [[foreign!], [999_999_999]]) {
				const error = await errorOf(() => withTransaction(pool, (conn) => debitSelections(conn, userId, ids)));
				expect(error).toBeInstanceOf(CoinMovementError);
			}
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 1 });
		});

		it('an admin has no coins: 403 NOT_A_PARTICIPANT', async () => {
			const { user } = await registerUser(app);
			await setUserState(pool, user.id, { rol: 'admin' });

			expect(await errorOf(() => withTransaction(pool, (conn) => grantValidationCoins(conn, user.id)))).toMatchObject({
				status: 403,
				code: 'NOT_A_PARTICIPANT',
			});
			expect(await userState(pool, user.id)).toMatchObject({ saldo: 0, movimientos: 0 });
		});

		it('an unknown user: 404 USER_NOT_FOUND', async () => {
			expect(await errorOf(() => withTransaction(pool, (conn) => grantValidationCoins(conn, 999_999_999)))).toMatchObject({
				status: 404,
				code: 'USER_NOT_FOUND',
			});
		});

		it('the validation +10 still happens once (T-04 goes through this service)', async () => {
			const userId = await validatedUser();

			expect(await errorOf(() => withTransaction(pool, (conn) => grantValidationCoins(conn, userId)))).toMatchObject({
				code: 'MOVEMENT_ALREADY_APPLIED',
			});
			expect(await movementsOf(userId)).toEqual([{ codigo: 'validacion', cantidad: 10, seleccionId: null }]);
		});
	});

	describe('transaction contract', () => {
		it('refuses a connection that is not inside withTransaction, before writing anything', async () => {
			const userId = await validatedUser();
			const [a, b] = await pendingSelections(pool, userId, 2);
			const plain = await pool.getConnection();
			try {
				// @ts-expect-error: a plain PoolConnection is not a TransactionConnection.
				const attempt = debitSelections(plain, userId, [a!, a!, b!]);

				await expect(attempt).rejects.toThrow(/withTransaction/);
			} finally {
				plain.release();
			}
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 1 });
		});

		it('the connection stops counting as transactional once withTransaction ends', async () => {
			const userId = await validatedUser();
			const [a] = await pendingSelections(pool, userId, 1);
			let leaked: Parameters<typeof debitSelections>[0] | undefined;
			await withTransaction(pool, async (conn) => {
				leaked = conn;
			});

			await expect(debitSelections(leaked!, userId, [a!])).rejects.toThrow(/withTransaction/);
			expect(await userState(pool, userId)).toMatchObject({ saldo: 10, movimientos: 1 });
		});
	});

	describe('concurrency', () => {
		it('25 parallel one-coin debits on 10 coins: exactly 10 pass, balance 0, no mismatch', async () => {
			const userId = await validatedUser();
			const ids = await pendingSelections(pool, userId, 25);

			const results = await Promise.allSettled(
				ids.map((id) => withTransaction(pool, (conn) => debitSelections(conn, userId, [id]))),
			);

			const passed = results.filter((r) => r.status === 'fulfilled');
			const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
			expect(passed).toHaveLength(10);
			expect(failed).toHaveLength(15);
			for (const f of failed) expect(f.reason).toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
			expect(await userState(pool, userId)).toMatchObject({ saldo: 0, movimientos: 11, sumaMovimientos: 0 });
			expect((await checkCoinConsistency(pool)).ok).toBe(true);
		});

		it('parallel batches of 3 on 10 coins: only the ones that fit pass (3 of 6)', async () => {
			const userId = await validatedUser();
			const ids = await pendingSelections(pool, userId, 18);
			const batches = Array.from({ length: 6 }, (_, i) => ids.slice(i * 3, i * 3 + 3));

			const results = await Promise.allSettled(
				batches.map((batch) => withTransaction(pool, (conn) => debitSelections(conn, userId, batch))),
			);

			expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
			expect(await userState(pool, userId)).toMatchObject({ saldo: 1, movimientos: 10, sumaMovimientos: 1 });
		});

		it('debits and refunds mixed in parallel never go negative and always add up', async () => {
			const userId = await validatedUser();
			const ids = await pendingSelections(pool, userId, 30);
			await withTransaction(pool, (conn) => debitSelections(conn, userId, ids.slice(0, 5)));

			const work = [
				...ids.slice(5).map((id) => () => withTransaction(pool, (conn) => debitSelections(conn, userId, [id]))),
				...ids.slice(0, 5).map((id) => () => withTransaction(pool, (conn) => refundSelections(conn, userId, [id]))),
			];
			await Promise.allSettled(work.map((run) => run()));

			const state = await userState(pool, userId);
			expect(state.saldo).toBeGreaterThanOrEqual(0);
			expect(state.saldo).toBe(state.sumaMovimientos);
			// How many debits fit depends on when the refunds land; never more than the 10 coins available.
			expect(state.movimientos).toBeLessThanOrEqual(1 + 5 + 10 + 5);
			expect((await checkCoinConsistency(pool)).ok).toBe(true);
		});
	});
});
