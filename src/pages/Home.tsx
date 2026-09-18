import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import CompetitionPicker from '../components/CompetitionPicker';
import Fixture from '../components/Fixture';
import Hero from '../components/Hero';
import LeagueNotice from '../components/LeagueNotice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { isTransientError } from '../lib/api';
import { listFixture, listTeams, type FixtureRead } from '../lib/league';
import { leagueLoadError, readLeagueChoice, type LeagueChoice } from '../lib/league-view';
import type { Matchday, ResolvedMatch, Team } from '../types';

/**
 * The landing (T-22): the teams of the competition on screen and its fixture,
 * both read from the public API through `src/lib/`. It is public, so it never
 * depends on the session; a read that fails leaves the page with its notice
 * and "Reintentar".
 */

/** Matches grouped under their round, rounds in the API's own order (BR-013). */
function byMatchday(matches: ResolvedMatch[]): Matchday[] {
	const rounds = new Map<number, ResolvedMatch[]>();
	for (const match of matches) {
		const round = rounds.get(match.matchday) ?? [];
		round.push(match);
		rounds.set(match.matchday, round);
	}
	return [...rounds.entries()].map(([matchday, list]) => ({ matchday, matches: list })).sort((a, b) => a.matchday - b.matchday);
}

/** What the page shows, without the matches the choice carried for the fixture. */
const view = (choice: LeagueChoice, teams: Team[], fixture: FixtureRead) => ({
	sports: choice.sports,
	competitions: choice.competitions,
	sportId: choice.sportId,
	competition: choice.competition,
	loadError: choice.loadError,
	teams,
	rounds: byMatchday(fixture.matches),
	fixtureTruncated: fixture.truncated,
});

const NOTHING: FixtureRead = { matches: [], truncated: false };

export async function loader({ request }: LoaderFunctionArgs) {
	const { signal } = request;
	// The landing needs the fixture anyway, so the read that chooses the
	// competition may bring it along (T-22 fix: one call, not two).
	const choice = await readLeagueChoice(new URL(request.url), { signal, withMatches: true });
	const competition = choice.competition;
	if (!competition) return view(choice, [], NOTHING);
	const alreadyRead = choice.matches;
	try {
		const [teams, fixture] = await Promise.all([
			listTeams(competition.id, signal),
			alreadyRead ? Promise.resolve({ matches: alreadyRead.filter((match) => match.competition.id === competition.id), truncated: false }) : listFixture(competition.id, { signal }),
		]);
		return view(choice, teams, fixture);
	} catch (error) {
		if (!isTransientError(error)) throw error;
		return view({ ...choice, loadError: leagueLoadError(error) }, [], NOTHING);
	}
}

export default function Home() {
	const { sports, competitions, sportId, competition, teams, rounds, fixtureTruncated, loadError } = useLoaderData<typeof loader>();
	useDocumentTitle('La Liga ACP');

	return (
		<>
			<Hero teams={teams} competition={competition?.name} />
			<CompetitionPicker sports={sports} competitions={competitions} sportId={sportId} competitionId={competition?.id ?? ''} path="/" />
			<LeagueNotice
				error={loadError}
				empty={
					competition
						? teams.length === 0 && rounds.length === 0
							? 'Esta competición todavía no tiene equipos ni partidos cargados.'
							: null
						: 'Todavía no hay ninguna competición con partidos: cuando se carguen aparecerán aquí.'
				}
			/>
			<Fixture rounds={rounds} truncated={fixtureTruncated} hasCompetition={Boolean(competition)} failed={Boolean(loadError)} />
		</>
	);
}
