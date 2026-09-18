/**
 * The `?next=` of `/ingresar`: where to go after signing in. It comes from
 * the page's URL, so anyone can craft it. Only a path inside this app is
 * accepted; anything else (another host, `//host`, `\\host`, `javascript:`,
 * control characters, the auth pages themselves) falls back to `fallback`.
 * It is only used for in-app navigation: never sent to the API.
 *
 * Both the raw text and the result are checked (T-18 fix): the URL parser
 * resolves dot segments, so `/.//evil.test` or `/%2e%2e//evil.test` become
 * `//evil.test`, which React Router follows as an absolute URL. A result that
 * starts with two slashes, a backslash or a scheme is refused.
 */

const BASE = 'http://app.invalid';
const MAX_LENGTH = 2048;
/** Going back to these after signing in makes no sense (and could loop). */
const AUTH_PAGES = ['/ingresar', '/registro'];
/** What React Router (and browsers) treat as leaving the site: a scheme, or `//`. */
const ABSOLUTE = /^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i;

function isInAppPath(path: string): boolean {
	// Root-relative only: not `//host`, not `/\host` (browsers read `\` as `/`).
	if (!path.startsWith('/') || ABSOLUTE.test(path) || path.includes('\\')) return false;
	// Tabs and newlines are dropped by the URL parser, which could turn `/\t/host` into `//host`.
	return !/[\u0000-\u001F\u007F\s]/.test(path);
}

export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
	if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_LENGTH || !isInAppPath(raw)) return fallback;

	let url: URL;
	try {
		url = new URL(raw, BASE);
	} catch {
		return fallback;
	}
	if (url.origin !== BASE) return fallback;
	// Never an empty segment: `/a//b` is suspicious and `//host` leaves the site.
	if (url.pathname.includes('//')) return fallback;
	const path = url.pathname.replace(/\/+$/, '') || '/';
	if (AUTH_PAGES.includes(path)) return fallback;

	const result = `${url.pathname}${url.search}${url.hash}`;
	// The normalized result must pass the same checks, and resolve to itself.
	if (!isInAppPath(result)) return fallback;
	try {
		const again = new URL(result, BASE);
		if (again.origin !== BASE || `${again.pathname}${again.search}${again.hash}` !== result) return fallback;
	} catch {
		return fallback;
	}
	return result;
}

/** `/ingresar?next=<current page>`, for a protected route that needs a session. */
export function loginPathFor(next: string): string {
	const safe = safeNextPath(next, '');
	return safe && safe !== '/' ? `/ingresar?next=${encodeURIComponent(safe)}` : '/ingresar';
}

/** A link click this app would follow, as a path of its own; `null` for anything else. */
export function inAppHref(href: string | null | undefined, from: string): string | null {
	if (typeof href !== 'string' || href === '') return null;
	let url: URL;
	try {
		url = new URL(href, from);
	} catch {
		return null;
	}
	const origin = (() => {
		try {
			return new URL(from).origin;
		} catch {
			return null;
		}
	})();
	if (origin === null || url.origin !== origin) return null;
	const path = `${url.pathname}${url.search}${url.hash}`;
	// The same rules as `?next=`: an in-app path and nothing that leaves the site.
	return safeNextPath(path, '') || null;
}
