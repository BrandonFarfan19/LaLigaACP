import type { Pool, PoolConnection } from 'mysql2/promise';
import { isDeadlock } from '../lib/db-errors.js';

export interface TransactionOptions {
	/**
	 * `READ COMMITTED` for check-and-set actions: after a conditional UPDATE
	 * matches nothing because a concurrent transaction just committed, the
	 * follow-up SELECT that explains why must see that commit. Under MySQL's
	 * default `REPEATABLE READ` it would still read the snapshot taken at the
	 * transaction's first read and report a stale reason.
	 */
	isolation?: 'READ COMMITTED' | 'REPEATABLE READ';
}

declare const inTransaction: unique symbol;

/**
 * A connection with an open transaction. Only `withTransaction` hands these
 * out, so a function that takes one (the coin service, for example) can't be
 * called with a plain autocommit connection: that doesn't compile without a
 * cast, and `assertInTransaction` rejects it at runtime too.
 */
export type TransactionConnection = PoolConnection & { readonly [inTransaction]: true };

/** Connections currently inside a `withTransaction` call. Pool connections are reused, so membership ends with the call. */
const open = new WeakSet<PoolConnection>();

export function assertInTransaction(conn: PoolConnection): asserts conn is TransactionConnection {
	if (!open.has(conn)) {
		throw new Error('Esta operación tiene que correr dentro de withTransaction (db/transaction.ts).');
	}
}

/** How many times a transaction runs at most when MySQL picks it as a deadlock victim. */
export const MAX_TRANSACTION_ATTEMPTS = 3;

/** Wait before retry `attempt` (1, 2...): a few tens of milliseconds, with jitter so the two sides don't collide again. */
const retryDelayMs = (attempt: number) => 20 * attempt + Math.floor(Math.random() * 30);

/** Counts of what `withTransaction` retried or gave up on, for tests and diagnostics. */
export const transactionStats = { deadlockRetries: 0, deadlocksExhausted: 0 };

/**
 * Runs `work` inside one transaction on one connection: commit if it
 * resolves, rollback if it throws (and rethrow). Every statement that must
 * succeed or fail together goes through the `conn` it receives.
 *
 * A deadlock (MySQL 1213) rolls the whole transaction back, so `work` runs
 * again from the start, up to `MAX_TRANSACTION_ATTEMPTS` times. `work` must
 * therefore only touch the database (no emails, no files). If the deadlock
 * persists, the error is rethrown and the error handler answers 409
 * `CONCURRENT_UPDATE` (`lib/db-errors.ts`). A lock wait timeout (1205) is not
 * retried: it already waited `innodb_lock_wait_timeout`, and answers 409 too.
 */
export async function withTransaction<T>(
	pool: Pool,
	work: (conn: TransactionConnection) => Promise<T>,
	options: TransactionOptions = {},
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await runOnce(pool, work, options);
		} catch (error) {
			if (!isDeadlock(error)) throw error;
			if (attempt >= MAX_TRANSACTION_ATTEMPTS) {
				transactionStats.deadlocksExhausted++;
				console.warn(`Deadlock persistente tras ${attempt} intentos; se responde CONCURRENT_UPDATE.`);
				throw error;
			}
			transactionStats.deadlockRetries++;
			await new Promise((resolve) => setTimeout(resolve, retryDelayMs(attempt)));
		}
	}
}

async function runOnce<T>(pool: Pool, work: (conn: TransactionConnection) => Promise<T>, options: TransactionOptions): Promise<T> {
	const conn = await pool.getConnection();
	try {
		// Without SESSION/GLOBAL, this applies only to the next transaction.
		if (options.isolation) await conn.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolation}`);
		await conn.beginTransaction();
		open.add(conn);
		try {
			const result = await work(conn as TransactionConnection);
			await conn.commit();
			return result;
		} catch (error) {
			await conn.rollback();
			throw error;
		} finally {
			open.delete(conn);
		}
	} finally {
		conn.release();
	}
}

/**
 * Runs several reads on one connection that all see the same moment
 * (`START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY`, under the
 * session's REPEATABLE READ): a count and its page, or a page and its
 * details, can't disagree because of a write in between (T-11). Nothing
 * can be written through `conn`.
 */
export async function withReadSnapshot<T>(pool: Pool, work: (conn: PoolConnection) => Promise<T>): Promise<T> {
	const conn = await pool.getConnection();
	try {
		await conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
		await conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
		try {
			return await work(conn);
		} finally {
			await conn.query('COMMIT');
		}
	} finally {
		conn.release();
	}
}
