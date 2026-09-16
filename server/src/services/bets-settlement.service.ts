import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { assertInTransaction, type TransactionConnection } from '../db/transaction.js';
import { PUNTOS_FALLO, PUNTOS_MARCADOR_EXACTO, pointsForResult } from '../lib/points.js';
import type { MatchSettler, SettledMatch } from './results.service.js';

/**
 * Módulo Polla, T-14: its implementation of the Informativo `MatchSettler`
 * extension point (T-12). `routes/index.ts` wires it into the result
 * confirmation, so Informativo never imports this file.
 *
 * It runs once, inside the confirmation's transaction, after the match is
 * `finalizado` and with its row locked (`FOR UPDATE`). Whatever it throws
 * rolls the whole confirmation back, and a deadlock retry runs it again from
 * scratch: it only writes to the database.
 */

/** Selections updated per statement: a few statements even with thousands of bets on one match. */
export const LOTE_LIQUIDACION = 1000;

/** The index that finds a match's selections by state (EsquemaBD, T-14). */
export const PENDING_INDEX = 'idx_seleccion_partido_estado';

/**
 * Optimizer hint for `PENDING_INDEX` on the table aliased `alias`. With stale
 * statistics (right after many bets came in) MySQL picked
 * `fk_seleccion_estado`, every pending selection of every match. The hint
 * works like `FORCE INDEX`, but a missing index (renamed, dropped) is only a
 * warning (3128) and MySQL plans on its own: the query stays correct, where
 * `FORCE INDEX` would fail with 1176 and turn every confirmation into a 500.
 * `tests/settlement.test.ts` checks the plan and the missing-index case.
 */
export const pendingIndexHint = (alias: string) => `/*+ INDEX(${alias} ${PENDING_INDEX}) */`;

/** The match's pending selection ids. */
export const PENDING_IDS_SQL = `SELECT ${pendingIndexHint('seleccion')} id FROM seleccion WHERE partido_id = ? AND estado_seleccion_id = ? ORDER BY id`;

export interface SettlementSummary {
	/** Selections this call moved from `pendiente` to `acertada` or `no_acertada`. */
	liquidadas: number;
	/** The match's `acertada` selections and their points, after this call (0 if it settled nothing). */
	acertadas: number;
	puntos: number;
}

/**
 * BR-034 to BR-040: every `pendiente` selection of the match, each on its
 * own, with the rule of `lib/points.ts` (`settleSelection`) written as one
 * `CASE` so a batch is a single UPDATE:
 *
 * - `resultado_general` with the match's result: `acertada`, +3 (winner) or +1 (draw);
 * - `marcador_exacto` with both sides of the score: `acertada`, +3;
 * - anything else: `no_acertada`, 0.
 *
 * Only `pendiente` selections of this match change: voided (`anulada`) or
 * already settled ones stay as they are, and so do the ticket's selections on
 * other matches. Calling it again settles nothing (there are no pending ones
 * left). No coins move (BR-039).
 *
 * Locks (server/README.md, "Orden de bloqueo"): the match row is already
 * locked by the caller, so no ticket can add a selection to this match
 * meanwhile (a ticket locks the match `FOR SHARE` first). The pending ids are
 * read without a lock, through `idx_seleccion_partido_estado`: every
 * selection on the match was committed before the match lock was granted,
 * and the transaction's snapshot is taken after it. Then each batch is
 * updated by primary key only, which locks just those rows (no secondary
 * index ranges, no gaps). The UPDATE checks `pendiente` again.
 */
