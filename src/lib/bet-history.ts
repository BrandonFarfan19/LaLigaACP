import type { ApiCompetition, ApiPage, MyBet, MyBetsSummary, SelectionState, TicketState } from '../types/betting';
import { api } from './api';
import { dayEnd, dayStart, isDay, positiveInt } from './betting';

/**
 * "Mis apuestas" (T-20, BR-026): the user's own bets and their summary. Every
 * read goes through the API client; the backend only ever returns the
 * session user's bets (T-11).
 */

export const SELECTION_STATES: readonly SelectionState[] = ['pendiente', 'acertada', 'no_acertada', 'anulada'];
export const TICKET_STATES: readonly TicketState[] = ['pendiente', 'finalizado', 'anulado'];

/** Rows (selections) per page. */
export const HISTORY_PAGE_SIZE = 20;

/** The filters of the list, as the page URL carries them: the API's own names. */
export interface HistoryFilters {
	estado?: SelectionState;
	estadoTicket?: TicketState;
	deporteId?: number;
	competicionId?: number;
	/** A day, `YYYY-MM-DD`, in the league's zone: the date the ticket was confirmed. */
	desde?: string;
	hasta?: string;
	page: number;
}

/**
 * Reads the filters from the page URL with the backend's rules
 * (`listMyBetsQuery`). An invalid value is dropped and reported, so the page
 * still loads. A parameter the page doesn't know (`?foo=bar`, a tracking tag)
 * is ignored with no notice, and never reaches the API.
 */
export function parseHistoryFilters(params: URLSearchParams): { filters: HistoryFilters; problems: string[] } {
	const filters: HistoryFilters = { page: 1 };
	const problems: string[] = [];
	const read = (name: string) => {
		const values = params.getAll(name);
		if (values.length > 1) problems.push(`El filtro ${name} aparece más de una vez: se ignoró.`);
		return values.length === 1 ? values[0]!.trim() : '';
	};

	const estado = read('estado');
	if (estado) {
		if ((SELECTION_STATES as readonly string[]).includes(estado)) filters.estado = estado as SelectionState;
		else problems.push('El estado de apuesta elegido no es válido: se muestran todos.');
	}
	const estadoTicket = read('estadoTicket');
	if (estadoTicket) {
		if ((TICKET_STATES as readonly string[]).includes(estadoTicket)) filters.estadoTicket = estadoTicket as TicketState;
		else problems.push('El estado de ticket elegido no es válido: se muestran todos.');
	}
	for (const [name, problem] of [
		['deporteId', 'El deporte elegido no es válido: se muestran todos.'],
		['competicionId', 'La competición elegida no es válida: se muestran todas.'],
	] as const) {
		const value = read(name);
		if (!value) continue;
		const id = positiveInt(value, Number.MAX_SAFE_INTEGER);
		if (id) filters[name] = id;
		else problems.push(problem);
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
	const page = read('page');
	if (page) {
		const n = positiveInt(page, 100_000);
		if (n) filters.page = n;
		else problems.push('La página no es válida: se muestra la primera.');
	}
	return { filters, problems };
}

/** The page URL for some filters (only the ones set; page 1 is left out). */
export function historySearch(filters: Partial<HistoryFilters>): string {
	const params = new URLSearchParams();
	if (filters.estado) params.set('estado', filters.estado);
	if (filters.estadoTicket) params.set('estadoTicket', filters.estadoTicket);
	if (filters.deporteId) params.set('deporteId', String(filters.deporteId));
	if (filters.competicionId) params.set('competicionId', String(filters.competicionId));
	if (filters.desde) params.set('desde', filters.desde);
	if (filters.hasta) params.set('hasta', filters.hasta);
	if (filters.page && filters.page > 1) params.set('page', String(filters.page));
	const search = params.toString();
	return search ? `?${search}` : '';
}

/** `GET /apuestas/mis-apuestas`: newest ticket first, one row per selection. */
export function listMyBets(filters: HistoryFilters, signal?: AbortSignal): Promise<ApiPage<MyBet>> {
	return api.get<ApiPage<MyBet>>('/apuestas/mis-apuestas', {
		signal,
		query: {
			estado: filters.estado,
			estadoTicket: filters.estadoTicket,
			deporteId: filters.deporteId,
			competicionId: filters.competicionId,
			desde: filters.desde ? dayStart(filters.desde) : undefined,
			hasta: filters.hasta ? dayEnd(filters.hasta) : undefined,
			page: filters.page,
			pageSize: HISTORY_PAGE_SIZE,
		},
	});
}

/** `GET /apuestas/mis-apuestas/resumen`. */
export function getMyBetsSummary(signal?: AbortSignal): Promise<MyBetsSummary> {
	return api.get<MyBetsSummary>('/apuestas/mis-apuestas/resumen', { signal });
}

/** Most competitions the filter reads at once (one API page). */
export const MAX_COMPETITIONS = 100;

/** The competitions of one sport, for the filter (public, T-08). */
export async function listCompetitions(deporteId: number, signal?: AbortSignal): Promise<ApiCompetition[]> {
	const page = await api.get<ApiPage<ApiCompetition>>('/public/competiciones', { signal, query: { deporteId, pageSize: MAX_COMPETITIONS } });
	return page.items;
}

/**
 * Every competition, when they fit in one page (`null` if not): with them the
 * filter shows a sport's competitions as soon as the sport is chosen.
 */
export async function listAllCompetitions(signal?: AbortSignal): Promise<ApiCompetition[] | null> {
	const page = await api.get<ApiPage<ApiCompetition>>('/public/competiciones', { signal, query: { pageSize: MAX_COMPETITIONS } });
	return page.totalPages <= 1 ? page.items : null;
}

export interface TicketGroup {
	ticket: MyBet['ticket'];
	selections: MyBet[];
}

/**
 * Consecutive rows of the same ticket, as one group (the API sorts by ticket).
 * A page may cut a ticket: its group then has fewer selections than
 * `ticket.cantidadSelecciones`.
 */
export function groupByTicket(rows: readonly MyBet[]): TicketGroup[] {
	const groups: TicketGroup[] = [];
	for (const row of rows) {
		const last = groups.at(-1);
		if (last && last.ticket.id === row.ticket.id) last.selections.push(row);
		else groups.push({ ticket: row.ticket, selections: [row] });
	}
	return groups;
}
