import { useEffect, useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType, type NavigationType } from 'react-router';

/**
 * Scrolls the way the multi-page site did, now that links no longer reload:
 *
 * - A new page starts at the top, or at its `#anchor`, instantly — a page
 *   load never animated. `scroll-behavior: smooth` on `<html>` would
 *   otherwise glide there from the previous page's offset.
 * - An `#anchor` on the page already showing scrolls with the CSS behavior
 *   (smooth, or instant under reduced motion), like a same-page link.
 * - Back/Forward and reload return to where that history entry was left.
 *
 * Runs in a layout effect of the layout route, after the page (already
 * rendered with its loader data) is in the DOM and before it paints.
 */

const STORAGE_KEY = 'la-liga-acp:scroll';

/** Whether the layout has placed at least one page since the document loaded. */
let firstPagePlaced = false;

/**
 * Back/Forward inside the app, as opposed to a page landing (a link, a typed
 * URL, a reload). The browser brought such an entry back from its cache as it
 * was left, so effects that only ran on page load (like opening a card from
 * `#stats-<id>`) should not run again. Call it from a child's layout effect,
 * which runs before the layout places the page.
 */
export function isInAppHistoryTraversal(navigationType: NavigationType): boolean {
	return firstPagePlaced && navigationType === 'POP';
}

function readPositions(): Record<string, number> {
	try {
		return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
	} catch {
		return {};
	}
}

function writePositions(positions: Record<string, number>) {
	try {
		sessionStorage.setItem(STORAGE_KEY, JSON.stringify(positions));
	} catch {
		// Private mode or blocked storage: restoring on reload is a nicety.
	}
}

/** A reload or a Back/Forward into this document, not a fresh visit. */
function documentWasRestored(): boolean {
	const [entry] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
	return entry?.type === 'reload' || entry?.type === 'back_forward';
}

function hashTarget(hash: string): HTMLElement | null {
	if (!hash) return null;
	try {
		return document.getElementById(decodeURIComponent(hash.slice(1)));
	} catch {
		return null;
	}
}

export function useScrollManagement() {
	const location = useLocation();
	const navigationType = useNavigationType();
	const positions = useRef<Record<string, number> | null>(null);
	const current = useRef<{ key: string; pathname: string } | null>(null);

	// The browser would restore before the new route has rendered.
	useEffect(() => {
		const previous = history.scrollRestoration;
		history.scrollRestoration = 'manual';
		return () => {
			history.scrollRestoration = previous;
		};
	}, []);

	// Remember the offset of whichever entry is showing.
	useEffect(() => {
		positions.current ??= readPositions();
		let frame = 0;
		const save = () => {
			frame = 0;
			if (!current.current || !positions.current) return;
			positions.current[current.current.key] = window.scrollY;
			writePositions(positions.current);
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(save);
		};
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('pagehide', save);
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('pagehide', save);
		};
	}, []);

	useLayoutEffect(() => {
		positions.current ??= readPositions();
		const previous = current.current;
		// Same history entry (StrictMode re-running the effect): already placed.
		if (previous?.key === location.key) return;
		current.current = { key: location.key, pathname: location.pathname };
		firstPagePlaced = true;

		const samePage = previous !== null && previous.pathname === location.pathname;
		const saved = positions.current[location.key];
		const target = hashTarget(location.hash);
		// A player's card the page opened from the hash (`#stats-<id>`). It is
		// opened in a child layout effect, so it is already showing here.
		const openCard = target instanceof HTMLDialogElement && target.open ? target : null;

		// Back/Forward within the app, or the first render after a reload.
		const restoring = previous === null ? documentWasRestored() : navigationType === 'POP';
		if (restoring) {
			// Reloaded with the card in the hash: it reopened, and opening it moved
			// the page to its focused close button. That wins over the old offset.
			if (openCard) return;
			if (saved !== undefined) {
				window.scrollTo({ top: saved, left: 0, behavior: 'instant' });
				return;
			}
		}

		// Landing on the card: a page load scrolled the document to it once it
		// was shown, with the CSS behavior and `scroll-padding-top`. On a tall
		// screen the page moves and the card ends up just under the navbar; on a
		// phone there is nothing to scroll. Like the browser, it waits for the
		// fonts: the card re-centers by half a pixel once they load, and
		// scrolling earlier would land a pixel off.
		if (openCard) {
			const card = openCard;
			if (!samePage) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
			const key = location.key;
			document.fonts.ready.then(() => {
				if (current.current?.key === key && card.open) card.scrollIntoView();
			});
			return;
		}

		if (target) {
			if (samePage) target.scrollIntoView();
			else target.scrollIntoView({ behavior: 'instant' });
			return;
		}

		if (!samePage || !location.hash) {
			window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
		}
	}, [location.key, location.pathname, location.hash, navigationType]);
}
