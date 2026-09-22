/**
 * The pool ranking's rules (BR-041 to BR-044, T-15), defined once. The
 * ranking itself is computed in SQL on every read (`services/ranking.service.ts`,
 * `RANK()`); `rankParticipants` is the same rule in TypeScript, and a test
 * keeps both equal.
 */

/** BR-042: the top shows every participant whose position is at most this. Ties at the edge all get in. */
export const POSICIONES_TOP = 10;

/**
 * Most rows the top returns (T-15 fix). With the pool just opened everyone is
 * tied at 0, and "every position up to 10" would be the whole pool. The
 * caller's own row always comes apart, and the answer says how many tied
 * participants were left out.
 */
export const MAX_FILAS_TOP = 50;

export interface RankingScore {
	id: number;
	nombre: string;
	/** BR-039/BR-040: `SUM(seleccion.puntos_obtenidos)`. */
	puntos: number;
	/** BR-042 (T-11): selections in state `acertada`, of any type. */
	aciertos: number;
}

export interface RankedScore extends RankingScore {
	posicion: number;
}

/**
 * BR-041, BR-043: more points first, then more hits. A full tie shares its
 * position, and the next one skips as many places as were shared
 * ("1, 1, 3"), so a position always says how many are ahead plus one.
 * Inside a tie, rows are listed by name with Spanish rules (ñ is its own
 * letter, after n; case and accents don't count), then by id. The SQL uses
 * `utf8mb4_es_0900_ai_ci` for the same order (`NOMBRE_ORDEN`). That order is
 * only for display and never changes a position.
 */
export function rankParticipants(scores: readonly RankingScore[]): RankedScore[] {
	const byName = new Intl.Collator('es', { sensitivity: 'base' });
	const sorted = [...scores].sort(
		(a, b) => b.puntos - a.puntos || b.aciertos - a.aciertos || byName.compare(a.nombre, b.nombre) || a.id - b.id,
	);
	let posicion = 0;
	return sorted.map((row, i) => {
		const prev = sorted[i - 1];
		if (!prev || prev.puntos !== row.puntos || prev.aciertos !== row.aciertos) posicion = i + 1;
		return { ...row, posicion };
	});
}
