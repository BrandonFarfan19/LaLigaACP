import { ApiError, fieldErrors, waitText } from './api';
import { dayEnd, dayStart, isDay, positiveInt } from './betting';

/**
 * Shared pieces of the admin panel's data layer (T-21): filters read from the
 * page URL, the league-time date fields, and how an admin write turns into a
 * message for the screen. Every call still goes through `api.ts`, and the
 * backend checks everything again (NFR-005).
 */

/** Rows per page of every admin list. */
export const ADMIN_PAGE_SIZE = 20;

export type FilterKind = { kind: 'id' } | { kind: 'enum'; values: readonly string[] } | { kind: 'text' } | { kind: 'day' };
export type FilterSpec = Record<string, FilterKind>;
export type FilterValues = Record<string, string | number | undefined> & { page: number };

/** Longest search text the backend takes (`q`). */
const MAX_TEXT = 100;

/**
 * The filters of an admin list, from the page URL, with the backend's rules.
 * An invalid value is dropped and reported, so the page still loads; a
 * parameter the list doesn't know is ignored and never reaches the API.
 */
export function parseFilters(params: URLSearchParams, spec: FilterSpec): { filters: FilterValues; problems: string[] } {
	const filters: FilterValues = { page: 1 };
	const problems: string[] = [];
	const read = (name: string) => {
		const values = params.getAll(name);
		if (values.length > 1) problems.push(`El filtro ${name} aparece más de una vez: se ignoró.`);
		return values.length === 1 ? values[0]!.trim() : '';
	};
	for (const [name, rule] of Object.entries(spec)) {
		const value = read(name);
		if (!value) continue;
		if (rule.kind === 'id') {
			const id = positiveInt(value, Number.MAX_SAFE_INTEGER);
			if (id) filters[name] = id;
			else problems.push(`El filtro ${name} no es válido: se ignoró.`);
		} else if (rule.kind === 'enum') {
			if (rule.values.includes(value)) filters[name] = value;
			else problems.push(`El filtro ${name} no es válido: se ignoró.`);
		} else if (rule.kind === 'text') {
			filters[name] = value.slice(0, MAX_TEXT);
		} else if (isDay(value)) {
			filters[name] = value;
		} else {
			problems.push(`La fecha "${name}" no es válida: se ignoró.`);
		}
	}
	if (typeof filters.desde === 'string' && typeof filters.hasta === 'string' && filters.desde > filters.hasta) {
		problems.push('La fecha "desde" es posterior a "hasta": se ignoró "hasta".');
		delete filters.hasta;
	}
	const page = read('page');
	if (page) {
		const n = positiveInt(page, 100_000);
		if (n) filters.page = n;
		else problems.push('La página no es válida: se muestra la primera.');
	}
	return { filters, problems };
}

/** The page URL's search for some filters (only the ones set; page 1 is left out). */
export function searchOf(filters: Partial<FilterValues>): string {
	const params = new URLSearchParams();
	for (const [name, value] of Object.entries(filters)) {
		if (value === undefined || value === '' || (name === 'page' && Number(value) <= 1)) continue;
		params.set(name, String(value));
	}
	const search = params.toString();
	return search ? `?${search}` : '';
}

/** The API query for some filters: days become the league day's first and last second. */
export function apiQuery(filters: FilterValues, pageSize = ADMIN_PAGE_SIZE): Record<string, string | number | undefined> {
	const query: Record<string, string | number | undefined> = { pageSize };
	for (const [name, value] of Object.entries(filters)) {
		if (value === undefined || value === '') continue;
		if (name === 'desde') query.desde = dayStart(String(value));
		else if (name === 'hasta') query.hasta = dayEnd(String(value));
		else query[name] = value;
	}
	return query;
}

/**
 * League time (America/Lima, UTC−5 all year, like `utils/format-date.ts`) for
 * a `datetime-local` field: `2026-10-01T20:00`.
 */
export function leagueInputOf(iso: string): string {
	const time = Date.parse(iso);
	// A date the API never sends (or a broken one) leaves the field empty instead of breaking the screen.
	if (!Number.isFinite(time)) return '';
	return new Date(time - 5 * 3_600_000).toISOString().slice(0, 16);
}

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** A `datetime-local` value in league time, as the API wants it (with seconds and zone), or `null`. */
export function isoFromLeagueInput(value: string): string | null {
	const match = LOCAL_INPUT.exec(value.trim());
	if (!match || !isDay(`${match[1]}-${match[2]}-${match[3]}`) || Number(match[4]) > 23 || Number(match[5]) > 59) return null;
	return `${value.trim()}:00-05:00`;
}

