import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Plugin } from 'vite';

/**
 * The SPA's deep links as nginx `location` blocks, generated from the same
 * route list as `dist/_redirects` (`vite-plugins/spa-rewrites.ts`).
 *
 * Written, not hand-maintained, for the reason the project already applies to
 * `vercel.json`: 21 routes with and without a trailing slash are 42 URLs, and a
 * list that long kept by hand drifts the first time someone adds a route. Here
 * it cannot — the file is rewritten from `SPA_ROUTES` on every build.
 *
 * It lands OUTSIDE `dist/`, unlike `_redirects`, and that is deliberate:
 * `dist/` is nginx's web root, so a config file written there would be served
 * to anyone who asked for it.
 *
 * Only the app's routes are listed. There is no `/*` catch-all, so real files
 * keep their own response and unknown URLs keep their 404 — which the site
 * config turns into `dist/404.html`, still with status 404.
 */
export default function nginxSpaRoutes(routes: string[], outFile: string): Plugin {
	return {
		name: 'nginx-spa-routes',
		apply: 'build',

		async closeBundle() {
			const target = resolve(outFile);
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, render(routes), 'utf8');
		},
	};
}

/**
 * What every SPA location does: serve the shell.
 *
 * No `add_header` here on purpose. In nginx an added header is NOT inherited
 * by a block that has one of its own, so a `Cache-Control` written per block
 * would silently cancel every header the site sets at the server level —
 * `Strict-Transport-Security` among them — on exactly the responses people
 * load most. The site config sets the headers for all of them instead, with a
 * `map` (see la-liga-acp.conf.example).
 */
const BODY = '\ttry_files /index.html =404;';

/** A path segment that is safe to drop into an nginx regex unescaped. */
const PLAIN_SEGMENT = /^[A-Za-z0-9-]*$/;

/**
 * Checks a fixed segment instead of escaping it. Every route in `SPA_ROUTES`
 * is plain text, and escaping would quietly absorb one that isn't; stopping the
 * build says so out loud.
 */
function literalSegment(piece: string): string {
	if (!PLAIN_SEGMENT.test(piece)) {
		throw new Error(`Segmento de ruta no admitido en la regex de nginx: "${piece}". Solo letras, dígitos y guion.`);
	}
	return piece;
}

function render(routes: string[]): string {
	const fixed = routes.filter((route) => !route.includes(':'));
	const withId = routes.filter((route) => route.includes(':'));

	const blocks = [
		// A route with no placeholder gets two exact matches: nginx's `=` takes a
		// single URI, so the trailing-slash form is its own block. Exact matches
		// are resolved before any regex, so the order here does not matter.
		...fixed.flatMap((route) => [`location = ${route} {\n${BODY}\n}`, `location = ${route}/ {\n${BODY}\n}`]),
		// `:id` is one path segment, hence `[^/]+`: it matches /plantilla/42 and
		// /plantilla/42/, but never /plantilla/a/b (the slash is excluded) nor
		// /plantilla (at least one character is required). Both keep their 404.
		...withId.map((route) => {
			const pattern = route
				.split('/')
				.map((piece) => (piece.startsWith(':') ? '[^/]+' : literalSegment(piece)))
				.join('/');
			return `location ~ ^${pattern}/?$ {\n${BODY}\n}`;
		}),
	];

	return [
		'# Generado por vite-plugins/nginx-spa-routes.ts en cada build.',
		'# NO editar a mano: se reescribe. La lista de rutas está en SPA_ROUTES (vite.config.ts).',
		`# ${routes.length} rutas = ${routes.length * 2} URLs (con y sin barra final) en ${blocks.length} bloques.`,
		'# Se incluye dentro del server { } del sitio: ver la-liga-acp.conf.example.',
		'# Las cabeceras (Cache-Control, HSTS) NO están acá: las pone el sitio para',
		'# todas las respuestas. Incluir este archivo sin esa parte deja el shell de',
		'# la app sin Cache-Control, y un navegador que lo cachee se queda con una',
		'# versión vieja apuntando a archivos con hash que ya no existen.',
		'',
		...blocks,
		'',
	].join('\n');
}
