import type { Competition, MatchStatus, Player, ResolvedMatch, ResolvedStanding, Sport, Team } from '../types';
import { api, ApiError, CLIENT_ERROR } from './api';

/**
 * The public API as the league screens need it (T-22): the one place that
 * knows the API's Spanish names and turns them into the types of
 * `src/types/index.ts`. Everything read here is public (no session, BR-048 to
 * BR-050) and comes from `/public/...` (server/README.md, "Contrato para
 * T-22").
 */

/* ---- A body that isn't the contract ------------------------------------- */

/**
 * The API answered something that is not what the contract says (a `null`, a
 * string, an object without the field the screen reads). It is reported as a
 * transient failure — status 0, like "no connection" — so the page keeps what
 * it shows with its notice and "Reintentar" (`isTransientError`), instead of
 * a `TypeError` reaching the error page (T-22 fix).
 */
function badResponse(): never {
	throw new ApiError(0, CLIENT_ERROR.BAD_RESPONSE, 'El servidor respondió algo inesperado. Intenta de nuevo.');
}

const asObject = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : badResponse());

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : badResponse());

const text = (value: unknown): string => (typeof value === 'string' ? value : badResponse());

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : badResponse());

/** A numeric id as the routes use it (`/plantilla/42`). */
const idText = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value) ? String(value) : typeof value === 'string' && value !== '' ? value : badResponse());

/** Goals: a whole number, or nothing at all (BR-049, before the official result). */
const maybeCount = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/** One page of a paginated list, with the two fields the reads below use. */
function asPage(value: unknown): { items: unknown[]; totalPages: number } {
	const body = asObject(value);
	return { items: asList(body.items), totalPages: count(body.totalPages) };
}

/* ---- The mapping -------------------------------------------------------- */

/**
 * A crest or a photo, only if it is something an `<img>` may load: an
 * `https://` URL or a path inside this site. Anything else (a `javascript:`,
 * a protocol-relative URL, a path climbing out) is `null` and the screen shows
 * the initials instead. The same rule as `TeamCrest` (T-19).
 */
export function imageSrc(value: unknown): string | null {
	if (typeof value !== 'string' || value.trim() === '') return null;
	const path = value.trim();
	if (path.startsWith('https://')) return path;
	if (path.startsWith('/') || path.startsWith('\\') || path.includes('..') || path.includes('//') || /^[a-z][a-z0-9+.-]*:/i.test(path)) return null;
	return /\.(png|jpe?g|webp|avif|gif|svg)$/i.test(path) ? `/${path}` : null;
}

function sportOf(value: unknown): Sport {
	const sport = asObject(value);
	return { id: idText(sport.id), name: text(sport.nombre) };
}

function competitionOf(value: unknown, sport: unknown): Competition {
	const competition = asObject(value);
	return { id: idText(competition.id), name: text(competition.nombre), sport: sportOf(sport) };
}

export function teamOf(value: unknown): Team {
	const team = asObject(value);
	return {
		id: idText(team.id),
		name: text(team.nombre),
		shortName: text(team.nombreCorto),
		competitionId: idText(team.competicionId),
		crest: imageSrc(team.escudo),
		accent: text(team.colorAcento),
	};
}

const STATUS: Record<string, MatchStatus> = {
	programado: 'scheduled',
	en_curso: 'live',
	finalizado: 'finished',
	cancelado: 'cancelled',
};

/** BR-049: the score only exists with the official result (both sides loaded). */
export function matchOf(value: unknown): ResolvedMatch {
	const match = asObject(value);
	const local = asObject(match.local);
	const visita = asObject(match.visita);
	const home = maybeCount(local.goles);
	const away = maybeCount(visita.goles);
	return {
		id: idText(match.id),
		matchday: count(match.jornada),
		kickoff: text(match.fechaHora),
		venue: text(match.sede),
		// An unknown state would be drawn as the wrong badge: it is a body that isn't the contract.
		status: STATUS[text(match.estado)] ?? badResponse(),
		score: home === null || away === null ? undefined : { home, away },
		competition: competitionOf(match.competicion, match.deporte),
		homeTeam: teamOf(local.equipo),
		awayTeam: teamOf(visita.equipo),
	};
}

