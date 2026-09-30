import { type RefObject, useLayoutEffect } from 'react';

/** The custom properties `global.css` reads to cut the hole in the scanlines. */
export const CRT_HOLE_PROPS = ['--crt-hole-x', '--crt-hole-y', '--crt-hole-w', '--crt-hole-h'] as const;

/**
 * C-14: keeps the site's CRT scanlines (`body::after`, fixed over the whole
 * page) off an element, e.g. the Facebook player of «En vivo». The scanlines
 * paint above `<main>` (z-index 200 against its 1), and lifting the player
 * over them would also lift it over the fixed navbar; so instead the
 * scanline layer gets a mask with a hole the size of the element
 * (`body[data-crt-hole]::after` in `global.css`). The hole follows the
 * element: its viewport rectangle is written on `<body>` as custom
 * properties, again on scroll (any scroller), resize and when the element
 * changes size. Synchronously: browsers already fire scroll events at most
 * once per frame, and an animation frame never runs in a hidden tab (checked
 * in Chrome), which left the hole behind. Everything else keeps its scanlines.
 */
export function useCrtHole(ref: RefObject<HTMLElement | null>, active = true): void {
	useLayoutEffect(() => {
		const element = ref.current;
		if (!element || !active) return;
		const body = document.body;
		const update = () => {
			const r = element.getBoundingClientRect();
			body.style.setProperty('--crt-hole-x', `${r.left}px`);
			body.style.setProperty('--crt-hole-y', `${r.top}px`);
			body.style.setProperty('--crt-hole-w', `${r.width}px`);
			body.style.setProperty('--crt-hole-h', `${r.height}px`);
		};
		update();
		body.dataset.crtHole = '';
		window.addEventListener('scroll', update, { passive: true, capture: true });
		window.addEventListener('resize', update);
		const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
		observer?.observe(element);
		return () => {
			window.removeEventListener('scroll', update, { capture: true });
			window.removeEventListener('resize', update);
			observer?.disconnect();
			delete body.dataset.crtHole;
			for (const prop of CRT_HOLE_PROPS) body.style.removeProperty(prop);
		};
	}, [ref, active]);
}
