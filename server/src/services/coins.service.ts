import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertInTransaction, type TransactionConnection, withTransaction } from '../db/transaction.js';
import { movementRule, SALDO_MAXIMO, type TipoMovimientoCodigo } from '../lib/coins.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { isDuplicateEntry } from './users.service.js';

/**
 * THE way coins move (BR-009, table 28, EsquemaBD D12/D19). Nothing else in
 * the codebase writes `usuario.saldo_monedas` or `movimiento_moneda`.
 *
 * `applyCoinMovements(conn, userId, movements)` runs inside a transaction
 * the caller owns, together with whatever else the operation changes (the
 * ticket in T-10, the voided selections in T-16, the validated state in
 * T-04). That is enforced: `conn` must be the `TransactionConnection` that
 * `withTransaction` hands out (a plain connection doesn't compile, and is
 * rejected at runtime). In one go it:
 *
 * 1. Locks the user's row (`SELECT ... FOR UPDATE`): concurrent operations
 *    on the same user wait for each other; other users are not blocked.
 * 2. Checks the resulting balance: never negative (BR-009, BR-021) → 409
 *    `INSUFFICIENT_BALANCE`, nothing written.
 * 3. For refunds, checks that each selection was debited and not refunded
 *    yet (BR-046: only coins actually spent come back) → 409
 *    `SELECTION_NOT_DEBITED` / `MOVEMENT_ALREADY_APPLIED`, nothing written.
 * 4. Inserts one `movimiento_moneda` per movement and sets
 *    `usuario.saldo_monedas` to the new total, so the balance always equals
 *    the sum of the movements.
 *
 * If it throws, the caller's transaction rolls back and nothing of the batch
 * remains.
 */

export interface CoinMovement {
	tipo: TipoMovimientoCodigo;
	/** Required for `seleccion_confirmada` and `devolucion_cancelacion`; forbidden for `validacion` (D19). */
	seleccionId?: number | null;
}

export interface CoinMovementResult {
	saldoAnterior: number;
	saldoNuevo: number;
	/** The inserted `movimiento_moneda` ids, in the order of the movements. */
	movimientoIds: number[];
}

/**
 * A caller bug, not a user error: an unknown type, a selection where D19
 * forbids one (or none where it requires one), a selection of another user.
 * Surfaces as a 500 and rolls the transaction back.
 */
export class CoinMovementError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CoinMovementError';
	}
}

function checkShape(movements: readonly CoinMovement[]): void {
	if (movements.length === 0) throw new CoinMovementError('No hay movimientos para aplicar.');
	for (const { tipo, seleccionId } of movements) {
		const rule = movementRule(tipo);
		if (!rule) throw new CoinMovementError(`Tipo de movimiento desconocido: ${String(tipo)}.`);
		const has = seleccionId !== undefined && seleccionId !== null;
		if (has && (!Number.isSafeInteger(seleccionId) || (seleccionId as number) < 1)) {
			throw new CoinMovementError(`seleccionId inválido: ${String(seleccionId)}.`);
		}
		if (rule.conSeleccion && !has) throw new CoinMovementError(`Un movimiento ${tipo} tiene que llevar seleccionId (D19).`);
		if (!rule.conSeleccion && has) throw new CoinMovementError(`Un movimiento ${tipo} no puede llevar seleccionId (D19).`);
	}
}

async function movementTypeIds(conn: TransactionConnection, tipos: TipoMovimientoCodigo[]): Promise<Map<string, number>> {
	const [rows] = await conn.query<RowDataPacket[]>('SELECT codigo, id FROM tipo_movimiento WHERE codigo IN (?)', [tipos]);
	const ids = new Map(rows.map((row) => [row.codigo as string, row.id as number]));
	for (const tipo of tipos) {
		if (!ids.has(tipo)) throw new Error(`Falta el tipo_movimiento ${tipo} (¿se cargó 02-catalogos.sql?).`);
	}
	return ids;
}

