import type { Player, ResolvedSquadPlacement } from '../types';

/**
 * Where each player stands on the pitch drawing. The schema has no position
 * and the API sends none (server/README.md, "Contrato para T-22"), so this is
 * a sample layout, like the radar ratings (D-022): players are placed in
 * their shirt-number order over a fixed 2-3-1 shape, and the same squad always
 * lands the same way.
 *
 * Only the drawing uses it; nothing here claims to be a real line-up.
 */

/** Which drawing the squad stands on. */
export type Court = 'futbol' | 'voley';

/** A volleyball sport (any spelling: "Vóley mixto", "Voleibol", "Volley") gets its court; everything else the pitch. */
export function courtFor(sportName: string): Court {
	const plain = sportName.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
	return /vol+ey|voleibol/.test(plain) ? 'voley' : 'futbol';
}

type Row = { y: number; columns: number[] };

/** Rows of the sample formation, front to back, as percentages of the drawing. */
const ROWS: Record<Court, Row[]> = {
	// A 1-2-3-2-1 shape over the whole pitch.
	futbol: [
		{ y: 88, columns: [50] },
		{ y: 68, columns: [26, 74] },
		{ y: 46, columns: [20, 50, 80] },
		{ y: 24, columns: [30, 70] },
		{ y: 8, columns: [50] },
	],
	// The six on court, grouped on one side of the net (the lower half of the
	// drawing, net at 44%, baseline at 85%): front row by the net, back row behind.
	voley: [
		{ y: 57, columns: [20, 50, 80] },
		{ y: 76, columns: [20, 50, 80] },
	],
};

/** The spots of each formation, in the order they are filled. */
const SPOTS = Object.fromEntries(
	Object.entries(ROWS).map(([court, rows]) => [court, rows.flatMap((row) => row.columns.map((x) => ({ x, y: row.y })))]),
) as Record<Court, { x: number; y: number }[]>;

export function squadPlacements(players: Player[], court: Court = 'futbol'): ResolvedSquadPlacement[] {
	const spots = SPOTS[court];
	const ordered = [...players].sort((a, b) => a.shirtNumber - b.shirtNumber || a.name.localeCompare(b.name, 'es'));
	return ordered.slice(0, spots.length).map((player, index) => ({
		id: `spot-${player.id}`,
		playerId: player.id,
		shirtNumber: player.shirtNumber,
		x: spots[index]!.x,
		y: spots[index]!.y,
		player,
	}));
}