/** A row of the table (BR-050), exactly as the API computed it: nothing is recomputed here. */
export function standingOf(value: unknown): ResolvedStanding {
	const row = asObject(value);
	return {
		position: count(row.posicion),
		team: teamOf(row.equipo),
		played: count(row.jugados),
		won: count(row.ganados),
		drawn: count(row.empatados),
		lost: count(row.perdidos),
		goalsFor: count(row.golesAFavor),
		goalsAgainst: count(row.golesEnContra),
		goalDifference: count(row.diferencia),
		points: count(row.puntos),
	};
}

function playerOf(value: unknown, teamId: string): Player {
	const member = asObject(value);
	return {
		id: idText(member.jugadorId),
		teamId,
		name: text(member.nombre),
		photo: imageSrc(member.foto),
		shirtNumber: count(member.numeroCamiseta),
	};
}

/* ---- Reads -------------------------------------------------------------- */

/** A page of the public API big enough for one competition's fixture. */
export const FIXTURE_PAGE_SIZE = 100;
/** How many pages of fixture one competition may ask for (100 matches each). */
export const MAX_FIXTURE_PAGES = 5;

/** An id that does not exist (404), or one the API refuses (400): both are "no existe" for the screens. */
export function isMissing(error: unknown): boolean {
	return error instanceof ApiError && (error.status === 404 || error.status === 400);
}

export async function listSports(signal?: AbortSignal): Promise<Sport[]> {
	return asList(await api.get('/public/deportes', { signal })).map(sportOf);
}

export async function listCompetitions(sportId?: string, signal?: AbortSignal): Promise<Competition[]> {
	const answer = asPage(await api.get('/public/competiciones', { signal, query: { deporteId: sportId || undefined, pageSize: FIXTURE_PAGE_SIZE } }));
	return answer.items.map((item) => competitionOf(item, asObject(item).deporte));
}

export async function getCompetition(id: string, signal?: AbortSignal): Promise<Competition | undefined> {
	try {
		const item = await api.get(`/public/competiciones/${encodeURIComponent(id)}`, { signal });
		return competitionOf(item, asObject(item).deporte);
	} catch (error) {
		if (isMissing(error)) return undefined;
		throw error;
	}
}

/** One read of the fixture (BR-013 order), with the filters the caller needs. */
const readMatches = (query: Record<string, string | number | undefined>, signal?: AbortSignal) => api.get('/public/partidos', { signal, query }).then(asPage);

/** How many matches the choice below looks at when the caller doesn't want them for anything else. */
const CHOICE_PAGE_SIZE = 20;

export interface DefaultCompetition {
	competition: Competition | undefined;
	/**
	 * The matches the choice was read from, but only when that single page held
	 * **every** match there is: then the landing's fixture is those of the
	 * chosen competition, and it doesn't ask again (T-22 fix). `null` otherwise.
	 */
	matches: ResolvedMatch[] | null;
}

/**
 * Which competition a league page opens on when the URL doesn't name one
 * (D-021). The rule lives here, in one place:
 *
 * 1. The competition of the **next scheduled match** (`programado`), which is
 *    what a visitor comes for.
 * 2. With nothing scheduled, the competition of the **most recent match that
 *    was really played** (`en_curso` or `finalizado`). A cancelled one is
 *    skipped: it never has a score (BR-049) and never counts in the table
 *    (BR-050), so opening on it would show a competition whose only news is
 *    that nothing happened.
 * 3. If every match there is was cancelled, the most recent of those, so a
 *    competition with matches still wins over one without any.
 * 4. With no matches at all, `competition` is `undefined` and the caller falls
 *    back to the first competition of the list (`readLeagueChoice`).
 *
 * The API answers in proximity order (BR-013: upcoming soonest first, then
 * past most recent first), so one page is enough to apply the rule: the whole
 * upcoming block comes first, and any match already played means that block
 * ended. Only a page that is nothing but cancelled matches may hide a
 * scheduled one behind it, and then it is asked for exactly.
 *
 * With a sport chosen (`?deporteId=`, BR-048) the reads are filtered by it, so
 * the rule runs among that sport's matches: otherwise a page full of another
 * sport's fixtures answered nothing usable and the screen fell back to the
 * first competition by name, empty or not (T-22 second fix).
 */
