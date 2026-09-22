import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db/transaction.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { findAccountRole, findParticipant, type Participant } from './participants.service.js';
import { grantValidationCoins } from './coins.service.js';

/**
 * The admin actions of the participation flow (business-rules.md §23):
 * confirm the payment, then validate. Each one runs in a single transaction
 * and changes the row only through an `UPDATE ... WHERE <expected state>`,
 * so a repeated or concurrent call finds nothing to change and answers 409
 * without side effects.
 *
 * The target is always an `apostador`: admins don't take part in the pool
 * (BR-001), so every UPDATE also requires that role, and an admin account
 * answers 404 `NOT_A_PARTICIPANT`. That also covers an admin acting on
 * their own account.
 *
 * T-17 (audit) wraps these without touching them: `hooks.inTransaction`
 * runs inside the same transaction, after the change and before the commit,
 * with the actor, the target and the outcome — an audit insert there commits
 * or rolls back together with the action.
 */

export type ParticipantAction = 'confirmar_pago' | 'revertir_pago' | 'validar';

export interface ParticipantActionInput {
	/** The admin doing it (`req.auth.user.id`). */
	actorId: number;
	/** The account it's done to. */
	userId: number;
}

export interface ParticipantActionOutcome {
	action: ParticipantAction;
	actorId: number;
	participant: Participant;
	/** Only for `validar`: the `movimiento_moneda` row created. */
	movimientoId?: number;
}

export interface ParticipantActionHooks {
	inTransaction?: (conn: PoolConnection, outcome: ParticipantActionOutcome) => Promise<void>;
}

const CATALOG_IDS = `SELECT
	(SELECT id FROM estado_usuario WHERE codigo = 'pendiente') AS usuarioPendiente,
	(SELECT id FROM estado_usuario WHERE codigo = 'validado') AS usuarioValidado,
	(SELECT id FROM estado_pago WHERE codigo = 'pendiente') AS pagoPendiente,
	(SELECT id FROM estado_pago WHERE codigo = 'confirmado') AS pagoConfirmado,
	(SELECT id FROM rol WHERE codigo = 'apostador') AS rolApostador`;

type CatalogIds = Record<
	'usuarioPendiente' | 'usuarioValidado' | 'pagoPendiente' | 'pagoConfirmado' | 'rolApostador',
	number
>;

/** Catalog ids resolved by `codigo`, never hardcoded. */
async function catalogIds(conn: PoolConnection): Promise<CatalogIds> {
	const [[row]] = await conn.query<RowDataPacket[]>(CATALOG_IDS);
	if (!row) throw new Error('No se pudieron leer los catálogos.');
	for (const [name, id] of Object.entries(row)) {
		if (id == null) throw new Error(`Falta la fila de catálogo ${name} (¿se cargó 02-catalogos.sql?).`);
	}
	return row as CatalogIds;
}

/** See TransactionOptions: the 409 reason must reflect a concurrent commit. */
const CHECK_AND_SET = { isolation: 'READ COMMITTED' } as const;

const errors = {
	notFound: () => HttpError.notFound('No existe un usuario con ese id.', ErrorCode.USER_NOT_FOUND),
	notAParticipant: () =>
		HttpError.notFound(
			'Esa cuenta es de un administrador: los administradores no participan en la polla.',
			ErrorCode.NOT_A_PARTICIPANT,
		),
	paymentAlreadyConfirmed: () =>
		HttpError.conflict(ErrorCode.PAYMENT_ALREADY_CONFIRMED, 'El pago de este usuario ya estaba confirmado.'),
	paymentNotConfirmed: (detail: string) => HttpError.conflict(ErrorCode.PAYMENT_NOT_CONFIRMED, detail),
	alreadyValidated: (detail = 'El usuario ya está validado.') =>
		HttpError.conflict(ErrorCode.USER_ALREADY_VALIDATED, detail),
};

/**
 * The current participant, read with the transaction's connection. 404
 * `USER_NOT_FOUND` if the account doesn't exist, 404 `NOT_A_PARTICIPANT` if
 * it is an admin: `/admin/participantes/:id` names a participant, and an
 * admin isn't one. A 404 rather than a 409 because no state change could
 * ever make the action valid on that account.
 */
async function mustFind(conn: PoolConnection, userId: number): Promise<Participant> {
	const participant = await findParticipant(conn, userId);
	if (participant) return participant;
	throw (await findAccountRole(conn, userId)) ? errors.notAParticipant() : errors.notFound();
}

async function finish(
	conn: PoolConnection,
	hooks: ParticipantActionHooks,
	outcome: Omit<ParticipantActionOutcome, 'participant'>,
	userId: number,
): Promise<ParticipantActionOutcome> {
	const full = { ...outcome, participant: await mustFind(conn, userId) };
	await hooks.inTransaction?.(conn, full);
	return full;
}

