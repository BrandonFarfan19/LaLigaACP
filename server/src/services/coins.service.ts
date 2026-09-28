import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { lockRowsById } from '../db/locks.js';
import { assertInTransaction, type TransactionConnection, withTransaction } from '../db/transaction.js';
import type { TipoApuestaCodigo } from '../lib/betting.js';
import { movementRule, PREMIO_POR_TIPO_APUESTA, SALDO_MAXIMO, TIPOS_PREMIO, type TipoMovimientoCodigo } from '../lib/coins.js';
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
	/** Required for debits, refunds and prizes; forbidden for `validacion` (D19). */
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

/** Rows per statement when a batch covers many users or selections (T-16). */
const LOTE = 1000;

function chunks<T>(items: readonly T[], size = LOTE): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
	return out;
}

/** Selection id → the user whose movement names it. */
type SelectionOwners = ReadonlyMap<number, number>;

const ownersOf = (userId: number, movements: readonly CoinMovement[]): SelectionOwners =>
	new Map(movements.flatMap((m) => (m.seleccionId ? [[m.seleccionId, userId] as const] : [])));

/** Every referenced selection must belong to a ticket of the user its movement is for. */
async function checkSelectionsOwned(conn: TransactionConnection, owners: SelectionOwners): Promise<void> {
	const foreign: number[] = [];
	const users = new Set<number>();
	for (const ids of chunks([...owners.keys()])) {
		const [rows] = await conn.query<RowDataPacket[]>(
			'SELECT s.id, t.usuario_id FROM seleccion s JOIN ticket t ON t.id = s.ticket_id WHERE s.id IN (?)',
			[ids],
		);
		const found = new Map(rows.map((row) => [Number(row.id), Number(row.usuario_id)]));
		for (const id of ids) {
			if (found.get(id) !== owners.get(id)) {
				foreign.push(id);
				users.add(owners.get(id)!);
			}
		}
	}
	if (foreign.length > 0) {
		throw new CoinMovementError(`Las selecciones ${foreign.join(', ')} no existen o no son del usuario ${[...users].join(', ')}.`);
	}
}

/**
 * BR-046/BR-055: a refund gives back a coin that was actually spent. Each
 * selection to refund needs its `seleccion_confirmada` movement for its user
 * and no `devolucion_cancelacion` yet. Runs with the users' rows locked, so a
 * concurrent debit or refund of the same user can't slip in between the check
 * and the insert. One bad selection rejects the whole batch.
 */
async function checkRefundsWereDebited(conn: TransactionConnection, owners: SelectionOwners, refundIds: readonly number[]): Promise<void> {
	if (refundIds.length === 0) return;

	const debited = new Set<number>();
	const refunded = new Set<number>();
	for (const ids of chunks([...new Set(refundIds)])) {
		const [rows] = await conn.query<RowDataPacket[]>(
			`SELECT m.seleccion_id AS seleccionId, m.usuario_id AS usuarioId, tm.codigo
			FROM movimiento_moneda m JOIN tipo_movimiento tm ON tm.id = m.tipo_movimiento_id
			WHERE m.seleccion_id IN (?) AND tm.codigo IN ('seleccion_confirmada', 'devolucion_cancelacion')`,
			[ids],
		);
		for (const row of rows) {
			const id = Number(row.seleccionId);
			if (Number(row.usuarioId) !== owners.get(id)) continue;
			(row.codigo === 'seleccion_confirmada' ? debited : refunded).add(id);
		}
	}

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
		throw new HttpError(409, ErrorCode.INSUFFICIENT_BALANCE, 'No tienes monedas suficientes para esta operación.', {
			saldo: saldoAnterior,
			requerido: -total,
		});
	}
	if (saldoNuevo > SALDO_MAXIMO) throw balanceLimitExceeded(1);

	const owners = ownersOf(userId, movements);
	await checkSelectionsOwned(conn, owners);
	await checkRefundsWereDebited(
		conn,
		owners,
		movements.filter((m) => m.tipo === 'devolucion_cancelacion').map((m) => m.seleccionId as number),
	);
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

export interface BatchMovementResult {
	/** Users whose balance the batch touched, with their balance before and after. */
	usuarios: Array<{ usuarioId: number; saldoAnterior: number; saldoNuevo: number }>;
	movimientos: number;
	/** The coins the batch moved, signed. */
	monedas: number;
}

