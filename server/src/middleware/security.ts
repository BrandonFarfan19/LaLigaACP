import cors from 'cors';
import type { Express, Request } from 'express';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import helmet from 'helmet';
import type { Env } from '../config/env.js';
import { ErrorCode } from '../lib/error-codes.js';
import { errorBody } from '../lib/response.js';

/**
 * Monitors poll `GET /health`; they must never use up the limit. Matches the
 * way the health route itself is matched — `Router()` defaults: case
 * insensitive, one optional trailing slash — so `/HEALTH` and `/health/`
 * are skipped exactly when they'd reach the endpoint. Only GET (and the HEAD
 * Express answers with it); any other method there is a 404 and counts.
 */
const HEALTH_PATH = /^\/health\/?$/i;

function isHealthCheck(req: Request): boolean {
	return (req.method === 'GET' || req.method === 'HEAD') && HEALTH_PATH.test(req.path);
}

/**
 * NFR-005 base: helmet's default headers, CORS locked to exactly the
 * frontend's origin (never a wildcard), a basic global rate limit and a
 * body-size cap — applied first, before any route. No secrets live here: the
 * only input is the already-validated `env`.
 *
 * Order matters: the limiter runs before `express.json()`, so a request with
 * an invalid or oversized body still counts against the limit before it's
 * parsed. It runs after `cors()` so a 429 still carries the CORS headers the
 * browser needs to read it.
 */
export function applySecurity(app: Express, env: Env): void {
	app.use(helmet());

	app.use(
		cors({
			origin: env.corsOrigin,
			credentials: true,
		}),
	);

	app.use(
		rateLimit({
			windowMs: env.rateLimit.windowMs,
			limit: env.rateLimit.max,
			standardHeaders: true,
			legacyHeaders: false,
			skip: isHealthCheck,
			handler: (_req, res) => {
				res.status(429).json(errorBody(ErrorCode.RATE_LIMITED, 'Demasiadas solicitudes. Probá de nuevo más tarde.'));
			},
		}),
	);

	// No file uploads yet (BR-033's goal media is a later task); a JSON API has
	// no legitimate reason to need more than this.
	app.use(express.json({ limit: '100kb' }));
}
