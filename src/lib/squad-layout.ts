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

/** Rows of the sample formation, front to back, as percentages of the pitch. */
const ROWS: { y: number; columns: number[] }[] = [
	{ y: 88, columns: [50] },
	{ y: 68, columns: [26, 74] },
	{ y: 46, columns: [20, 50, 80] },
	{ y: 24, columns: [30, 70] },
	{ y: 8, columns: [50] },
];

/** The spots of the formation, in the order they are filled. */
const SPOTS = ROWS.flatMap((row) => row.columns.map((x) => ({ x, y: row.y })));

export function squadPlacements(players: Player[]): ResolvedSquadPlacement[] {
	const ordered = [...players].sort((a, b) => a.shirtNumber - b.shirtNumber || a.name.localeCompare(b.name, 'es'));
	return ordered.slice(0, SPOTS.length).map((player, index) => ({
		id: `spot-${player.id}`,
		playerId: player.id,
		shirtNumber: player.shirtNumber,
		x: SPOTS[index]!.x,
		y: SPOTS[index]!.y,
		player,
	}));
}
