import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import pixelImages from './vite-plugins/pixel-images.ts';
import spaRewrites from './vite-plugins/spa-rewrites.ts';

/**
 * The app's deep routes, as the hosts must rewrite them (see `src/App.tsx`).
 * `/` needs no rule. Adding a route means listing it here and in `vercel.json`
 * (with and without a trailing slash); the build fails if they differ.
 */
const SPA_ROUTES = ['/posiciones', '/plantilla/:id'];

/**
 * Fallback for static hosts without rewrites (e.g. GitHub Pages): they serve
 * `404.html` for unknown paths, so a copy of the SPA shell there still boots
 * the app on deep links — with HTTP 404. Hosts with rewrites answer the app's
 * routes with 200 through the generated `_redirects` and `vercel.json`.
 */
function spaFallback(): Plugin {
	let outDir = 'dist';
	return {
		name: 'spa-fallback',
		apply: 'build',
		configResolved(config) {
			outDir = resolve(config.root, config.build.outDir);
		},
		async closeBundle() {
			await copyFile(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
		},
	};
}

export default defineConfig({
	plugins: [
		/**
		 * Rendition presets for `?pixel=<preset>` imports. Each spec is a width
		 * ("96", height from the aspect ratio), a crop ("32x32"), or the density
		 * of one of those ("96@2"). Every size a component asks `<PixelImage />`
		 * for must be listed here; a missing one throws instead of shipping the
		 * image at full size.
		 */
		pixelImages({
			// Carousel 96 · MatchCard 48 · Plantilla 32 · Posiciones 32×32 — all with a 2x density
			crest: ['96', '96@2', '48', '48@2', '32', '32@2', '32x32', '32x32@2'],
			// Navbar 32×32 · Hero 96×96 — both with a 2x density
			logo: ['32x32', '32x32@2', '96x96', '96x96@2'],
			// Layout backdrop: landscape from 48rem, portrait on phones
			'backdrop-landscape': ['480'],
			'backdrop-portrait': ['240'],
			// SquadBoard pitch 240, 2x density
			pitch: ['240', '240@2'],
			// PlayerStatsDialog portrait, drawn at exactly 2× by CSS
			portrait: ['96'],
		}),
		react(),
		spaRewrites(SPA_ROUTES),
		spaFallback(),
	],
	css: {
		modules: {
			// Readable in devtools while still scoped per component.
			generateScopedName: '[local]_[hash:base64:5]',
		},
	},
});
