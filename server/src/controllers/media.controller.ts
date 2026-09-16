import type { Request, RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { ImageRejected } from '../lib/images.js';
import { errorBody, sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { idParamsSchema } from '../schemas/common.schema.js';
import { createGoalBody, goalParams, mediaParams, updateGoalBody, videoBody } from '../schemas/goals.schema.js';
import type { AdminActionHooks } from '../services/admin-action.js';
import * as goals from '../services/goals.service.js';
import * as media from '../services/match-media.service.js';
import { isStoredImageName, type MediaStore } from '../services/media-storage.js';

/**
 * T-13: a match's goals (BR-033) and its images and videos, under
 * `/admin/partidos/:id`, plus the image files themselves.
 */
export function createMediaController(pool: Pool, deps: goals.MediaDeps, hooks?: AdminActionHooks) {
	const ctx = (req: Request) => ({ actorId: authUser(req).id, hooks });
	const upload = (req: Request) => req.file!.buffer;
	/** A rejected image is the client's fault: 400, never a 500. */
	const image = async <T>(work: () => Promise<T>): Promise<T> => {
		try {
			return await work();
		} catch (error) {
			if (error instanceof ImageRejected) throw new HttpError(400, ErrorCode.IMAGE_INVALID, error.message);
			throw error;
		}
	};

	const listGoals: RequestHandler = async (req, res) => {
		sendSuccess(res, await goals.listGoals(pool, idParamsSchema.parse(req.params).id));
	};
	const createGoal: RequestHandler = async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		sendSuccess(res, await goals.createGoal(pool, ctx(req), id, createGoalBody.parse(req.body), deps), 201);
	};
	const updateGoal: RequestHandler = async (req, res) => {
		const { id, golId } = goalParams.parse(req.params);
		sendSuccess(res, await goals.updateGoal(pool, ctx(req), id, golId, updateGoalBody.parse(req.body), deps));
	};
	const deleteGoal: RequestHandler = async (req, res) => {
		const { id, golId } = goalParams.parse(req.params);
		await goals.deleteGoal(pool, ctx(req), id, golId, deps);
		sendSuccess(res, { id: golId });
	};
	const setGoalImage: RequestHandler = async (req, res) => {
		const { id, golId } = goalParams.parse(req.params);
		sendSuccess(res, await image(() => goals.setGoalImage(pool, ctx(req), id, golId, upload(req), deps)));
	};
	const removeGoalImage: RequestHandler = async (req, res) => {
		const { id, golId } = goalParams.parse(req.params);
		sendSuccess(res, await goals.removeGoalImage(pool, ctx(req), id, golId, deps));
	};
	const setGoalVideo: RequestHandler = async (req, res) => {
		const { id, golId } = goalParams.parse(req.params);
		sendSuccess(res, await goals.setGoalVideo(pool, ctx(req), id, golId, videoBody.parse(req.body).url, deps));
	};
	const removeGoalVideo: RequestHandler = async (req, res) => {
		const { id, golId } = goalParams.parse(req.params);
		sendSuccess(res, await goals.setGoalVideo(pool, ctx(req), id, golId, null, deps));
	};

	const listMedia: RequestHandler = async (req, res) => {
		sendSuccess(res, await media.listMatchMedia(pool, idParamsSchema.parse(req.params).id));
	};
	const addImage: RequestHandler = async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		sendSuccess(res, await image(() => media.addMatchImage(pool, ctx(req), id, upload(req), deps)), 201);
	};
	const addVideo: RequestHandler = async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		sendSuccess(res, await media.addMatchVideo(pool, ctx(req), id, videoBody.parse(req.body).url, deps), 201);
	};
	const deleteMedia: RequestHandler = async (req, res) => {
		const { id, mediaId } = mediaParams.parse(req.params);
		await media.deleteMatchMedia(pool, ctx(req), id, mediaId, deps);
		sendSuccess(res, { id: mediaId });
	};

	return {
		listGoals,
		createGoal,
		updateGoal,
		deleteGoal,
		setGoalImage,
		removeGoalImage,
		setGoalVideo,
		removeGoalVideo,
		listMedia,
		addImage,
		addVideo,
		deleteMedia,
	};
}

/**
 * How long a browser or proxy may keep a public image. A stored file never
 * changes (random name, written once), so caching is safe; the only risk is an
 * image the admin removed, which a cache can keep showing for this long. One
 * hour bounds that while still sparing repeat downloads on a match page.
 */
export const PUBLIC_IMAGE_MAX_AGE_SECONDS = 3600;

/**
 * `GET .../archivos/:nombre`: an uploaded image, read-only. Only names the
 * server made up (no path, no traversal: see media-storage.ts) and only files
 * a row points at: for the public, of a match with its official result
 * (BR-049); for the admin, of any match. Always `image/webp`, never sniffed,
 * sandboxed, and loadable as an <img> from the frontend's origin.
 */
export function serveImage(pool: Pool, store: MediaStore, scope: 'admin' | 'public'): RequestHandler {
	return async (req, res) => {
		const name = req.params.nombre;
		const notFound = () => res.status(404).json(errorBody(ErrorCode.FILE_NOT_FOUND, 'No existe esa imagen.'));
		if (!isStoredImageName(name) || !(await isServableImage(pool, name, scope))) {
			notFound();
			return;
		}
		const headers = {
			'Content-Type': 'image/webp',
			'Content-Disposition': 'inline',
			'Cache-Control': scope === 'public' ? `public, max-age=${PUBLIC_IMAGE_MAX_AGE_SECONDS}` : 'private, no-store',
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'Cross-Origin-Resource-Policy': 'cross-origin',
			'X-Content-Type-Options': 'nosniff',
		};
		await new Promise<void>((resolve, reject) => {
			res.sendFile(store.pathOf(name), { headers, dotfiles: 'deny', acceptRanges: false }, (error) => {
				if (!error) return resolve();
				// The client went away mid-transfer: nothing left to answer.
				if (res.headersSent) return resolve();
				// The row exists but the file doesn't (a lost volume): a missing image, not a crash.
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					res.set('Cache-Control', 'no-store');
					notFound();
					return resolve();
				}
				reject(error);
			});
		});
	};
}

const isServableImage = (pool: Pool, name: string, scope: 'admin' | 'public') => media.isServableImage(pool, name, scope === 'admin');
