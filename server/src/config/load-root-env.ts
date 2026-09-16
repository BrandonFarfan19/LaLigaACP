import { config as loadDotenv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

let loaded = false;

/**
 * Loads the repo-root `.env` into `process.env`, once per process.
 *
 * The path is computed from this file's own location (not `cwd()`), so it
 * resolves the same way regardless of how the process was started — bare
 * `tsx watch src/index.ts` from `server/`, the compiled `dist/` build, or a
 * Vitest run. Inside Docker there is no `.env` file (secrets are injected as
 * real environment variables by `compose.yaml` instead — see `env.ts`), and
 * `dotenv` silently does nothing when the file is missing, which is exactly
 * what we want there. `override: false` (the default) means an already-set
 * variable — like the ones Compose injects — always wins over the file.
 */
export function loadRootEnvFile(): void {
	if (loaded) return;
	loaded = true;
	const here = dirname(fileURLToPath(import.meta.url));
	// server/src/config -> server/src -> server -> repo root.
	loadDotenv({ path: resolve(here, '../../../.env'), quiet: true, override: false });
}
