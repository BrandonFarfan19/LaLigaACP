import { describe, expect, it } from 'vitest';
import { halcones, standingRow } from '../test/league-fixtures';
import { standingOf } from './league';
import { groupStandings } from './league-groups';

/** A row of the men's football table (competition 13), as `standingOf` maps the API's. */
const team = (id: number, nombre: string) => ({ ...halcones, id, competicionId: 13, nombre, nombreCorto: nombre.slice(0, 3).toUpperCase() });
const row = (id: number, nombre: string, posicion: number, puntos: number) => standingOf(standingRow(team(id, nombre), posicion, puntos));

/** The API's table, already in BR-050 order (points, difference, goals for...). */
const TABLE = [
	row(49, 'LOS IMPARABLES', 1, 9),
	row(54, 'Grupzul 2.0', 2, 6),
	row(51, 'Bad Legend', 3, 6),
	row(50, 'AQUÍ SE COBRA FC', 4, 3),
	row(52, 'LOS DIBUJITOS FC CON IA', 5, 3),
	row(53, 'SPORT LA PLATA FC', 6, 0),
];

describe('groups of the table (C-11, D-040)', () => {
	it('men\'s football (13): 50, 54 and 53 in Grupo A, every other team in Grupo B, in that order', () => {
		const groups = groupStandings('13', TABLE)!;
		expect(groups.map((g) => g.name)).toEqual(['Grupo A', 'Grupo B']);
		expect(groups[0]!.rows.map((r) => r.team.id)).toEqual(['54', '50', '53']);
		expect(groups[1]!.rows.map((r) => r.team.id)).toEqual(['49', '51', '52']);
	});

	it('each group numbers from 1, keeping the order the API sent (nothing recalculated)', () => {
		const [a, b] = groupStandings('13', TABLE)!;
		expect(a!.rows.map((r) => [r.position, r.team.name, r.points])).toEqual([
			[1, 'Grupzul 2.0', 6],
			[2, 'AQUÍ SE COBRA FC', 3],
			[3, 'SPORT LA PLATA FC', 0],
		]);
		expect(b!.rows.map((r) => [r.position, r.team.name, r.points])).toEqual([
			[1, 'LOS IMPARABLES', 9],
			[2, 'Bad Legend', 6],
			[3, 'LOS DIBUJITOS FC CON IA', 3],
		]);
		// Every other figure travels as it came.
		expect(a!.rows[0]).toEqual({ ...TABLE[1]!, position: 1 });
		// The API's rows are not changed in place.
		expect(TABLE.map((r) => r.position)).toEqual([1, 2, 3, 4, 5, 6]);
	});

	it('a team added later to that competition goes to Grupo B', () => {
		const [, b] = groupStandings('13', [...TABLE, row(77, 'Equipo Nuevo', 7, 0)])!;
		expect(b!.rows.map((r) => [r.position, r.team.id])).toEqual([
			[1, '49'],
			[2, '51'],
			[3, '52'],
			[4, '77'],
		]);
	});

	it('a group with no rows is still there, empty, so the page can say so', () => {
		const onlyB = TABLE.filter((r) => !['50', '53', '54'].includes(r.team.id));
		const [a, b] = groupStandings('13', onlyB)!;
		expect(a).toEqual({ name: 'Grupo A', rows: [] });
		expect(b!.rows).toHaveLength(3);
	});

	it('production (competition 1): teams 12, 15 and 16 in Grupo A, the rest in Grupo B', () => {
		const prod = [row(3, 'LOS IMPARABLES', 1, 9), row(15, 'Grupzul 2.0', 2, 6), row(12, 'AQUÍ SE COBRA FC', 3, 3), row(7, 'Bad Legend', 4, 3), row(16, 'SPORT LA PLATA FC', 5, 0)];
		const [a, b] = groupStandings('1', prod)!;
		expect(a!.rows.map((r) => [r.position, r.team.id])).toEqual([[1, '15'], [2, '12'], [3, '16']]);
		expect(b!.rows.map((r) => [r.position, r.team.id])).toEqual([[1, '3'], [2, '7']]);
	});

	it('any other competition (women\'s football, volleyball) has no groups: its single table as always', () => {
		for (const id of ['14', '15', '10', '']) expect(groupStandings(id, TABLE)).toBeNull();
	});

	it('the same rule for any configuration: named teams first, `rest` takes the others', () => {
		const config = { '7': [{ name: 'Norte', teams: 'rest' as const }, { name: 'Sur', teams: ['52'] }] };
		const [norte, sur] = groupStandings('7', TABLE, config)!;
		expect(sur!.rows.map((r) => [r.position, r.team.id])).toEqual([[1, '52']]);
		expect(norte!.rows.map((r) => r.team.id)).toEqual(['49', '54', '51', '50', '53']);
	});
});
