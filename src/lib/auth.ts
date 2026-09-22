import type { AuthUser, CoinBalance, LoginResponse, MeResponse, RegisterResponse } from '../types/api';
import { api, ApiError, onUnauthorized, setCsrfRefresher, setCsrfToken } from './api';

/**
 * The session as the frontend knows it (T-18), read through the backend's
 * `/auth` routes. One in-memory store shared by the route loaders (protected
 * routes) and the layout (navbar, coin counter), with a subscription for
 * `useSyncExternalStore` (`src/hooks/useSession.ts`).
 *
 * When `/auth/me` is read (D-009 in `docs/decisiones.md`):
 * - always, before a protected page shows anything (`readSession`), so a
 *   session that ended on the server is never shown as alive;
 * - on public pages, only if the copy in memory is older than
 *   `SESSION_CACHE_MS` (`cachedSession`): browsing the site doesn't spend
 *   the backend's limits;
 * - after anything that spends coins (T-19 calls `refreshSession`).
 * Any 401 from the API empties the store at once.
 */

/** How long the in-memory copy serves public pages: 60 seconds. */
export const SESSION_CACHE_MS = 60_000;

export type SessionStatus = 'unknown' | 'ready' | 'error';

export interface SessionState {
	/** `unknown` until the first read ends; `error` if the server could not be reached. */
	status: SessionStatus;
	/** `null` when nobody is signed in (or the state is still unknown). */
	user: AuthUser | null;
}

let state: SessionState = { status: 'unknown', user: null };
/** When the backend last confirmed `state.user` (ms), or `null`. */
let confirmedAt: number | null = null;
const listeners = new Set<() => void>();
let inFlight: Promise<AuthUser | null> | null = null;

const sameUser = (a: AuthUser | null, b: AuthUser | null) => a === b || (a !== null && b !== null && JSON.stringify(a) === JSON.stringify(b));

function setState(next: SessionState): void {
	if (next.status === state.status && sameUser(next.user, state.user)) return;
	// Keep the same object when nothing changed, so subscribers don't re-render for nothing.
	state = { status: next.status, user: sameUser(next.user, state.user) ? state.user : next.user };
	for (const listener of [...listeners]) listener();
}

export function getSessionState(): SessionState {
	return state;
}

export function subscribeSession(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** Replaces the known user (after login, logout or a fresh read). */
export function setSessionUser(user: AuthUser | null): void {
	if (!user) setCsrfToken(null);
	confirmedAt = Date.now();
	setState({ status: 'ready', user });
}

/**
 * Reads `/auth/me` now (one request at a time: concurrent callers share it).
 * Resolves with the user, or `null` without a session. If the server can't be
 * reached (or refuses with a 429), the last known user is kept, the status
 * becomes `error` and the promise rejects with the `ApiError`.
 */
export function refreshSession(): Promise<AuthUser | null> {
	inFlight ??= api
		.get<MeResponse>('/auth/me')
		.then(
			({ user, csrfToken }) => {
				setCsrfToken(csrfToken);
				setSessionUser(user);
				return user;
			},
			(error: unknown) => {
				if (error instanceof ApiError && error.status === 401) {
					setSessionUser(null);
					return null;
				}
				setState({ status: 'error', user: state.user });
				throw error;
			},
		)
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

/** Protected pages: always the backend's answer, never the copy in memory. */
export const readSession = refreshSession;

/** Public pages: the copy in memory while it is younger than `SESSION_CACHE_MS`, else a fresh read. */
export function cachedSession(now = Date.now()): Promise<AuthUser | null> {
	const fresh = state.status === 'ready' && confirmedAt !== null && now - confirmedAt < SESSION_CACHE_MS;
	return fresh ? Promise.resolve(state.user) : refreshSession();
}

export async function login(email: string, password: string): Promise<AuthUser> {
	const { user, csrfToken } = await api.post<LoginResponse>('/auth/login', { email, password });
	setCsrfToken(csrfToken);
	setSessionUser(user);
	return user;
}

export async function register(nombre: string, email: string, password: string): Promise<AuthUser> {
	const { user } = await api.post<RegisterResponse>('/auth/register', { nombre, email, password });
	return user;
}

/** Ends the session on the server. Already gone (401) counts as done. */
export async function logout(): Promise<void> {
	try {
		await api.post<null>('/auth/logout');
	} catch (error) {
		if (!(error instanceof ApiError && error.status === 401)) throw error;
	}
	setSessionUser(null);
}

/** `GET /monedas/saldo` (participants only), also updating the known user's balance. */
export async function refreshCoinBalance(): Promise<number> {
	const { saldoMonedas } = await api.get<CoinBalance>('/monedas/saldo');
	if (state.user && state.user.saldoMonedas !== saldoMonedas) {
		setState({ status: state.status, user: { ...state.user, saldoMonedas } });
	}
	return saldoMonedas;
}

// A 401 anywhere means the session is over; a refused CSRF token is renewed through /auth/me.
onUnauthorized(() => setSessionUser(null));
setCsrfRefresher(async () => {
	await refreshSession();
});

/** Tests only: forget everything. */
export function resetSessionForTests(): void {
	state = { status: 'unknown', user: null };
	confirmedAt = null;
	inFlight = null;
	setCsrfToken(null);
	for (const listener of [...listeners]) listener();
}
