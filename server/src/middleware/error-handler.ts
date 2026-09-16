import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { errorBody } from '../lib/response.js';

/**
 * The only place that writes an error response. Mounted last, after
 * `notFoundHandler`. Express 5 forwards both thrown errors and rejected
 * promises from async handlers here automatically.
 *
 * Anything that isn't an `HttpError` or a `ZodError` is treated as
 * unexpected: logged in full server-side, but the client only ever gets a
 * generic message — never a stack trace, a driver error string or any other
 * internal detail (NFR-005).
 */
// `_next` is unused but required: Express only treats a middleware as an
// error handler when its function has exactly 4 parameters.
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
	if (err instanceof HttpError) {
		res.status(err.status).json(errorBody(err.code, err.message, err.details));
		return;
	}

	if (err instanceof ZodError) {
		const details = err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));
		res.status(400).json(errorBody(ErrorCode.VALIDATION_ERROR, 'Solicitud inválida.', details));
		return;
	}

	console.error('Error no controlado:', err);
	res.status(500).json(errorBody(ErrorCode.INTERNAL_ERROR, 'Error interno del servidor.'));
}
