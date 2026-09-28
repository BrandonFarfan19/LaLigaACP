import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction } from '../db/transaction.js';
import { hashSessionToken, newSessionToken } from '../lib/tokens.js';
import { type PublicUser, toPublicUser, USER_COLUMNS, USER_JOINS, type UserRow } from './users.service.js';

/**
 * Server-side sessions (NFR-005, `sesion` table). The cookie holds a random
 * token; only its SHA-256 is stored. A session is valid while
 * `expira_en > now` and its row exists — deleting the row is a real logout.
 */

export interface NewSession {
	token: string;
	expiresAt: Date;
}

/** Expired rows deleted per login at most, so a long backlog never slows one login down. */
const PURGE_BATCH = 500;

/**
 * Opens a session for `userId`, whose password was just verified against
 * `verifiedHash`. Also purges expired sessions of **every** user (indexed on
 * `expira_en`, bounded by PURGE_BATCH) and, if the request carried one, the
 * session being replaced (no orphan left behind by logging in twice).
 * Expired rows are already useless — `findSessionUser` ignores them — this
 * only keeps the table from growing forever.
 *
 * `null` when the password changed since it was verified (C-08 fix): an admin
 * reset that commits between the login's read and this insert has already
 * deleted the user's sessions, so a session opened now with the old password
 * would survive it. The user row is locked `FOR SHARE` first, by primary key
 * (the lock order starts with `usuario`), and the hash is read again under
 * that lock: a reset in progress holds the row `FOR UPDATE` (its UPDATE), so
 * either it commits first and the hash differs here, or this commits first
 * and the reset deletes the new session. The caller answers the usual 401.
 */
export async function createSession(
	pool: Pool,
	userId: number,
	verifiedHash: string,
	ttlMs: number,
	replacedToken: string | undefined,
	now = new Date(),
): Promise<NewSession | null> {
	const token = newSessionToken();
	const expiresAt = new Date(now.getTime() + ttlMs);

	const opened = await withTransaction(pool, async (conn) => {
		const [[user]] = await conn.query<RowDataPacket[]>(
			'SELECT password_hash FROM usuario FORCE INDEX (PRIMARY) WHERE id = ? FOR SHARE',
			[userId],
		);
		if (!user || user.password_hash !== verifiedHash) return false;
		await conn.query('DELETE FROM sesion WHERE expira_en <= ? LIMIT ?', [now, PURGE_BATCH]);
		if (replacedToken) {
			await conn.query('DELETE FROM sesion WHERE token_hash = ?', [hashSessionToken(replacedToken)]);
		}
		await conn.query<ResultSetHeader>(
			'INSERT INTO sesion (usuario_id, token_hash, creado_en, expira_en) VALUES (?, ?, ?, ?)',
			[userId, hashSessionToken(token), now, expiresAt],
		);
		return true;
	});

	return opened ? { token, expiresAt } : null;
}

/** The user behind a live session, read fresh (a role or state change applies on the next request). */
export async function findSessionUser(pool: Pool, token: string, now = new Date()): Promise<PublicUser | null> {
	const [rows] = await pool.query<UserRow[]>(
		`SELECT ${USER_COLUMNS}
		FROM sesion s
		JOIN usuario u ON u.id = s.usuario_id
		${USER_JOINS}
		WHERE s.token_hash = ? AND s.expira_en > ?`,
		[hashSessionToken(token), now],
	);
	return rows[0] ? toPublicUser(rows[0]) : null;
}

export async function deleteSession(pool: Pool, token: string): Promise<void> {
	await pool.query('DELETE FROM sesion WHERE token_hash = ?', [hashSessionToken(token)]);
}
