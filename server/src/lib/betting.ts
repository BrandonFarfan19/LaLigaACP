/**
 * Betting rules that are plain numbers or plain logic (BR-014 to BR-021),
 * defined once. Services import them; tests assert against them.
 */

/** BR-014: bets on a match close this many hours before its scheduled start. */
export const HORAS_CIERRE_APUESTAS = 24;

const MS_CIERRE = HORAS_CIERRE_APUESTAS * 60 * 60 * 1000;

/** `fecha_cierre = fecha_inicio_partido - 24 horas` (BR-014). */
export function bettingCloseTime(fechaHora: Date): Date {
	return new Date(fechaHora.getTime() - MS_CIERRE);
}

/**
 * BR-014: still before the close. The close itself is already closed. This is
 * the only comparison against the close: T-07 (a match can start once it's
 * false) and T-09/T-10 (a selection needs it true) both call it.
 */
export function isBeforeBettingClose(fechaHora: Date, now: Date): boolean {
	return now.getTime() < bettingCloseTime(fechaHora).getTime();
}

/**
 * The same test in SQL: a match (whose `fecha_hora` is stored in whole
 * seconds) is before its close exactly when `fecha_hora > <this value>`.
 * Truncated to the second so MySQL never has to round a fraction: for a
 * whole-second F, `now + 24 h < F` holds exactly when `floor(now + 24 h) < F`.
 */
export function openKickoffsAfter(now: Date): Date {
	return new Date(Math.floor((now.getTime() + MS_CIERRE) / 1000) * 1000);
}

/** `tipo_apuesta.codigo` (BR-015, BR-016). */
export const TIPOS_APUESTA = ['resultado_general', 'marcador_exacto'] as const;
export type TipoApuestaCodigo = (typeof TIPOS_APUESTA)[number];

/** `resultado_general.codigo` (BR-015, BR-029): a pronóstico and a match's derived result. */
export const RESULTADOS_GENERALES = ['local_gana', 'empate', 'visitante_gana'] as const;
export type ResultadoGeneralCodigo = (typeof RESULTADOS_GENERALES)[number];

/**
 * Highest score accepted in a `marcador_exacto` pronóstico, per side. High
 * enough for basketball (BR-015 names it), far below the column's 65535.
 */
export const MAX_GOLES_PRONOSTICO = 999;

/** Most selections in one ticket (T-09 decision, business-rules.md BR-019). */
export const MAX_SELECCIONES_POR_TICKET = 50;

/** The general result a score implies (BR-029). */
export function resultOfScore(golesLocal: number, golesVisitante: number): ResultadoGeneralCodigo {
	if (golesLocal > golesVisitante) return 'local_gana';
	if (golesLocal < golesVisitante) return 'visitante_gana';
	return 'empate';
}

/** BR-015: the general results a sport lets you bet on. No draw where the sport always has a winner. */
export function allowedResults(permiteEmpate: boolean): ResultadoGeneralCodigo[] {
	return RESULTADOS_GENERALES.filter((codigo) => permiteEmpate || codigo !== 'empate');
}

/** BR-052: what the betting screen shows for a match. */
export type EstadoApuesta = 'disponible' | 'cerrada' | 'en_curso' | 'finalizado' | 'cancelado';
export const ESTADOS_APUESTA: readonly EstadoApuesta[] = ['disponible', 'cerrada', 'en_curso', 'finalizado', 'cancelado'];

/** BR-012 + BR-014: only a `programado` match before its close takes bets. */
export function bettingState(
	estado: 'programado' | 'en_curso' | 'finalizado' | 'cancelado',
	fechaHora: Date,
	now: Date,
): EstadoApuesta {
	if (estado !== 'programado') return estado;
	return isBeforeBettingClose(fechaHora, now) ? 'disponible' : 'cerrada';
}
