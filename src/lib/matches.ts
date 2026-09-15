import { matches } from '../data/matches';
import { teams } from '../data/teams';
import type { Match, Matchday, ResolvedMatch } from '../types';

/**
 * Data-access layer for the fixture. Components read through these functions
 * and never touch `src/data` directly.
 *
 * Async on purpose: when the backend arrives only these bodies change.
 */

const teamsById = new Map(teams.map((team) => [team.id, team]));

/**
 * Joins a match onto its teams. This is the work a SQL join (or an API
 * `include`) will do later — keeping it here means components never learn
 * that relations are stored as ids.
 */
function resolve(match: Match): ResolvedMatch {
	const homeTeam = teamsById.get(match.homeTeamId);
	const awayTeam = teamsById.get(match.awayTeamId);

	// Fail at build time rather than rendering a half-empty card.
	if (!homeTeam) throw new Error(`Match ${match.id}: unknown homeTeamId "${match.homeTeamId}"`);
	if (!awayTeam) throw new Error(`Match ${match.id}: unknown awayTeamId "${match.awayTeamId}"`);

	const { homeTeamId: _home, awayTeamId: _away, ...rest } = match;
	return { ...rest, homeTeam, awayTeam };
}

/** Every match, chronological. */
export async function getFixtures(): Promise<ResolvedMatch[]> {
	return matches
		.map(resolve)
		.sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff));
}

/** Every match grouped under its round — the shape the fixture screen renders. */
export async function getFixturesByMatchday(): Promise<Matchday[]> {
	const fixtures = await getFixtures();
	const grouped = new Map<number, ResolvedMatch[]>();

	for (const match of fixtures) {
		const round = grouped.get(match.matchday) ?? [];
		round.push(match);
		grouped.set(match.matchday, round);
	}

	return [...grouped.entries()]
		.map(([matchday, matches]) => ({ matchday, matches }))
		.sort((a, b) => a.matchday - b.matchday);
}

/** Every match a given team plays, home or away. */
export async function getMatchesByTeam(teamId: string): Promise<ResolvedMatch[]> {
	const fixtures = await getFixtures();
	return fixtures.filter(
		(match) => match.homeTeam.id === teamId || match.awayTeam.id === teamId,
	);
}
