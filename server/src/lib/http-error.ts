import { ErrorCode } from './error-codes.js';

/**
 * The one way controllers and services signal an expected failure. Express 5
 * forwards a rejected promise (or a thrown error inside an async handler) to
 * the error-handling middleware automatically — no manual try/catch or
 * `next(err)` needed at the call site, just `throw`.
 */
export class HttpError extends Error {
	readonly status: number;
	readonly code: ErrorCode;
	readonly details?: unknown;

	constructor(status: number, code: ErrorCode, message: string, details?: unknown) {
		super(message);
		this.name = 'HttpError';
		this.status = status;
		this.code = code;
		this.details = details;
	}

	static notFound(message = 'Recurso no encontrado.'): HttpError {
		return new HttpError(404, ErrorCode.NOT_FOUND, message);
	}

	static badRequest(message = 'Solicitud inválida.', details?: unknown): HttpError {
		return new HttpError(400, ErrorCode.VALIDATION_ERROR, message, details);
	}

	static serviceUnavailable(message = 'Servicio no disponible.'): HttpError {
		return new HttpError(503, ErrorCode.DATABASE_UNAVAILABLE, message);
	}
}
