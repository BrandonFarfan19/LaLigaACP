import { z } from 'zod';

/**
 * Query string of a route that takes no parameters. Any key is a 400, so a
 * client relying on a filter that doesn't exist (or no longer exists) finds
 * out instead of silently getting unfiltered data.
 */
export const emptyQuerySchema = z.strictObject({});

/**
 * A whole number from 1 to `max`, each failure with its own message. The
 * "must be a number" text applies only to non-numbers: set on the schema
 * itself, zod would use it for every failed check too ("page debe ser un
 * número" for page=100001).
 */
export function pageNumber(name: string, max: number) {
	return z.coerce
		.number({ error: (issue) => (issue.code === 'invalid_type' ? `${name} debe ser un número.` : undefined) })
		.int(`${name} debe ser un número entero.`)
		.min(1, `${name} debe ser 1 o mayor.`)
		.max(max, `${name} no puede ser mayor que ${max}.`);
}

/**
 * `page` and `pageSize`, shared by every paginated list. `page` is capped: at
 * the largest pageSize that is 10 million rows, far beyond any real pool.
 */
export const paginationFields = {
	page: pageNumber('page', 100_000).default(1),
	pageSize: pageNumber('pageSize', 100).default(20),
};

/**
 * A numeric id arriving as text (URL segment or query value): digits only (no
 * `1e3`, `0x10`, `-1`), within MySQL's BIGINT and JS's safe range.
 */
export function idFromText(name = 'El id') {
	return z
		.string()
		.regex(/^[1-9]\d{0,15}$/, `${name} debe ser un entero positivo.`)
		.transform(Number)
		.refine(Number.isSafeInteger, `${name} es demasiado grande.`);
}

/** `:id` in the URL. */
export const idParamsSchema = z.object({ id: idFromText() });

/** A list that takes only pagination: anything else is a 400. */
export const paginationQuerySchema = z.strictObject(paginationFields);

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Page<T> {
	items: T[];
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
}

export function toPage<T>(items: T[], total: number, query: PaginationQuery): Page<T> {
	return { items, page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) };
}
