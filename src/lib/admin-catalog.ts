import type {
	AdminCompetition,
	AdminEnrollment,
	AdminGoal,
	AdminMatch,
	AdminPlayer,
	AdminSport,
	AdminTeam,
	ApiPage,
	CancellationFigures,
	CancellationPreview,
	MatchImage,
	MatchMedia,
	MatchVideo,
	OfficialResult,
	ResultPreview,
} from '../types/admin';
import { api } from './api';
import { ADMIN_PAGE_SIZE, apiQuery, type FilterSpec, type FilterValues } from './admin-core';

/**
 * The sports catalog (T-06), the matches (T-07), their result (T-12), goals
 * and media (T-13) and their cancellation (T-16), for the admin panel (T-21).
 * Reads and writes only through `api.ts`; the backend checks every rule.
 */

/** The catalog resources and their API paths. */
export const CATALOG_PATHS = {
	deportes: '/admin/deportes',
	competiciones: '/admin/competiciones',
	equipos: '/admin/equipos',
	jugadores: '/admin/jugadores',
	planteles: '/admin/planteles',
} as const;
export type CatalogResource = keyof typeof CATALOG_PATHS;

export interface CatalogRow {
	deportes: AdminSport;
	competiciones: AdminCompetition;
	equipos: AdminTeam;
	jugadores: AdminPlayer;
	planteles: AdminEnrollment;
}

/** Each list's filters in the page URL: the API's own names. */
export const CATALOG_FILTERS: Record<CatalogResource, FilterSpec> = {
	deportes: { q: { kind: 'text' }, permiteEmpate: { kind: 'enum', values: ['true', 'false'] } },
	competiciones: { q: { kind: 'text' }, deporteId: { kind: 'id' } },
	equipos: { q: { kind: 'text' }, deporteId: { kind: 'id' }, competicionId: { kind: 'id' } },
	jugadores: { q: { kind: 'text' }, competicionId: { kind: 'id' }, equipoId: { kind: 'id' } },
	planteles: { q: { kind: 'text' }, competicionId: { kind: 'id' }, equipoId: { kind: 'id' }, jugadorId: { kind: 'id' } },
};

export function listCatalog<R extends CatalogResource>(resource: R, filters: FilterValues, signal?: AbortSignal): Promise<ApiPage<CatalogRow[R]>> {
	return api.get<ApiPage<CatalogRow[R]>>(CATALOG_PATHS[resource], { signal, query: apiQuery(filters) });
}

/**
 * A bounded list, whole: only where the backend caps it (a team's squad is at
 * most 99, one shirt number each). Anything that can grow is searched instead
 * (D-019, `searchCatalog`).
 */
export async function catalogOptions<R extends CatalogResource>(
	resource: R,
	query: Record<string, number | undefined> = {},
	signal?: AbortSignal,
): Promise<CatalogRow[R][]> {
	const page = await api.get<ApiPage<CatalogRow[R]>>(CATALOG_PATHS[resource], { signal, query: { ...query, pageSize: 100 } });
	return page.items;
}

/** Options per page of the searchable chooser (D-019). */
export const OPTIONS_PAGE_SIZE = 20;

/** One page of a catalog list for the searchable chooser: the API does the filtering. */
export const searchCatalog = <R extends CatalogResource>(
	resource: R,
	query: Record<string, string | number | undefined>,
	signal?: AbortSignal,
): Promise<ApiPage<CatalogRow[R]>> => api.get<ApiPage<CatalogRow[R]>>(CATALOG_PATHS[resource], { signal, query: { pageSize: OPTIONS_PAGE_SIZE, ...query } });

/** One row by id, to show a chosen option (or a filter's value) with its whole name. */
export const getCatalogRow = <R extends CatalogResource>(resource: R, id: number, signal?: AbortSignal): Promise<CatalogRow[R]> =>
	api.get<CatalogRow[R]>(`${CATALOG_PATHS[resource]}/${id}`, { signal });

export const createCatalog = <R extends CatalogResource>(resource: R, body: Record<string, unknown>) =>
	api.post<CatalogRow[R]>(CATALOG_PATHS[resource], body);

export const updateCatalog = <R extends CatalogResource>(resource: R, id: number, body: Record<string, unknown>) =>
	api.patch<CatalogRow[R]>(`${CATALOG_PATHS[resource]}/${id}`, body);

export const deleteCatalog = (resource: CatalogResource, id: number) => api.delete<{ id: number }>(`${CATALOG_PATHS[resource]}/${id}`);

/* ---- Matches (T-07) ---------------------------------------------------- */

export const MATCH_STATES = ['programado', 'en_curso', 'finalizado', 'cancelado'] as const;

export const MATCH_FILTERS: FilterSpec = {
	deporteId: { kind: 'id' },
	competicionId: { kind: 'id' },
	equipoId: { kind: 'id' },
	estado: { kind: 'enum', values: MATCH_STATES },
	desde: { kind: 'day' },
	hasta: { kind: 'day' },
};

