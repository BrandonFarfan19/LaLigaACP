import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { TransactionConnection } from '../db/transaction.js';
import { type FacebookVideoLink, storedFacebookVideo } from '../lib/facebook-links.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';

/**
 * Módulo Informativo, C-14 (D-043): the live stream of the «En vivo» section,
 * one and general (not per sport or match). One row, always id 1
 * (`transmision_en_vivo`); `url` NULL means there is no stream. The admin sets
 * or removes the link; everyone reads it through the public API.
 */

/** The single row's id (`ck_transmision_una_fila`). */
export const LIVE_STREAM_ID = 1;

/** What the page and the panel get. Without a stream, all three are `null`. */
export interface LiveStream {
	/** The canonical Facebook video link. */
	url: string | null;
	/** The only URL the frontend may put in the player (`lib/facebook-links.ts`). */
	embedUrl: string | null;
	/** When the link was last set (UTC); `null` without a stream. */
	actualizadoEn: Date | null;
}

const EMPTY: LiveStream = { url: null, embedUrl: null, actualizadoEn: null };

type Db = Pool | PoolConnection;

function viewOf(row: RowDataPacket | undefined): LiveStream {
	const video = row ? storedFacebookVideo(row.url) : null;
	if (!video) return EMPTY;
	return { url: video.url, embedUrl: video.embedUrl, actualizadoEn: row!.actualizado_en as Date };
}

/** The stream now. A missing row (only possible in a database emptied by hand) reads as no stream. */
export async function getLiveStream(db: Db): Promise<LiveStream> {
	const [[row]] = await db.query<RowDataPacket[]>('SELECT url, actualizado_en FROM transmision_en_vivo WHERE id = ?', [LIVE_STREAM_ID]);
	return viewOf(row);
}

/**
 * The row, locked. Created first if it is missing (`db/init` creates it; a
 * test reset empties it), so the lock never lands on a gap.
 */
async function lockRow(conn: TransactionConnection): Promise<RowDataPacket | undefined> {
	await conn.query('INSERT IGNORE INTO transmision_en_vivo (id, url, actualizado_en) VALUES (?, NULL, NULL)', [LIVE_STREAM_ID]);
	const [[row]] = await conn.query<RowDataPacket[]>('SELECT url, actualizado_en FROM transmision_en_vivo WHERE id = ? FOR UPDATE', [LIVE_STREAM_ID]);
	return row;
}

/**
 * Sets (`video`) or removes (`null`) the stream, with its audit record
 * (`actualizacion_transmision` / `retiro_transmision`, in the same
 * transaction). The same link again, or removing a stream that isn't there,
 * writes nothing and records nothing (D-004). `actualizado_en` is set by the
 * backend, in UTC, to the second.
 */
export async function setLiveStream(pool: Pool, ctx: AdminActionContext, video: FacebookVideoLink | null, now: Date = new Date()): Promise<LiveStream> {
	const outcome = await runAdminAction<LiveStream>(pool, ctx, video ? 'editar' : 'borrar', 'transmision', async (conn) => {
		const before = viewOf(await lockRow(conn));
		const url = video?.url ?? null;
		if (before.url === url) return { id: LIVE_STREAM_ID, before, after: before };
		await conn.query('UPDATE transmision_en_vivo SET url = ?, actualizado_en = ? WHERE id = ?', [
			url,
			new Date(Math.floor(now.getTime() / 1000) * 1000),
			LIVE_STREAM_ID,
		]);
		return { id: LIVE_STREAM_ID, before, after: viewOf(await lockRow(conn)) };
	});
	return outcome.after!;
}
