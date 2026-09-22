/**
 * Kickoff labels that read the same in every browser and visitor time zone.
 *
 * `Intl` would leave both to the runtime: engines abbreviate Spanish months
 * differently ("sept" vs "sep"), and the hour would follow whatever zone the
 * code asked for or the visitor is in. Here the month names are fixed and the
 * time is always shown in the league's zone.
 */

/**
 * The league's zone: America/Lima, the zone the approved Astro build formatted
 * with. Peru has kept UTC−5 without daylight saving time since 1994, so a
 * fixed offset gives the same wall-clock time for every date the league uses.
 */
const LEAGUE_UTC_OFFSET_MINUTES = -5 * 60;

/** Spanish short month names, exactly as Chrome's `Intl` wrote them for `es`. */
const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** `2026-09-05T20:00:00-05:00`: date, time and an explicit `Z` or `±HH:MM` offset. */
const ISO_WITH_OFFSET = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|([+-])(\d{2}):(\d{2}))$/;

export interface KickoffLabel {
	/** `05 sept` */
	day: string;
	/** `20:00`, 24-hour clock */
	time: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * `17 sept 2026`: the day of an ISO 8601 instant (with offset) in the league's
 * zone. Returns `—` for anything else, since it only labels account data.
 */
export function formatDateOnly(iso: string): string {
	if (!ISO_WITH_OFFSET.test(iso)) return '—';
	const { day } = formatKickoff(iso);
	const instant = Date.parse(iso) + LEAGUE_UTC_OFFSET_MINUTES * 60_000;
	return `${day} ${new Date(instant).getUTCFullYear()}`;
}

/** Formats an ISO 8601 kickoff (with offset) in the league's zone. Throws on anything else. */
export function formatKickoff(iso: string): KickoffLabel {
	const match = ISO_WITH_OFFSET.exec(iso);
	if (!match) throw new Error(`formatKickoff: expected an ISO 8601 date with offset, got "${iso}"`);

	const [, year, month, day, hour, minute, second = '0', zone, sign, offsetHours, offsetMinutes] = match;
	const offset = zone === 'Z' ? 0 : (sign === '-' ? -1 : 1) * (Number(offsetHours) * 60 + Number(offsetMinutes));

	// The instant in UTC, then moved to the league's wall clock. Only UTC
	// arithmetic is used, so the visitor's zone never enters the result.
	const instant = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - offset * 60_000;
	const league = new Date(instant + LEAGUE_UTC_OFFSET_MINUTES * 60_000);

	return {
		day: `${pad(league.getUTCDate())} ${MONTHS[league.getUTCMonth()]}`,
		time: `${pad(league.getUTCHours())}:${pad(league.getUTCMinutes())}`,
	};
}
