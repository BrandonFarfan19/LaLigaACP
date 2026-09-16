import cors from 'cors';
import type { Express } from 'express';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Env } from '../config/env.js';
import { ErrorCode } from '../lib/error-codes.js';
import { errorBody } from '../lib/response.js';

/**
 * NFR-005 base: helmet's default headers, CORS locked to exactly the
 * frontend's origin (never a wildcard), a body-size cap and a basic global
 * rate limit — applied first, before any route. No secrets live here: the
 * only input is the already-validated `env`.
 */
export function applySecurity(app: Express, env: Env): void {
	app.use(helmet());

	app.use(
		cors({
			origin: env.corsOrigin,
			credentials: true,
		}),
	);

	// No file uploads yet (BR-033's goal media is a later task); a JSON API has
	// no legitimate reason to need more than this.
	app.use(express.json({ limit: '100kb' }));

	app.use(
		rateLimit({
			windowMs: env.rateLimit.windowMs,
			limit: env.rateLimit.max,
			standardHeaders: true,
			legacyHeaders: false,
			handler: (_req, res) => {
				res.status(429).json(errorBody(ErrorCode.RATE_LIMITED, 'Demasiadas solicitudes. Probá de nuevo más tarde.'));
			},
		}),
	);
}
