import { createBrowserRouter, type RouteObject } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import Base from './layouts/Base';
import Apuestas, { action as apuestasAction, loader as apuestasLoader, shouldRevalidate as apuestasShouldRevalidate } from './pages/Apuestas';
import Cuenta, { loader as cuentaLoader } from './pages/Cuenta';
import Home, { loader as homeLoader } from './pages/Home';
import MisApuestas, { loader as misApuestasLoader, shouldRevalidate as misApuestasShouldRevalidate } from './pages/MisApuestas';
import Ingresar, { action as ingresarAction, loader as ingresarLoader } from './pages/Ingresar';
import NotFound, { RouteError } from './pages/NotFound';
import { adminRoute } from './pages/admin/routes';
import Plantilla, { loader as plantillaLoader } from './pages/Plantilla';
import Posiciones, { loader as posicionesLoader } from './pages/Posiciones';
import Ranking, { loader as rankingLoader } from './pages/Ranking';
import Registro, { action as registroAction, loader as registroLoader } from './pages/Registro';
import Ticket, { loader as ticketLoader } from './pages/Ticket';

/**
 * Same URLs the static site had, plus the account pages of T-18. Every page
 * reads through `src/lib/` in its loader, so a route renders complete — like
 * the pre-rendered HTML did — and anchors such as `/#fixture` exist by the
 * time scrolling runs.
 *
 * Every path here is also in `SPA_ROUTES` (`vite.config.ts`) and `vercel.json`.
 */
export const routes: RouteObject[] = [
	{
		Component: Base,
		// The first loaders read the API (T-22): the shell (backdrop and navbar) is
		// already there, so there is nothing else to show while they answer.
		HydrateFallback: () => null,
		children: [
			// Like every other route, a failure they can't handle is drawn inside the
			// layout by `RouteError` (with "Reintentar" when it is worth retrying),
			// never by the router's own bare page (T-23).
			{ path: '/', loader: homeLoader, Component: Home, ErrorBoundary: RouteError },
			{ path: '/posiciones', loader: posicionesLoader, Component: Posiciones, ErrorBoundary: RouteError },
			{
				path: '/plantilla/:id',
				loader: plantillaLoader,
				Component: Plantilla,
				// An unknown team id is a 404, rendered inside the layout.
				ErrorBoundary: RouteError,
			},
			// Account (T-18). Sign in and sign up send a signed-in user on; the
			// account needs a session.
			{ path: '/ingresar', loader: ingresarLoader, action: ingresarAction, Component: Ingresar, ErrorBoundary: RouteError },
			{ path: '/registro', loader: registroLoader, action: registroAction, Component: Registro, ErrorBoundary: RouteError },
			{ path: '/cuenta', loader: cuentaLoader, Component: Cuenta, ErrorBoundary: RouteError },
			// The admin panel (T-21): admins only, every section checks.
			adminRoute,
			// Betting (T-19): the matches and the ticket being built, and a ticket's receipt.
			{
				path: '/apuestas',
				loader: apuestasLoader,
				action: apuestasAction,
				shouldRevalidate: apuestasShouldRevalidate,
				Component: Apuestas,
				ErrorBoundary: RouteError,
			},
			{ path: '/apuestas/tickets/:id', loader: ticketLoader, Component: Ticket, ErrorBoundary: RouteError },
			// T-20: the user's own bets (participants) and the pool ranking (any session).
			{
				path: '/mis-apuestas',
				loader: misApuestasLoader,
				shouldRevalidate: misApuestasShouldRevalidate,
				Component: MisApuestas,
				ErrorBoundary: RouteError,
			},
			{ path: '/ranking', loader: rankingLoader, Component: Ranking, ErrorBoundary: RouteError },
			{ path: '*', Component: NotFound },
		],
	},
];

const router = createBrowserRouter(routes);

export default function App() {
	return <RouterProvider router={router} />;
}
