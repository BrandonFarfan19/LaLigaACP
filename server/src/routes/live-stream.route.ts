import { type RequestHandler, Router } from 'express';
import type { Pool } from 'mysql2/promise';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { rejectQueryParams } from '../middleware/no-query.js';
import { setLiveStreamBody } from '../schemas/live-stream.schema.js';
import type { AdminActionContext, AdminActionHooks } from '../services/admin-action.js';
import { getLiveStream, setLiveStream } from '../services/live-stream.service.js';

/**
 * C-14 (D-043, Módulo Informativo), mounted at `/admin/transmision` (session,
 * admin role; writes need the CSRF token). No query string anywhere.
 *
 *   GET    /admin/transmision            the stream now: { url, embedUrl, actualizadoEn }
 *   PUT    /admin/transmision { url }    sets it (a Facebook video link) or removes it (null)
 *   DELETE /admin/transmision            removes it
 *
 * The public read is `GET /public/transmision` (public.route.ts).
 */
export function createLiveStreamRouter(pool: Pool, hooks?: AdminActionHooks): Router {
	const router = Router();
	const ctx = (req: Parameters<RequestHandler>[0]): AdminActionContext => ({ actorId: authUser(req).id, hooks });

	router.get('/', rejectQueryParams, async (_req, res) => {
		sendSuccess(res, await getLiveStream(pool));
	});
	router.put('/', rejectQueryParams, async (req, res) => {
		const { url } = setLiveStreamBody.parse(req.body);
		sendSuccess(res, await setLiveStream(pool, ctx(req), url));
	});
	router.delete('/', rejectQueryParams, async (req, res) => {
		sendSuccess(res, await setLiveStream(pool, ctx(req), null));
	});
	return router;
}
