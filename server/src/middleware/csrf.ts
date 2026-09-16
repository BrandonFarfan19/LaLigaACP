import type { RequestHandler } from 'express';
import type { Env } from '../config/env.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { readSessionCookie } from '../lib/session-cookie.js';
import { csrfTokenFor, safeEqual } from '../lib/tokens.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Routes that open a session: there is no token yet to send. Covered by the Origin check and SameSite=Strict. */
const NO_TOKEN_PATHS = /^\/auth\/(login|register)\/?$/i;

export const CSRF_HEADER = 'x-csrf-token';

/**
 * CSRF protection for every state-changing request (NFR-005), no database
 * access needed:
 *
 * 1. A browser request whose `Origin` isn't the frontend's is rejected. This
 *    also blocks login CSRF on `/auth/login`. Clients that send no `Origin`
 *    (curl, server-to-server) don't carry the victim's cookie anyway.
 * 2. If the request carries a session cookie, the `X-CSRF-Token` header must
 *    equal `csrfTokenFor(cookie)`. The frontend gets that value from the
 *    login and `/auth/me` responses; a cross-site page can't read either.
 */
export function csrfProtection(env: Env): RequestHandler {
	return (req, _res, next) => {
		if (SAFE_METHODS.has(req.method)) return next();

		const origin = req.headers.origin;
		if (origin !== undefined && origin !== env.corsOrigin) {
			throw HttpError.forbidden('Origen no permitido.', ErrorCode.CSRF_FAILED);
		}

		const sessionToken = readSessionCookie(req, env);
		if (sessionToken && !NO_TOKEN_PATHS.test(req.path)) {
			const sent = req.get(CSRF_HEADER);
			if (!sent || !safeEqual(sent, csrfTokenFor(sessionToken, env.session.secret))) {
				throw HttpError.forbidden('Token CSRF ausente o inválido.', ErrorCode.CSRF_FAILED);
			}
		}
		next();
	};
}
