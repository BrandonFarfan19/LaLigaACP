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

/** `GET /auth/me` (same matching as the router). It has its own limiter (`sessionReadRateLimit`, D-009). */
const SESSION_READ_PATH = /^\/auth\/me\/?$/i;

export function isSessionRead(req: Request): boolean {
	return (req.method === 'GET' || req.method === 'HEAD') && SESSION_READ_PATH.test(req.path);
}

/**
 * Which limit refused a request, in `error.details.limite` of every 429, so a
 * client can tell "too many failed logins" from "too many requests".
 */
export type RateLimitKind = 'general' | 'publico' | 'subidas' | 'sesion' | 'ingreso' | 'registro';

export const rateLimited = (message: string, limite: RateLimitKind) => errorBody(ErrorCode.RATE_LIMITED, message, { limite });

/**
 * D-009: reading one's own session (`GET /auth/me`), per IP. The frontend
 * reads it on every protected page, so it can't share the global budget of
 * 100 per 15 minutes: a few people browsing behind one IP would block every
 * real action. Reading the session is cheap and exposes nothing else.
 * `SESSION_READ_RATE_LIMIT_MAX` per `SESSION_READ_RATE_LIMIT_WINDOW_MS`
 * (120 per minute by default). Counts every request, signed in or not.
 */
export function sessionReadRateLimit(env: Env): RequestHandler {
	return rateLimit({
		windowMs: env.sessionReadRateLimit.windowMs,
		limit: env.sessionReadRateLimit.max,
		standardHeaders: true,
		legacyHeaders: false,
		handler: (_req, res) => {
			res.status(429).json(rateLimited('Demasiadas consultas de la sesión. Intenta de nuevo en unos momentos.', 'sesion'));
		},
	});
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
			res.status(429).json(rateLimited('Demasiadas solicitudes. Intenta de nuevo más tarde.', 'publico'));
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
			res.status(429).json(rateLimited('Demasiadas subidas de imágenes. Intenta de nuevo más tarde.', 'subidas'));
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
			skip: (req) => isHealthCheck(req) || isPublicApi(req) || isSessionRead(req),
			handler: (_req, res) => {
				res.status(429).json(rateLimited('Demasiadas solicitudes. Intenta de nuevo más tarde.', 'general'));
			},
		}),
	);

	// JSON bodies only. Image uploads (T-13) have their own parser and limit
	// (middleware/upload.ts); nothing else needs more than this.
	app.use(express.json({ limit: '100kb' }));
}
