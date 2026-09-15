import { players } from '../data/players';
import { playerStats } from '../data/player-stats';
import { teams } from '../data/teams';
import { squadPlacements } from '../data/squad-placements';
import type { Player, PlayerStats, ResolvedSquadPlacement } from '../types';

/**
 * Data-access layer for squads. Pages and components read through these
 * functions and never import `src/data/players` directly.
 *
 * Async on purpose: when the backend arrives only these bodies change.
 */

// Catch a typo'd `teamId` at build time instead of rendering an empty squad.
const teamIds = new Set(teams.map((team) => team.id));
for (const player of players) {
	if (!teamIds.has(player.teamId)) {
		throw new Error(`Player ${player.id}: unknown teamId "${player.teamId}"`);
	}
}

/** Every player in the tournament. */
export async function getPlayers(): Promise<Player[]> {
	return players;
}

/** One club's squad — the array the plantilla screen renders. */
export async function getPlayersByTeamId(teamId: string): Promise<Player[]> {
	return players.filter((player) => player.teamId === teamId);
}

/** Resolve stored placements by stable player id, never roster order. */
export async function getSquadPlacementsByTeamId(teamId: string): Promise<ResolvedSquadPlacement[]> {
	const squad = new Map((await getPlayersByTeamId(teamId)).map((player) => [player.id, player]));
	return squadPlacements.flatMap((placement) => {
		const player = squad.get(placement.playerId);
		return player ? [{ ...placement, player }] : [];
	});
}

/** Attribute ratings for one club's squad, one row per player. */
export async function getPlayerStatsByTeamId(teamId: string): Promise<PlayerStats[]> {
	const squadIds = new Set(
		players.filter((player) => player.teamId === teamId).map((player) => player.id),
	);
	return playerStats.filter((stats) => squadIds.has(stats.playerId));
}