/** In the backend's proximity order (BR-013). */
export const listMatches = (filters: FilterValues, signal?: AbortSignal) =>
	api.get<ApiPage<AdminMatch>>('/admin/partidos', { signal, query: apiQuery(filters, ADMIN_PAGE_SIZE) });

export const getMatch = (id: number, signal?: AbortSignal) => api.get<AdminMatch>(`/admin/partidos/${id}`, { signal });

export interface MatchBody {
	competicionId?: unknown;
	localId?: unknown;
	visitaId?: unknown;
	jornada?: unknown;
	/** ISO with seconds and zone. */
	fechaHora?: unknown;
	sede?: unknown;
}

export const createMatch = (body: MatchBody) => api.post<AdminMatch>('/admin/partidos', body);
export const updateMatch = (id: number, body: MatchBody) => api.patch<AdminMatch>(`/admin/partidos/${id}`, body);
export const deleteMatch = (id: number) => api.delete<{ id: number }>(`/admin/partidos/${id}`);

/* ---- Result (T-12) ----------------------------------------------------- */

export const getResultPreview = (id: number, signal?: AbortSignal) => api.get<ResultPreview>(`/admin/partidos/${id}/resultado`, { signal });

export const setResult = (id: number, golesLocal: unknown, golesVisitante: unknown) =>
	api.put<AdminMatch>(`/admin/partidos/${id}/resultado`, { golesLocal, golesVisitante });

/** BR-031: explicit, with the score the admin saw. The answer carries the official result (BR-029). */
export const confirmResult = (id: number, golesLocal: number, golesVisitante: number) =>
	api.post<{ partido: AdminMatch; resultado: OfficialResult }>(`/admin/partidos/${id}/resultado/confirmar`, { confirmar: true, golesLocal, golesVisitante });

/* ---- Goals and media (T-13) -------------------------------------------- */

export const listGoals = (id: number, signal?: AbortSignal) => api.get<AdminGoal[]>(`/admin/partidos/${id}/goles`, { signal });
export const createGoal = (id: number, body: { jugadorId: unknown; equipoId: unknown; minuto: unknown }) =>
	api.post<AdminGoal>(`/admin/partidos/${id}/goles`, body);
export const updateGoal = (id: number, golId: number, body: Record<string, unknown>) => api.patch<AdminGoal>(`/admin/partidos/${id}/goles/${golId}`, body);
export const deleteGoal = (id: number, golId: number) => api.delete<{ id: number }>(`/admin/partidos/${id}/goles/${golId}`);

/** One file in the field `imagen` (the backend checks its content, size and pixels). */
const imageForm = (file: File) => {
	const form = new FormData();
	form.append('imagen', file);
	return form;
};

export const setGoalImage = (id: number, golId: number, file: File) =>
	api.upload<AdminGoal>('PUT', `/admin/partidos/${id}/goles/${golId}/imagen`, imageForm(file));
export const removeGoalImage = (id: number, golId: number) => api.delete<AdminGoal>(`/admin/partidos/${id}/goles/${golId}/imagen`);
export const setGoalVideo = (id: number, golId: number, url: unknown) => api.put<AdminGoal>(`/admin/partidos/${id}/goles/${golId}/video`, { url });
export const removeGoalVideo = (id: number, golId: number) => api.delete<AdminGoal>(`/admin/partidos/${id}/goles/${golId}/video`);

export const listMedia = (id: number, signal?: AbortSignal) => api.get<MatchMedia>(`/admin/partidos/${id}/multimedia`, { signal });
export const addMatchImage = (id: number, file: File) => api.upload<MatchImage>('POST', `/admin/partidos/${id}/multimedia/imagenes`, imageForm(file));
export const addMatchVideo = (id: number, url: unknown) => api.post<MatchVideo>(`/admin/partidos/${id}/multimedia/videos`, { url });
export const deleteMedia = (id: number, mediaId: number) => api.delete<{ id: number }>(`/admin/partidos/${id}/multimedia/${mediaId}`);

/**
 * An uploaded image's path, as the screen loads it (through the `/api`
 * proxy): only the server's own `/admin/archivos/<32 hex>.webp` names, so a
 * value from the API can never point an `<img>` anywhere else.
 */
export function adminImageSrc(path: string | null): string | null {
	return path && /^\/admin\/archivos\/[0-9a-f]{32}\.webp$/.test(path) ? `/api${path}` : null;
}

/** A video player may only load the platforms' embed addresses (T-13 note). */
export function safeEmbedUrl(url: string): string | null {
	return /^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[\w-]+|player\.vimeo\.com\/video\/\d+)$/.test(url) ? url : null;
}

/* ---- Cancellation (T-16) ----------------------------------------------- */

export const getCancellationPreview = (id: number, signal?: AbortSignal) =>
	api.get<CancellationPreview>(`/admin/partidos/${id}/cancelacion`, { signal });

/** BR-045: explicit and final. */
export const cancelMatch = (id: number) =>
	api.post<CancellationFigures & { partido: AdminMatch }>(`/admin/partidos/${id}/cancelacion/confirmar`, { confirmar: true });
