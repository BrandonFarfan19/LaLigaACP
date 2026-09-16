import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { errorBody } from '../lib/response.js';

/**
 * Shape of the client errors `express.json()` (body-parser / raw-body) raises
 * for a bad request body: an `http-errors`-style error with a 4xx `status` and
 * `expose: true`. `type` is usually set, but not always — a corrupt gzip or
 * brotli body arrives straight from zlib with only `status`/`expose`. Checked
 * structurally, since body-parser doesn't export a class to `instanceof`
 * against.
 */
interface ClientError {
	type?: unknown;
	status: number;
	expose: true;
}

function isClientError(err: unknown): err is ClientError {
	if (typeof err !== 'object' || err === null) return false;
	const { status, expose } = err as Record<string, unknown>;
	return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}

/**
 * Our own code and message per body-parser `type`. The library's message is
 * never forwarded: it's English and may echo parser or zlib internals. Any
 * other exposed 4xx (unknown or missing `type`, e.g. a corrupt gzip body)
 * keeps its status with a generic `BAD_REQUEST`.
 */
const BODY_ERRORS = new Map<unknown, { code: ErrorCode; message: string }>([
	['entity.parse.failed', { code: ErrorCode.INVALID_JSON, message: 'El cuerpo de la solicitud no es JSON válido.' }],
	['entity.too.large', { code: ErrorCode.PAYLOAD_TOO_LARGE, message: 'El cuerpo de la solicitud es demasiado grande.' }],
	[
		'charset.unsupported',
		{ code: ErrorCode.UNSUPPORTED_MEDIA_TYPE, message: 'Codificación de caracteres no soportada: usá UTF-8.' },
	],
	['encoding.unsupported', { code: ErrorCode.UNSUPPORTED_MEDIA_TYPE, message: 'Content-Encoding no soportado.' }],
]);

const GENERIC_CLIENT_ERROR = { code: ErrorCode.BAD_REQUEST, message: 'Solicitud inválida.' };

/**
 * The only place that writes an error response. Mounted last, after
 * `notFoundHandler`. Express 5 forwards both thrown errors and rejected
 * promises from async handlers here automatically.
 *
 * `HttpError`, `ZodError` and any error flagged as the client's fault
 * (`expose: true` + 4xx status, as `express.json()` raises for bad bodies)
 * are expected: they map to their own 4xx and aren't logged. Anything else —
 * including a 5xx or non-exposed error that carries a `status` — is
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

	if (isClientError(err)) {
		const known = BODY_ERRORS.get(err.type) ?? GENERIC_CLIENT_ERROR;
		res.status(err.status).json(errorBody(known.code, known.message));
		return;
	}

	console.error('Error no controlado:', err);
	res.status(500).json(errorBody(ErrorCode.INTERNAL_ERROR, 'Error interno del servidor.'));
}
