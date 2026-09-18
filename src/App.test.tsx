import { describe, expect, it } from 'vitest';
import { routes } from './App';

/**
 * The app's own route tree (T-23). The test routers of `src/test/` rebuild it
 * by hand, so what is checked here is the real one: a route whose failures
 * nobody catches would be drawn by the router's bare page, outside the layout
 * and without "Reintentar" — which is what `/` and `/posiciones` did.
 */

type Route = { path?: string; Component?: unknown; ErrorBoundary?: unknown; children?: Route[] };

/** Every leaf that renders a page, with the path it answers. */
function leaves(list: Route[], prefix = ''): { path: string; guarded: boolean }[] {
	return list.flatMap((route) => {
		const path = route.path ? (route.path.startsWith('/') ? route.path : `${prefix}/${route.path}`) : prefix;
		if (route.children?.length) return leaves(route.children, path);
		return [{ path: path || '/', guarded: Boolean(route.ErrorBoundary) }];
	});
}

describe('route tree (T-23)', () => {
	it('every page has an error boundary, so a failure stays inside the layout', () => {
		const unguarded = leaves(routes as Route[])
			// The catch-all only renders "Página no encontrada": it reads nothing.
			.filter((leaf) => leaf.path !== '/*')
			.filter((leaf) => !leaf.guarded)
			.map((leaf) => leaf.path);

		expect(unguarded).toEqual([]);
	});

	it('covers the league pages, the account, the betting screens and the panel', () => {
		const paths = leaves(routes as Route[]).map((leaf) => leaf.path);
		for (const path of ['/', '/posiciones', '/plantilla/:id', '/ingresar', '/registro', '/cuenta', '/apuestas', '/mis-apuestas', '/ranking', '/admin']) {
			expect(paths, path).toContain(path);
		}
	});
});
