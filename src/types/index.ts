/**
 * Shared entity contracts.
 *
 * These interfaces are the shape the future backend/database has to honor.
 * Relations are expressed by id (never by nesting) so the static data matches
 * what an API will eventually return.
 */

/** A club taking part in the tournament. */
export interface Team {
	id: string;
	name: string;
	shortName: string;
	country: string;
	/** Crest imported from `src/assets/` with `?pixel=crest`, pre-sized at build time. */
	crest: PixelImageSet;
	/** Accent color used for the FIFA-style glow behind the crest. */
	accent: string;
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

export type MatchStatus ='scheduled' | 'live' | 'finished';

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
	score?: MatchScore;
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
 * Referenced by `teamId`, the way a `standings` view or table would return
 * it. Derived today from finished matches in `src/lib/standings.ts`.
 */
export interface Standing {
	teamId: string;
	played: number;
	won: number;
	drawn: number;
	lost: number;
	goalsFor: number;
	goalsAgainst: number;
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
	image: PixelImageSet;
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
