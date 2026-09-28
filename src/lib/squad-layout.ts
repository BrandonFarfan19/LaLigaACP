import type { Player, ResolvedSquadPlacement } from '../types';

/**
 * Where each player stands on the pitch drawing. The schema has no position
 * and the API sends none (server/README.md, "Contrato para T-22"), so the
 * drawing is a random one (C-06, D-035; the radar's statistics, instead, are
 * real since C-05): a draw picks **who** goes on the fixed shape — 1-2-3-2-1
 * on the pitch (9 spots), two rows of three on the volleyball court (6, the
 * side that is on court) — and **which spot** each one takes. A squad with
 * fewer players than spots puts all of them in, on spots drawn too.
 *
 * The chance comes in as a parameter (`Math.random` by default), so tests are
 * deterministic. `SquadBoard` draws once per visit: it picks a seed when it
 * mounts and feeds `seededRandom(seed)`, so every render lands the same way
 * until the page is entered or reloaded again.
 *
 * Everyone left out of the drawing is in the roster table beside it, with
 * their own card. Only the drawing uses this; nothing here claims to be a
 * real line-up, and the pitch says so (D-033).
 */

/** A number in [0, 1), like `Math.random`. */
export type Random = () => number;

/**
 * mulberry32: a tiny generator that gives the same sequence for the same
 * seed, so one draw can be repeated on every render.
 */
export function seededRandom(seed: number): Random {
	let a = Math.floor(seed * 2 ** 32) | 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Fisher-Yates over a copy: every order equally likely. */
function shuffled<T>(items: readonly T[], random: Random): T[] {
	const out = [...items];
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.min(i, Math.floor(random() * (i + 1)));
		[out[i], out[j]] = [out[j]!, out[i]!];
	}
	return out;
}

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

/** Who goes on the drawing and where, drawn with `random` (see the module comment). */
export function squadPlacements(players: Player[], court: Court = 'futbol', random: Random = Math.random): ResolvedSquadPlacement[] {
	const chosen = shuffled(players, random).slice(0, SPOTS[court].length);
	const spots = shuffled(SPOTS[court], random);
	return chosen.map((player, index) => ({
		id: `spot-${player.id}`,
		playerId: player.id,
		shirtNumber: player.shirtNumber,
		x: spots[index]!.x,
		y: spots[index]!.y,
		player,
	}));
}
