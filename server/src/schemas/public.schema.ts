import { z } from 'zod';
import { idFromText, paginationFields } from './common.schema.js';
import { isoDateTime, MATCH_STATES } from './matches.schema.js';

/** Query strings of the public API (T-08). All strict: an unknown key is a 400. */

export const noQuery = z.strictObject({});

export const listPublicCompetitionsQuery = z.strictObject({
	...paginationFields,
	deporteId: idFromText('deporteId').optional(),
});

export const listFixtureQuery = z
	.strictObject({
		...paginationFields,
		deporteId: idFromText('deporteId').optional(),
		competicionId: idFromText('competicionId').optional(),
		/** Home or away. */
		equipoId: idFromText('equipoId').optional(),
		estado: z.enum(MATCH_STATES, { error: `Tiene que ser uno de: ${MATCH_STATES.join(', ')}.` }).optional(),
		jornada: z
			.string()
			.regex(/^[1-9]\d{0,2}$/, 'jornada tiene que ser un entero de 1 a 999.')
			.transform(Number)
			.optional(),
		desde: isoDateTime('desde').optional(),
		hasta: isoDateTime('hasta').optional(),
	})
	.refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, { message: 'desde no puede ser posterior a hasta.', path: ['hasta'] });

export type ListPublicCompetitionsQuery = z.infer<typeof listPublicCompetitionsQuery>;
export type ListFixtureQuery = z.infer<typeof listFixtureQuery>;
