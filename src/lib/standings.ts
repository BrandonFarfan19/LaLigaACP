import { matches } from '../data/matches';
import { teams } from '../data/teams';
import type { ResolvedStanding, Standing } from '../types';

/**
 * Data-access layer for the league table. Pages read through these functions
 * and never compute standings themselves.
 *
 * Today the table is derived from finished matches, so it can never disagree
 * with the fixture. When the backend arrives it may serve standings directly;
 * only this body changes.
 */

const POINTS_WIN = 3;
const POINTS_DRAW = 1;

function emptyStanding(teamId: string): Standing {
	return { teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, points: 0 };
}

function record(row: Standing, scored: number, conceded: number) {
	row.played++;
	row.goalsFor += scored;
	row.goalsAgainst += conceded;
	if (scored > conceded) {
		row.won++;
		row.points += POINTS_WIN;
	} else if (scored === conceded) {
		row.drawn++;
		row.points += POINTS_DRAW;
	} else {
		row.lost++;
	}
}

/**
 * Every team, best first: points, then goal difference, then goals scored,
 * then name so the order is stable when everything else ties.
 */
export async function getStandings(): Promise<ResolvedStanding[]> {
	const rows = new Map(teams.map((team) => [team.id, emptyStanding(team.id)]));

	for (const match of matches) {
		if (match.status !== 'finished' || !match.score) continue;

		const home = rows.get(match.homeTeamId);
		const away = rows.get(match.awayTeamId);
		if (!home) throw new Error(`Match ${match.id}: unknown homeTeamId "${match.homeTeamId}"`);
		if (!away) throw new Error(`Match ${match.id}: unknown awayTeamId "${match.awayTeamId}"`);

		record(home, match.score.home, match.score.away);
		record(away, match.score.away, match.score.home);
	}

	return teams
		.map((team) => {
			const { teamId: _teamId, ...stats } = rows.get(team.id)!;
			return { ...stats, team };
		})
		.sort(
			(a, b) =>
				b.points - a.points ||
				b.goalsFor - b.goalsAgainst - (a.goalsFor - a.goalsAgainst) ||
				b.goalsFor - a.goalsFor ||
				a.team.name.localeCompare(b.team.name, 'es'),
		)
		.map((row, index) => ({ ...row, position: index + 1 }));
}
