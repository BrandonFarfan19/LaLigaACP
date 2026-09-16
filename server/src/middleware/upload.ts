import type { RequestHandler } from 'express';
import multer from 'multer';
import type { Env } from '../config/env.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';

/**
 * One image per request, as `multipart/form-data` with the field `imagen`
 * (T-13). Kept in memory, at most `UPLOAD_MAX_BYTES`, with no other fields
 * or files: whatever else arrives is a 400, and a bigger file is a 413. The
 * file's content is checked afterwards (lib/images.ts), never trusted here.
 * The general JSON limit (100 KB) doesn't apply: this is its own parser.
 */
export const UPLOAD_FIELD = 'imagen';

export function imageUpload(env: Env): RequestHandler {
	const parse = multer({
		storage: multer.memoryStorage(),
		limits: { fileSize: env.uploads.maxBytes, files: 1, fields: 0, parts: 1, headerPairs: 20 },
	}).single(UPLOAD_FIELD);
	const megabytes = Math.floor(env.uploads.maxBytes / 1024 / 1024);

	return (req, res, next) => {
		if (!req.is('multipart/form-data')) {
			next(new HttpError(415, ErrorCode.UNSUPPORTED_MEDIA_TYPE, `Enviá la imagen como multipart/form-data, en el campo ${UPLOAD_FIELD}.`));
			return;
		}
		parse(req, res, (error: unknown) => {
			if (!error) {
				next(req.file ? undefined : new HttpError(400, ErrorCode.UPLOAD_INVALID, `Falta el archivo en el campo ${UPLOAD_FIELD}.`));
				return;
			}
			if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
				next(new HttpError(413, ErrorCode.PAYLOAD_TOO_LARGE, `La imagen supera el máximo de ${megabytes} MB.`));
				return;
			}
			// Any other problem with the multipart body (other fields, more files, a
			// cut or malformed stream) is the client's; the parser's message is not
			// forwarded.
			next(new HttpError(400, ErrorCode.UPLOAD_INVALID, `El envío no es válido: mandá un solo archivo en el campo ${UPLOAD_FIELD} y nada más.`));
		});
	};
}
