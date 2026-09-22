/**
 * A match's official result (BR-028, BR-029, BR-049), defined once. Used by
 * the admin result flow (T-12), the public API (T-08), the ticket receipt and
 * history (T-10, T-11) and the settlement of bets (T-14). Computed, never
 * stored (EsquemaBD: the general result is not a column).
 */

/** `resultado_general.codigo` (BR-015, BR-029): a match's derived result, and a bet's forecast. */
export const RESULTADOS_GENERALES = ['local_gana', 'empate', 'visitante_gana'] as const;
export type ResultadoGeneralCodigo = (typeof RESULTADOS_GENERALES)[number];

/**
 * Highest score per side, for a loaded result (T-12) and an exact-score
 * forecast (T-09). High enough for basketball, far below the columns'
 * SMALLINT UNSIGNED.
 */
export const MAX_GOLES = 999;

/** BR-029: the general result a score implies. */
export function resultOfScore(golesLocal: number, golesVisitante: number): ResultadoGeneralCodigo {
	if (golesLocal > golesVisitante) return 'local_gana';
	if (golesLocal < golesVisitante) return 'visitante_gana';
	return 'empate';
}

export interface OfficialResult {
	golesLocal: number;
	golesVisitante: number;
	resultado: ResultadoGeneralCodigo;
}

/**
 * The result the app shows to users (BR-049, BR-050, BR-026): only once the
 * match is `finalizado` (confirmed, BR-031) and both sides are loaded.
 * Anything else, including a score loaded while the match is in progress,
 * is `null`.
 */
export function officialResult(
	estado: string,
	golesLocal: number | null | undefined,
	golesVisitante: number | null | undefined,
): OfficialResult | null {
	if (estado !== 'finalizado' || golesLocal === null || golesLocal === undefined) return null;
	if (golesVisitante === null || golesVisitante === undefined) return null;
	return { golesLocal, golesVisitante, resultado: resultOfScore(golesLocal, golesVisitante) };
}
