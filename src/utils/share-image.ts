import { toBlob } from 'html-to-image';

/**
 * Captures an on-screen element as a PNG, exactly as it is styled.
 *
 * Runs in the browser. The element is copied out of the page flow (no
 * margin, no scroll clipping) and laid on the page background with a gutter,
 * so its outer pixel border is not cut off. Anything marked
 * `data-capture-exclude` (close and share buttons) is left out.
 */

/** Room around the element; wider than the `--px` notched border. */
const GUTTER = 16;

const isWebKit = /apple/i.test(navigator.vendor);

export async function captureElement(element: HTMLElement): Promise<Blob> {
	await Promise.all([
		document.fonts.ready,
		...[...element.querySelectorAll('img')].map((img) => img.decode().catch(() => {})),
	]);

	const width = element.offsetWidth;
	// The dialog scrolls on short screens; the image shows all of it, minus
	// the excluded blocks at its bottom edge.
	const excluded = [...element.children]
		.filter((child): child is HTMLElement => child instanceof HTMLElement && child.hasAttribute('data-capture-exclude'))
		.reduce((sum, child) => {
			const style = getComputedStyle(child);
			return sum + child.offsetHeight + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
		}, 0);
	const height = element.scrollHeight - excluded;

	const options = {
		width: width + GUTTER * 2,
		height: height + GUTTER * 2,
		// Whole-number upscale keeps pixel art on the pixel grid.
		pixelRatio: 3,
		backgroundColor: getComputedStyle(document.body).backgroundColor,
		style: {
			margin: `${GUTTER}px`,
			position: 'static',
			inset: 'auto',
			transform: 'none',
			width: `${width}px`,
			height: `${height}px`,
			maxWidth: 'none',
			maxHeight: 'none',
			overflow: 'visible',
		},
		filter: (node: Node) => !(node instanceof HTMLElement && node.hasAttribute('data-capture-exclude')),
	};

	// Safari often paints images and fonts only on the second pass.
	if (isWebKit) await toBlob(element, options);

	const blob = await toBlob(element, options);
	if (!blob) throw new Error('No se pudo generar la imagen');
	return blob;
}
