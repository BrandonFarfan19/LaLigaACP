import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { assertIsTestDatabase } from './test-database.js';

interface TableNameRow extends RowDataPacket {
	TABLE_NAME: string;
}

interface CurrentDatabaseRow extends RowDataPacket {
	name: string | null;
}

const here = dirname(fileURLToPath(import.meta.url));
// server/tests/helpers -> server/tests -> server -> repo root -> db/init.
export const DB_INIT_DIR = resolve(here, '../../../db/init');

/**
 * Catalog tables: the ones `02-catalogos.sql` fills. Read from the file
 * itself, so a new catalog is kept automatically instead of silently wiped.
 */
export const CATALOG_TABLES: ReadonlySet<string> = new Set(
	Array.from(readFileSync(resolve(DB_INIT_DIR, '02-catalogos.sql'), 'utf8').matchAll(/INSERT\s+INTO\s+`?(\w+)`?/gi), (m) => m[1]!),
);

/**
 * Empties every non-catalog table of the pool's database, so each test starts
 * from a known state with roles, states and movement types still loaded.
 * Refuses to run (before touching anything) unless the pool points at the
 * test database. Disables FK checks around it so table order doesn't matter.
 *
 * `DELETE`, not `TRUNCATE`: each TRUNCATE is DDL, and for the ~14 tables it
 * took ~1 s per reset (vs ~25 ms), which every `beforeEach` paid. The catch:
 * AUTO_INCREMENT keeps counting, so tests must never assume specific ids.
 */
export async function resetDatabase(pool: Pool): Promise<void> {
	const [current] = await pool.query<CurrentDatabaseRow[]>('SELECT DATABASE() AS name');
	assertIsTestDatabase(current[0]?.name);

	const [rows] = await pool.query<TableNameRow[]>(
		"SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
	);
	const tables = rows.map((row) => row.TABLE_NAME).filter((table) => !CATALOG_TABLES.has(table));

	// A pool hands out a different connection per query: FK checks are a
	// session setting, so the whole reset must run on one connection.
	const conn = await pool.getConnection();
	try {
		await conn.query('SET FOREIGN_KEY_CHECKS = 0');
		try {
			for (const table of tables) {
				await conn.query(`DELETE FROM \`${table}\``);
			}
		} finally {
			await conn.query('SET FOREIGN_KEY_CHECKS = 1');
		}
	} finally {
		conn.release();
	}
}
