import type { PlayerStatKey, PlayerStats } from '../types';

/**
 * Sample ratings — made up here, never real data (D-022).
 *
 * The rest of the league is real since T-22: these six attributes are not, and
 * no business rule defines them nor does the schema store them. They are
 * generated from the player's real id, so they stay the same on every reload
 * and on every device instead of reshuffling, and the player's card says out
 * loud that they are a sample.
 *
 * Every attribute is a whole number between 70 and 90, so each player's
 * average lands in that range too. If real attributes ever exist, only this
 * file changes: the screen keeps reading them through `src/lib/league.ts`.
 */

const MIN = 70;
const MAX = 90;

const KEYS: PlayerStatKey[] = ['shooting', 'passing', 'strength', 'defense', 'speed', 'dribbling'];

/** FNV-1a: turns the id string into a 32-bit seed. */
function hash(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
function seededRandom(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** The sample ratings of one player, from their real id. */
export function statsForPlayer(playerId: string): PlayerStats {
	const random = seededRandom(hash(playerId));
	const stats = { playerId } as PlayerStats;
	for (const key of KEYS) {
		stats[key] = MIN + Math.floor(random() * (MAX - MIN + 1));
	}
	return stats;
}
