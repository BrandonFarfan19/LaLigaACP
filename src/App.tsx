import { createBrowserRouter } from 'react-router';
import { RouterProvider } from 'react-router/dom';
import Base from './layouts/Base';
import Home, { loader as homeLoader } from './pages/Home';
import NotFound, { RouteError } from './pages/NotFound';
import Plantilla, { loader as plantillaLoader } from './pages/Plantilla';
import Posiciones, { loader as posicionesLoader } from './pages/Posiciones';

/**
 * Same URLs the static site had. Every page reads through `src/lib/` in its
 * loader, so a route renders complete — like the pre-rendered HTML did — and
 * anchors such as `/#fixture` exist by the time scrolling runs.
 */
const router = createBrowserRouter([
	{
		Component: Base,
		// Nothing to show before the first loaders resolve (they read local data).
		HydrateFallback: () => null,
		children: [
			{ path: '/', loader: homeLoader, Component: Home },
			{ path: '/posiciones', loader: posicionesLoader, Component: Posiciones },
			{
				path: '/plantilla/:id',
				loader: plantillaLoader,
				Component: Plantilla,
				// An unknown team id is a 404, rendered inside the layout.
				ErrorBoundary: RouteError,
			},
			{ path: '*', Component: NotFound },
		],
	},
]);

export default function App() {
	return <RouterProvider router={router} />;
}
