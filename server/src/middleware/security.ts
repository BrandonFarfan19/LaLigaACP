import cors from 'cors';
import type { Express, Request, RequestHandler } from 'express';
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

/** `/public` and below (same matching as the router). It has its own limiter (`publicRateLimit`). */
const PUBLIC_PATH = /^\/public(?:\/|$)/i;

export function isPublicApi(req: Request): boolean {
	return PUBLIC_PATH.test(req.path);
}

/**
 * The public read-only API (T-08) gets its own limit, per IP, roomier than
 * the global one: a landing page view makes several calls (fixture, table,
 * team), everything is cacheable and cheap, and one visitor browsing a few
 * pages must not hit the 100-per-15-minutes budget meant for accounts and
 * admin actions. Still bounded: `PUBLIC_RATE_LIMIT_MAX` per
 * `PUBLIC_RATE_LIMIT_WINDOW_MS` (120 per minute by default).
 */
export function publicRateLimit(env: Env) {
	return rateLimit({
		windowMs: env.publicRateLimit.windowMs,
		limit: env.publicRateLimit.max,
		standardHeaders: true,
		legacyHeaders: false,
		handler: (_req, res) => {
			res.set('Cache-Control', 'no-store');
			res.status(429).json(errorBody(ErrorCode.RATE_LIMITED, 'Demasiadas solicitudes. Probá de nuevo más tarde.'));
		},
	});
}

/**
 * T-13: image uploads per IP (UPLOAD_RATE_LIMIT_*), on top of the global
 * limit. Uploads are the heaviest requests the API takes.
 */
export function uploadRateLimit(env: Env): RequestHandler {
	return rateLimit({
		windowMs: env.uploadRateLimit.windowMs,
		limit: env.uploadRateLimit.max,
		standardHeaders: true,
		legacyHeaders: false,
		handler: (_req, res) => {
			res.status(429).json(errorBody(ErrorCode.RATE_LIMITED, 'Demasiadas subidas de imágenes. Probá de nuevo más tarde.'));
		},
	});
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
			// T-10: the frontend reads these on a ticket confirmation.
			exposedHeaders: ['Location', 'Idempotent-Replayed'],
		}),
	);

	app.use(
		rateLimit({
			windowMs: env.rateLimit.windowMs,
			limit: env.rateLimit.max,
			standardHeaders: true,
			legacyHeaders: false,
			skip: (req) => isHealthCheck(req) || isPublicApi(req),
			handler: (_req, res) => {
				res.status(429).json(errorBody(ErrorCode.RATE_LIMITED, 'Demasiadas solicitudes. Probá de nuevo más tarde.'));
			},
		}),
	);

	// JSON bodies only. Image uploads (T-13) have their own parser and limit
	// (middleware/upload.ts); nothing else needs more than this.
	app.use(express.json({ limit: '100kb' }));
}
