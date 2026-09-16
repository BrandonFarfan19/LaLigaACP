/**
 * BR-013, "ordenar por proximidad de fecha", defined once for every match
 * list: admin (T-07), public fixture and landing (T-08), betting (T-19) and
 * the admin panel (T-21).
 *
 * 1. First the matches still ahead (`fecha_hora >= ahora`), soonest first.
 * 2. Then the ones already past (`fecha_hora < ahora`), most recent first.
 * 3. Same date: lowest id first.
 *
 * "ahora" is the moment of the request.
 */

/** `ORDER BY` fragment and its two parameters (both `now`), for a DATETIME column in UTC. */
export function proximityOrderBy(column: string, idColumn: string, now: Date): { sql: string; params: [Date, Date] } {
	return {
		sql: `(${column} < ?) ASC, CASE WHEN ${column} >= ? THEN ${column} END ASC, ${column} DESC, ${idColumn} ASC`,
		params: [now, now],
	};
}

/** The same order in memory, for lists that aren't sorted by SQL (and for tests). */
export function compareByProximity(
	a: { fechaHora: Date; id: number },
	b: { fechaHora: Date; id: number },
	now: Date,
): number {
	const aPast = a.fechaHora < now;
	const bPast = b.fechaHora < now;
	if (aPast !== bPast) return aPast ? 1 : -1;
	const byDate = aPast ? b.fechaHora.getTime() - a.fechaHora.getTime() : a.fechaHora.getTime() - b.fechaHora.getTime();
	return byDate !== 0 ? byDate : a.id - b.id;
}