/** Every referenced selection must belong to a ticket of this user. */
async function checkSelectionsOwned(conn: TransactionConnection, userId: number, movements: readonly CoinMovement[]): Promise<void> {
	const ids = [...new Set(movements.flatMap((m) => (m.seleccionId ? [m.seleccionId] : [])))];
	if (ids.length === 0) return;
	const [rows] = await conn.query<RowDataPacket[]>(
		'SELECT s.id FROM seleccion s JOIN ticket t ON t.id = s.ticket_id WHERE s.id IN (?) AND t.usuario_id = ?',
		[ids, userId],
	);
	if (rows.length !== ids.length) {
		const owned = new Set(rows.map((row) => row.id as number));
		const foreign = ids.filter((id) => !owned.has(id));
		throw new CoinMovementError(`Las selecciones ${foreign.join(', ')} no existen o no son del usuario ${userId}.`);
	}
}

/**
 * BR-046/BR-055: a refund gives back a coin that was actually spent. Each
 * selection to refund needs its `seleccion_confirmada` movement for this user
 * and no `devolucion_cancelacion` yet. Runs with the user's row locked, so a
 * concurrent debit or refund of the same user can't slip in between the check
 * and the insert. One bad selection rejects the whole batch.
 */
async function checkRefundsWereDebited(
	conn: TransactionConnection,
	userId: number,
	movements: readonly CoinMovement[],
): Promise<void> {
	const refundIds = movements.filter((m) => m.tipo === 'devolucion_cancelacion').map((m) => m.seleccionId as number);
	if (refundIds.length === 0) return;

	const [rows] = await conn.query<RowDataPacket[]>(
		`SELECT m.seleccion_id AS seleccionId, tm.codigo
		FROM movimiento_moneda m JOIN tipo_movimiento tm ON tm.id = m.tipo_movimiento_id
		WHERE m.usuario_id = ? AND m.seleccion_id IN (?)
			AND tm.codigo IN ('seleccion_confirmada', 'devolucion_cancelacion')`,
		[userId, [...new Set(refundIds)]],
	);
	const debited = new Set(rows.filter((r) => r.codigo === 'seleccion_confirmada').map((r) => Number(r.seleccionId)));
	const refunded = new Set(rows.filter((r) => r.codigo === 'devolucion_cancelacion').map((r) => Number(r.seleccionId)));

	const notDebited = refundIds.filter((id) => !debited.has(id));
	if (notDebited.length > 0) {
		throw new HttpError(
			409,
			ErrorCode.SELECTION_NOT_DEBITED,
			'No se puede devolver una moneda que nunca se descontó.',
			{ selecciones: [...new Set(notDebited)] },
		);
	}
	const alreadyRefunded = refundIds.filter((id) => refunded.has(id));
	if (alreadyRefunded.length > 0) {
		throw new HttpError(409, ErrorCode.MOVEMENT_ALREADY_APPLIED, 'Esa selección ya se había devuelto.', {
			selecciones: [...new Set(alreadyRefunded)],
		});
	}
	const repeatedInBatch = refundIds.filter((id, i) => refundIds.indexOf(id) !== i);
	if (repeatedInBatch.length > 0) {
		throw new HttpError(409, ErrorCode.MOVEMENT_ALREADY_APPLIED, 'La misma selección aparece más de una vez en la devolución.', {
			selecciones: [...new Set(repeatedInBatch)],
		});
	}
}

