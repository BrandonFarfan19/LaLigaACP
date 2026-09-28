import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { lockRowsById } from '../db/locks.js';
import { assertInTransaction, type TransactionConnection } from '../db/transaction.js';
import type { TipoApuestaCodigo } from '../lib/betting.js';
import { MOVIMIENTOS, PREMIO_POR_TIPO_APUESTA } from '../lib/coins.js';
import type { OfficialResult } from '../lib/match-result.js';
import { PUNTOS_FALLO, PUNTOS_MARCADOR_EXACTO, pointsForResult } from '../lib/points.js';
import { payPrizesBatch } from './coins.service.js';
import {
	type MatchSettler,
	type SettledMatch,
	type SettlementPayout,
	type SettlementPreparer,
	SettlementRestart,
} from './results.service.js';

/**
 * Módulo Polla, T-14: its implementation of the Informativo `MatchSettler`
 * extension point (T-12). `routes/index.ts` wires it into the result
 * confirmation, so Informativo never imports this file.
 *
 * It runs once, inside the confirmation's transaction, after the match is
 * `finalizado` and with its row locked (`FOR UPDATE`). Whatever it throws
 * rolls the whole confirmation back, and a deadlock retry runs it again from
 * scratch: it only writes to the database.
 *
 * C-09 (BR-057, D-038): it also pays the prizes, 1 coin for a right general
 * result and 2 for a right exact score, through `payPrizesBatch`. Paying
 * locks users, and the app locks usuario → partido, so the winners are locked
 * by `lockPrizeWinners` (the confirmation's `prepareSettlement`) before the
 * match, and the settler starts over if a winner shows up that wasn't locked.
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
	/** C-09: the prizes this call paid (a second call pays nothing). */
	premios: SettlementPayout;
}

/** The users `lockPrizeWinners` locked, for the settler to check. */
export interface LockedWinners {
	readonly usuarios: ReadonlySet<number>;
}

const NO_PRIZES: SettlementPayout = { selecciones: 0, monedas: 0, participantes: 0 };

/**
 * The match's pending selections that the result makes right, of tickets whose
 * owner is an `apostador` today: the ones that get a prize (BR-057). An admin
 * account's selection is settled but paid nothing (BR-001, as in D-002).
 * Params: match id, then `hitParams` (see `HIT`).
 */
const PENDING_HITS_SQL = `SELECT ${pendingIndexHint('s')} s.id, t.usuario_id, tap.codigo AS tipo
	FROM seleccion s
	JOIN ticket t ON t.id = s.ticket_id
	JOIN usuario u ON u.id = t.usuario_id
	JOIN tipo_apuesta tap ON tap.id = s.tipo_apuesta_id
	WHERE s.partido_id = ?
		AND s.estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = 'pendiente')
		AND u.rol_id = (SELECT id FROM rol WHERE codigo = 'apostador')
		AND ((tap.codigo = 'resultado_general' AND s.pronostico_resultado_id = (SELECT id FROM resultado_general WHERE codigo = ?))
			OR (tap.codigo = 'marcador_exacto' AND s.pronostico_goles_local = ? AND s.pronostico_goles_visitante = ?))
	ORDER BY s.id`;

interface PendingHit {
	seleccionId: number;
	usuarioId: number;
	tipoApuesta: TipoApuestaCodigo;
}

async function pendingHits(db: Pool | TransactionConnection, matchId: number, result: OfficialResult): Promise<PendingHit[]> {
	const [rows] = await db.query<RowDataPacket[]>(PENDING_HITS_SQL, [matchId, result.resultado, result.golesLocal, result.golesVisitante]);
	return rows.map((row) => ({ seleccionId: Number(row.id), usuarioId: Number(row.usuario_id), tipoApuesta: row.tipo as TipoApuestaCodigo }));
}

