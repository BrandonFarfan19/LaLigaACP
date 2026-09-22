import { parseCookie } from 'cookie';
import type { CookieOptions, Request, Response } from 'express';
import type { Env } from '../config/env.js';

/**
 * The session cookie (NFR-005): httpOnly (no script can read it), Secure in
 * production, SameSite=Strict (never sent on a request started by another
 * site; the dev front on localhost:5173 and the API on :3001 are the same
 * site), Path=/ and an absolute expiry that matches `sesion.expira_en`.
 */
function cookieOptions(env: Env): CookieOptions {
	return { httpOnly: true, secure: env.session.secureCookie, sameSite: 'strict', path: '/' };
}

export function readSessionCookie(req: Request, env: Env): string | undefined {
	const header = req.headers.cookie;
	if (!header) return undefined;
	const value = parseCookie(header)[env.session.cookieName];
	return value ? value : undefined;
}

export function setSessionCookie(res: Response, env: Env, token: string, expiresAt: Date): void {
	res.cookie(env.session.cookieName, token, { ...cookieOptions(env), expires: expiresAt });
}

export function clearSessionCookie(res: Response, env: Env): void {
	res.clearCookie(env.session.cookieName, cookieOptions(env));
}
