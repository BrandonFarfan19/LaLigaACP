import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { TransactionConnection } from '../db/transaction.js';
import { DEVOLUCION_POR_SELECCION } from '../lib/coins.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import type { MatchState } from '../lib/match-state.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { pendingIndexHint } from './bets-settlement.service.js';
import { refundSelectionsBatch } from './coins.service.js';
import { find, findForUpdate, type Match, markCancelled } from './matches.service.js';

/**
 * Módulo Polla, T-16: cancelling a match (BR-045 to BR-047, BR-055). It spans
 * both modules: the match becomes `cancelado` (Informativo's `markCancelled`;
 * Polla may import Informativo, never the other way round) and, in the same
 * transaction, every `pendiente` selection of the match becomes `anulada`
 * and gets its coin back (`refundSelectionsBatch`).
 *
 * Lock order (server/README.md, "Orden de bloqueo"): usuario → partido →
 * seleccion. A ticket locks its user (X) and then the match (S), so the
 * cancellation can't lock the match first and the users after. Instead:
 *
 * 1. read, without locks, the users with pending selections on the match;
 * 2. lock those users (X, by primary key, ascending id);
 * 3. lock the match (X) and check its effective state;
 * 4. read the pending selections again. Under READ COMMITTED this sees every
 *    ticket that committed before the match lock was granted, and no new one
 *    can come while it is held. If a user appears that step 2 didn't lock,
 *    the whole transaction is rolled back and run again (`MAX_INTENTOS`);
 * 5. void the selections by primary key, in batches, refund the debited ones
 *    and mark the match `cancelado`.
 */

/** How many times the cancellation starts over when bets from new users came in meanwhile. */
export const MAX_INTENTOS_CANCELACION = 3;

const LOTE = 1000;

/** How often a cancellation started over because new bettors showed up, for tests and diagnostics. */
export const cancellationStats = { restarts: 0 };

export interface CancellationFigures {
	/** Pending selections that become `anulada` (BR-045). */
	selecciones: number;
	/** Coins given back: one per voided selection that was debited, of an `apostador` account (BR-046). */
	monedasDevueltas: number;
	/**
	 * Voided selections that give nothing back, by reason. Both are only
	 * possible with data loaded by hand: `sinDebito`, never debited (it never
	 * cost a coin); `cuentaAdministrador`, the account is an admin today
	 * (D-002: admins have no coins, BR-001).
	 */
	seleccionesSinDevolucion: { total: number; sinDebito: number; cuentaAdministrador: number };
	/** Users with a voided selection. */
	usuarios: number;
	/** Tickets with a voided selection. */
	tickets: number;
	/** Of those, tickets left with every selection voided (BR-025: `anulado`). */
	ticketsAnulados: number;
}

export interface CancellationProblem {
	code: ErrorCode;
	message: string;
}

export interface CancellationPreview extends CancellationFigures {
	partido: Match;
	puedeCancelar: boolean;
	problemas: CancellationProblem[];
	advertencia: string;
}

export interface CancelledMatch extends CancellationFigures {
	partido: Match;
}

export interface CancellationDeps {
	now?: () => Date;
	/** Test seam: runs inside the transaction, after the refunds and before the match changes state. */
	afterRefunds?: (conn: TransactionConnection) => Promise<void>;
}

const WARNING =
	'Cancelar el partido es definitivo: sus apuestas pendientes quedan anuladas, se devuelve 1 moneda por cada una y el partido ya no se puede reprogramar ni reactivar.';

const now = (deps: CancellationDeps) => (deps.now ?? (() => new Date()))();

/** A finished or cancelled match can't be cancelled; anything else can (programado or en_curso, with goals or media too). */
function cancellationProblem(estado: MatchState): CancellationProblem | null {
	if (estado === 'finalizado') {
		return {
			code: ErrorCode.MATCH_ALREADY_FINISHED,
			message: 'El partido ya tiene su resultado confirmado: no se puede cancelar.',
		};
	}
	if (estado === 'cancelado') {
		return { code: ErrorCode.MATCH_ALREADY_CANCELLED, message: 'El partido ya está cancelado.' };
	}
	return null;
}

/** Raised inside the transaction when bets from users that weren't locked showed up: start over. */
class AffectedUsersChanged extends Error {}

