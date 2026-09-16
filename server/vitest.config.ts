import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		globalSetup: ['./tests/global-setup.ts'],
		// Forced, not defaulted: a NODE_ENV=development exported in the terminal
		// would otherwise point the suite at the real database (src/config/env.ts
		// only picks MYSQL_DATABASE_TEST when NODE_ENV=test).
		env: { NODE_ENV: 'test' },
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
