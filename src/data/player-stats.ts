import type { PlayerStatKey, PlayerStats } from '../types';
import { players } from './players';

/**
 * Placeholder ratings — random, not real data.
 *
 * Every attribute is a whole number between 70 and 90, so each player's
 * average lands in that range too. The generator is seeded by the player id:
 * the numbers look random but stay the same on every build, instead of
 * reshuffling each time the site is deployed.
 *
 * When the backend arrives this whole file is replaced by the
 * `player_stats` table; `src/lib/players.ts` is the only reader.
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

export const playerStats: PlayerStats[] = players.map((player) => {
	const random = seededRandom(hash(player.id));
	const stats = { playerId: player.id } as PlayerStats;
	for (const key of KEYS) {
		stats[key] = MIN + Math.floor(random() * (MAX - MIN + 1));
	}
	return stats;
});
