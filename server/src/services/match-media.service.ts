import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { TransactionConnection } from '../db/transaction.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { toSafeWebp } from '../lib/images.js';
import { storedVideo, type VideoLink } from '../lib/video-links.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { imagePath, type MediaDeps, requireMediaEditable } from './goals.service.js';
import { find, findForUpdate } from './matches.service.js';

/**
 * Módulo Informativo, T-13 (BR-001, BR-033): images and videos of a match as
 * a whole. Same rule as a goal's media: from the kick-off on, also after the
 * result is confirmed, never in a cancelled match.
 */

/** Per match (BR-001 asks for images and videos, not a gallery). */
export const MAX_IMAGENES_PARTIDO = 20;
export const MAX_VIDEOS_PARTIDO = 10;

export interface MatchImage {
	id: number;
	tipo: 'imagen';
	/** API path of the file. */
	url: string;
	creadoEn: Date;
}

export interface MatchVideo {
	id: number;
	tipo: 'video';
	video: VideoLink;
	creadoEn: Date;
}

export type MatchMediaItem = MatchImage | MatchVideo;

export interface MatchMedia {
	imagenes: MatchImage[];
	videos: MatchVideo[];
}

export function mediaItemFrom(row: RowDataPacket, scope: 'admin' | 'public'): MatchMediaItem {
	const creadoEn = row.creado_en as Date;
	if (row.imagen !== null) return { id: Number(row.id), tipo: 'imagen', url: imagePath(scope, row.imagen)!, creadoEn };
	return { id: Number(row.id), tipo: 'video', video: storedVideo(row.video)!, creadoEn };
}

/** A match's media, oldest first, split by kind. */
export async function readMatchMedia(db: Pool | TransactionConnection, matchId: number, scope: 'admin' | 'public'): Promise<MatchMedia> {
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT id, imagen, video, creado_en FROM multimedia_partido WHERE partido_id = ? ORDER BY id',
		[matchId],
	);
	const items = rows.map((row) => mediaItemFrom(row, scope));
	return {
		imagenes: items.filter((item): item is MatchImage => item.tipo === 'imagen'),
		videos: items.filter((item): item is MatchVideo => item.tipo === 'video'),
	};
}

export async function listMatchMedia(pool: Pool, matchId: number): Promise<MatchMedia> {
	await find(pool, matchId);
	return readMatchMedia(pool, matchId, 'admin');
}

const now = (deps: { now?: () => Date }) => (deps.now ?? (() => new Date()))();
const second = (at: Date) => new Date(Math.floor(at.getTime() / 1000) * 1000);

async function readItem(conn: TransactionConnection, id: number): Promise<MatchMediaItem> {
	const [[row]] = await conn.query<RowDataPacket[]>('SELECT id, imagen, video, creado_en FROM multimedia_partido WHERE id = ?', [id]);
	return mediaItemFrom(row!, 'admin');
}

/** Counts under the match lock, so two uploads can't both take the last slot. */
async function countMedia(conn: TransactionConnection, matchId: number) {
	const [[row]] = await conn.query<RowDataPacket[]>(
		'SELECT COUNT(imagen) AS imagenes, COUNT(video) AS videos FROM multimedia_partido WHERE partido_id = ?',
		[matchId],
	);
	return { imagenes: Number(row!.imagenes), videos: Number(row!.videos) };
}

/** Adds an image to the match. The file is written before the transaction and removed if it fails. */
export async function addMatchImage(pool: Pool, ctx: AdminActionContext, matchId: number, upload: Buffer, deps: MediaDeps): Promise<MatchMediaItem> {
	const at = now(deps);
	const content = await toSafeWebp(upload, deps.maxPixels);
	const name = await deps.store.save(content);
	try {
		const outcome = await runAdminAction<MatchMediaItem>(pool, ctx, 'crear', 'multimedia', async (conn) => {
			const match = await findForUpdate(conn, matchId, at);
			requireMediaEditable(match, at);
			if ((await countMedia(conn, matchId)).imagenes >= MAX_IMAGENES_PARTIDO) {
				throw new HttpError(409, ErrorCode.MEDIA_LIMIT_REACHED, `El partido ya tiene ${MAX_IMAGENES_PARTIDO} imágenes, el máximo.`, {
					maximo: MAX_IMAGENES_PARTIDO,
				});
			}
			const [result] = await conn.query<ResultSetHeader>(
				'INSERT INTO multimedia_partido (partido_id, imagen, video, creado_en) VALUES (?, ?, NULL, ?)',
				[matchId, name, second(at)],
			);
			return { id: result.insertId, before: null, after: await readItem(conn, result.insertId) };
		});
		return outcome.after!;
	} catch (error) {
		await deps.store.remove(name);
		throw error;
	}
}

