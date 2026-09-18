import { useEffect } from 'react';
import type { LoaderFunctionArgs, ShouldRevalidateFunction } from 'react-router';
import { useRememberedNavigate } from '../hooks/useRequestedPath';
import { type FilterValues, searchOf } from './admin-core';
import { isTransientError, waitText } from './api';
import { requireKnownUser } from './route-guards';

/**
 * What every admin section's loader answers (T-21): its data, or why it
 * couldn't be read this time. Only an admin gets here (`requireKnownUser`
 * with the `admin` role: a participant gets the 403 page, nobody signed in
 * goes to sign in). A transient failure (no connection, the server down, a
 * limit), of the data or of the session check once the tab knows the admin,
 * stays on the page with its notice and "Reintentar", keeping what it showed
 * (T-19, T-20). Anything else is the error page.
 */
export interface AdminLoad<T> {
	data: T | null;
	loadError: string | null;
}

export function loadMessage(error: { code: string; message: string; retryAfterSeconds: number | null }, what: string): string {
	// "los participantes" are many: "no se pudieron cargar" (T-21 fix).
	const could = /^(los|las) /.test(what) ? 'No se pudieron cargar' : 'No se pudo cargar';
	if (error.code === 'RATE_LIMITED') {
		return `${could} ${what}: demasiadas solicitudes. Espera ${waitText(error.retryAfterSeconds) ?? 'unos minutos'} y vuelve a intentarlo.`;
	}
	return `${could} ${what}. ${error.message}`.trim();
}

/**
 * A page past the end (`?page=999`, T-21 fix): the list shows the last one and
 * says so, as `/mis-apuestas` does. Returns the problems to report and the
 * page actually read; `filters.page` is left at the page shown.
 */
/** The URL a list is replacing after showing a page other than the one asked for. */
let fixingSearch: string | null = null;

/**
 * `?page=999` shows the last page: the URL says that page too, replacing the
 * entry instead of adding one (T-21 second fix, as `/mis-apuestas` does).
 */
export function usePageUrlFix(path: string, filters: FilterValues, fixed: boolean): void {
	const navigate = useRememberedNavigate();
	const search = searchOf(filters);
	useEffect(() => {
		if (!fixed) return;
		fixingSearch = `${path}${search}`;
		navigate(fixingSearch, { replace: true });
	}, [fixed, path, search, navigate]);
}

/** That replacement reads nothing again: what is on screen is already that page's data. */
export const skipPageFix: ShouldRevalidateFunction = ({ nextUrl, defaultShouldRevalidate }) => {
	if (fixingSearch !== null && `${nextUrl.pathname}${nextUrl.search}` === fixingSearch) {
		fixingSearch = null;
		return false;
	}
	return defaultShouldRevalidate;
};

export async function pageInRange<P extends { totalPages: number }>(
	filters: { page: number },
	first: P,
	read: () => Promise<P>,
): Promise<{ page: P; problem: string | null }> {
	const last = Math.max(1, first.totalPages);
	if (filters.page <= last) return { page: first, problem: null };
	const asked = filters.page;
	filters.page = last;
	const problem = last === 1 ? `La página ${asked} no existe: se muestra la primera.` : `La página ${asked} no existe: se muestra la última (${last}).`;
	return { page: first.totalPages > 0 ? await read() : first, problem };
}

export async function loadAdmin<T>(args: LoaderFunctionArgs, what: string, work: (signal: AbortSignal) => Promise<T>): Promise<AdminLoad<T>> {
	const { sessionError } = await requireKnownUser(args, 'admin');
	try {
		if (sessionError) throw sessionError;
		return { data: await work(args.request.signal), loadError: null };
	} catch (error) {
		if (!isTransientError(error)) throw error;
		return { data: null, loadError: loadMessage(error, what) };
	}
}