export async function defaultCompetition(options: { signal?: AbortSignal; withMatches?: boolean; sportId?: string } = {}): Promise<DefaultCompetition> {
	const { signal, withMatches = false, sportId } = options;
	const ofSport = sportId || undefined;
	const answer = await readMatches({ deporteId: ofSport, page: 1, pageSize: withMatches ? FIXTURE_PAGE_SIZE : CHOICE_PAGE_SIZE }, signal);
	const items = answer.items.map(matchOf);

	let chosen = items.find((match) => match.status === 'scheduled');
	if (!chosen && answer.totalPages > 1 && items.every((match) => match.status === 'cancelled')) {
		chosen = (await readMatches({ deporteId: ofSport, estado: 'programado', pageSize: 1 }, signal)).items.map(matchOf)[0];
	}
	chosen ??= items.find((match) => match.status !== 'cancelled') ?? items[0];

	return {
		competition: chosen?.competition,
		matches: withMatches && answer.totalPages <= 1 ? items : null,
	};
}

export async function listTeams(competitionId: string, signal?: AbortSignal): Promise<Team[]> {
	try {
		return asList(await api.get(`/public/competiciones/${encodeURIComponent(competitionId)}/equipos`, { signal })).map(teamOf);
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
}

export interface FixtureRead {
	matches: ResolvedMatch[];
	/**
	 * `true` when the competition has more matches than the pages asked for
	 * (`MAX_FIXTURE_PAGES` × 100): the screen says so instead of cutting the
	 * list in silence (T-22 fix).
	 */
	truncated: boolean;
}

/**
 * The fixture of one competition, in the API's order (BR-013). It asks the
 * API for that competition only, 100 at a time, so a big tournament never
 * makes the landing walk pages it doesn't need; `jornada` narrows it further.
 */
export async function listFixture(competitionId: string, options: { matchday?: number; signal?: AbortSignal } = {}): Promise<FixtureRead> {
	const matches: ResolvedMatch[] = [];
	let totalPages = 1;
	for (let page = 1; page <= MAX_FIXTURE_PAGES; page++) {
		const answer = await readMatches({ competicionId: competitionId, jornada: options.matchday, page, pageSize: FIXTURE_PAGE_SIZE }, options.signal);
		matches.push(...answer.items.map(matchOf));
		totalPages = answer.totalPages;
		if (page >= totalPages) break;
	}
	return { matches, truncated: totalPages > MAX_FIXTURE_PAGES };
}

export async function listStandings(competitionId: string, signal?: AbortSignal): Promise<ResolvedStanding[]> {
	try {
		// The API answers `{ competicion, filas }`: the table itself is `filas`.
		const answer = asObject(await api.get(`/public/competiciones/${encodeURIComponent(competitionId)}/posiciones`, { signal }));
		return asList(answer.filas).map(standingOf);
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
}

export interface TeamWithSquad {
	team: Team;
	competition: Competition;
	players: Player[];
}

/** One team with its squad; `undefined` when the id doesn't exist or isn't one (400 or 404). */
export async function getTeamWithSquad(id: string, signal?: AbortSignal): Promise<TeamWithSquad | undefined> {
	try {
		const detail = asObject(await api.get(`/public/equipos/${encodeURIComponent(id)}`, { signal }));
		const team = teamOf(detail);
		return {
			team,
			competition: competitionOf(detail.competicion, detail.deporte),
			players: asList(detail.plantel).map((member) => playerOf(member, team.id)),
		};
	} catch (error) {
		if (isMissing(error)) return undefined;
		throw error;
	}
}
