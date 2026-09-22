import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../lib/http-error.js';

/** Mounted after every route. Anything that reaches here didn't match. */
export function notFoundHandler(_req: Request, _res: Response, next: NextFunction): void {
	next(HttpError.notFound('Ruta no encontrada.'));
}
