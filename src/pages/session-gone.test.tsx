import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { adminMatch, adminRoutes, pageOf as adminPage, participant } from '../test/admin-fixtures';
import { apiRoutes, bettingMatch, myBet, page as bettingPage, rankingOf, rankingRow, summaryOf, voley } from '../test/betting-fixtures';
import { admin, apostador, fail, mockFetch, ok } from '../test/fetch-mock';
import { renderApp, where } from '../test/render-app';
import { forgetRequested, requestedForTest } from '../hooks/useRequestedPath';
import type { ApiPage, MyBet } from '../types/betting';

/**
 * A session that ends while the user is asking for another page: signing in
 * always comes back to the page asked for, never to the one left on screen
 * (T-21 fixes). The four protected screens with filters and pages go through
 * the same recorder, whichever way the page was asked for: a link, the filter
 * form or a reload of what is on screen.
 */

const futbolMatch = bettingMatch({ id: 1, local: 'Halcones', visita: 'Pumas' });
const voleyMatch = bettingMatch({ id: 2, local: 'Águilas', visita: 'Delfines', sport: voley });

const listOf = (items: MyBet[], extra: Partial<ApiPage<MyBet>> = {}): ApiPage<MyBet> => ({
	items,
	page: 1,
	pageSize: 20,
	total: 45,
	totalPages: 3,
	...extra,
});

/** The session answers until `alive` says otherwise. */
function routes(alive: () => boolean, extra: Record<string, Parameters<typeof apiRoutes>[0][string]> = {}, user = apostador) {
	return mockFetch(
		apiRoutes({
			'GET /api/auth/me': () => (alive() ? ok({ user, csrfToken: 't' }) : fail(401, 'UNAUTHENTICATED')),
			'GET /api/public/deportes': () => ok([futbolMatch.deporte, voley]),
			'GET /api/public/competiciones': () => ok({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 }),
			'GET /api/apuestas/mis-apuestas': ({ url }) => ok(listOf([myBet(Number(new URL(url, 'http://x').searchParams.get('page')) || 1)])),
			'GET /api/apuestas/mis-apuestas/resumen': () => ok(summaryOf()),
			'GET /api/apuestas/partidos': () => ok({ ...bettingPage([futbolMatch, voleyMatch]), total: 45, totalPages: 3 }),
			'GET /api/ranking': () => ok(rankingOf([rankingRow(1, 'Ana', 3, 1)])),
			...extra,
		}),
	);
}

const nextOf = (path: string) => `/ingresar?next=${encodeURIComponent(path)}`;

