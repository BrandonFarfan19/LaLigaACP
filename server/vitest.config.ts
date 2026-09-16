import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		globalSetup: ['./tests/global-setup.ts'],
		testTimeout: 15000,
		hookTimeout: 20000,
		// All test files share one MySQL test database; running them in
		// separate parallel workers would race on resetDatabase().
		fileParallelism: false,
		// No shared mutable state between files beyond the database itself
		// (each file makes its own pool) — safe to reuse one worker.
		isolate: false,
	},
});
