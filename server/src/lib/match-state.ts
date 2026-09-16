/**
 * The effective state of a match (BR-012, user decision in T-13), defined once.
 *
 * A match starts by itself: the stored state stays `programado` until an
 * action writes another one, but from its `fecha_hora` on it IS `en_curso`
 * for every rule and every answer. It lasts `DURACION_PARTIDO_MINUTOS`; after
 * that it is still `en_curso` (ended, waiting for its result) until the admin
 * confirms the result (`finalizado`, T-12) or it is cancelled (`cancelado`,
 * T-16). There is no manual start or stop.
 *
 * Computed on read, never by a scheduled job:
 * - in TypeScript, `effectiveState(stored, fechaHora, now)` for every match
 *   the API returns or a rule checks;
 * - in SQL, `effectiveStateCondition(state, now)` for filters.
 * Actions that touch the match write the state they imply (loading a result
 * writes `en_curso`, confirming writes `finalizado`).
 */

export const MATCH_STATES = ['programado', 'en_curso', 'finalizado', 'cancelado'] as const;
export type MatchState = (typeof MATCH_STATES)[number];

/** How long a match lasts, from its `fecha_hora`. Its result is confirmed only after this. */
export const DURACION_PARTIDO_MINUTOS = 60;

const MS_DURACION = DURACION_PARTIDO_MINUTOS * 60 * 1000;

/** The kick-off already came (the kick-off instant itself counts as started). */
export function hasStarted(fechaHora: Date, now: Date): boolean {
	return now.getTime() >= fechaHora.getTime();
}

/** When the match ends: `fecha_hora + 60 min`. */
export function matchEndTime(fechaHora: Date): Date {
	return new Date(fechaHora.getTime() + MS_DURACION);
}

/** The match's time is over (the end instant itself counts as over): its result can be confirmed. */
export function hasEnded(fechaHora: Date, now: Date): boolean {
	return now.getTime() >= matchEndTime(fechaHora).getTime();
}

/** BR-012: the state every rule and answer uses. */
export function effectiveState(stored: MatchState, fechaHora: Date, now: Date): MatchState {
	return stored === 'programado' && hasStarted(fechaHora, now) ? 'en_curso' : stored;
}

/**
 * `now` for SQL, truncated to the second: `fecha_hora` is stored in whole
 * seconds, so for a whole-second F, `F <= now` exactly when `F <= floor(now)`.
 * MySQL never has to round a fraction.
 */
function sqlNow(now: Date): Date {
	return new Date(Math.floor(now.getTime() / 1000) * 1000);
}

/**
 * The same rule as a SQL condition on `p.fecha_hora` and the stored code
 * `ep.codigo` (the aliases every match query uses), with its parameters.
 */
export function effectiveStateCondition(state: MatchState, now: Date): { sql: string; params: unknown[] } {
	const started = sqlNow(now);
	switch (state) {
		case 'programado':
			return { sql: "(ep.codigo = 'programado' AND p.fecha_hora > ?)", params: [started] };
		case 'en_curso':
			return { sql: "(ep.codigo = 'en_curso' OR (ep.codigo = 'programado' AND p.fecha_hora <= ?))", params: [started] };
		default:
			return { sql: '(ep.codigo = ?)', params: [state] };
	}
}
