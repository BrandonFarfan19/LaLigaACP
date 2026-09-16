import type { Pool, PoolConnection } from 'mysql2/promise';

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

/**
 * Runs `work` inside one transaction on one connection: commit if it
 * resolves, rollback if it throws (and rethrow). Every statement that must
 * succeed or fail together goes through the `conn` it receives.
 */
export async function withTransaction<T>(
	pool: Pool,
	work: (conn: PoolConnection) => Promise<T>,
	options: TransactionOptions = {},
): Promise<T> {
	const conn = await pool.getConnection();
	try {
		// Without SESSION/GLOBAL, this applies only to the next transaction.
		if (options.isolation) await conn.query(`SET TRANSACTION ISOLATION LEVEL ${options.isolation}`);
		await conn.beginTransaction();
		try {
			const result = await work(conn);
			await conn.commit();
			return result;
		} catch (error) {
			await conn.rollback();
			throw error;
		}
	} finally {
		conn.release();
	}
}
