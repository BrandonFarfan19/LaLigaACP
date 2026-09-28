import type { CoinMovement } from '../types/api';
import type { ApiPage } from '../types/betting';
import { api, ApiError, CLIENT_ERROR } from './api';

/**
 * The participant's own coin movements (`GET /monedas/movimientos`, BR-010):
 * validation, debits, refunds and, since C-09, the prizes of right forecasts
 * (BR-057). Newest first. Admins have none (403 `NOT_A_PARTICIPANT`).
 */

/** How many "Mi cuenta" shows: the most recent ones. */
export const MOVEMENTS_SHOWN = 20;

/**
 * The latest movements. A body that isn't a page of them is an `ApiError`
 * `BAD_RESPONSE` (status 0), like the league's reads: the page shows its
 * notice with "Reintentar" instead of breaking.
 */
export async function listRecentMovements(signal?: AbortSignal): Promise<ApiPage<CoinMovement>> {
	const page = await api.get<ApiPage<CoinMovement>>('/monedas/movimientos', { signal, query: { page: 1, pageSize: MOVEMENTS_SHOWN } });
	const valid =
		typeof page === 'object' &&
		page !== null &&
		Array.isArray(page.items) &&
		typeof page.total === 'number' &&
		page.items.every((m) => typeof m?.cantidad === 'number' && typeof m.tipo?.codigo === 'string' && typeof m.tipo.nombre === 'string');
	if (!valid) throw new ApiError(0, CLIENT_ERROR.BAD_RESPONSE, 'El servidor respondió algo inesperado. Intenta de nuevo.');
	return page;
}

/** The prize movements (C-09), told apart from the rest on screen. */
export const isPrize = (movement: CoinMovement) => movement.tipo.codigo.startsWith('premio_');
