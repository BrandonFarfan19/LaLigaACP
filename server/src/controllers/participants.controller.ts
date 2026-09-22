import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import { sendSuccess } from '../lib/response.js';
import { authUser } from '../middleware/auth.js';
import { emptyQuerySchema } from '../schemas/common.schema.js';
import { listParticipantsQuerySchema, userIdParamsSchema } from '../schemas/participants.schema.js';
import * as participantActions from '../services/participant-validation.service.js';
import { countParticipants, listParticipants } from '../services/participants.service.js';

/** `/admin/participantes` handlers (BR-001, BR-006 to BR-008, §23). The router already requires an admin session. */
export function createParticipantsController(pool: Pool, hooks: participantActions.ParticipantActionHooks = {}) {
	const list: RequestHandler = async (req, res) => {
		sendSuccess(res, await listParticipants(pool, listParticipantsQuerySchema.parse(req.query)));
	};

	const counts: RequestHandler = async (req, res) => {
		// No filters: `?rol=admin` (removed) or any other key is a 400, like in the list.
		emptyQuerySchema.parse(req.query);
		sendSuccess(res, await countParticipants(pool));
	};

	/** Wraps one of the service actions: parse `:id`, run it as the logged-in admin, answer with the updated participant. */
	const action =
		(run: typeof participantActions.confirmPayment): RequestHandler =>
		async (req, res) => {
			const { id } = userIdParamsSchema.parse(req.params);
			const outcome = await run(pool, { actorId: authUser(req).id, userId: id }, hooks);
			sendSuccess(res, { participante: outcome.participant });
		};

	return {
		list,
		counts,
		confirmPayment: action(participantActions.confirmPayment),
		revertPayment: action(participantActions.revertPayment),
		validate: action(participantActions.validateParticipant),
	};
}
