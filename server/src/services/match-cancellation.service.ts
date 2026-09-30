import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { TransactionConnection } from '../db/transaction.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import type { MatchState } from '../lib/match-state.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { pendingIndexHint } from './bets-settlement.service.js';
import { find, findForUpdate, type Match, markCancelled } from './matches.service.js';

/**
 * Módulo Polla, T-16: cancelling a match (BR-045, BR-047). It spans both
 * modules: the match becomes `cancelado` (Informativo's `markCancelled`;
 * Polla may import Informativo, never the other way round) and, in the same
 * transaction, every `pendiente` selection of the match becomes `anulada`.
 * Since C-13 (D-042) nothing is refunded: there are no coins (BR-046 and
 * BR-055 are repealed), so no user row is locked either.
 *
 * Lock order (server/README.md, "Orden de bloqueo"): the match (X), then the
 * selections by primary key. A ticket locks its user (X) and then the match
 * (S): with the match held in X no ticket can add a selection to it, and the
 * cancellation takes no user lock, so the two can't wait on each other.
 *
 * 1. lock the match (X) and check its effective state;
 * 2. read its pending selections. Under READ COMMITTED this sees every
 *    ticket that committed before the lock was granted;
 * 3. void them by primary key, in batches, and mark the match `cancelado`.
 */

const LOTE = 1000;

export interface CancellationFigures {
	/** Pending selections that become `anulada` (BR-045). */
	selecciones: number;
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
	/** Test seam: runs inside the transaction, after voiding the selections and before the match changes state. */
	afterVoiding?: (conn: TransactionConnection) => Promise<void>;
}

const WARNING =
	'Cancelar el partido es definitivo: sus apuestas pendientes quedan anuladas, sin puntos, y el partido ya no se puede reprogramar ni reactivar.';

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

const pendingState = "(SELECT id FROM estado_seleccion WHERE codigo = 'pendiente')";
const voidState = "(SELECT id FROM estado_seleccion WHERE codigo = 'anulada')";

/** The match's pending selections with their ticket and user. */
const PENDING = `SELECT ${pendingIndexHint('s')} s.id, s.ticket_id, t.usuario_id
	FROM seleccion s JOIN ticket t ON t.id = s.ticket_id
	WHERE s.partido_id = ? AND s.estado_seleccion_id = ${pendingState}`;

/**
 * The figures of cancelling the match now, in one statement: its pending
 * selections, their users and tickets, and the tickets that would end up
 * with every selection voided. That last one is one aggregate per affected
 * ticket (how many of its selections stay alive), not a check per selection.
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
			(SELECT COUNT(DISTINCT usuario_id) FROM p) AS usuarios,
			(SELECT COUNT(DISTINCT ticket_id) FROM p) AS tickets,
			(SELECT COUNT(*) FROM vivas WHERE vivas = 0) AS tickets_anulados`,
		[matchId, matchId],
	);
	return {
		selecciones: Number(row!.selecciones),
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

const emptyFigures = (): CancellationFigures => ({ selecciones: 0, usuarios: 0, tickets: 0, ticketsAnulados: 0 });

/**
 * BR-045, BR-047: cancels the match for good, in one transaction. Only its
 * `pendiente` selections change (to `anulada`, points stay NULL): settled or
 * already voided ones (only possible with data loaded by hand) stay as they
 * are. The ticket's selections on other matches are untouched (BR-047).
 */
export async function cancelMatch(pool: Pool, ctx: AdminActionContext, matchId: number, deps: CancellationDeps = {}): Promise<CancelledMatch> {
	const at = now(deps);
	let result: CancellationFigures | undefined;
	const outcome = await runAdminAction<Match>(
		pool,
		ctx,
		'cancelar',
		'partido',
		async (conn) => {
			// 1. The match.
			const before = await findForUpdate(conn, matchId, at);
			const problem = cancellationProblem(before.estado);
			if (problem) throw new HttpError(409, problem.code, problem.message, { estado: before.estado });

			// 2. The selections, now that no ticket can add one.
			result = await figures(conn, matchId);
			const [pending] = await conn.query<RowDataPacket[]>(`${PENDING} ORDER BY s.id`, [matchId]);

			// 3. Void by primary key, cancel.
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
			await deps.afterVoiding?.(conn);
			await markCancelled(conn, matchId);
			return { id: matchId, before, after: await find(conn, matchId, at), detail: { ...result } };
		},
		{ isolation: 'READ COMMITTED' },
	);
	return { partido: outcome.after!, ...result! };
}