/** The result of a refund batch (T-16). */
export type BatchRefundResult = BatchMovementResult;

/** One movement of a batch: always tied to a selection (a refund or a prize). */
export interface SelectionMovement {
	usuarioId: number;
	seleccionId: number;
	tipo: TipoMovimientoCodigo;
}

/**
 * C-09: a balance never goes past `SALDO_MAXIMO` (`saldo_monedas` is
 * SMALLINT UNSIGNED). Only reachable with a huge balance, but a movement that
 * would overflow is a clear 409 and nothing is written, never a 500 from the
 * database. The caller's whole transaction rolls back (the result
 * confirmation, the cancellation, a ticket).
 */
function balanceLimitExceeded(participantes: number): HttpError {
	return new HttpError(
		409,
		ErrorCode.BALANCE_LIMIT_EXCEEDED,
		`El saldo de ${participantes === 1 ? 'un participante' : `${participantes} participantes`} superaría el máximo de ${SALDO_MAXIMO} monedas: no se aplicó nada.`,
		{ participantes, saldoMaximo: SALDO_MAXIMO },
	);
}

/**
 * C-09: each prize names a selection that is `acertada`, and its bet type is
 * the one the prize is for (`PREMIO_POR_TIPO_APUESTA`). A caller bug otherwise.
 */
async function checkPrizesWereWon(conn: TransactionConnection, prizes: readonly SelectionMovement[]): Promise<void> {
	if (prizes.length === 0) return;
	const expected = new Map(prizes.map((p) => [p.seleccionId, p.tipo]));
	const wrong: number[] = [];
	for (const ids of chunks([...expected.keys()])) {
		const [rows] = await conn.query<RowDataPacket[]>(
			`SELECT s.id, tap.codigo AS tipo, es.codigo AS estado
			FROM seleccion s JOIN tipo_apuesta tap ON tap.id = s.tipo_apuesta_id JOIN estado_seleccion es ON es.id = s.estado_seleccion_id
			WHERE s.id IN (?)`,
			[ids],
		);
		const found = new Map(rows.map((row) => [Number(row.id), row]));
		for (const id of ids) {
			const row = found.get(id);
			if (!row || row.estado !== 'acertada' || PREMIO_POR_TIPO_APUESTA[row.tipo as TipoApuestaCodigo] !== expected.get(id)) wrong.push(id);
		}
	}
	if (wrong.length > 0) throw new CoinMovementError(`Las selecciones ${wrong.join(', ')} no están acertadas o su premio es de otro tipo.`);
}

/**
 * Selection movements (refunds of T-16, prizes of C-09) for many users at
 * once, in a few statements: lock the users, check roles, ownership, debits
 * and hits, one multi-row INSERT and one UPDATE per batch. Every rule of
 * `applyCoinMovements` holds: admins get nothing, a refund needs its debit and
 * no earlier refund, a prize needs its selection `acertada` of its bet type,
 * the same movement never twice (`uq_movimiento_seleccion_tipo`), and one bad
 * movement rejects everything (the caller's transaction rolls back).
 *
 * Locks the users' rows (`FOR UPDATE`, by primary key, ascending id). The
 * callers already hold them, before the match (usuario → partido).
 */
