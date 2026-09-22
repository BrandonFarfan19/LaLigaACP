import mysql, { type RowDataPacket } from 'mysql2/promise';
import { env } from './app.js';

export interface HeldLock {
	tabla: string;
	indice: string | null;
	/** `TABLE` or `RECORD`. */
	tipo: string;
	/** e.g. `S,REC_NOT_GAP`, `X`, `IS`. */
	modo: string;
	/** The locked key, e.g. `42` or `supremum pseudo-record`. */
	dato: string | null;
}

/** Whether `performance_schema` can be read (needs root: the app user has no grants there). */
export const canInspectLocks = Boolean(process.env.MYSQL_ROOT_PASSWORD);

/**
 * The InnoDB locks a connection holds right now in the test database
 * (`performance_schema.data_locks`), read as root from another connection.
 */
export async function locksHeldBy(connectionId: number): Promise<HeldLock[]> {
	const conn = await mysql.createConnection({
		host: env.db.host,
		port: env.db.port,
		user: 'root',
		password: process.env.MYSQL_ROOT_PASSWORD,
	});
	try {
		const [rows] = await conn.query<RowDataPacket[]>(
			`SELECT l.OBJECT_NAME AS tabla, l.INDEX_NAME AS indice, l.LOCK_TYPE AS tipo, l.LOCK_MODE AS modo, l.LOCK_DATA AS dato
			FROM performance_schema.data_locks l
			JOIN performance_schema.threads t ON t.THREAD_ID = l.THREAD_ID
			WHERE t.PROCESSLIST_ID = ? AND l.OBJECT_SCHEMA = ?
			ORDER BY l.OBJECT_NAME, l.INDEX_NAME, l.LOCK_DATA`,
			[connectionId, env.db.database],
		);
		return rows as HeldLock[];
	} finally {
		await conn.end();
	}
}
