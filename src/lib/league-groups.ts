import type { ResolvedStanding } from '../types';

/**
 * Groups in a competition's table (C-11, D-040): front configuration, the one
 * exception to "nothing on screen is hardcoded". The API still sends a single
 * table, already in BR-050 order; this only splits it for display. Teams are
 * named by **id** (a name can be edited by an admin; the ids are kept from
 * development to production by the real-data dump, D-04), with the names in
 * comments. Every team of the competition that no group names goes to the one
 * marked `rest`, including one added later.
 *
 * If the groups ever have to be data the admin changes, they need a column in
 * the schema (docs/pendientes.md).
 */

export interface GroupSpec {
	name: string;
	/** Team ids (the API's numeric id, as text), or `rest`: every team the other groups don't name. */
	teams: readonly string[] | 'rest';
}

/**
 * Torneo futbol masculino (Futbol). Production was not loaded with the dump, so
 * its ids differ from development's: both sets are listed. A team belongs to
 * one competition only, so the other environment's ids never match anything.
 */
const MENS_FOOTBALL: readonly GroupSpec[] = [
	{
		name: 'Grupo A',
		teams: [
			// Development.
			'50', // AQUÍ SE COBRA FC
			'54', // Grupzul 2.0
			'53', // SPORT LA PLATA FC
			// Production: the same three teams.
			'12',
			'15',
			'16',
		],
	},
	{ name: 'Grupo B', teams: 'rest' },
];

/** By competition id. A competition that isn't here keeps a single table. */
const GROUPS: Readonly<Record<string, readonly GroupSpec[]>> = {
	'13': MENS_FOOTBALL, // development
	'1': MENS_FOOTBALL, // production
};

export interface StandingGroup {
	name: string;
	/** In the order the API sent them, numbered from 1 within the group. */
	rows: ResolvedStanding[];
}

/**
 * The competition's table split into its groups, in the order they are
 * configured, or `null` when it has none (the page shows the single table as
 * it always did). Each row keeps the API's order (BR-050: nothing is
 * recalculated) and its `position` is renumbered from 1 inside its group. A
 * group with no rows is still returned, empty, so the page can say so.
 * `groups` is only for tests: the page uses the configuration above.
 */
export function groupStandings(
	competitionId: string,
	rows: readonly ResolvedStanding[],
	groups: Readonly<Record<string, readonly GroupSpec[]>> = GROUPS,
): StandingGroup[] | null {
	const specs = groups[competitionId];
	if (!specs || specs.length === 0) return null;
	const rest = specs.findIndex((spec) => spec.teams === 'rest');
	const buckets: ResolvedStanding[][] = specs.map(() => []);
	for (const row of rows) {
		const named = specs.findIndex((spec) => spec.teams !== 'rest' && spec.teams.includes(row.team.id));
		const index = named >= 0 ? named : rest;
		// A team no group names, in a configuration without `rest`, is still shown: in the last group.
		buckets[index >= 0 ? index : specs.length - 1]!.push(row);
	}
	return specs.map((spec, index) => ({
		name: spec.name,
		rows: buckets[index]!.map((row, position) => ({ ...row, position: position + 1 })),
	}));
}
