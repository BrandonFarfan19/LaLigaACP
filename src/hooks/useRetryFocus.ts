import { useEffect, useRef } from 'react';
import { useRevalidator } from 'react-router';

/**
 * "Reintentar" on a page that reloads in place (T-20, shared since the C-07
 * fix): it reads the page's loaders again without a new location, so the
 * page's own arrival focus never runs. This follows the retry instead: when
 * other loader data arrives, `onLoaded` runs if it loaded (the page moves the
 * focus to its results and announces them) and nothing happens if it failed
 * again (the focus stays on the button, inside the notice that is still
 * there). `busy` is for the button's `aria-disabled` (never `disabled`: it
 * would drop the focus).
 */
export function useRetryFocus<T>(data: T, loaded: (data: T) => boolean, onLoaded: () => void): { retry: () => void; busy: boolean } {
	const revalidator = useRevalidator();
	const busy = revalidator.state !== 'idle';
	// The loader data the retry started from: the retry is over when other data arrives.
	const retriedFrom = useRef<T | null>(null);
	useEffect(() => {
		if (retriedFrom.current === null || data === retriedFrom.current) return;
		retriedFrom.current = null;
		if (loaded(data)) onLoaded();
	}, [data]);
	const retry = () => {
		if (busy) return;
		retriedFrom.current = data;
		void revalidator.revalidate();
	};
	return { retry, busy };
}
