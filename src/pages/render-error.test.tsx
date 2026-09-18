import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { routes } from '../App';
import { apiRoutes, bettingMatch, evaluationFor, myBet, page as bettingPage, summaryOf } from '../test/betting-fixtures';
import { apostador, mockFetch, ok, type Handler } from '../test/fetch-mock';
import { apiMatch, leagueRoutes, matchesRoute, page } from '../test/league-fixtures';

/**
 * A page that throws **while rendering** (T-23 fix).
 *
 * The tester reproduced it with a proxy that broke `fechaHora` in the API's
 * answers: `formatKickoff` throws, the error is not an `ApiError`, and before
 * this fix the boundary re-threw it, so the router drew its own bare screen —
 * no navbar, no way back, and the stack trace on display.
 *
 * These tests use the **real route tree** of `src/App.tsx` inside the real
 * layout, so they see exactly what a visitor would.
 */

/** A date the API would never send, of the shape a broken proxy leaves behind. */
const BROKEN = 'no-es-una-fecha';

function renderReal(path: string) {
	const router = createMemoryRouter(routes, { initialEntries: [path] });
	const view = render(<RouterProvider router={router} />);
	return { router, dispose: () => view.unmount() };
}

/** The page the router draws by itself, outside the layout: what must never show up. */
const routerOwnPage = () => screen.queryByText(/Unexpected Application Error/i);

let logged: unknown[][] = [];

beforeEach(() => {
	logged = [];
	vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
		logged.push(args);
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	sessionStorage.clear();
});

describe('a page that breaks while rendering (T-23)', () => {
	const session: Record<string, Handler> = { 'GET /api/auth/me': () => ok({ user: apostador, csrfToken: 't' }) };

	it('the landing shows the error page inside the layout, never the router own screen', async () => {
		mockFetch(apiRoutes({ ...session, ...leagueRoutes({ 'GET /api/public/partidos': matchesRoute([apiMatch({ id: 1, fechaHora: BROKEN })]) }) }));
		renderReal('/');

		expect(await screen.findByRole('heading', { name: 'No se pudo mostrar la página' }, { timeout: 5000 })).toBeTruthy();
		// The layout is still there: the navbar and its link home.
		expect(screen.getByRole('navigation', { name: 'Principal' })).toBeTruthy();
		expect(screen.getByRole('link', { name: /Volver al inicio/ })).toBeTruthy();
		expect(routerOwnPage()).toBeNull();
		// Nothing of the failure reaches the screen; the detail goes to the console.
		expect(document.body.textContent).not.toMatch(/formatKickoff|Error:|at /);
		// The log comes from an effect, which runs after the page is painted: it is
		// waited for, not assumed (with 25 workers the machine can lag behind).
		await waitFor(() => expect(logged.some((args) => String(args[0]).includes('error inesperado'))).toBe(true));
		// And it carries the real cause, for whoever is debugging.
		expect(logged.some((args) => args.some((arg) => arg instanceof Error))).toBe(true);
	});

	it('also when the landing is reached from another page, not only on a direct visit', async () => {
		mockFetch(apiRoutes({ ...session, ...leagueRoutes({ 'GET /api/public/partidos': matchesRoute([apiMatch({ id: 1, fechaHora: BROKEN })]) }) }));
		renderReal('/posiciones?competicionId=10');
		await screen.findByRole('heading', { name: 'Posiciones' }, { timeout: 5000 });

		await userEvent.setup().click(within(screen.getByRole('navigation', { name: 'Principal' })).getByRole('link', { name: 'Inicio' }));

		expect(await screen.findByRole('heading', { name: 'No se pudo mostrar la página' }, { timeout: 5000 })).toBeTruthy();
		expect(screen.getByRole('navigation', { name: 'Principal' })).toBeTruthy();
		expect(routerOwnPage()).toBeNull();
	});

	it('the betting screen too', async () => {
		const broken = { ...bettingMatch({ id: 1 }), fechaHora: BROKEN };
		mockFetch(
			apiRoutes({
				...session,
				'GET /api/public/deportes': () => ok([broken.deporte]),
				'GET /api/apuestas/partidos': () => ok(bettingPage([broken])),
				'POST /api/apuestas/vista-previa': ({ body }) => ok(evaluationFor((body as { selecciones: unknown[] }).selecciones, 10)),
			}),
		);
		renderReal('/apuestas');

		expect(await screen.findByRole('heading', { name: 'No se pudo mostrar la página' }, { timeout: 5000 })).toBeTruthy();
		expect(screen.getByRole('navigation', { name: 'Principal' })).toBeTruthy();
		expect(routerOwnPage()).toBeNull();
	});

	it('and the bets history', async () => {
		const bet = myBet(1);
		const broken = { ...bet, partido: { ...bet.partido, fechaHora: BROKEN } };
		mockFetch(
			apiRoutes({
				...session,
				'GET /api/apuestas/mis-apuestas': () => ok(bettingPage([broken])),
				'GET /api/apuestas/mis-apuestas/resumen': () => ok(summaryOf()),
				'GET /api/public/deportes': () => ok([bet.partido.deporte]),
				'GET /api/public/competiciones': () => ok(bettingPage([])),
			}),
		);
		renderReal('/mis-apuestas');

		expect(await screen.findByRole('heading', { name: 'No se pudo mostrar la página' }, { timeout: 5000 })).toBeTruthy();
		expect(screen.getByRole('navigation', { name: 'Principal' })).toBeTruthy();
		expect(routerOwnPage()).toBeNull();
	});

	it('an ApiError keeps telling what happened, and a transient one still offers "Reintentar"', async () => {
		// A 403 names the reason (T-18); this path already worked and must keep working.
		mockFetch(apiRoutes({ 'GET /api/auth/me': () => ok({ user: { ...apostador, rol: 'admin' as const }, csrfToken: 't' }), 'GET /api/public/deportes': () => ok([]) }));
		const view = renderReal('/apuestas');
		expect(await screen.findByRole('heading', { name: 'Acceso restringido' }, { timeout: 5000 })).toBeTruthy();
		expect(screen.getByRole('navigation', { name: 'Principal' })).toBeTruthy();
		expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
		view.dispose();

		mockFetch(apiRoutes({ ...session, 'GET /api/public/deportes': () => ok([]), 'GET /api/apuestas/partidos': () => new Response('', { status: 503 }) }));
		renderReal('/apuestas');
		await waitFor(() => expect(screen.getByRole('heading', { name: 'No se pudo cargar' })).toBeTruthy());
		expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
		expect(routerOwnPage()).toBeNull();
	});
});
