import type { RowDataPacket } from 'mysql2/promise';
import { pendingIndexHint } from './bets-settlement.service.js';
import type { MatchBetsProbe } from './matches.service.js';
import type { PendingSelectionsProbe } from './results.service.js';

/**
 * Módulo Polla: its implementation of the Informativo `MatchBetsProbe`
 * extension point (T-07). `routes/index.ts` wires it into the match routes,
 * so Informativo never imports this file. Counts every selection on the
 * match, whatever its state: an annulled bet is still a bet on those teams.
 */
export const countBetsOnMatch: MatchBetsProbe = async (conn, matchId) => {
	const [[row]] = await conn.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM seleccion WHERE partido_id = ?', [matchId]);
	return Number(row?.n ?? 0);
};

/**
 * T-12's `PendingSelectionsProbe`: how many selections of the match are still
 * `pendiente`, i.e. what confirming its result will settle (BR-034).
 */
export const countPendingSelections: PendingSelectionsProbe = async (db, matchId) => {
	const [[row]] = await db.query<RowDataPacket[]>(
		`SELECT ${pendingIndexHint('s')} COUNT(*) AS n FROM seleccion s
		WHERE s.partido_id = ? AND s.estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = 'pendiente')`,
		[matchId],
	);
	return Number(row?.n ?? 0);
};
