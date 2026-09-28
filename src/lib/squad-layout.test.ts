import { describe, expect, it } from 'vitest';
import type { Player } from '../types';
import { courtFor, seededRandom, squadPlacements } from './squad-layout';

const squad = (count: number): Player[] =>
	Array.from({ length: count }, (_, index) => ({ id: String(index + 1), teamId: '1', name: `Jugador ${index + 1}`, photo: null, shirtNumber: index + 1 }));

describe('courtFor', () => {
	it('a volleyball sport gets its court, whatever the spelling', () => {
		for (const name of ['Voley mixto', 'Vóley', 'VOLEIBOL', 'Volley playa']) expect(courtFor(name)).toBe('voley');
	});

	it('anything else gets the football pitch', () => {
		for (const name of ['Futbol', 'futbol femenino', 'Básquet']) expect(courtFor(name)).toBe('futbol');
	});
});

describe('squadPlacements', () => {
	it('football spreads nine players over the whole pitch', () => {
		const spots = squadPlacements(squad(10));
		expect(spots).toHaveLength(9);
		expect(Math.min(...spots.map((spot) => spot.y))).toBeLessThan(44);
		expect(Math.max(...spots.map((spot) => spot.y))).toBeGreaterThan(44);
	});

	it('volleyball groups the six on court on one side of the net', () => {
		const spots = squadPlacements(squad(10), 'voley');
		expect(spots).toHaveLength(6);
		// The net is at 44% of the drawing and the baseline at 85%: every spot sits between them.
		for (const spot of spots) {
			expect(spot.y).toBeGreaterThan(44);
			expect(spot.y).toBeLessThan(85);
		}
		// No two players share a spot.
		expect(new Set(spots.map((spot) => `${spot.x},${spot.y}`)).size).toBe(6);
	});
});

describe('the draw (C-06, D-035)', () => {
	const ids = (placements: ReturnType<typeof squadPlacements>) => placements.map((spot) => spot.playerId);
	const where = (placements: ReturnType<typeof squadPlacements>) => placements.map((spot) => `${spot.playerId}@${spot.x},${spot.y}`);

	it('with the chance injected, who goes in and on which spot is fixed', () => {
		// A chance that always says 0 turns each shuffle into a rotation by one:
		// players 2 to 10 go in (1 stays out) and player 10 takes the first spot.
		const drawn = squadPlacements(squad(10), 'futbol', () => 0);
		expect(ids(drawn)).toEqual(['2', '3', '4', '5', '6', '7', '8', '9', '10']);
		expect(drawn.map((spot) => [spot.playerId, spot.x, spot.y])).toEqual([
			['2', 26, 68],
			['3', 74, 68],
			['4', 20, 46],
			['5', 50, 46],
			['6', 80, 46],
			['7', 30, 24],
			['8', 70, 24],
			['9', 50, 8],
			['10', 50, 88],
		]);
		// One that always says "the last one" leaves both lists as they are.
		expect(where(squadPlacements(squad(3), 'voley', () => 0.999999))).toEqual(['1@20,57', '2@50,57', '3@80,57']);
	});

	it('the same seed repeats the draw; another seed gives another one', () => {
		expect(where(squadPlacements(squad(12), 'futbol', seededRandom(0.25)))).toEqual(where(squadPlacements(squad(12), 'futbol', seededRandom(0.25))));
		expect(where(squadPlacements(squad(12), 'futbol', seededRandom(0.25)))).not.toEqual(where(squadPlacements(squad(12), 'futbol', seededRandom(0.75))));
	});

	it('every drawn player is from the squad, none twice and no two on one spot, over many draws', () => {
		const players = squad(12);
		const seen = new Set<string>();
		for (let i = 0; i < 300; i++) {
			for (const court of ['futbol', 'voley'] as const) {
				const drawn = squadPlacements(players, court, seededRandom(i / 300));
				expect(drawn).toHaveLength(court === 'futbol' ? 9 : 6);
				expect(new Set(ids(drawn)).size).toBe(drawn.length);
				expect(new Set(drawn.map((spot) => `${spot.x},${spot.y}`)).size).toBe(drawn.length);
				for (const spot of drawn) {
					expect(players.find((player) => player.id === spot.playerId)).toBe(spot.player);
					expect(spot.shirtNumber).toBe(spot.player.shirtNumber);
					seen.add(spot.playerId);
				}
			}
		}
		// Not the lowest shirt numbers any more: everyone gets drawn sometimes.
		expect(seen.size).toBe(12);
	});

	it('a squad with fewer players than spots puts all of them in, each on its own spot', () => {
		for (const court of ['futbol', 'voley'] as const) {
			const drawn = squadPlacements(squad(4), court, seededRandom(0.5));
			expect([...ids(drawn)].sort()).toEqual(['1', '2', '3', '4']);
			expect(new Set(drawn.map((spot) => `${spot.x},${spot.y}`)).size).toBe(4);
		}
		expect(squadPlacements([], 'futbol')).toEqual([]);
	});
});
