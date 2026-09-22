import { cleanup, configure } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
import { resetSessionForTests } from '../lib/auth';

// Page tests render the whole router and wait for its loaders: on a busy machine the
// default 1 s of findBy/waitFor was not always enough (T-20). A real failure still fails.
configure({ asyncUtilTimeout: 5000 });

// jsdom doesn't scroll; the layout's scroll management calls it on every page.
window.scrollTo = (() => undefined) as typeof window.scrollTo;

// jsdom has no media queries either; the carousel asks for `prefers-reduced-motion` (T-22).
window.matchMedia =
	window.matchMedia ??
	((query: string) =>
		({
			matches: false,
			media: query,
			onchange: null,
			addEventListener: () => undefined,
			removeEventListener: () => undefined,
			addListener: () => undefined,
			removeListener: () => undefined,
			dispatchEvent: () => false,
		}) as unknown as MediaQueryList);

// jsdom knows `<dialog>` but not how to open it; the player's card is a modal dialog (T-22).
if (!HTMLDialogElement.prototype.showModal) {
	HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
		this.open = true;
	};
	HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
		this.open = false;
		this.dispatchEvent(new Event('close'));
	};
}

// The carousel watches its slides; jsdom has no IntersectionObserver.
window.IntersectionObserver =
	window.IntersectionObserver ??
	(class {
		observe() {}
		unobserve() {}
		disconnect() {}
		takeRecords() {
			return [];
		}
		root = null;
		rootMargin = '';
		thresholds = [];
	} as unknown as typeof IntersectionObserver);

// Vitest runs without globals, so Testing Library can't clean up by itself.
afterEach(() => {
	cleanup();
	resetSessionForTests();
	vi.unstubAllGlobals();
});
