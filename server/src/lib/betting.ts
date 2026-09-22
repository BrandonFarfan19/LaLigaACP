import { MAX_GOLES, RESULTADOS_GENERALES, type ResultadoGeneralCodigo } from './match-result.js';
import type { MatchState } from './match-state.js';

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

// The result codes and the derived result live in lib/match-result.ts (T-12), shared with Informativo.
export { RESULTADOS_GENERALES, type ResultadoGeneralCodigo, resultOfScore } from './match-result.js';

/** Highest score accepted in a `marcador_exacto` pronóstico, per side: the same limit as a loaded result. */
export const MAX_GOLES_PRONOSTICO = MAX_GOLES;

/** Most selections in one ticket (T-09 decision, business-rules.md BR-019). */
export const MAX_SELECCIONES_POR_TICKET = 50;

/** BR-015: the general results a sport lets you bet on. No draw where the sport always has a winner. */
export function allowedResults(permiteEmpate: boolean): ResultadoGeneralCodigo[] {
	return RESULTADOS_GENERALES.filter((codigo) => permiteEmpate || codigo !== 'empate');
}

/** BR-052: what the betting screen shows for a match. */
export type EstadoApuesta = 'disponible' | 'cerrada' | 'en_curso' | 'finalizado' | 'cancelado';
export const ESTADOS_APUESTA: readonly EstadoApuesta[] = ['disponible', 'cerrada', 'en_curso', 'finalizado', 'cancelado'];

/**
 * BR-012 + BR-014: only a `programado` match before its close takes bets.
 * `estado` must be the effective state (lib/match-state.ts).
 */
export function bettingState(estado: MatchState, fechaHora: Date, now: Date): EstadoApuesta {
	if (estado !== 'programado') return estado;
	return isBeforeBettingClose(fechaHora, now) ? 'disponible' : 'cerrada';
}

/** `estado_seleccion.codigo` (BR-027). */
export const ESTADOS_SELECCION = ['pendiente', 'acertada', 'no_acertada', 'anulada'] as const;
export type EstadoSeleccion = (typeof ESTADOS_SELECCION)[number];

/** BR-025, derived and never stored (EsquemaBD: the ticket has no state column). */
export const ESTADOS_TICKET = ['pendiente', 'finalizado', 'anulado'] as const;
export type EstadoTicket = (typeof ESTADOS_TICKET)[number];

/**
 * A ticket's state from its selections (T-10 decision, business-rules.md
 * BR-025): `pendiente` while any selection is still pending; once none is,
 * `anulado` if every selection was voided (all its matches were cancelled),
 * and `finalizado` otherwise.
 */
export function ticketState(estados: readonly EstadoSeleccion[]): EstadoTicket {
	return ticketStateFromCounts({
		total: estados.length,
		pendientes: estados.filter((estado) => estado === 'pendiente').length,
		anuladas: estados.filter((estado) => estado === 'anulada').length,
	});
}

/** How many selections a ticket has, in total and in the states its own state depends on. */
export interface TicketCounts {
	total: number;
	pendientes: number;
	anuladas: number;
}

/** The same rule from counts (what SQL aggregates return). */
export function ticketStateFromCounts({ total, pendientes, anuladas }: TicketCounts): EstadoTicket {
	if (pendientes > 0) return 'pendiente';
	if (total > 0 && anuladas === total) return 'anulado';
	return 'finalizado';
}


/**
 * The same rule as a SQL condition, over an aggregate with columns `total`,
 * `pendientes` and `anuladas` (T-11 filters and counts). A test checks it
 * against `ticketStateFromCounts` for every combination.
 */
export function ticketStateCondition(estado: EstadoTicket, alias: string): string {
	switch (estado) {
		case 'pendiente':
			return `${alias}.pendientes > 0`;
		case 'anulado':
			return `(${alias}.pendientes = 0 AND ${alias}.total > 0 AND ${alias}.anuladas = ${alias}.total)`;
		case 'finalizado':
			return `(${alias}.pendientes = 0 AND NOT (${alias}.total > 0 AND ${alias}.anuladas = ${alias}.total))`;
	}
}
