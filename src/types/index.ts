/**
 * Shared entity contracts: what the league screens render (T-22).
 *
 * They are the public API's rows (`/public/...`, server/README.md "Contrato
 * para T-22") mapped in `src/lib/`, so the screens never learn the API's
 * Spanish names or its shapes. Relations arrive resolved, as the API sends
 * them.
 */

/** A club taking part in a competition. */
export interface Team {
	/** The API's numeric id, as text (the routes use it: `/plantilla/42`). */
	id: string;
	name: string;
	shortName: string;
	/** Its competition's id, as text. */
	competitionId: string;
	/**
	 * The crest as the API gives it: an `https://` URL or a path inside the
	 * site. Shown only with `<img>` (never inline SVG); `null` when it isn't
	 * one of those.
	 */
	crest: string | null;
	/** Accent color used for the FIFA-style glow behind the crest. */
	accent: string;
}

/** A sport (BR-011, BR-048). */
export interface Sport {
	id: string;
	name: string;
}

/** A competition: one standalone tournament of a sport. */
export interface Competition {
	id: string;
	name: string;
	sport: Sport;
}

/**
 * A player on a club's squad.
 *
 * The club is referenced by id — the `players.team_id` column of the future
 * table. `getPlayersByTeamId()` does the join.
 */
export interface Player {
	id: string;
	teamId: string;
	name: string;
	/** Same format as a crest, or `null`. */
	photo: string | null;
	shirtNumber: number;
}

/** Editable display placement; demo values until official lineups arrive. */
export interface SquadPlacement {
	id: string;
	playerId: string;
	shirtNumber: number;
	x: number;
	y: number;
}

export interface ResolvedSquadPlacement extends SquadPlacement {
	player: Player;
}

/** The six attributes drawn on a player's radar. */
export type PlayerStatKey =
	| 'shooting'
	| 'passing'
	| 'strength'
	| 'defense'
	| 'speed'
	| 'dribbling';

/**
 * A player's attribute ratings, 0–100.
 *
 * One row per player, referenced by id — the future `player_stats` table.
 */
export interface PlayerStats extends Record<PlayerStatKey, number> {
	playerId: string;
}

/** BR-012: `cancelado` also reaches the fixture (BR-049), so it has its own state. */
export type MatchStatus = 'scheduled' | 'live' | 'finished' | 'cancelled';

/** Goals scored. Only present once the match has started. */
export interface MatchScore {
	home: number;
	away: number;
}

/**
 * A scheduled meeting between two teams.
 *
 * Teams are referenced by id — exactly what a `matches` table would store.
 * The join happens in the data layer, never in a component.
 */
export interface Match {
	id: string;
	/** Round number within the tournament. */
	matchday: number;
	/** Kickoff as an ISO 8601 string, with offset. */
	kickoff: string;
	homeTeamId: string;
	awayTeamId: string;
	venue: string;
	status: MatchStatus;
	/** Only with the official result (BR-049): finished and both sides loaded. */
	score?: MatchScore;
	competition: Competition;
}

/** A `Match` with its team relations already resolved by the data layer. */
export interface ResolvedMatch extends Omit<Match, 'homeTeamId' | 'awayTeamId'> {
	homeTeam: Team;
	awayTeam: Team;
}

/** Matches grouped under their round, ready to render. */
export interface Matchday {
	matchday: number;
	matches: ResolvedMatch[];
}

/**
 * A team's row in the league table.
 *
 * The API computes it (BR-050) and sends it already in order: the screen only
 * shows it, and `src/lib/league.ts` maps each field.
 */
export interface Standing {
	teamId: string;
	played: number;
	won: number;
	drawn: number;
	lost: number;
	goalsFor: number;
	goalsAgainst: number;
	/** Goal difference, as the API computes it (never recomputed here). */
	goalDifference: number;
	points: number;
}

/** A `Standing` with its team resolved and its table position assigned. */
export interface ResolvedStanding extends Omit<Standing, 'teamId'> {
	position: number;
	team: Team;
}

/** One pre-sized webp of an image. */
export interface ImageRendition {
	src: string;
	width: number;
	height: number;
}

/**
 * Every rendition built for one image, keyed by its spec (`"96"`, `"32x32"`,
 * `"96@2"`). Produced by `vite-plugins/pixel-images.ts` for `?pixel=<preset>`
 * imports and rendered through `<PixelImage />`.
 */
export type PixelImageSet = Record<string, ImageRendition>;

/** One slide of the generic `<Carousel />` component. */
export interface CarouselSlide {
	id: string;
	/** The team it features: its crest comes from the API, so it is shown with `<img>` (T-22). */
	team: Pick<Team, 'crest' | 'shortName'>;
	/** Alt text for the image. Required — slides are meaningful content. */
	alt: string;
	eyebrow?: string;
	title?: string;
	subtitle?: string;
	/** Optional accent color driving the slide glow. */
	accent?: string;
	/** When set, the image becomes a link to this URL. */
	href?: string;
	/**
	 * Accessible name for that link. Without it the link would announce as
	 * the image alt ("Escudo de …"), which says nothing about where it goes.
	 */
	hrefLabel?: string;
}