export async function settleMatchSelections(conn: TransactionConnection, match: SettledMatch): Promise<SettlementSummary> {
	assertInTransaction(conn);
	const ids = await catalogIds(conn, match.resultado);
	const [pending] = await conn.query<RowDataPacket[]>(PENDING_IDS_SQL, [match.id, ids.pendiente]);
	const summary: SettlementSummary = { liquidadas: 0, acertadas: 0, puntos: 0 };
	if (pending.length === 0) return summary;

	const resultPoints = pointsForResult(match.resultado);
	// A right forecast: of the general result, or of the exact score.
	const hit = `((tipo_apuesta_id = ? AND pronostico_resultado_id = ?)
		OR (tipo_apuesta_id = ? AND pronostico_goles_local = ? AND pronostico_goles_visitante = ?))`;
	const hitParams = [ids.resultadoGeneral, ids.resultado, ids.marcadorExacto, match.golesLocal, match.golesVisitante];
	// Both assignments read only forecast columns, which this UPDATE never changes.
	const sql = `UPDATE seleccion FORCE INDEX (PRIMARY)
		SET estado_seleccion_id = IF(${hit}, ?, ?),
			puntos_obtenidos = CASE
				WHEN tipo_apuesta_id = ? AND pronostico_resultado_id = ? THEN ?
				WHEN tipo_apuesta_id = ? AND pronostico_goles_local = ? AND pronostico_goles_visitante = ? THEN ?
				ELSE ? END
		WHERE id IN (?) AND estado_seleccion_id = ?`;

	for (let start = 0; start < pending.length; start += LOTE_LIQUIDACION) {
		const batch = pending.slice(start, start + LOTE_LIQUIDACION).map((row) => Number(row.id));
		const [updated] = await conn.query<ResultSetHeader>(sql, [
			...hitParams,
			ids.acertada,
			ids.noAcertada,
			ids.resultadoGeneral,
			ids.resultado,
			resultPoints,
			ids.marcadorExacto,
			match.golesLocal,
			match.golesVisitante,
			PUNTOS_MARCADOR_EXACTO,
			PUNTOS_FALLO,
			batch,
			ids.pendiente,
		]);
		if (updated.affectedRows !== batch.length) {
			// Something changed a pending selection of a locked match: a bug, never a normal outcome.
			throw new Error(
				`Liquidación del partido ${match.id}: se esperaban ${batch.length} selecciones pendientes y se actualizaron ${updated.affectedRows}.`,
			);
		}
		summary.liquidadas += batch.length;
	}

	const [[totals]] = await conn.query<RowDataPacket[]>(
		`SELECT COUNT(*) AS acertadas, COALESCE(SUM(puntos_obtenidos), 0) AS puntos
		FROM seleccion FORCE INDEX (idx_seleccion_partido_estado)
		WHERE partido_id = ? AND estado_seleccion_id = ?`,
		[match.id, ids.acertada],
	);
	summary.acertadas = Number(totals!.acertadas);
	summary.puntos = Number(totals!.puntos);
	return summary;
}

/** The T-12 extension point: settles the match and discards the summary. */
export const settleMatchBets: MatchSettler = async (conn, match) => {
	await settleMatchSelections(conn, match);
};

/** Catalog ids by `codigo`, in one read without locks. */
async function catalogIds(conn: TransactionConnection, resultado: string) {
	const [rows] = await conn.query<RowDataPacket[]>(
		`SELECT 'estado' AS catalogo, codigo, id FROM estado_seleccion
		UNION ALL SELECT 'tipo', codigo, id FROM tipo_apuesta
		UNION ALL SELECT 'resultado', codigo, id FROM resultado_general`,
	);
	const find = (catalogo: string, codigo: string) => {
		const row = rows.find((r) => r.catalogo === catalogo && r.codigo === codigo);
		if (!row) throw new Error(`Falta ${catalogo} ${codigo} en los catálogos (¿se cargó 02-catalogos.sql?).`);
		return Number(row.id);
	};
	return {
		pendiente: find('estado', 'pendiente'),
		acertada: find('estado', 'acertada'),
		noAcertada: find('estado', 'no_acertada'),
		resultadoGeneral: find('tipo', 'resultado_general'),
		marcadorExacto: find('tipo', 'marcador_exacto'),
		resultado: find('resultado', resultado),
	};
}
