import type { TipoApuestaCodigo } from './betting.js';
import type { OfficialResult, ResultadoGeneralCodigo } from './match-result.js';

/**
 * Pool points (table 27 of business-rules.md, BR-035 to BR-038). The only
 * place these numbers live. Points measure performance and never turn into
 * coins (BR-039): settling a selection moves no `movimiento_moneda`.
 * `seleccion.puntos_obtenidos` only admits these values (`ck_seleccion_puntos`).
 */

/** BR-035: the right winner (`resultado_general`, local or visitante). */
export const PUNTOS_GANADOR = 3;

/** BR-036: the right draw (`resultado_general` = `empate`). */
export const PUNTOS_EMPATE = 1;

/** BR-037: both sides of the score right (`marcador_exacto`). */
export const PUNTOS_MARCADOR_EXACTO = 3;

/** Table 27: any wrong selection. */
export const PUNTOS_FALLO = 0;

/** A selection's forecast, in the shape `seleccion` stores it. */
export type Forecast =
	| { tipo: Extract<TipoApuestaCodigo, 'resultado_general'>; pronostico: ResultadoGeneralCodigo }
	| { tipo: Extract<TipoApuestaCodigo, 'marcador_exacto'>; golesLocal: number; golesVisitante: number };

export interface Settlement {
	estado: 'acertada' | 'no_acertada';
	puntos: number;
}

/** Points a right `resultado_general` forecast earns for a given result. */
export const pointsForResult = (resultado: ResultadoGeneralCodigo) => (resultado === 'empate' ? PUNTOS_EMPATE : PUNTOS_GANADOR);

/**
 * BR-034 to BR-038: one selection, on its own, against the confirmed result.
 * No selection earns points for another type (BR-038): a right winner never
 * adds the exact score's points, and the other way round. The settlement SQL
 * (`services/bets-settlement.service.ts`) applies this same rule in bulk; a
 * test checks both agree for every combination.
 */
export function settleSelection(forecast: Forecast, result: OfficialResult): Settlement {
	if (forecast.tipo === 'resultado_general') {
		return forecast.pronostico === result.resultado
			? { estado: 'acertada', puntos: pointsForResult(result.resultado) }
			: { estado: 'no_acertada', puntos: PUNTOS_FALLO };
	}
	return forecast.golesLocal === result.golesLocal && forecast.golesVisitante === result.golesVisitante
		? { estado: 'acertada', puntos: PUNTOS_MARCADOR_EXACTO }
		: { estado: 'no_acertada', puntos: PUNTOS_FALLO };
}