const pendingState = "(SELECT id FROM estado_seleccion WHERE codigo = 'pendiente')";
const voidState = "(SELECT id FROM estado_seleccion WHERE codigo = 'anulada')";
const debitType = "(SELECT id FROM tipo_movimiento WHERE codigo = 'seleccion_confirmada')";
const bettorRole = "(SELECT id FROM rol WHERE codigo = 'apostador')";

/**
 * The match's pending selections with their user, whether that user is an
 * `apostador` today, and whether the selection was debited.
 */
const PENDING = `SELECT ${pendingIndexHint('s')} s.id, s.ticket_id, t.usuario_id,
		u.rol_id = ${bettorRole} AS apostador,
		EXISTS (SELECT 1 FROM movimiento_moneda m WHERE m.seleccion_id = s.id AND m.tipo_movimiento_id = ${debitType}) AS debitada
	FROM seleccion s JOIN ticket t ON t.id = s.ticket_id JOIN usuario u ON u.id = t.usuario_id
	WHERE s.partido_id = ? AND s.estado_seleccion_id = ${pendingState}`;

/**
 * The figures of cancelling the match now, in one statement: its pending
 * selections, their users and tickets, what comes back and what doesn't, and
 * the tickets that would end up with every selection voided. That last one
 * is one aggregate per affected ticket (how many of its selections stay
 * alive), not a check per selection.
 */
async function figures(db: Pool | TransactionConnection, matchId: number): Promise<CancellationFigures> {
	const [[row]] = await db.query<RowDataPacket[]>(
		`WITH p AS (${PENDING}),
		vivas AS (
			SELECT o.ticket_id,
				SUM(o.estado_seleccion_id <> ${voidState} AND NOT (o.partido_id = ? AND o.estado_seleccion_id = ${pendingState})) AS vivas
			FROM seleccion o
			WHERE o.ticket_id IN (SELECT ticket_id FROM p)
			GROUP BY o.ticket_id
		)
		SELECT (SELECT COUNT(*) FROM p) AS selecciones,
			(SELECT COALESCE(SUM(apostador AND debitada), 0) FROM p) AS devueltas,
			(SELECT COALESCE(SUM(apostador AND NOT debitada), 0) FROM p) AS sin_debito,
			(SELECT COALESCE(SUM(NOT apostador), 0) FROM p) AS admin,
			(SELECT COUNT(DISTINCT usuario_id) FROM p) AS usuarios,
			(SELECT COUNT(DISTINCT ticket_id) FROM p) AS tickets,
			(SELECT COUNT(*) FROM vivas WHERE vivas = 0) AS tickets_anulados`,
		[matchId, matchId],
	);
	const sinDebito = Number(row!.sin_debito);
	const cuentaAdministrador = Number(row!.admin);
	return {
		selecciones: Number(row!.selecciones),
		monedasDevueltas: Number(row!.devueltas) * DEVOLUCION_POR_SELECCION,
		seleccionesSinDevolucion: { total: sinDebito + cuentaAdministrador, sinDebito, cuentaAdministrador },
		usuarios: Number(row!.usuarios),
		tickets: Number(row!.tickets),
		ticketsAnulados: Number(row!.tickets_anulados),
	};
}

/** BR-045 preview: what cancelling would do, without writing or locking anything. */
export async function getCancellationPreview(pool: Pool, matchId: number, deps: CancellationDeps = {}): Promise<CancellationPreview> {
	const partido = await find(pool, matchId, now(deps));
	const problem = cancellationProblem(partido.estado);
	const counted = problem ? emptyFigures() : await figures(pool, matchId);
	return { partido, ...counted, puedeCancelar: !problem, problemas: problem ? [problem] : [], advertencia: WARNING };
}

const emptyFigures = (): CancellationFigures => ({
	selecciones: 0,
	monedasDevueltas: 0,
	seleccionesSinDevolucion: { total: 0, sinDebito: 0, cuentaAdministrador: 0 },
	usuarios: 0,
	tickets: 0,
	ticketsAnulados: 0,
});

/**
 * The `apostador` accounts with pending selections on the match: the ones
 * whose balance may change. Admin accounts (D-002) are not locked: nothing is
 * refunded to them, and only their selections change.
 */
