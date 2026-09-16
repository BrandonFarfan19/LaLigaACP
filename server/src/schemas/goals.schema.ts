import { z } from 'zod';
import { ALLOWED_VIDEO_MESSAGE, MAX_VIDEO_URL_LENGTH, parseVideoUrl } from '../lib/video-links.js';
import { idFromText } from './common.schema.js';

/** Requests of the goals and media routes (T-13). Strict: unknown keys are a 400. */

/** BR-033: a 60-minute match, with room for stoppage and extra time. */
export const MINUTO_MINIMO = 1;
export const MINUTO_MAXIMO = 120;

const bodyId = z
	.number({ error: 'Debe ser un número.' })
	.int('Debe ser un número entero.')
	.positive('Debe ser un entero positivo.')
	.max(Number.MAX_SAFE_INTEGER, 'Es demasiado grande.');

const minuto = z
	.number({ error: 'Debe ser un número.' })
	.int('Debe ser un número entero.')
	.min(MINUTO_MINIMO, `Tiene que estar entre ${MINUTO_MINIMO} y ${MINUTO_MAXIMO}.`)
	.max(MINUTO_MAXIMO, `Tiene que estar entre ${MINUTO_MINIMO} y ${MINUTO_MAXIMO}.`);

export const createGoalBody = z.strictObject({ jugadorId: bodyId, equipoId: bodyId, minuto });

export const updateGoalBody = z
	.strictObject({ jugadorId: bodyId.optional(), equipoId: bodyId.optional(), minuto: minuto.optional() })
	.refine((value) => Object.values(value).some((v) => v !== undefined), { message: 'No hay campos para modificar.' });

/** An allowed video link, returned already normalized (`VideoLink`). */
export const videoBody = z.strictObject({
	url: z
		.string({ error: 'Debe ser un texto.' })
		.max(2048, 'Es demasiado largo.')
		.transform((value, ctx) => {
			const link = parseVideoUrl(value);
			if (!link || link.url.length > MAX_VIDEO_URL_LENGTH) {
				ctx.addIssue({ code: 'custom', message: ALLOWED_VIDEO_MESSAGE });
				return z.NEVER;
			}
			return link;
		}),
});

export const goalParams = z.object({ id: idFromText(), golId: idFromText('golId') });
export const mediaParams = z.object({ id: idFromText(), mediaId: idFromText('mediaId') });

export type CreateGoalBody = z.infer<typeof createGoalBody>;
export type UpdateGoalBody = z.infer<typeof updateGoalBody>;
