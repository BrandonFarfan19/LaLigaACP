import type { RouteObject } from 'react-router';
import { RouteError } from '../NotFound';
import AdminLayout from './AdminLayout';

/**
 * The admin panel (T-21): `/admin` and its sections, admins only (each
 * loader checks). Every section loads its code on first use (`lazy`), so
 * visitors and bettors never download the panel. Every path is also in
 * `SPA_ROUTES` (`vite.config.ts`) and `vercel.json`.
 */
const page = (load: () => Promise<{ default: RouteObject['Component']; loader?: unknown; action?: unknown; shouldRevalidate?: unknown }>) => async () => {
	const module = await load();
	return {
		Component: module.default,
		loader: module.loader as RouteObject['loader'],
		action: module.action as RouteObject['action'],
		shouldRevalidate: module.shouldRevalidate as RouteObject['shouldRevalidate'],
	};
};

const CATALOG = ['deportes', 'competiciones', 'equipos', 'jugadores', 'planteles'] as const;

export const adminRoute: RouteObject = {
	path: '/admin',
	Component: AdminLayout,
	children: [
		{ index: true, lazy: page(() => import('./AdminHome')), ErrorBoundary: RouteError },
		{ path: 'participantes', lazy: page(() => import('./Participantes')), ErrorBoundary: RouteError },
		{ path: 'partidos', lazy: page(() => import('./Partidos')), ErrorBoundary: RouteError },
		{ path: 'partidos/:id', lazy: page(() => import('./Partido')), ErrorBoundary: RouteError },
		{ path: 'apuestas', lazy: page(() => import('./ApuestasAdmin')), ErrorBoundary: RouteError },
		{ path: 'ranking', lazy: page(() => import('./RankingAdmin')), ErrorBoundary: RouteError },
		{ path: 'auditoria', lazy: page(() => import('./Auditoria')), ErrorBoundary: RouteError },
		...CATALOG.map((resource) => ({
			path: resource,
			lazy: async () => (await import('./Catalogo')).catalogRoutes[resource],
			ErrorBoundary: RouteError,
		})),
	],
};
