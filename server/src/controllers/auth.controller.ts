import type { RequestHandler } from 'express';
import type { Pool } from 'mysql2/promise';
import type { Env } from '../config/env.js';
import { sendSuccess } from '../lib/response.js';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '../lib/session-cookie.js';
import { csrfTokenFor } from '../lib/tokens.js';
import { authUser } from '../middleware/auth.js';
import { loginSchema, registerSchema } from '../schemas/auth.schema.js';
import * as auth from '../services/auth.service.js';

/**
 * `/auth` handlers. Responses carry the user (never the hash) and, once there
 * is a session, the `csrfToken` the frontend must echo in `X-CSRF-Token` on
 * every state-changing request.
 */
export function createAuthController(pool: Pool, env: Env) {
	const register: RequestHandler = async (req, res) => {
		const user = await auth.register(pool, registerSchema.parse(req.body));
		sendSuccess(res, { user }, 201);
	};

	const login: RequestHandler = async (req, res) => {
		const { user, session } = await auth.login(pool, loginSchema.parse(req.body), {
			ttlMs: env.session.ttlMs,
			replacedToken: readSessionCookie(req, env),
		});
		setSessionCookie(res, env, session.token, session.expiresAt);
		sendSuccess(res, {
			user,
			csrfToken: csrfTokenFor(session.token, env.session.secret),
			expiraEn: session.expiresAt,
		});
	};

	const me: RequestHandler = (req, res) => {
		sendSuccess(res, {
			user: authUser(req),
			csrfToken: csrfTokenFor(req.auth!.sessionToken, env.session.secret),
		});
	};

	const logout: RequestHandler = async (req, res) => {
		await auth.logout(pool, req.auth!.sessionToken);
		clearSessionCookie(res, env);
		sendSuccess(res, null);
	};

	return { register, login, me, logout };
}
