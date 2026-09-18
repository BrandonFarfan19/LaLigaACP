import type { RankingData, RankingRow } from '../types/betting';
import { api } from './api';

/**
 * The pool ranking (T-20, BR-041 to BR-044). Computed by the backend on every
 * read (T-15), so reading it again is all "updating" takes.
 */
export function getRanking(signal?: AbortSignal): Promise<RankingData> {
	return api.get<RankingData>('/ranking', { signal });
}

/** Positions held by more than one row of the list (a full tie, BR-043). */
export function sharedPositions(rows: readonly RankingRow[]): Set<number> {
	const seen = new Set<number>();
	const shared = new Set<number>();
	for (const row of rows) {
		if (seen.has(row.posicion)) shared.add(row.posicion);
		seen.add(row.posicion);
	}
	return shared;
}
