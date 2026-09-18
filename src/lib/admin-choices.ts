import type { SearchSource } from '../components/admin/SearchSelect';
import type { AdminCompetition, AdminEnrollment, AdminPlayer, AdminSport, AdminTeam } from '../types/admin';
import { type CatalogResource, type CatalogRow, getCatalogRow, searchCatalog } from './admin-catalog';

/**
 * What the panel's searchable choosers offer (D-019): the API filters by the
 * text typed and pages the answer, so no list is ever cut at 100 and every
 * option reads whole. The label of each row comes from the row itself (the API
 * joins the competition and sport names), never from another list.
 */

export const sportLabel = (s: AdminSport) => s.nombre;
export const competitionLabel = (c: AdminCompetition) => `${c.nombre} (${c.deporteNombre})`;
export const teamLabel = (t: AdminTeam) => `${t.nombre} · ${t.competicionNombre} (${t.deporteNombre})`;
export const playerLabel = (p: AdminPlayer) => p.nombre;
export const enrollmentLabel = (e: AdminEnrollment) => `${e.jugadorNombre} · ${e.equipoNombre} (camiseta ${e.numeroCamiseta})`;

const LABELS = {
	deportes: sportLabel as (row: CatalogRow['deportes']) => string,
	competiciones: competitionLabel as (row: CatalogRow['competiciones']) => string,
	equipos: teamLabel as (row: CatalogRow['equipos']) => string,
	jugadores: playerLabel as (row: CatalogRow['jugadores']) => string,
	planteles: enrollmentLabel as (row: CatalogRow['planteles']) => string,
};

/** The text a chooser shows for a resource's row. */
export function labelOf<R extends CatalogResource>(resource: R, row: CatalogRow[R]): string {
	return (LABELS[resource] as (value: CatalogRow[R]) => string)(row);
}

/**
 * A chooser's source: what is typed becomes the list's own `q`, and `within`
 * narrows it (the teams of a competition, the players of a team).
 */
export function catalogSource<R extends CatalogResource>(resource: R, within: Record<string, string | number | undefined> = {}): SearchSource {
	return async (text, page, signal) => {
		const result = await searchCatalog(resource, { ...within, q: text || undefined, page }, signal);
		return {
			options: result.items.map((row) => ({ value: String(row.id), label: labelOf(resource, row) })),
			total: result.total,
			totalPages: result.totalPages,
		};
	};
}

/**
 * A chooser over a fixed list (the audit actions): the same control, filtered
 * here, so a long name reads whole at 320 px too (D-019).
 */
export function fixedSource(options: readonly { value: string; label: string }[]): SearchSource {
	return async (text) => {
		const wanted = text.trim().toLowerCase();
		const found = wanted ? options.filter((option) => option.label.toLowerCase().includes(wanted)) : [...options];
		return { options: found, total: found.length, totalPages: 1 };
	};
}

/**
 * The label of an id chosen before (a filter in the page URL, the value of a
 * row being edited). A row that can't be read leaves its id, never a failure:
 * the screen still works.
 */
export async function labelById<R extends CatalogResource>(resource: R, id: number | string | undefined, signal?: AbortSignal): Promise<string> {
	const value = Number(id);
	if (!Number.isInteger(value) || value <= 0) return '';
	try {
		return labelOf(resource, await getCatalogRow(resource, value, signal));
	} catch {
		return `#${value}`;
	}
}
