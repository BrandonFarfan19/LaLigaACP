import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import Home, { loader as homeLoader } from '../pages/Home';
import { RouteError } from '../pages/NotFound';
import Plantilla, { loader as plantillaLoader } from '../pages/Plantilla';
import Posiciones, { loader as posicionesLoader } from '../pages/Posiciones';

/**
 * The league routes of `src/App.tsx` with their real loaders, in a memory
 * router and without the layout (its backdrop, navbar and session refresh are
 * not what these tests look at). Since T-22 they read the public API, so the
 * tests give them a simulated `fetch`.
 */
export function renderLeague(initialEntry: string) {
	const router = createMemoryRouter(
		[
			{ path: '/', loader: homeLoader, Component: Home, ErrorBoundary: RouteError },
			{ path: '/posiciones', loader: posicionesLoader, Component: Posiciones, ErrorBoundary: RouteError },
			{ path: '/plantilla/:id', loader: plantillaLoader, Component: Plantilla, ErrorBoundary: RouteError },
		],
		{ initialEntries: [initialEntry] },
	);
	const view = render(<RouterProvider router={router} />);
	return { router, dispose: () => view.unmount() };
}

/** Where the router is now (`/posiciones?competicionId=10`). */
export const where = (router: ReturnType<typeof renderLeague>['router']) => `${router.state.location.pathname}${router.state.location.search}`;
