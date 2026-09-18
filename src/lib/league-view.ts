import type { Competition, ResolvedMatch, Sport } from '../types';
import { isTransientError } from './api';
import { defaultCompetition, getCompetition, listCompetitions, listSports } from './league';

/**
 * What the landing and `/posiciones` need before they can show anything
 * (D-021): which sport and competition are on screen, and the lists to choose
 * from. Both read it in their loader, and a transient failure keeps the page
 * with its notice and "Reintentar" (as T-19 to T-21 do), never a blank screen.
 */

export interface LeagueChoice {
	sports: Sport[];
	competitions: Competition[];
	/** `''` when no sport is chosen: every competition is offered. */
	sportId: string;
	competition: Competition | undefined;
	/**
	 * The matches already read while choosing the competition, when they are
	 * every match there is: the landing's fixture reuses them instead of asking
	 * again (T-22 fix). `null` whenever they can't stand for the whole fixture.
	 */
	matches: ResolvedMatch[] | null;
	/** Why nothing could be read this time, for the page's notice. */
	loadError: string | null;
}

/** The message a failed read shows. A 429 says how long to wait (the public API has its own limit). */
export function leagueLoadError(error: unknown): string {
	const failure = error as { code?: string; message?: string };
	if (failure?.code === 'RATE_LIMITED') return 'No se pudo cargar la liga: demasiadas solicitudes. Espera un momento y vuelve a intentarlo.';
	return `No se pudo cargar la liga. ${failure?.message ?? ''}`.trim();
}

const idOf = (value: string | null): string => (value && /^[1-9]\d{0,15}$/.test(value) ? value : '');

/**
 * Reads the choice from the page URL and completes it: the sport's
 * competitions, and the competition to show. Without one in the URL it is the
 * default of D-021, whose rule lives in `defaultCompetition`; if that finds no
 * match at all, the first competition of the list (the API's order: by sport
 * and name).
 *
 * `withMatches` says the caller needs the fixture anyway (the landing), so the
 * read that chooses may bring it along.
 */
export async function readLeagueChoice(url: URL, options: { signal?: AbortSignal; withMatches?: boolean } = {}): Promise<LeagueChoice> {
	const { signal, withMatches = false } = options;
	const sportId = idOf(url.searchParams.get('deporteId'));
	const wanted = idOf(url.searchParams.get('competicionId'));
	try {
		const [sports, competitions] = await Promise.all([listSports(signal), listCompetitions(sportId, signal)]);
		let competition = wanted ? competitions.find((item) => item.id === wanted) : undefined;
		// A competition of another sport, or one not in this page: read it by id before giving up.
		if (wanted && !competition) competition = await getCompetition(wanted, signal);
		let matches: ResolvedMatch[] | null = null;
		if (!competition && !wanted) {
			// With a sport chosen the rule runs among its own matches (BR-048):
			// the list of competitions is only the last resort, when that sport
			// has no matches at all.
			const byDefault = await defaultCompetition({ signal, withMatches, sportId });
			competition = byDefault.competition ?? competitions[0];
			matches = byDefault.competition ? byDefault.matches : null;
		}
		return { sports, competitions, sportId, competition, matches, loadError: null };
	} catch (error) {
		if (!isTransientError(error)) throw error;
		return { sports: [], competitions: [], sportId, competition: undefined, matches: null, loadError: leagueLoadError(error) };
	}
}
