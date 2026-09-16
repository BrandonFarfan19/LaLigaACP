import { z } from 'zod';
import { idParamsSchema, paginationFields } from './common.schema.js';

/**
 * Query string of `GET /admin/participantes`. Every value arrives as a
 * string; a repeated key arrives as an array and fails. Unknown keys fail
 * too (`strict`), so a leftover `rol=...` is reported instead of ignored.
 */
export const listParticipantsQuerySchema = z.strictObject({
	...paginationFields,
	estadoPago: z.enum(['pendiente', 'confirmado']).optional(),
	estadoValidacion: z.enum(['pendiente', 'validado']).optional(),
	/** Part of the name or email, case-insensitive. */
	q: z.string().trim().max(100).optional().transform((value) => (value ? value : undefined)),
	/** By registration date; `asc` (oldest first, the order they wait to be validated) by default. */
	orden: z.enum(['asc', 'desc']).default('asc'),
});

export type ListParticipantsQuery = z.infer<typeof listParticipantsQuerySchema>;

/** `:id` of a participant. */
export const userIdParamsSchema = idParamsSchema;
