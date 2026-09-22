import type { RowDataPacket } from 'mysql2/promise';
import type { DrawRuleGuard } from './sports.service.js';
import { plural } from '../lib/plural.js';

/**
 * Módulo Polla: its check for the Informativo `DrawRuleGuard` extension point
 * (BR-015). Polla may depend on Informativo, not the other way around, so
 * this file imports the type and `routes/index.ts` (the composition root)
 * hands the guard to the sports routes.
 *
 * A sport with at least one selection on any of its matches keeps its
 * `permite_empate`: a draw bet could become invalid, or one refused earlier
 * could have been allowed, under the new rule.
 */
export const betsOnSportGuard: DrawRuleGuard = async (conn, sportId) => {
	const [[row]] = await conn.query<RowDataPacket[]>(
		`SELECT COUNT(*) AS n
		FROM seleccion s
		JOIN partido p ON p.id = s.partido_id
		JOIN competicion c ON c.id = p.competicion_id
		WHERE c.deporte_id = ?`,
		[sportId],
	);
	const n = Number(row?.n ?? 0);
	return n > 0 ? `sus partidos tienen ${plural(n, 'apuesta', 'apuestas')}` : null;
};