/** §23 step 1: payment `pendiente` → `confirmado`. */
export async function confirmPayment(
	pool: Pool,
	input: ParticipantActionInput,
	hooks: ParticipantActionHooks = {},
): Promise<ParticipantActionOutcome> {
	return withTransaction(pool, async (conn) => {
		const ids = await catalogIds(conn);
		const [result] = await conn.query<ResultSetHeader>(
			'UPDATE usuario SET estado_pago_id = ? WHERE id = ? AND rol_id = ? AND estado_pago_id = ?',
			[ids.pagoConfirmado, input.userId, ids.rolApostador, ids.pagoPendiente],
		);
		if (result.affectedRows !== 1) {
			await mustFind(conn, input.userId);
			throw errors.paymentAlreadyConfirmed();
		}
		return finish(conn, hooks, { action: 'confirmar_pago', actorId: input.actorId }, input.userId);
	}, CHECK_AND_SET);
}

/**
 * Undoes a payment confirmed by mistake: `confirmado` → `pendiente`, only
 * while the user is still `pendiente`. Never for a validated user: their
 * validation (and the 10 coins) rests on that payment (BR-006), and
 * validation is not reversible.
 */
export async function revertPayment(
	pool: Pool,
	input: ParticipantActionInput,
	hooks: ParticipantActionHooks = {},
): Promise<ParticipantActionOutcome> {
	return withTransaction(pool, async (conn) => {
		const ids = await catalogIds(conn);
		const [result] = await conn.query<ResultSetHeader>(
			'UPDATE usuario SET estado_pago_id = ? WHERE id = ? AND rol_id = ? AND estado_pago_id = ? AND estado_usuario_id = ?',
			[ids.pagoPendiente, input.userId, ids.rolApostador, ids.pagoConfirmado, ids.usuarioPendiente],
		);
		if (result.affectedRows !== 1) {
			const current = await mustFind(conn, input.userId);
			if (current.estadoValidacion === 'validado') {
				throw errors.alreadyValidated('El usuario ya está validado: su pago no se puede revertir.');
			}
			throw errors.paymentNotConfirmed('El pago de este usuario no está confirmado: no hay nada que revertir.');
		}
		return finish(conn, hooks, { action: 'revertir_pago', actorId: input.actorId }, input.userId);
	}, CHECK_AND_SET);
}

/**
 * §23 step 2, BR-006/BR-008, in one transaction:
 *
 * 1. `pendiente` → `validado`, in an UPDATE that only matches a `pendiente`
 *    `apostador` with payment `confirmado`. Two concurrent calls: InnoDB
 *    locks the row, the second re-reads it after the first commits, matches
 *    nothing and gets 409.
 * 2. The +10 through the coin service (`grantValidationCoins`, T-05): the
 *    `validacion` movement and the new balance. `uq_movimiento_sin_seleccion`
 *    (EsquemaBD D19) rejects a second one for the same user even if the state
 *    had been reset by hand; the whole transaction is then rolled back.
 */
export async function validateParticipant(
	pool: Pool,
	input: ParticipantActionInput,
	hooks: ParticipantActionHooks = {},
): Promise<ParticipantActionOutcome> {
	return withTransaction(pool, async (conn) => {
		const ids = await catalogIds(conn);
		const [result] = await conn.query<ResultSetHeader>(
			`UPDATE usuario
			SET estado_usuario_id = ?
			WHERE id = ? AND rol_id = ? AND estado_usuario_id = ? AND estado_pago_id = ?`,
			[ids.usuarioValidado, input.userId, ids.rolApostador, ids.usuarioPendiente, ids.pagoConfirmado],
		);
		if (result.affectedRows !== 1) {
			const current = await mustFind(conn, input.userId);
			if (current.estadoValidacion === 'validado') throw errors.alreadyValidated();
			throw errors.paymentNotConfirmed('Primero hay que confirmar el pago del usuario; después se lo puede validar.');
		}

		let movimientoId: number;
		try {
			[movimientoId] = (await grantValidationCoins(conn, input.userId)).movimientoIds as [number];
		} catch (error) {
			if (error instanceof HttpError && error.code === ErrorCode.MOVEMENT_ALREADY_APPLIED) {
				throw errors.alreadyValidated('Este usuario ya recibió sus monedas de validación: no se asignan dos veces.');
			}
			throw error;
		}

		return finish(conn, hooks, { action: 'validar', actorId: input.actorId, movimientoId }, input.userId);
	}, CHECK_AND_SET);
}
