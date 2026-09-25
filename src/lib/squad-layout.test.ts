import { describe, expect, it } from 'vitest';
import type { Player } from '../types';
import { courtFor, squadPlacements } from './squad-layout';

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
		expect(spots.map((spot) => spot.shirtNumber)).toEqual([1, 2, 3, 4, 5, 6]);
		// The net is at 44% of the drawing and the baseline at 85%: every spot sits between them.
		for (const spot of spots) {
			expect(spot.y).toBeGreaterThan(44);
			expect(spot.y).toBeLessThan(85);
		}
		// No two players share a spot.
		expect(new Set(spots.map((spot) => `${spot.x},${spot.y}`)).size).toBe(6);
	});
});
