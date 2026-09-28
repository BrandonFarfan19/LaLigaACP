import type { ApiPage, ParticipantBet } from '../types/betting';
import type { FilterSpec, FilterValues } from './admin-core';
import { api } from './api';

/**
 * "Apuestas de todos" (C-07, BR-056): every participant's bets on matches
 * with the official result, for a validated participant. Only the name, the
 * match and the forecast come back (the backend decides what shows and when).
 */

/** The page's path, and its links'. */
export const EVERYONE_PATH = '/apuestas-de-todos';

/** Rows per page. */
export const EVERYONE_PAGE_SIZE = 20;

/**
 * The filters in the page URL, with the API's own names (`listParticipantBetsQuery`).
 * Their problems are said in words, as `/mis-apuestas` does (C-07 fix): never the
 * parameter's name on screen.
 */
export const EVERYONE_FILTERS: FilterSpec = {
	deporteId: {
		kind: 'id',
		invalid: 'El deporte elegido no es válido: se muestran todos.',
		repeated: 'Se eligió más de un deporte: se muestran todos.',
	},
	participante: {
		kind: 'text',
		invalid: 'El nombre del participante no es válido: se muestran todos.',
		repeated: 'Se escribió más de un nombre de participante: se muestran todos.',
	},
};

/** `GET /apuestas/participantes`: the most recent match first, then by name. */
export function listParticipantBets(filters: FilterValues, signal?: AbortSignal): Promise<ApiPage<ParticipantBet>> {
	return api.get<ApiPage<ParticipantBet>>('/apuestas/participantes', {
		signal,
		query: {
			deporteId: filters.deporteId,
			participante: typeof filters.participante === 'string' && filters.participante ? filters.participante : undefined,
			page: filters.page,
			pageSize: EVERYONE_PAGE_SIZE,
		},
	});
}