/** What to do after each admin refusal, beyond the backend's own message (which says why). */
const HINTS: Record<string, string> = {
	VALIDATION_ERROR: 'Revisa los campos marcados.',
	SLUG_TAKEN: 'Escribe otro slug (si lo dejaste vacío, sale del nombre: cambia el nombre o escribe uno).',
	SPORT_IN_USE: 'Borra antes sus competiciones.',
	COMPETITION_IN_USE: 'Solo se borra (o se mueve de deporte) una competición sin equipos, partidos ni jugadores inscritos.',
	TEAM_IN_USE: 'Solo se borra (o se mueve de competición) un equipo sin partidos, jugadores inscritos ni goles.',
	PLAYER_IN_USE: 'Da de baja antes sus inscripciones en planteles.',
	ENROLLMENT_IN_USE: 'La inscripción tiene goles registrados: bórralos antes.',
	PLAYER_ALREADY_ENROLLED: 'Elige otro jugador, o da de baja antes esa inscripción.',
	SHIRT_NUMBER_TAKEN: 'Elige otro número para este equipo.',
	TRANSFER_NOT_ALLOWED: 'Dentro de una competición un jugador no cambia de equipo: solo se edita el número.',
	COMPETITION_MISMATCH: 'Vuelve a elegir el equipo después de la competición.',
	DRAW_RULE_LOCKED: 'Si necesitas otra regla, crea un deporte nuevo con ella.',
	MATCH_DATE_IN_PAST: 'La hora es la de Lima: elige un momento posterior al de ahora.',
	SAME_TEAM: 'Cambia uno de los dos.',
	MATCH_LOCKED: 'Un partido finalizado o cancelado ya no se modifica.',
	MATCH_NOT_PROGRAMMED: 'El partido ya empezó (empieza solo a su hora): no se posterga, no cambia de equipos ni se borra.',
	MATCH_HAS_BETS: 'Con apuestas, un partido solo se posterga: no cambia de equipos ni de competición y no se borra. Si no se jugará, cancélalo.',
	MATCH_HAS_GOALS: 'Borra antes sus goles registrados.',
	MATCH_HAS_RESULT: 'El partido ya tiene un marcador cargado.',
	MATCH_HAS_MEDIA: 'Quita antes sus imágenes y videos.',
	RESULT_NOT_ALLOWED_YET: 'El marcador y los goles se cargan desde la hora de inicio del partido.',
	RESULT_INCOMPLETE: 'Carga los goles de los dos equipos antes de confirmar.',
	MATCH_NOT_ENDED: 'El resultado se confirma pasados 60 minutos desde el inicio.',
	RESULT_CHANGED: 'Alguien corrigió el marcador mientras tanto: revisa la vista previa actualizada y vuelve a confirmar.',
	RESULT_ALREADY_CONFIRMED: 'El resultado ya es definitivo: el partido quedó bloqueado.',
	DRAW_NOT_ALLOWED: 'Este deporte no admite empate: corrige el marcador antes de confirmar.',
	SCORE_BELOW_GOALS: 'Borra o corrige antes los goles con autor de ese equipo.',
	GOALS_EXCEED_SCORE: 'Primero sube el marcador de ese equipo.',
	PLAYER_NOT_IN_TEAM: 'Inscribe antes al jugador en el plantel de ese equipo (sección Planteles).',
	TEAM_NOT_IN_MATCH: 'Elige uno de los dos equipos del partido.',
	MATCH_NOT_STARTED: 'La multimedia se agrega desde la hora de inicio del partido.',
	MEDIA_LIMIT_REACHED: 'Quita alguna antes de agregar otra.',
	VIDEO_ALREADY_ADDED: 'Ese video ya está en el partido.',
	IMAGE_INVALID: 'Sube una imagen JPEG, PNG, WebP o GIF (nunca SVG) de hasta 24 megapíxeles.',
	UPLOAD_INVALID: 'Elige un solo archivo de imagen.',
	PAYLOAD_TOO_LARGE: 'El máximo es 5 MB: elige una imagen más liviana.',
	UNSUPPORTED_MEDIA_TYPE: 'Ese envío no es válido: vuelve a elegir el archivo.',
	MATCH_ALREADY_FINISHED: 'Un partido con el resultado confirmado no se cancela.',
	MATCH_ALREADY_CANCELLED: 'El partido ya estaba cancelado.',
	CONCURRENT_UPDATE: 'Otra operación estaba usando los mismos datos: vuelve a intentarlo.',
	PAYMENT_ALREADY_CONFIRMED: 'No hace falta hacer nada.',
	PAYMENT_NOT_CONFIRMED: 'Primero confirma el pago; después valida.',
	USER_ALREADY_VALIDATED: 'La validación y sus 10 monedas no se deshacen.',
	NOT_A_PARTICIPANT: 'Los administradores no participan en la polla.',
	CSRF_FAILED: 'Recarga la página e intenta de nuevo.',
};

