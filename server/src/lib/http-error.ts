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

	static notFound(message = 'Recurso no encontrado.', code: ErrorCode = ErrorCode.NOT_FOUND): HttpError {
		return new HttpError(404, code, message);
	}

	static badRequest(message = 'Solicitud inválida.', details?: unknown): HttpError {
		return new HttpError(400, ErrorCode.VALIDATION_ERROR, message, details);
	}

	static unauthenticated(message = 'Inicia sesión para continuar.'): HttpError {
		return new HttpError(401, ErrorCode.UNAUTHENTICATED, message);
	}

	static forbidden(message = 'No tienes permiso para esta acción.', code: ErrorCode = ErrorCode.FORBIDDEN): HttpError {
		return new HttpError(403, code, message);
	}

	static conflict(code: ErrorCode, message: string): HttpError {
		return new HttpError(409, code, message);
	}

	static serviceUnavailable(message = 'Servicio no disponible.'): HttpError {
		return new HttpError(503, ErrorCode.DATABASE_UNAVAILABLE, message);
	}
}
