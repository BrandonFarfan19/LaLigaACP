import type {
	ApiPage,
	ApiSport,
	BettingMatch,
	BettingState,
	SelectionInput,
	TicketEvaluation,
	TicketReceipt,
} from '../types/betting';
import { api, ApiError } from './api';

/**
 * The betting pool's data layer (T-19): every read and write of the betting
 * screens goes through here, and through the API client (`api.ts`). The
 * backend checks everything again (BR-014, BR-015, BR-021, BR-054).
 */

export const BETTING_STATES: readonly BettingState[] = ['disponible', 'cerrada', 'en_curso', 'finalizado', 'cancelado'];

/** Matches per page of the betting list. */
export const MATCHES_PAGE_SIZE = 20;
/** BR-019 precision (T-09): at most 50 selections in a ticket. */
export const MAX_SELECTIONS = 50;
/** BR-016 precision (T-09): 0 to 999 goals per side. */
export const MAX_GOALS = 999;

/**
 * The league's zone (America/Lima, UTC−5 all year): the same one the kick-off
 * labels use (`utils/format-date.ts`). A day filter means that day there.
 */
const LEAGUE_OFFSET = '-05:00';

/** The first and last second of a league day (`YYYY-MM-DD`), as the API wants them. */
export const dayStart = (day: string) => `${day}T00:00:00${LEAGUE_OFFSET}`;
export const dayEnd = (day: string) => `${day}T23:59:59${LEAGUE_OFFSET}`;

/** The filters of the betting list, as the page URL carries them (BR-051). */
export interface BettingFilters {
	deporteId?: number;
	/** A day, `YYYY-MM-DD`, in the league's zone. */
	desde?: string;
	hasta?: string;
	estadoApuesta?: BettingState;
	page: number;
}

/** The page URL's parameters, by name: the same names the API uses. */
export const FILTER_PARAMS = ['deporteId', 'desde', 'hasta', 'estadoApuesta', 'page'] as const;

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day, `YYYY-MM-DD`, between 2000 and 2099. */
export function isDay(value: string): boolean {
	const match = DAY.exec(value);
	if (!match) return false;
	const [, y, m, d] = match.map(Number) as [number, number, number, number];
	const date = new Date(Date.UTC(y, m - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d && y >= 2000 && y < 2100;
}

/** A whole number from 1 to `max`, written plainly (no sign, no leading zero), or `null`. */
export const positiveInt = (value: string, max: number) => (/^[1-9]\d{0,15}$/.test(value) && Number(value) <= max ? Number(value) : null);

/**
 * Reads the filters from the page URL with the backend's rules
 * (`listBettingMatchesQuery`). An invalid value is dropped and reported, so
 * the page still loads; unknown parameters are ignored and never reach the API.
 */
export function parseBettingFilters(params: URLSearchParams): { filters: BettingFilters; problems: string[] } {
	const filters: BettingFilters = { page: 1 };
	const problems: string[] = [];
	const read = (name: string) => {
		const values = params.getAll(name);
		if (values.length > 1) problems.push(`El filtro ${name} aparece más de una vez: se ignoró.`);
		return values.length === 1 ? values[0]!.trim() : '';
	};

	const deporte = read('deporteId');
	if (deporte) {
		const id = positiveInt(deporte, Number.MAX_SAFE_INTEGER);
		if (id) filters.deporteId = id;
		else problems.push('El deporte elegido no es válido: se muestran todos.');
	}
	for (const name of ['desde', 'hasta'] as const) {
		const day = read(name);
		if (!day) continue;
		if (isDay(day)) filters[name] = day;
		else problems.push(`La fecha "${name}" no es válida: se ignoró.`);
	}
	if (filters.desde && filters.hasta && filters.desde > filters.hasta) {
		problems.push('La fecha "desde" es posterior a "hasta": se ignoró "hasta".');
		delete filters.hasta;
	}
	const estado = read('estadoApuesta');
	if (estado) {
		if ((BETTING_STATES as readonly string[]).includes(estado)) filters.estadoApuesta = estado as BettingState;
		else problems.push('El estado elegido no es válido: se muestran todos.');
	}
	const page = read('page');
	if (page) {
		const n = positiveInt(page, 100_000);
		if (n) filters.page = n;
		else problems.push('La página no es válida: se muestra la primera.');
	}
	return { filters, problems };
}

/** The page URL for some filters (only the ones set; page 1 is left out). */
export function bettingSearch(filters: Partial<BettingFilters>): string {
	const params = new URLSearchParams();
	if (filters.deporteId) params.set('deporteId', String(filters.deporteId));
	if (filters.desde) params.set('desde', filters.desde);
	if (filters.hasta) params.set('hasta', filters.hasta);
	if (filters.estadoApuesta) params.set('estadoApuesta', filters.estadoApuesta);
	if (filters.page && filters.page > 1) params.set('page', String(filters.page));
	const search = params.toString();
	return search ? `?${search}` : '';
}

/** `GET /apuestas/partidos`, in the BR-013 order the API returns. */
export function listBettingMatches(filters: BettingFilters, signal?: AbortSignal): Promise<ApiPage<BettingMatch>> {
	return api.get<ApiPage<BettingMatch>>('/apuestas/partidos', {
		signal,
		query: {
			deporteId: filters.deporteId,
			desde: filters.desde ? dayStart(filters.desde) : undefined,
			hasta: filters.hasta ? dayEnd(filters.hasta) : undefined,
			estadoApuesta: filters.estadoApuesta,
			page: filters.page,
			pageSize: MATCHES_PAGE_SIZE,
		},
	});
}

/** The sports for the filter (public, BR-048). */
export function listSports(signal?: AbortSignal): Promise<ApiSport[]> {
	return api.get<ApiSport[]>('/public/deportes', { signal });
}

/** BR-023: what the ticket would cost and whether it would be accepted. Writes nothing. */
export function previewTicket(selecciones: SelectionInput[]): Promise<TicketEvaluation> {
	return api.post<TicketEvaluation>('/apuestas/vista-previa', { selecciones });
}

/**
 * BR-024, BR-054: confirms the ticket. `idempotencyKey` identifies this
 * attempt: a retry of the same ticket (a network error, a double click) must
 * send the same key, so the backend returns the ticket already created
 * instead of charging twice.
 */
export function confirmTicket(selecciones: SelectionInput[], idempotencyKey: string): Promise<TicketReceipt> {
	return api.post<TicketReceipt>('/apuestas/tickets', { selecciones }, { headers: { 'Idempotency-Key': idempotencyKey } });
}

/**
 * BR-025: one of the user's own tickets. `null` for an id that isn't one
 * (not a number, someone else's, or missing: the backend answers the same 404).
 */
export async function getTicket(id: string): Promise<TicketReceipt | null> {
	if (!/^[1-9]\d{0,15}$/.test(id) || !Number.isSafeInteger(Number(id))) return null;
	try {
		return await api.get<TicketReceipt>(`/apuestas/tickets/${id}`);
	} catch (error) {
		if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
		throw error;
	}
}

/** A new idempotency key (a random UUID). */
export function newIdempotencyKey(): string {
	if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	bytes[6] = (bytes[6]! & 0x0f) | 0x40;
	bytes[8] = (bytes[8]! & 0x3f) | 0x80;
	const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