export async function applyCoinMovements(
	conn: TransactionConnection,
	userId: number,
	movements: readonly CoinMovement[],
	now: Date = new Date(),
): Promise<CoinMovementResult> {
	assertInTransaction(conn);
	checkShape(movements);

	// Lock only the user's row, by primary key, in its own statement (the app's
	// lock order starts with usuario: server/README.md, "Orden de bloqueo").
	// The role is read after, from the locked row.
	const [[user]] = await conn.query<RowDataPacket[]>(
		'SELECT saldo_monedas AS saldo, rol_id FROM usuario FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE',
		[userId],
	);
	if (user) {
		const [[rol]] = await conn.query<RowDataPacket[]>('SELECT codigo FROM rol WHERE id = ?', [user.rol_id]);
		user.rol = rol?.codigo;
	}
	if (!user) throw HttpError.notFound('No existe un usuario con ese id.', ErrorCode.USER_NOT_FOUND);
	if (user.rol !== 'apostador') {
		// BR-001: admins have no coins. Callers already filter them out; this is the last line.
		throw HttpError.forbidden('Los administradores no participan en la polla: no tienen monedas.', ErrorCode.NOT_A_PARTICIPANT);
	}

	const saldoAnterior = Number(user.saldo);
	const total = movements.reduce((sum, m) => sum + movementRule(m.tipo)!.cantidad, 0);
	const saldoNuevo = saldoAnterior + total;
	if (saldoNuevo < 0) {
		throw new HttpError(409, ErrorCode.INSUFFICIENT_BALANCE, 'No tenés monedas suficientes para esta operación.', {
			saldo: saldoAnterior,
			requerido: -total,
		});
	}
	if (saldoNuevo > SALDO_MAXIMO) throw new CoinMovementError(`El saldo superaría el máximo (${SALDO_MAXIMO}).`);

	await checkSelectionsOwned(conn, userId, movements);
	await checkRefundsWereDebited(conn, userId, movements);
	const typeIds = await movementTypeIds(conn, [...new Set(movements.map((m) => m.tipo))]);

	const movimientoIds: number[] = [];
	try {
		for (const movement of movements) {
			const [inserted] = await conn.query<ResultSetHeader>(
				'INSERT INTO movimiento_moneda (usuario_id, tipo_movimiento_id, seleccion_id, cantidad, creado_en) VALUES (?, ?, ?, ?, ?)',
				[userId, typeIds.get(movement.tipo), movement.seleccionId ?? null, movementRule(movement.tipo)!.cantidad, now],
			);
			movimientoIds.push(inserted.insertId);
		}
	} catch (error) {
		if (isDuplicateEntry(error)) {
			// D19 / UNIQUE(seleccion_id, tipo): this exact movement was already applied.
			throw HttpError.conflict(ErrorCode.MOVEMENT_ALREADY_APPLIED, 'Ese movimiento de monedas ya se había aplicado.');
		}
		throw error;
	}

	if (total !== 0) {
		await conn.query('UPDATE usuario SET saldo_monedas = ? WHERE id = ?', [saldoNuevo, userId]);
	}
	return { saldoAnterior, saldoNuevo, movimientoIds };
}

/** BR-008: the +10 of a validation. Used by T-04's `validateParticipant`. */
export function grantValidationCoins(conn: TransactionConnection, userId: number): Promise<CoinMovementResult> {
	return applyCoinMovements(conn, userId, [{ tipo: 'validacion' }]);
}

/** BR-020/BR-022: one debit per confirmed selection, all or none, one lock. For T-10. */
export function debitSelections(conn: TransactionConnection, userId: number, seleccionIds: readonly number[]): Promise<CoinMovementResult> {
	return applyCoinMovements(
		conn,
		userId,
		seleccionIds.map((seleccionId) => ({ tipo: 'seleccion_confirmada', seleccionId })),
	);
}

/** BR-046/BR-055: one refund per voided selection of this user. For T-16 (group the selections by user). */
export function refundSelections(conn: TransactionConnection, userId: number, seleccionIds: readonly number[]): Promise<CoinMovementResult> {
	return applyCoinMovements(
		conn,
		userId,
		seleccionIds.map((seleccionId) => ({ tipo: 'devolucion_cancelacion', seleccionId })),
	);
}

/** Convenience for a coin-only operation: its own transaction. */
export function applyCoinMovementsInTransaction(
	pool: Pool,
	userId: number,
	movements: readonly CoinMovement[],
): Promise<CoinMovementResult> {
	return withTransaction(pool, (conn) => applyCoinMovements(conn, userId, movements));
}
