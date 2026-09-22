import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config.ts';

/**
 * Frontend tests (`npm test`): Vitest + Testing Library on jsdom, with the
 * app's own Vite config (pixel image presets, CSS modules). Only `src/`:
 * the backend has its own suite (`npm run server:test`).
 */
export default mergeConfig(
	viteConfig,
	defineConfig({
		test: {
			environment: 'jsdom',
			include: ['src/**/*.test.{ts,tsx}'],
			setupFiles: ['src/test/setup.ts'],
			restoreMocks: true,
			// Room for the longer waits set in src/test/setup.ts, in page tests that chain several.
			testTimeout: 30_000,
		},
	}),
);
