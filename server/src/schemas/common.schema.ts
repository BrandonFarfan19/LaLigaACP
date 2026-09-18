import { z } from 'zod';

/**
 * Query string of a route that takes no parameters. Any key is a 400, so a
 * client relying on a filter that doesn't exist (or no longer exists) finds
 * out instead of silently getting unfiltered data.
 */
export const emptyQuerySchema = z.strictObject({});

/**
 * A whole number from 1 to `max`, written only with decimal digits (T-21 fix:
 * `z.coerce` took `1e2`, `0x10`, ` 2` or `2.0`), each failure with its own
 * message.
 */
export function pageNumber(name: string, max: number) {
	return z.string({ error: `${name} debe ser un número.` }).transform((text, ctx) => {
		let message: string | null = null;
		if (/^-\d+$/.test(text)) message = `${name} debe ser 1 o mayor.`;
		else if (!/^\d+$/.test(text)) {
			// Something a number parser would take (1.5, 1e2, 0x10) is a number, just not a whole one in digits.
			message = text.trim() !== '' && Number.isFinite(Number(text)) ? `${name} debe ser un número entero, escrito solo con cifras.` : `${name} debe ser un número.`;
		} else if (Number(text) < 1) message = `${name} debe ser 1 o mayor.`;
		else if (Number(text) > max) message = `${name} no puede ser mayor que ${max}.`;
		if (message) {
			ctx.addIssue({ code: 'custom', message });
			return z.NEVER;
		}
		return Number(text);
	});
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
