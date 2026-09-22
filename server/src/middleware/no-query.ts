import type { RequestHandler } from 'express';
import { emptyQuerySchema } from '../schemas/common.schema.js';

/**
 * For routes that accept no query parameters: `?anything` → 400
 * `VALIDATION_ERROR` naming the key. Put it after `requireAuth`, so a
 * request without a session still gets 401 first.
 */
export const rejectQueryParams: RequestHandler = (req, _res, next) => {
	emptyQuerySchema.parse(req.query);
	next();
};
