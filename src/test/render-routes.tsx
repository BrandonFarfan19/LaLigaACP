import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { adminRoute } from '../pages/admin/routes';
import Cuenta, { loader as cuentaLoader } from '../pages/Cuenta';
import Ingresar, { action as ingresarAction, loader as ingresarLoader } from '../pages/Ingresar';
import { RouteError } from '../pages/NotFound';
import Registro, { action as registroAction, loader as registroLoader } from '../pages/Registro';

/**
 * The account routes of `src/App.tsx` in a memory router, without the
 * layout (its backdrop and navbar are not what these tests look at). Public
 * pages are stubs that only say where the router ended up.
 */
export function renderRoutes(initialEntry: string) {
	const router = createMemoryRouter(
		[
			{ path: '/', Component: () => <p>Página de inicio</p> },
			{ path: '/posiciones', Component: () => <p>Página de posiciones</p> },
			{ path: '/apuestas', Component: () => <p>Página de apuestas</p> },
			{ path: '/ingresar', loader: ingresarLoader, action: ingresarAction, Component: Ingresar, ErrorBoundary: RouteError },
			{ path: '/registro', loader: registroLoader, action: registroAction, Component: Registro, ErrorBoundary: RouteError },
			{ path: '/cuenta', loader: cuentaLoader, Component: Cuenta, ErrorBoundary: RouteError },
			adminRoute,
		],
		{ initialEntries: [initialEntry] },
	);
	render(<RouterProvider router={router} />);
	return router;
}

/** Where the router is now (`/cuenta?x=1`). */
export const locationOf = (router: ReturnType<typeof renderRoutes>) => `${router.state.location.pathname}${router.state.location.search}`;

export { screen };