async function usersWithPending(conn: TransactionConnection, matchId: number): Promise<number[]> {
	const [rows] = await conn.query<RowDataPacket[]>(`SELECT DISTINCT p.usuario_id FROM (${PENDING}) p WHERE p.apostador`, [matchId]);
	return rows.map((row) => Number(row.usuario_id)).sort((a, b) => a - b);
}

/**
 * BR-045 to BR-047, BR-055: cancels the match for good, in one transaction.
 * Only its `pendiente` selections change (to `anulada`, points stay NULL):
 * settled or already voided ones (only possible with data loaded by hand)
 * stay as they are and get nothing back. Every voided selection that was
 * debited gets its coin back; one with no debit, or of an account that is an
 * admin today (D-002), is voided with no refund, and never blocks the
 * cancellation. The ticket's selections on other matches are untouched (BR-047).
 */
export async function cancelMatch(pool: Pool, ctx: AdminActionContext, matchId: number, deps: CancellationDeps = {}): Promise<CancelledMatch> {
	const at = now(deps);
	for (let attempt = 1; ; attempt++) {
		try {
			return await cancelOnce(pool, ctx, matchId, at, deps);
		} catch (error) {
			if (!(error instanceof AffectedUsersChanged)) throw error;
			cancellationStats.restarts++;
			if (attempt >= MAX_INTENTOS_CANCELACION) {
				throw HttpError.conflict(
					ErrorCode.CONCURRENT_UPDATE,
					'Siguen entrando apuestas a este partido: vuelve a intentar la cancelación.',
				);
			}
		}
	}
}

async function cancelOnce(pool: Pool, ctx: AdminActionContext, matchId: number, at: Date, deps: CancellationDeps): Promise<CancelledMatch> {
	let result: CancellationFigures | undefined;
	const outcome = await runAdminAction<Match>(
		pool,
		ctx,
		'cancelar',
		'partido',
		async (conn) => {
			// 1-2. The users first (usuario → partido).
			const users = await usersWithPending(conn, matchId);
			for (let i = 0; i < users.length; i += LOTE) {
				await conn.query('SELECT id FROM usuario FORCE INDEX (PRIMARY) WHERE id IN (?) ORDER BY id FOR UPDATE', [users.slice(i, i + LOTE)]);
			}
			// 3. The match.
			const before = await findForUpdate(conn, matchId, at);
			const problem = cancellationProblem(before.estado);
			if (problem) throw new HttpError(409, problem.code, problem.message, { estado: before.estado });

			// 4. The selections, again, now that no ticket can add one.
			result = await figures(conn, matchId);
			const [pending] = await conn.query<RowDataPacket[]>(`${PENDING} ORDER BY s.id`, [matchId]);
			const locked = new Set(users);
			if (pending.some((row) => row.apostador && !locked.has(Number(row.usuario_id)))) throw new AffectedUsersChanged();

			// 5. Void by primary key, refund, cancel.
			const ids = pending.map((row) => Number(row.id));
			for (let i = 0; i < ids.length; i += LOTE) {
				const batch = ids.slice(i, i + LOTE);
				const [updated] = await conn.query<ResultSetHeader>(
					`UPDATE seleccion FORCE INDEX (PRIMARY) SET estado_seleccion_id = ${voidState}, puntos_obtenidos = NULL
					WHERE id IN (?) AND estado_seleccion_id = ${pendingState}`,
					[batch],
				);
				if (updated.affectedRows !== batch.length) {
					throw new Error(`Cancelación del partido ${matchId}: se esperaban ${batch.length} selecciones pendientes y se anularon ${updated.affectedRows}.`);
				}
			}
			// Only debited selections of apostador accounts come back (BR-046; D-002: an admin account gets nothing).
			const refunds = new Map<number, number[]>();
			for (const row of pending) {
				if (!row.debitada || !row.apostador) continue;
				const userId = Number(row.usuario_id);
				const list = refunds.get(userId);
				if (list) list.push(Number(row.id));
				else refunds.set(userId, [Number(row.id)]);
			}
			await refundSelectionsBatch(conn, refunds, at);
			await deps.afterRefunds?.(conn);
			await markCancelled(conn, matchId);
			return { id: matchId, before, after: await find(conn, matchId, at), detail: { ...result } };
		},
		{ isolation: 'READ COMMITTED' },
	);
	return { partido: outcome.after!, ...result! };
}

