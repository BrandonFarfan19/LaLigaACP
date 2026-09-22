import type { ImgHTMLAttributes } from 'react';
import type { ImageRendition, PixelImageSet } from '../types';

/**
 * The `<Image />` of this app: renders a small pre-built rendition that CSS
 * upscales with `.pixelated`. Same contract `astro:assets` had — `width`
 * (and optionally `height` for a crop) pick the 1x file, `densities` add the
 * `srcset`, and `width`/`height` attributes come from the real file.
 *
 * The rendition must exist in the image's preset (`vite.config.ts`); asking
 * for one that doesn't throws, so nothing silently ships at full size.
 */
interface Props extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'srcSet' | 'width' | 'height'> {
	image: PixelImageSet;
	width: number;
	/** Set it to crop to an exact box (center crop). Omit to keep the aspect ratio. */
	height?: number;
	densities?: number[];
}

function pick(image: PixelImageSet, spec: string): ImageRendition {
	const rendition = image[spec];
	if (!rendition) {
		throw new Error(`PixelImage: no "${spec}" rendition. Add it to the image's preset in vite.config.ts.`);
	}
	return rendition;
}

export default function PixelImage({ image, width, height, densities = [], ...attributes }: Props) {
	const spec = height === undefined ? `${width}` : `${width}x${height}`;
	const base = pick(image, spec);
	const srcSet = densities.map((density) => `${pick(image, `${spec}@${density}`).src} ${density}x`).join(', ');

	return (
		<img
			src={base.src}
			srcSet={srcSet || undefined}
			decoding="async"
			width={base.width}
			height={base.height}
			{...attributes}
		/>
	);
}
