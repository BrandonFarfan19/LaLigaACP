import type { Response } from 'express';
import type { ErrorCode } from './error-codes.js';

/**
 * The one response shape for the whole API: `{ data }` on success,
 * `{ error }` on failure, always — including validation errors and the
 * `404`/`429` cases raised outside a controller. Client code can rely on the
 * discriminated shape without special-casing status codes.
 */
export interface SuccessBody<T> {
	data: T;
}

export interface ErrorBody {
	error: {
		code: ErrorCode;
		message: string;
		details?: unknown;
	};
}

export function sendSuccess<T>(res: Response, data: T, status = 200): void {
	const body: SuccessBody<T> = { data };
	res.status(status).json(body);
}

export function errorBody(code: ErrorCode, message: string, details?: unknown): ErrorBody {
	return { error: details === undefined ? { code, message } : { code, message, details } };
}
