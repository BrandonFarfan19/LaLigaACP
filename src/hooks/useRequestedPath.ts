import { useCallback, useEffect } from 'react';
import { type NavigateOptions, type To, useNavigate, useNavigation } from 'react-router';
import { inAppHref } from '../lib/next-path';

/**
 * Where the user is going right now, for the redirect to sign in when the
 * session turns out to be gone (T-21 fixes). Every way of asking for a page
 * records its destination the moment it is asked for, in one place:
 *
 * - a link, through the click on it (captured on `document`);
 * - a page's own navigation (a filter, "Quitar filtros", the page URL a list
 *   replaces), through `useRememberedNavigate`, which every screen uses
 *   instead of `useNavigate` for those;
 * - and, while it lasts, the navigation React Router already has in flight,
 *   which is the most reliable of the three.
 *
 * Without this the redirect used the URL still on screen, so the filter or the
 * page just asked for was lost from `?next=`. Only a path of this app counts
 * (`inAppHref`, the same rules as `?next=`), and only for a moment: an older
 * one is no longer where the user is going.
 */

/** How long a recorded destination still says where the user was going. */
export const CLICK_WINDOW_MS = 2000;

export interface ClickedLink {
	path: string;
	at: number;
}

interface PendingLocation {
	pathname: string;
	search: string;
	hash: string;
}

/** The last destination asked for, however it was asked for. */
let requested: ClickedLink | null = null;

/** Records where a navigation is going, if it is a path of this app. */
export function rememberRequested(to: string, now = Date.now()): void {
	const path = inAppHref(to, window.location.href);
	if (path) requested = { path, at: now };
}

/** For tests: forgets what was recorded, and reads it back. */
export function forgetRequested(): void {
	requested = null;
}

export const requestedForTest = (): ClickedLink | null => requested;

/** The rule: the navigation in flight, then what was just asked for, then what is on screen. */
export function pendingPath(current: string, going: PendingLocation | null | undefined, clicked: ClickedLink | null, now: number): string {
	if (going) return `${going.pathname}${going.search}${going.hash}`;
	const since = clicked ? now - clicked.at : Infinity;
	return clicked && since >= 0 && since <= CLICK_WINDOW_MS ? clicked.path : current;
}

/** A plain left click that the router would take over (no new tab, no download). */
function followedLink(event: MouseEvent): HTMLAnchorElement | null {
	if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
	const target = event.target;
	const anchor = target instanceof Element ? target.closest('a[href]') : null;
	if (!(anchor instanceof HTMLAnchorElement) || anchor.hasAttribute('download')) return null;
	const where = anchor.getAttribute('target');
	return !where || where === '_self' ? anchor : null;
}

/**
 * `useNavigate` that first records where it is going, so a session found gone
 * on the way still signs in with the page that was asked for. Pages use it for
 * filters and for the page URL they replace; links are recorded on their own.
 */
export function useRememberedNavigate(): (to: To, options?: NavigateOptions) => void {
	const navigate = useNavigate();
	return useCallback(
		(to: To, options?: NavigateOptions) => {
			if (typeof to === 'string') rememberRequested(to);
			void navigate(to, options);
		},
		[navigate],
	);
}

export function useRequestedPath(current: string): () => string {
	const navigation = useNavigation();

	useEffect(() => {
		// A fresh app has nothing pending: never inherit a destination from before.
		forgetRequested();
		const onClick = (event: MouseEvent) => {
			const anchor = followedLink(event);
			if (anchor) rememberRequested(anchor.getAttribute('href') ?? '');
		};
		// Captured, so it is recorded even if the router stops the event on its way down.
		document.addEventListener('click', onClick, true);
		return () => document.removeEventListener('click', onClick, true);
	}, []);

	// Once that page is on screen it is no longer "where the user is going".
	useEffect(() => {
		if (requested?.path === current) forgetRequested();
	}, [current]);

	return useCallback(() => pendingPath(current, navigation.location, requested, Date.now()), [current, navigation.location]);
}
