import { parseEnv } from '../../src/config/env.js';

/**
 * The only database the suite may drop, migrate or truncate. Resolved through
 * `parseEnv` with NODE_ENV forced to `test`, so it inherits the config guard
 * that rejects `MYSQL_DATABASE_TEST === MYSQL_DATABASE`.
 */
export function resolveTestDatabase(source: NodeJS.ProcessEnv = process.env): string {
	return parseEnv({ ...source, NODE_ENV: 'test' }).db.database;
}

/**
 * Last check before anything destructive: `target` must be exactly the test
 * database and never the real one. Throws otherwise.
 */
export function assertIsTestDatabase(target: string | null | undefined, source: NodeJS.ProcessEnv = process.env): void {
	const expected = resolveTestDatabase(source);
	if (!target || target !== expected || target === source.MYSQL_DATABASE) {
		throw new Error(
			`Operación destructiva cancelada: la base destino es "${target ?? '(ninguna)'}", pero las pruebas solo pueden tocar "${expected}".`,
		);
	}
}