describe('the session ends while another page is asked for', () => {
	beforeEach(() => forgetRequested());

	it('/mis-apuestas: the filter keeps its URL, from a page other than the first', async () => {
		let alive = true;
		routes(() => alive);
		const router = renderApp('/mis-apuestas?page=2');
		await screen.findByRole('heading', { name: 'Mis apuestas', level: 1 });
		const user = userEvent.setup();
		alive = false;
		await user.selectOptions(screen.getByLabelText('Estado de la apuesta'), 'acertada');
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));

		// The filter asked for is what comes back after signing in, not the page it started from.
		expect(requestedForTest()?.path).toBe('/mis-apuestas?estado=acertada');
		await waitFor(() => expect(where(router)).toBe(nextOf('/mis-apuestas?estado=acertada')));
	});

	it('/mis-apuestas: a page link keeps its page', async () => {
		let alive = true;
		routes(() => alive);
		const router = renderApp('/mis-apuestas');
		await screen.findByRole('heading', { name: 'Mis apuestas', level: 1 });
		alive = false;
		await userEvent.setup().click(screen.getByRole('link', { name: 'Siguiente >' }));

		expect(requestedForTest()?.path).toBe('/mis-apuestas?page=2');
		await waitFor(() => expect(where(router)).toBe(nextOf('/mis-apuestas?page=2')));
	});

	it('/mis-apuestas: reloading what is on screen comes back to it, filters included', async () => {
		let alive = true;
		let down = false;
		routes(() => alive, { 'GET /api/apuestas/mis-apuestas': () => (down ? new Response('', { status: 502 }) : ok(listOf([myBet(1)]))) });
		down = true;
		const router = renderApp('/mis-apuestas?estado=acertada');
		const notice = await screen.findByRole('alert');
		alive = false;
		await userEvent.setup().click(within(notice).getByRole('button', { name: 'Reintentar' }));

		await waitFor(() => expect(where(router)).toBe(nextOf('/mis-apuestas?estado=acertada')));
	});

	it('/apuestas: the filter keeps its URL', async () => {
		let alive = true;
		routes(() => alive);
		const router = renderApp('/apuestas');
		await screen.findByRole('heading', { name: 'Apuestas', level: 1 });
		const user = userEvent.setup();
		alive = false;
		await user.click(within(screen.getByRole('group', { name: 'Deporte' })).getByRole('radio', { name: 'Vóley' }));
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));

		expect(requestedForTest()?.path).toBe('/apuestas?deporteId=2');
		await waitFor(() => expect(where(router)).toBe(nextOf('/apuestas?deporteId=2')));
	});

	it('/apuestas: a page link keeps its page', async () => {
		let alive = true;
		routes(() => alive);
		const router = renderApp('/apuestas');
		await screen.findByRole('heading', { name: 'Apuestas', level: 1 });
		alive = false;
		await userEvent.setup().click(screen.getByRole('link', { name: 'Siguiente >' }));

		expect(requestedForTest()?.path).toBe('/apuestas?page=2');
		await waitFor(() => expect(where(router)).toBe(nextOf('/apuestas?page=2')));
	});

	it('/ranking: reloading it comes back to it', async () => {
		let alive = true;
		routes(() => alive);
		const router = renderApp('/ranking');
		await screen.findByRole('table');
		alive = false;
		await userEvent.setup().click(screen.getByRole('button', { name: 'Actualizar' }));

		await waitFor(() => expect(where(router)).toBe(nextOf('/ranking')));
	});

	it('the panel: filter, page link and reload keep the URL asked for', async () => {
		let alive = true;
		const admins = (extra: Record<string, Parameters<typeof apiRoutes>[0][string]> = {}) =>
			mockFetch(
				adminRoutes({
					'GET /api/auth/me': () => (alive ? ok({ user: admin, csrfToken: 't' }) : fail(401, 'UNAUTHENTICATED')),
					'GET /api/admin/participantes': ({ url }) =>
						ok(adminPage([participant()], { page: Number(new URL(url, 'http://x').searchParams.get('page')) || 1, total: 25, totalPages: 2 })),
					...extra,
				}),
			);

		admins();
		let router = renderApp('/admin/participantes');
		await screen.findByRole('table', { name: 'Participantes' });
		const user = userEvent.setup();
		alive = false;
		await user.click(screen.getByRole('link', { name: 'Siguiente >' }));
		expect(requestedForTest()?.path).toBe('/admin/participantes?page=2');
		await waitFor(() => expect(where(router)).toBe(nextOf('/admin/participantes?page=2')));
		router.dispose();

		alive = true;
		forgetRequested();
		admins({ 'GET /api/admin/partidos': () => ok(adminPage([adminMatch()])) });
		router = renderApp('/admin/partidos');
		const form = await screen.findByRole('form', { name: 'Filtrar partidos' });
		alive = false;
		await user.selectOptions(within(form).getByLabelText('Estado'), 'en_curso');
		await user.click(within(form).getByRole('button', { name: 'Filtrar' }));
		expect(requestedForTest()?.path).toBe('/admin/partidos?estado=en_curso');
		await waitFor(() => expect(where(router)).toBe(nextOf('/admin/partidos?estado=en_curso')));
		router.dispose();

		// A reload of what is on screen (its "Reintentar") comes back to that same page.
		alive = true;
		forgetRequested();
		let down = false;
		admins({ 'GET /api/admin/partidos': () => (down ? new Response('', { status: 502 }) : ok(adminPage([adminMatch()]))) });
		router = renderApp('/admin/partidos?estado=en_curso');
		await screen.findByRole('table', { name: 'Partidos' });
		down = true;
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		const notice = await screen.findByRole('alert');
		alive = false;
		await user.click(within(notice).getByRole('button', { name: 'Reintentar' }));
		await waitFor(() => expect(where(router)).toBe(nextOf('/admin/partidos?estado=en_curso')));
	});
});