/**
 * The field a refusal belongs to, when the backend names the problem but not
 * the field (a 409 carries no `details` per field). The form marks it and the
 * focus lands there, like a 400 (T-21 fix).
 */
const FIELD_OF_CODE: Record<string, string> = {
	SLUG_TAKEN: 'slug',
	SHIRT_NUMBER_TAKEN: 'numeroCamiseta',
	PLAYER_ALREADY_ENROLLED: 'jugadorId',
	SAME_TEAM: 'visitaId',
	MATCH_DATE_IN_PAST: 'fechaHora',
};

/** The message an admin refusal shows: the backend's reason, and what to do. */
export function adminErrorText(error: unknown): string {
	if (!(error instanceof ApiError)) return 'Ocurrió un error inesperado. Intenta de nuevo.';
	if (error.code === 'RATE_LIMITED') {
		return `Demasiadas solicitudes. Espera ${waitText(error.retryAfterSeconds) ?? 'unos minutos'} y vuelve a intentarlo.`;
	}
	const hint = HINTS[error.code];
	return hint && hint !== error.message ? `${error.message} ${hint}` : error.message;
}

/**
 * What a route action answers after an admin write: `ok` with a message, or
 * the refusal with its message, its code and the per-field problems of a 400.
 * `intent` and `target` say which form it belongs to.
 */
export interface ActionOutcome<T = unknown> {
	intent: string;
	/** The row or item the action was about (a participant id, "nuevo"...). */
	target: string;
	ok: boolean;
	message: string;
	code: string | null;
	fields: Record<string, string>;
	data?: T;
}

/** Runs an admin write and describes how it went; unexpected errors still reach the error page. */
export async function perform<T>(intent: string, target: string, work: () => Promise<T>, success: (data: T) => string): Promise<ActionOutcome<T>> {
	try {
		const data = await work();
		return { intent, target, ok: true, message: success(data), code: null, fields: {}, data };
	} catch (error) {
		if (!(error instanceof ApiError)) throw error;
		const fields = fieldErrors(error);
		const named = FIELD_OF_CODE[error.code];
		if (named && !fields[named]) fields[named] = error.message;
		return { intent, target, ok: false, message: adminErrorText(error), code: error.code, fields };
	}
}

/** A refusal decided before calling the API (a date that isn't one, a missing choice). */
export const refused = (intent: string, target: string, message: string, fields: Record<string, string> = {}): ActionOutcome => ({
	intent,
	target,
	ok: false,
	message,
	code: 'VALIDATION_ERROR',
	fields,
});

/** The JSON body of a route action (`fetcher.submit(..., { encType: 'application/json' })`), or `{}`. */
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
	try {
		const body: unknown = await request.json();
		return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** A whole number field of a form body (`'12'` or `12`), or `undefined`. */
export function intOf(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isInteger(value)) return value;
	if (typeof value === 'string' && /^-?\d{1,9}$/.test(value.trim())) return Number(value.trim());
	return undefined;
}

/** "del jugador Ana", "de la inscripción": the contraction Spanish needs after "de". */
export const deOf = (label: string) => (label.startsWith('el ') ? `del ${label.slice(3)}` : `de ${label}`);

/** A text field of a form body, trimmed, or `undefined` when empty. */
export function textOf(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
