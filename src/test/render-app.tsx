import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import Base from '../layouts/Base';
import { adminRoute } from '../pages/admin/routes';
import Apuestas, { action as apuestasAction, loader as apuestasLoader, shouldRevalidate as apuestasShouldRevalidate } from '../pages/Apuestas';
import Cuenta, { loader as cuentaLoader } from '../pages/Cuenta';
import Ingresar, { action as ingresarAction, loader as ingresarLoader } from '../pages/Ingresar';
import MisApuestas, { loader as misApuestasLoader, shouldRevalidate as misApuestasShouldRevalidate } from '../pages/MisApuestas';
import { RouteError } from '../pages/NotFound';
import Ranking, { loader as rankingLoader } from '../pages/Ranking';
import Registro, { action as registroAction, loader as registroLoader } from '../pages/Registro';
import Ticket, { loader as ticketLoader } from '../pages/Ticket';

/**
 * The real layout (`Base`: navbar, session bar, session refresh) with the
 * real account and betting routes of `src/App.tsx`, in a memory router. The league pages
 * are stubs: their static data and artwork are not what these tests look at.
 */
export function renderApp(initialEntry: string) {
	const router = createMemoryRouter(
		[
			{
				Component: Base,
				children: [
					{ path: '/', Component: () => <h1>Página de inicio</h1> },
					{ path: '/posiciones', Component: () => <h1>Página de posiciones</h1> },
					{ path: '/plantilla/:id', Component: () => <h1>Página de plantilla</h1> },
					{ path: '/ingresar', loader: ingresarLoader, action: ingresarAction, Component: Ingresar, ErrorBoundary: RouteError },
					{ path: '/registro', loader: registroLoader, action: registroAction, Component: Registro, ErrorBoundary: RouteError },
					{ path: '/cuenta', loader: cuentaLoader, Component: Cuenta, ErrorBoundary: RouteError },
					adminRoute,
					{
						path: '/apuestas',
						loader: apuestasLoader,
						action: apuestasAction,
						shouldRevalidate: apuestasShouldRevalidate,
						Component: Apuestas,
						ErrorBoundary: RouteError,
					},
					{ path: '/apuestas/tickets/:id', loader: ticketLoader, Component: Ticket, ErrorBoundary: RouteError },
					{
						path: '/mis-apuestas',
						loader: misApuestasLoader,
						shouldRevalidate: misApuestasShouldRevalidate,
						Component: MisApuestas,
						ErrorBoundary: RouteError,
					},
					{ path: '/ranking', loader: rankingLoader, Component: Ranking, ErrorBoundary: RouteError },
				],
			},
		],
		{ initialEntries: [initialEntry] },
	);
	render(<RouterProvider router={router} />);
	return router;
}

export const where = (router: ReturnType<typeof renderApp>) => `${router.state.location.pathname}${router.state.location.search}`;