/** Adds a video link (already validated and normalized). The same video twice in a match is 409. */
export async function addMatchVideo(pool: Pool, ctx: AdminActionContext, matchId: number, video: VideoLink, deps: MediaDeps): Promise<MatchMediaItem> {
	const at = now(deps);
	const outcome = await runAdminAction<MatchMediaItem>(pool, ctx, 'crear', 'multimedia', async (conn) => {
		const match = await findForUpdate(conn, matchId, at);
		requireMediaEditable(match, at);
		if ((await countMedia(conn, matchId)).videos >= MAX_VIDEOS_PARTIDO) {
			throw new HttpError(409, ErrorCode.MEDIA_LIMIT_REACHED, `El partido ya tiene ${MAX_VIDEOS_PARTIDO} videos, el máximo.`, {
				maximo: MAX_VIDEOS_PARTIDO,
			});
		}
		const [[repeated]] = await conn.query<RowDataPacket[]>('SELECT id FROM multimedia_partido WHERE partido_id = ? AND video = ?', [
			matchId,
			video.url,
		]);
		if (repeated) {
			throw new HttpError(409, ErrorCode.VIDEO_ALREADY_ADDED, 'Ese video ya está en el partido.', { id: Number(repeated.id) });
		}
		const [result] = await conn.query<ResultSetHeader>(
			'INSERT INTO multimedia_partido (partido_id, imagen, video, creado_en) VALUES (?, NULL, ?, ?)',
			[matchId, video.url, second(at)],
		);
		return { id: result.insertId, before: null, after: await readItem(conn, result.insertId) };
	});
	return outcome.after!;
}

/** Removes an image or video of the match (and, after the commit, the image file). */
export async function deleteMatchMedia(pool: Pool, ctx: AdminActionContext, matchId: number, mediaId: number, deps: MediaDeps): Promise<void> {
	const at = now(deps);
	let file: string | null = null;
	await runAdminAction<MatchMediaItem>(pool, ctx, 'borrar', 'multimedia', async (conn) => {
		const match = await findForUpdate(conn, matchId, at);
		requireMediaEditable(match, at);
		const [[row]] = await conn.query<RowDataPacket[]>(
			'SELECT id, imagen, video, creado_en FROM multimedia_partido WHERE id = ? AND partido_id = ?',
			[mediaId, matchId],
		);
		if (!row) throw HttpError.notFound('No existe esa imagen o video en este partido.', ErrorCode.MEDIA_NOT_FOUND);
		await conn.query('DELETE FROM multimedia_partido WHERE id = ?', [mediaId]);
		file = row.imagen === null ? null : String(row.imagen);
		return { id: mediaId, before: mediaItemFrom(row, 'admin'), after: null };
	});
	await deps.store.remove(file);
}

/**
 * Whether a stored image may be served (`GET /public/archivos/:nombre`): it
 * belongs to a goal or to the media of a match whose result is official
 * (`finalizado` with both sides loaded, BR-049). With `anyState`, whether it
 * belongs to any match at all (the admin route).
 */
export async function isServableImage(pool: Pool, name: string, anyState: boolean): Promise<boolean> {
	const official = anyState
		? ''
		: `JOIN estado_partido ep ON ep.id = p.estado_partido_id AND ep.codigo = 'finalizado'
			WHERE NOT EXISTS (SELECT 1 FROM partido_equipo pe2 WHERE pe2.partido_id = p.id AND pe2.goles IS NULL)`;
	const [[row]] = await pool.query<RowDataPacket[]>(
		`SELECT COUNT(*) AS n FROM (
			SELECT pe.partido_id FROM gol g JOIN partido_equipo pe ON pe.id = g.partido_equipo_id WHERE g.imagen = ?
			UNION ALL
			SELECT m.partido_id FROM multimedia_partido m WHERE m.imagen = ?
		) f
		JOIN partido p ON p.id = f.partido_id
		${official}`,
		[name, name],
	);
	return Number(row?.n ?? 0) > 0;
}
