import type { Request, RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Env } from '../config/env.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { readSessionCookie } from '../lib/session-cookie.js';
import { findSessionUser } from '../services/session.service.js';
import type { PublicUser, RolCodigo } from '../services/users.service.js';

/**
 * Route protection (BR-001, BR-002, BR-005, NFR-005). Chain them in this
 * order: `requireAuth` loads the session (401 without one), then
 * `requireRole` / `requireBettor` decide on what it loaded (403).
 *
 *   router.use(requireAuth, requireRole('admin'))
 *   router.post('/tickets', requireAuth, requireBettor, handler)   // T-09
 */
export function createRequireAuth(pool: Pool, env: Env): RequestHandler {
	return async (req, _res, next) => {
		if (req.auth) return next();

		const token = readSessionCookie(req, env);
		const user = token ? await findSessionUser(pool, token) : null;
		if (!token || !user) throw HttpError.unauthenticated();

		req.auth = { user, sessionToken: token };
		next();
	};
}

/** The user `requireAuth` loaded. Throws 401 if a route forgot to put `requireAuth` first. */
export function authUser(req: Request): PublicUser {
	if (!req.auth) throw HttpError.unauthenticated();
	return req.auth.user;
}

/** Exactly that role. Roles don't include each other: an admin is not an `apostador` (BR-001, BR-002). */
export function requireRole(role: RolCodigo): RequestHandler {
	return (req, _res, next) => {
		const user = authUser(req);
		if (user.rol !== role) throw HttpError.forbidden();
		next();
	};
}

/**
 * Guard for the user's own pool data (balance, movements, later their bets
 * and points): only an `apostador`, validated or not. An admin gets 403
 * `NOT_A_PARTICIPANT` rather than an empty answer: admins have no coins
 * (BR-001), and a "0" would let the frontend show them a coin counter.
 */
export const requireParticipant: RequestHandler = (req, _res, next) => {
	if (authUser(req).rol !== 'apostador') {
		throw HttpError.forbidden(
			'Los administradores no participan en la polla: no tienen monedas ni apuestas.',
			ErrorCode.NOT_A_PARTICIPANT,
		);
	}
	next();
};

/**
 * Guard for every betting route (T-09 on). Only a **validated `apostador`**
 * passes:
 *
 * - An admin never bets, whatever its state in the database says (BR-001):
 *   403 `ADMIN_CANNOT_BET`. Whoever loads results must not have bets riding
 *   on them.
 * - A `pendiente` user can log in and browse, but not bet (BR-005): 403
 *   `USER_NOT_VALIDATED`.
 */
export const requireBettor: RequestHandler = (req, _res, next) => {
	const user = authUser(req);
	if (user.rol !== 'apostador') {
		throw HttpError.forbidden('Los administradores no participan en la polla: no pueden apostar.', ErrorCode.ADMIN_CANNOT_BET);
	}
	if (user.estadoValidacion !== 'validado') {
		throw HttpError.forbidden(
			'Tu cuenta todavía no está validada: un administrador tiene que confirmar tu pago.',
			ErrorCode.USER_NOT_VALIDATED,
		);
	}
	next();
};
