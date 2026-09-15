import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import sharp from 'sharp';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * Pre-sized, pixel-art-ready image renditions.
 *
 * `import crest from '../assets/boca.avif?pixel=crest'` resolves to an object
 * of webp renditions, one per spec in the named preset, keyed by the spec:
 *
 * - `"96"`: 96px wide, height rounded from the aspect ratio.
 * - `"32x32"`: exactly 32×32, center-cropped.
 * - `"96@2"`: the 2x density of `"96"` — both dimensions of the 1x rendition
 *   doubled, so a 96×112 crest gets 192×224, not a re-rounded 192×223.
 *
 * Components pick them with `<PixelImage />` and CSS upscales them with
 * `image-rendering: pixelated`, so artwork never ships at full size.
 *
 * The sharp pipeline mirrors the one `astro:assets` used (explicit width and
 * height, auto-rotate, no enlargement, webp at default quality), so every
 * rendition is byte-identical to what the Astro build produced.
 */

export type PixelPresets = Record<string, string[]>;

interface Rendition {
	fileName: string;
	source: Buffer;
	width: number;
	height: number;
}

const QUERY = /\?pixel=([\w-]+)$/;
const SPEC = /^(\d+)(?:x(\d+))?(?:@(\d+))?$/;
const DEV_PREFIX = '/@pixel/';

sharp.cache(false);

async function render(file: string, spec: string): Promise<Rendition> {
	const match = SPEC.exec(spec);
	if (!match) throw new Error(`pixel-images: invalid spec "${spec}" (use "96", "32x32" or "96@2")`);

	const input = await readFile(file);
	const density = Number(match[3] ?? 1);
	const baseWidth = Number(match[1]);
	let baseHeight = match[2] === undefined ? undefined : Number(match[2]);
	if (baseHeight === undefined) {
		const { width, height } = await sharp(input).metadata();
		baseHeight = Math.round(baseWidth * (height / width));
	}

	const image = sharp(input, { failOn: 'none', pages: -1 })
		.rotate()
		.resize({ width: baseWidth * density, height: baseHeight * density, withoutEnlargement: true });

	const { data, info } = await image.webp({}).toBuffer({ resolveWithObject: true });
	const hash = createHash('sha256').update(data).digest('hex').slice(0, 8);
	const name = basename(file, extname(file));
	return {
		fileName: `${name}-${info.width}x${info.height}-${hash}.webp`,
		source: data,
		width: info.width,
		height: info.height,
	};
}

export default function pixelImages(presets: PixelPresets): Plugin {
	let config: ResolvedConfig;
	/** Renders keyed by file, mtime and spec, so dev rebuilds stay fast. */
	const cache = new Map<string, Promise<Rendition>>();
	/** Dev server: URL → bytes. */
	const served = new Map<string, Buffer>();
	const emitted = new Set<string>();

	return {
		name: 'pixel-images',
		enforce: 'pre',

		configResolved(resolved) {
			config = resolved;
		},

		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const source = req.url && served.get(req.url.split('?')[0]);
				if (!source) return next();
				res.setHeader('Content-Type', 'image/webp');
				res.setHeader('Cache-Control', 'no-cache');
				res.end(source);
			});
		},

		async load(id) {
			const match = QUERY.exec(id);
			if (!match) return null;

			const file = id.slice(0, match.index);
			const specs = presets[match[1]];
			if (!specs) throw new Error(`pixel-images: unknown preset "${match[1]}" in ${id}`);

			this.addWatchFile(file);
			const { mtimeMs } = await stat(file);

			const entries = await Promise.all(
				specs.map(async (spec) => {
					const key = `${file}|${mtimeMs}|${spec}`;
					if (!cache.has(key)) cache.set(key, render(file, spec));
					const rendition = await cache.get(key)!;

					let src: string;
					if (config.command === 'build') {
						const fileName = `${config.build.assetsDir}/${rendition.fileName}`;
						if (!emitted.has(fileName)) {
							emitted.add(fileName);
							this.emitFile({ type: 'asset', fileName, source: rendition.source });
						}
						src = `${config.base}${fileName}`;
					} else {
						src = `${config.base}${DEV_PREFIX.slice(1)}${rendition.fileName}`;
						served.set(src, rendition.source);
					}

					return [spec, { src, width: rendition.width, height: rendition.height }] as const;
				}),
			);

			return `export default ${JSON.stringify(Object.fromEntries(entries))};`;
		},
	};
}