/** The prize of a hit, from `lib/coins.ts` (the only place the amounts live). */
const prizeOf = (hit: PendingHit) => MOVIMIENTOS[PREMIO_POR_TIPO_APUESTA[hit.tipoApuesta]].cantidad;

function payoutOf(hits: readonly PendingHit[]): SettlementPayout {
	return {
		selecciones: hits.length,
		monedas: hits.reduce((sum, hit) => sum + prizeOf(hit), 0),
		participantes: new Set(hits.map((hit) => hit.usuarioId)).size,
	};
}

/**
 * C-09, the confirmation's `prepareSettlement`: before the match is locked,
 * reads without a lock who would be paid with this score and locks those users
 * (X, by primary key, ascending id: usuario → partido). The settler checks
 * the winners again once the match is locked.
 */
export const lockPrizeWinners: SettlementPreparer = async (conn, matchId, result): Promise<LockedWinners> => {
	assertInTransaction(conn);
	const users = (await pendingHits(conn, matchId, result)).map((hit) => hit.usuarioId);
	await lockRowsById(conn, 'usuario', users, 'UPDATE');
	return { usuarios: new Set(users) };
};


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
 * left), and so pays nothing.
 *
 * C-09 (BR-057): every selection it makes `acertada` on a ticket of an
 * `apostador` gets its prize (`payPrizesBatch`), and no other: the prize comes
 * from each selection's hit, never from its points (BR-039). The winners must
 * be among `locked` (`lockPrizeWinners`, before the match lock); one that
 * isn't means bets came in meanwhile, and it throws `SettlementRestart`
 * before changing anything. Matches confirmed before C-09 are never settled
 * again, so they get nothing (D-038: not retroactive).
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
export async function settleMatchSelections(
	conn: TransactionConnection,
	match: SettledMatch,
	locked: LockedWinners,
	now: Date = new Date(),
): Promise<SettlementSummary> {
	assertInTransaction(conn);
	if (!locked?.usuarios) throw new Error('La liquidación necesita a los ganadores bloqueados antes del partido (lockPrizeWinners).');
	const ids = await catalogIds(conn, match.resultado);
	const [pending] = await conn.query<RowDataPacket[]>(PENDING_IDS_SQL, [match.id, ids.pendiente]);
	const summary: SettlementSummary = { liquidadas: 0, acertadas: 0, puntos: 0, premios: { ...NO_PRIZES } };
	if (pending.length === 0) return summary;

	// Who gets a prize, read again now that no ticket can add a selection to this match.
	const hits = await pendingHits(conn, match.id, match);
	if (hits.some((hit) => !locked.usuarios.has(hit.usuarioId))) throw new SettlementRestart();

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
		`SELECT ${pendingIndexHint('seleccion')} COUNT(*) AS acertadas, COALESCE(SUM(puntos_obtenidos), 0) AS puntos
		FROM seleccion
		WHERE partido_id = ? AND estado_seleccion_id = ?`,
		[match.id, ids.acertada],
	);
	summary.acertadas = Number(totals!.acertadas);
	summary.puntos = Number(totals!.puntos);

	// BR-057: the prizes of the selections this call made right (payPrizesBatch checks each is `acertada`).
	if (hits.length > 0) {
		await payPrizesBatch(conn, hits, now);
		summary.premios = payoutOf(hits);
	}
	return summary;
}

/** The T-12 extension point: settles the match, pays the prizes and reports what was paid. */
export const settleMatchBets: MatchSettler = async (conn, match, prepared) =>
	(await settleMatchSelections(conn, match, prepared as LockedWinners)).premios;

/**
 * Everything the result confirmation needs from Polla (T-12, T-14, C-09),
 * wired by the composition root: lock the winners, then settle and pay them.
 * The payment is automatic: it is part of confirming the result, with no step
 * of its own.
 */
export const matchSettlement = {
	prepareSettlement: lockPrizeWinners,
	settle: settleMatchBets,
} as const;

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