export async function applySelectionMovementsBatch(
	conn: TransactionConnection,
	movements: readonly SelectionMovement[],
	now: Date = new Date(),
): Promise<BatchMovementResult> {
	assertInTransaction(conn);
	if (movements.length === 0) return { usuarios: [], movimientos: 0, monedas: 0 };
	checkShape(movements.map(({ tipo, seleccionId }) => ({ tipo, seleccionId })));
	const userIds = [...new Set(movements.map((m) => m.usuarioId))].sort((a, b) => a - b);

	const saldos = new Map<number, number>();
	// One point read per user (db/locks.ts): an IN list on a small table scans the primary key and locks others.
	for (const row of await lockRowsById(conn, 'usuario', userIds, 'UPDATE', 'id, saldo_monedas AS saldo')) {
		saldos.set(Number(row.id), Number(row.saldo));
	}
	for (const ids of chunks(userIds)) {
		const [roles] = await conn.query<RowDataPacket[]>(
			'SELECT u.id FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.id IN (?) AND r.codigo <> ?',
			[ids, 'apostador'],
		);
		if (roles.length > 0) {
			throw HttpError.forbidden('Los administradores no participan en la polla: no tienen monedas.', ErrorCode.NOT_A_PARTICIPANT);
		}
	}
	const missing = userIds.filter((id) => !saldos.has(id));
	if (missing.length > 0) throw HttpError.notFound('No existe un usuario con ese id.', ErrorCode.USER_NOT_FOUND);

	const delta = new Map<number, number>();
	for (const m of movements) delta.set(m.usuarioId, (delta.get(m.usuarioId) ?? 0) + movementRule(m.tipo)!.cantidad);
	const usuarios = userIds.map((usuarioId) => {
		const saldoAnterior = saldos.get(usuarioId)!;
		return { usuarioId, saldoAnterior, saldoNuevo: saldoAnterior + delta.get(usuarioId)! };
	});
	if (usuarios.some((u) => u.saldoNuevo < 0)) {
		throw new HttpError(409, ErrorCode.INSUFFICIENT_BALANCE, 'No hay monedas suficientes para esta operación.');
	}
	const overflowing = usuarios.filter((u) => u.saldoNuevo > SALDO_MAXIMO).length;
	if (overflowing > 0) throw balanceLimitExceeded(overflowing);

	const owners: SelectionOwners = new Map(movements.map((m) => [m.seleccionId, m.usuarioId]));
	await checkSelectionsOwned(conn, owners);
	await checkRefundsWereDebited(
		conn,
		owners,
		movements.filter((m) => m.tipo === 'devolucion_cancelacion').map((m) => m.seleccionId),
	);
	await checkPrizesWereWon(
		conn,
		movements.filter((m) => TIPOS_PREMIO.includes(m.tipo)),
	);
	const typeIds = await movementTypeIds(conn, [...new Set(movements.map((m) => m.tipo))]);

	try {
		for (const batch of chunks(movements)) {
			await conn.query('INSERT INTO movimiento_moneda (usuario_id, tipo_movimiento_id, seleccion_id, cantidad, creado_en) VALUES ?', [
				batch.map((m) => [m.usuarioId, typeIds.get(m.tipo), m.seleccionId, movementRule(m.tipo)!.cantidad, now]),
			]);
		}
	} catch (error) {
		if (isDuplicateEntry(error)) {
			throw HttpError.conflict(ErrorCode.MOVEMENT_ALREADY_APPLIED, 'Ese movimiento de monedas ya se había aplicado.');
		}
		throw error;
	}
	for (const batch of chunks(usuarios.filter((u) => u.saldoNuevo !== u.saldoAnterior))) {
		await conn.query(
			`UPDATE usuario FORCE INDEX (PRIMARY) SET saldo_monedas = CASE id ${batch.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN (?)`,
			[...batch.flatMap((u) => [u.usuarioId, u.saldoNuevo]), batch.map((u) => u.usuarioId)],
		);
	}
	return { usuarios, movimientos: movements.length, monedas: [...delta.values()].reduce((sum, n) => sum + n, 0) };
}

/**
 * BR-046/BR-047/BR-055, T-16: the refunds of a cancelled match, for many users
 * at once (`applySelectionMovementsBatch`): every selection needs its debit
 * for that user and no earlier refund.
 */
export function refundSelectionsBatch(
	conn: TransactionConnection,
	refunds: ReadonlyMap<number, readonly number[]>,
	now: Date = new Date(),
): Promise<BatchMovementResult> {
	const movements = [...refunds.keys()]
		.sort((a, b) => a - b)
		.flatMap((usuarioId) => refunds.get(usuarioId)!.map((seleccionId) => ({ usuarioId, seleccionId, tipo: 'devolucion_cancelacion' as const })));
	return applySelectionMovementsBatch(conn, movements, now);
}

/**
 * BR-057, C-09: the prizes of a confirmed result, one per right selection of
 * an `apostador` ticket, by its bet type (`PREMIO_POR_TIPO_APUESTA`). Runs
 * inside the confirmation, after the settlement made them `acertada`.
 */
export function payPrizesBatch(
	conn: TransactionConnection,
	prizes: ReadonlyArray<{ usuarioId: number; seleccionId: number; tipoApuesta: TipoApuestaCodigo }>,
	now: Date = new Date(),
): Promise<BatchMovementResult> {
	return applySelectionMovementsBatch(
		conn,
		prizes.map(({ usuarioId, seleccionId, tipoApuesta }) => ({ usuarioId, seleccionId, tipo: PREMIO_POR_TIPO_APUESTA[tipoApuesta] })),
		now,
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
