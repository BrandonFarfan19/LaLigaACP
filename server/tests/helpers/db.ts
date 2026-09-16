import type { Pool, RowDataPacket } from 'mysql2/promise';

interface TableNameRow extends RowDataPacket {
	TABLE_NAME: string;
}

/**
 * Truncates every table in the current database. Disables FK checks around
 * it so table order doesn't matter — there's no data yet to preserve, this
 * only needs to leave every test starting from an empty, known state.
 */
export async function resetDatabase(pool: Pool): Promise<void> {
	const [rows] = await pool.query<TableNameRow[]>(
		'SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE()',
	);

	await pool.query('SET FOREIGN_KEY_CHECKS = 0');
	try {
		for (const { TABLE_NAME: table } of rows) {
			await pool.query(`TRUNCATE TABLE \`${table}\``);
		}
	} finally {
		await pool.query('SET FOREIGN_KEY_CHECKS = 1');
	}
}
