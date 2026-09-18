import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { Env } from '../config/env.js';
import { rateLimited } from './security.js';

/**
 * Limits specific to `/auth`, stricter than the global one. Both key on
 * `req.ip`, which is the socket's address unless `TRUST_PROXY` says which
 * proxies may report the real client (app.ts).
 */

/**
 * Login (BR-004): at most `LOGIN_RATE_LIMIT_MAX` failed attempts per window.
 * Successful logins don't count. The key is IP + email: guessing one
 * account's password is capped, while other people behind the same IP (an
 * office, a NAT) can still log in — spraying many emails from one IP is still
 * bound by the global limit.
 */
export function loginRateLimit(env: Env): RequestHandler {
	return rateLimit({
		windowMs: env.loginRateLimit.windowMs,
		limit: env.loginRateLimit.max,
		skipSuccessfulRequests: true,
		standardHeaders: true,
		legacyHeaders: false,
		keyGenerator: (req) => {
			const body: unknown = req.body;
			const email = typeof body === 'object' && body !== null ? (body as { email?: unknown }).email : undefined;
			const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
			return `${ipKeyGenerator(req.ip ?? '')}|${normalized}`;
		},
		handler: (_req, res) => {
			res
				.status(429)
				.json(rateLimited('Demasiados intentos de inicio de sesión. Intenta de nuevo más tarde.', 'ingreso'));
		},
	});
}

/**
 * Registration (BR-003): at most `REGISTER_RATE_LIMIT_MAX` attempts per IP per
 * window, successful or not. Caps mass account creation and probing which
 * emails exist through the 409 `EMAIL_TAKEN` answer.
 */
export function registerRateLimit(env: Env): RequestHandler {
	return rateLimit({
		windowMs: env.registerRateLimit.windowMs,
		limit: env.registerRateLimit.max,
		standardHeaders: true,
		legacyHeaders: false,
		handler: (_req, res) => {
			res
				.status(429)
				.json(rateLimited('Demasiados registros desde esta conexión. Intenta de nuevo más tarde.', 'registro'));
		},
	});
}
