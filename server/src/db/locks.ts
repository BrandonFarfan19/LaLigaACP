import type { RowDataPacket } from 'mysql2/promise';
import { assertInTransaction, type TransactionConnection } from './transaction.js';

/**
 * Locking many rows by primary key, one point read each (C-09 fix).
 *
 * `SELECT ... WHERE id IN (2, 3) ... FOR UPDATE` is not safe: on a small table
 * MySQL plans it as a full scan of the primary key (`type: index`), which
 * locks rows the list doesn't name. That is how a confirmation paying bettors
 * 2 and 3 held the admin's row (id 1) and deadlocked with an admin write whose
 * audit record needs that row (`tests/concurrency-stress.test.ts`). One
 * `WHERE id = ?` per row is always a `const` read: it locks exactly that row
 * when it exists.
 *
 * An id that doesn't exist is not free of locks under every isolation level:
 * in `READ COMMITTED` it locks nothing, but in `REPEATABLE READ` the point read
 * takes a gap lock (up to the next record, the supremum past the last id), which
 * blocks inserts there. Every caller today passes ids of rows that exist, read
 * just before (the winners, the bettors of a cancellation, the users of a coin
 * batch), and the result confirmation and the cancellation run in `READ
 * COMMITTED`; the development seed runs in `REPEATABLE READ`, alone, in its own
 * transaction. A new caller with ids it hasn't checked filters the ones that
 * don't exist first, as `lockAndReadMatches` does (T-09 fix).
 *
 * The reads go in one statement per `LOTE_BLOQUEO` rows, as a `UNION ALL` of
 * parenthesized point reads, in ascending id (the app's lock order inside a
 * table).
 */

/** Tables locked this way. The name goes into the SQL, so it only ever comes from this list. */
export type LockableTable = 'usuario';

/** Rows per statement. */
export const LOTE_BLOQUEO = 500;

/**
 * Locks the rows of `table` with these ids (`FOR UPDATE` or `FOR SHARE`),
 * ascending, and returns what `columns` reads of each row found, in id order.
 * `columns` is fixed SQL from the caller (never input) and must include `id`.
 */
export async function lockRowsById(
	conn: TransactionConnection,
	table: LockableTable,
	ids: readonly number[],
	mode: 'UPDATE' | 'SHARE',
	columns = 'id',
): Promise<RowDataPacket[]> {
	assertInTransaction(conn);
	const sorted = [...new Set(ids)].sort((a, b) => a - b);
	const rows: RowDataPacket[] = [];
	for (let start = 0; start < sorted.length; start += LOTE_BLOQUEO) {
		const batch = sorted.slice(start, start + LOTE_BLOQUEO);
		const read = `(SELECT ${columns} FROM \`${table}\` WHERE id = ? FOR ${mode})`;
		const [found] = await conn.query<RowDataPacket[]>(batch.map(() => read).join(' UNION ALL '), batch);
		rows.push(...found);
	}
	return rows;
}
