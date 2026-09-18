import { data, redirect, type LoaderFunctionArgs } from 'react-router';
import type { AuthUser, UserRole } from '../types/api';
import { type ApiError, isTransientError } from './api';
import { getSessionState, readSession } from './auth';
import { loginPathFor, safeNextPath } from './next-path';

/**
 * Route loaders that protect pages (T-18). They only decide what the page
 * may show: the backend checks the session and the role again on every
 * request (NFR-005), so these are a convenience, never the barrier.
 */

/** Pages that need a session. Leaving the session on one of them sends to sign in. */
const PROTECTED_PREFIXES = ['/cuenta', '/admin', '/apuestas', '/mis-apuestas', '/ranking'];

export function isProtectedPath(pathname: string): boolean {
	return PROTECTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

const pathOf = (request: Request) => {
	const url = new URL(request.url);
	return `${url.pathname}${url.search}`;
};

/**
 * Needs a session, read from the backend right now (D-009: never the copy in
 * memory, so a session that ended is never shown as alive). Without one,
 * `/ingresar?next=<this page>`. Resolves with the user.
 */
export async function requireUser({ request }: LoaderFunctionArgs): Promise<AuthUser> {
	const user = await readSession();
	if (!user) throw redirect(loginPathFor(pathOf(request)));
	return user;
}

/** What a 403 from `requireRole` carries: the role the page needs. */
export interface RoleRequired {
	role: UserRole;
}

/** Needs a session with exactly that role (roles don't include each other). Otherwise a 403 page. */
export function requireRole(role: UserRole) {
	return async (args: LoaderFunctionArgs): Promise<AuthUser> => {
		const user = await requireUser(args);
		if (user.rol !== role) throw data<RoleRequired>({ role }, { status: 403 });
		return user;
	};
}

/** What `requireKnownUser` resolves with: the user, and why the session couldn't be checked now (or `null`). */
export interface PageUser {
	user: AuthUser;
	sessionError: ApiError | null;
}

/**
 * For a page that stays on screen when a reload fails (T-20 fix): like
 * `requireUser` (or `requireRole(role)`), but when the session can't be
 * checked right now (no connection, the server down, a 429) and this tab
 * already knows a user of that role (the state is unknown, not signed out,
 * as in the session bar), it resolves with that user and the error, so the
 * page keeps what it shows with its notice and "Reintentar". Without a known
 * user (a first visit) the error goes to the error page. No session (401)
 * still sends to sign in, and another role still gets the 403. The backend
 * checks the session again on every request anyway.
 */
export async function requireKnownUser(args: LoaderFunctionArgs, role?: UserRole): Promise<PageUser> {
	try {
		const user = role ? await requireRole(role)(args) : await requireUser(args);
		return { user, sessionError: null };
	} catch (error) {
		const known = getSessionState().user;
		if (!isTransientError(error) || !known || (role && known.rol !== role)) throw error;
		return { user: known, sessionError: error };
	}
}

/**
 * Where a signed-in user lands when `next` says nothing (D-008): a validated
 * participant goes to bet, a pending one to their account (which says why
 * they can't bet yet), an admin to administration.
 */
export function homeFor(user: AuthUser): string {
	if (user.rol === 'admin') return '/admin';
	return user.estadoValidacion === 'validado' ? '/apuestas' : '/cuenta';
}

/**
 * The sign-in and sign-up pages: someone already signed in goes on to `next`
 * (or their area). Read fresh too: a stale copy would send someone whose
 * session ended away from the sign-in page.
 */
export async function guestOnly({ request }: LoaderFunctionArgs): Promise<null> {
	const user = await readSession().catch(() => null);
	if (user) throw redirect(safeNextPath(new URL(request.url).searchParams.get('next'), homeFor(user)));
	return null;
}
