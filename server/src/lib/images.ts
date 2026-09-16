import sharp, { type Metadata } from 'sharp';

// Predictable memory for untrusted uploads: no decoded-image cache, one libvips thread per image.
sharp.cache(false);
sharp.concurrency(1);

/**
 * How many images are decoded at once in this process. sharp.concurrency
 * only limits the threads of one image; libuv would still decode several
 * uploads side by side, each up to `UPLOAD_MAX_PIXELS` (about 4 bytes per
 * pixel). The rest wait in line, in arrival order.
 */
export const MAX_IMAGENES_EN_PROCESO = 1;

let running = 0;
const waiting: Array<() => void> = [];

/** Runs `task` when a processing slot is free (a small FIFO semaphore). */
export async function inImageQueue<T>(task: () => Promise<T>): Promise<T> {
	if (running >= MAX_IMAGENES_EN_PROCESO) {
		await new Promise<void>((resolve) => waiting.push(resolve));
	} else {
		running++;
	}
	try {
		return await task();
	} finally {
		const next = waiting.shift();
		// The slot passes straight to the next waiter, so `running` stays the same.
		if (next) next();
		else running--;
	}
}

/**
 * Uploaded images (T-13, BR-033, NFR-005). Nothing a client sends is kept as
 * is: the type is decided by the file's first bytes (never by its name or its
 * Content-Type), only common raster formats get in (never SVG: sharp could
 * render it, so it is refused before sharp sees it), and what is stored is a
 * fresh WebP encoded by sharp, at most `IMAGE_MAX_SIDE` pixels per side and
 * with no metadata (EXIF, GPS, ICC comments...).
 */

export const ACCEPTED_FORMATS = ['jpeg', 'png', 'webp', 'gif'] as const;
export type AcceptedFormat = (typeof ACCEPTED_FORMATS)[number];

/** Longest side of a stored image, in pixels. */
export const IMAGE_MAX_SIDE = 1600;
const WEBP_QUALITY = 82;
/** A decode taking longer than this is given up (a hostile file). */
const PROCESSING_TIMEOUT_SECONDS = 15;

const startsWith = (buf: Buffer, bytes: number[], offset = 0) => bytes.every((byte, i) => buf[offset + i] === byte);
const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));

/** The format by magic bytes, or `null` if it isn't one of the accepted ones. */
export function sniffImageFormat(buf: Buffer): AcceptedFormat | null {
	if (buf.length < 12) return null;
	if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'jpeg';
	if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
	if (startsWith(buf, ascii('GIF87a')) || startsWith(buf, ascii('GIF89a'))) return 'gif';
	if (startsWith(buf, ascii('RIFF')) && startsWith(buf, ascii('WEBP'), 8)) return 'webp';
	return null;
}

export class ImageRejected extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageRejected';
	}
}

/**
 * Checks and re-encodes an uploaded image. Throws `ImageRejected` (a client
 * error) for anything that isn't a readable JPEG, PNG, WebP or GIF within
 * `maxPixels`; an animated GIF or WebP keeps its first frame. One image at a
 * time per process (`inImageQueue`).
 */
export function toSafeWebp(buf: Buffer, maxPixels: number): Promise<Buffer> {
	return inImageQueue(() => reencode(buf, maxPixels));
}

async function reencode(buf: Buffer, maxPixels: number): Promise<Buffer> {
	if (buf.length === 0) throw new ImageRejected('El archivo está vacío.');
	const sniffed = sniffImageFormat(buf);
	if (!sniffed) throw new ImageRejected('El archivo no es una imagen JPEG, PNG, WebP o GIF.');

	const input = () => sharp(buf, { limitInputPixels: maxPixels, failOn: 'error', animated: false, sequentialRead: true });
	const tooLarge = () => new ImageRejected(`La imagen es demasiado grande: como máximo ${maxPixels} píxeles (ancho × alto).`);
	// sharp's own message when limitInputPixels stops it.
	const isPixelLimit = (error: unknown) => error instanceof Error && /pixel limit/i.test(error.message);
	let metadata: Metadata;
	try {
		metadata = await input().metadata();
	} catch (error) {
		throw isPixelLimit(error) ? tooLarge() : new ImageRejected('La imagen está dañada o no se puede leer.');
	}
	if (metadata.format !== sniffed) throw new ImageRejected('El contenido del archivo no coincide con un formato de imagen aceptado.');
	if (!metadata.width || !metadata.height) throw new ImageRejected('La imagen no tiene dimensiones válidas.');
	if (metadata.width * metadata.height > maxPixels) throw tooLarge();

	try {
		return await input()
			.timeout({ seconds: PROCESSING_TIMEOUT_SECONDS })
			.rotate() // apply the EXIF orientation before the metadata is dropped
			.resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer();
	} catch {
		throw new ImageRejected('La imagen está dañada o no se puede procesar.');
	}
}
