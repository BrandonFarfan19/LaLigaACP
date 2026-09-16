import { z } from 'zod';

/**
 * A whole number from 1 to `max`, each failure with its own message. The
 * "must be a number" text applies only to non-numbers: set on the schema
 * itself, zod would use it for every failed check too ("page debe ser un
 * número" for page=100001).
 */
function pageNumber(name: string, max: number) {
	return z.coerce
		.number({ error: (issue) => (issue.code === 'invalid_type' ? `${name} debe ser un número.` : undefined) })
		.int(`${name} debe ser un número entero.`)
		.min(1, `${name} debe ser 1 o mayor.`)
		.max(max, `${name} no puede ser mayor que ${max}.`);
}

/**
 * Query string of `GET /admin/participantes`. Every value arrives as a
 * string; a repeated key arrives as an array and fails. Unknown keys fail
 * too (`strict`), so a leftover `rol=...` is reported instead of ignored.
 */
export const listParticipantsQuerySchema = z.strictObject({
	// Capped: at the largest pageSize that is 10 million rows, far beyond any real pool.
	page: pageNumber('page', 100_000).default(1),
	pageSize: pageNumber('pageSize', 100).default(20),
	estadoPago: z.enum(['pendiente', 'confirmado']).optional(),
	estadoValidacion: z.enum(['pendiente', 'validado']).optional(),
	/** Part of the name or email, case-insensitive. */
	q: z.string().trim().max(100).optional().transform((value) => (value ? value : undefined)),
	/** By registration date; `asc` (oldest first, the order they wait to be validated) by default. */
	orden: z.enum(['asc', 'desc']).default('asc'),
});

export type ListParticipantsQuery = z.infer<typeof listParticipantsQuerySchema>;

/** `:id` in the URL: digits only (no `1e3`, `0x10`, `-1`), within MySQL's BIGINT and JS's safe range. */
export const userIdParamsSchema = z.object({
	id: z
		.string()
		.regex(/^[1-9]\d{0,15}$/, 'El id debe ser un entero positivo.')
		.transform(Number)
		.refine(Number.isSafeInteger, 'El id es demasiado grande.'),
});
