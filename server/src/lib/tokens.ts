import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256 random bits, URL-safe: the value of the session cookie. */
export function newSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

/** What `sesion.token_hash` stores: the token itself never reaches the database. */
export function hashSessionToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/**
 * CSRF token bound to one session (OWASP's signed double-submit pattern):
 * HMAC of the session token with `SESSION_SECRET`. A cross-site page can make
 * the browser send the cookie, but can't read it or compute this value.
 */
export function csrfTokenFor(sessionToken: string, secret: string): string {
	return createHmac('sha256', secret).update(`csrf:${sessionToken}`).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}
