import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { idParamsSchema } from '../schemas/common.schema.js';
import { cancelMatchBody } from '../schemas/matches.schema.js';
import type { AdminActionHooks } from '../services/admin-action.js';
import { cancelMatch, getCancellationPreview } from '../services/match-cancellation.service.js';

/** T-16: the cancellation preview and the cancellation itself. */
export function createMatchCancellationController(pool: Pool, hooks?: AdminActionHooks) {
	const preview: RequestHandler = async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		sendSuccess(res, await getCancellationPreview(pool, id));
	};

	const cancel: RequestHandler = async (req, res) => {
		const { id } = idParamsSchema.parse(req.params);
		cancelMatchBody.parse(req.body);
		sendSuccess(res, await cancelMatch(pool, { actorId: authUser(req).id, hooks }, id));
	};

	return { preview, cancel };
}
