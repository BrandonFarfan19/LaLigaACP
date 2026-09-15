/// <reference types="vite/client" />

/*
 * `?pixel=<preset>` imports resolve to pre-sized webp renditions (see
 * `vite-plugins/pixel-images.ts`). One declaration per preset in `vite.config.ts`.
 */

declare module '*?pixel=crest' {
	const image: import('./types').PixelImageSet;
	export default image;
}

declare module '*?pixel=logo' {
	const image: import('./types').PixelImageSet;
	export default image;
}

declare module '*?pixel=backdrop-landscape' {
	const image: import('./types').PixelImageSet;
	export default image;
}

declare module '*?pixel=backdrop-portrait' {
	const image: import('./types').PixelImageSet;
	export default image;
}

declare module '*?pixel=pitch' {
	const image: import('./types').PixelImageSet;
	export default image;
}

declare module '*?pixel=portrait' {
	const image: import('./types').PixelImageSet;
	export default image;
}
