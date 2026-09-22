import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { ImageRejected, IMAGE_MAX_SIDE, inImageQueue, MAX_IMAGENES_EN_PROCESO, sniffImageFormat, toSafeWebp } from '../src/lib/images.js';
import { parseVideoUrl, VIDEO_HOSTS } from '../src/lib/video-links.js';

const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#c00020' } });

describe('uploaded images (T-13)', () => {
	it('sniffs the four accepted formats by content, and nothing else', async () => {
		expect(sniffImageFormat(await solid(4, 4).jpeg().toBuffer())).toBe('jpeg');
		expect(sniffImageFormat(await solid(4, 4).png().toBuffer())).toBe('png');
		expect(sniffImageFormat(await solid(4, 4).webp().toBuffer())).toBe('webp');
		expect(sniffImageFormat(await solid(4, 4).gif().toBuffer())).toBe('gif');
		for (const text of [
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
			'<!doctype html><html><body>hola</body></html>',
			'%PDF-1.7 aaaaaaaaaaaa',
			'hola, no soy una imagen',
			'',
		]) {
			expect(sniffImageFormat(Buffer.from(text)), text).toBeNull();
		}
		expect(sniffImageFormat(await solid(4, 4).tiff().toBuffer())).toBeNull();
	});

	it('decodes one image at a time, in arrival order; a failure frees the slot', async () => {
		expect(MAX_IMAGENES_EN_PROCESO).toBe(1);
		let active = 0;
		let peak = 0;
		const order: number[] = [];
		const task = (n: number, fail = false) =>
			inImageQueue(async () => {
				active++;
				peak = Math.max(peak, active);
				await new Promise((resolve) => setTimeout(resolve, 15));
				order.push(n);
				active--;
				if (fail) throw new Error(`falla ${n}`);
				return n;
			});
		const results = await Promise.allSettled([task(1), task(2, true), task(3), task(4)]);
		expect(peak).toBe(1);
		expect(order).toEqual([1, 2, 3, 4]);
		expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);

		// Real images through the queue, side by side.
		const images = await Promise.all([1, 2, 3].map((i) => solid(300 * i, 200).png().toBuffer()));
		const stored = await Promise.all(images.map((image) => toSafeWebp(image, 24_000_000)));
		expect(stored.map((buf) => sniffImageFormat(buf))).toEqual(['webp', 'webp', 'webp']);
	});

	it('re-encodes to WebP, shrinks to the maximum side and drops every metadata', async () => {
		const original = await solid(2400, 800).jpeg().withExif({ IFD0: { Copyright: 'Secreto GPS -12.04, -77.03', Artist: 'Autor oculto' } }).toBuffer();
		expect((await sharp(original).metadata()).exif).toBeDefined();

		const stored = await toSafeWebp(original, 24_000_000);
		const meta = await sharp(stored).metadata();
		expect(meta).toMatchObject({ format: 'webp', width: IMAGE_MAX_SIDE, height: 533 });
		expect(meta.exif).toBeUndefined();
		expect(meta.icc).toBeUndefined();
		expect(meta.xmp).toBeUndefined();
		expect(stored.toString('latin1')).not.toMatch(/Secreto|Autor oculto/);
	});

	it('keeps small images at their size, and only the first frame of an animation', async () => {
		const small = await toSafeWebp(await solid(40, 30).png().toBuffer(), 24_000_000);
		expect(await sharp(small).metadata()).toMatchObject({ format: 'webp', width: 40, height: 30 });
		const frames = await sharp({ create: { width: 8, height: 16, channels: 4, background: '#0f0' } }).gif().toBuffer();
		const stored = await toSafeWebp(frames, 24_000_000);
		expect((await sharp(stored).metadata()).pages ?? 1).toBe(1);
	});

	it.each([
		['empty', async () => Buffer.alloc(0)],
		['plain text', async () => Buffer.from('no soy una imagen, aunque me llame foto.jpg')],
		['SVG', async () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')],
		['HTML', async () => Buffer.from('<html><script>alert(1)</script></html>')],
		['a truncated JPEG', async () => (await solid(200, 200).jpeg().toBuffer()).subarray(0, 60)],
		['a JPEG header with garbage', async () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])],
		['a GIF header followed by HTML (polyglot)', async () => Buffer.from('GIF89a<html><script>alert(1)</script></html>')],
		['a TIFF', async () => solid(10, 10).tiff().toBuffer()],
	])('rejects %s', async (_label, make) => {
		await expect(toSafeWebp(await make(), 24_000_000)).rejects.toBeInstanceOf(ImageRejected);
	});

	it('rejects an image above the pixel limit (a decompression bomb) before decoding it all', async () => {
		const bomb = await solid(2000, 2000).png({ compressionLevel: 9 }).toBuffer();
		expect(bomb.length).toBeLessThan(100_000);
		await expect(toSafeWebp(bomb, 1_000_000)).rejects.toThrow(/píxeles/);
	});

	it('a valid image with HTML appended is stored clean', async () => {
		const polyglot = Buffer.concat([await solid(20, 20).png().toBuffer(), Buffer.from('<script>alert(1)</script>')]);
		const stored = await toSafeWebp(polyglot, 24_000_000);
		expect(stored.toString('latin1')).not.toContain('<script>');
	});
});

describe('video links (T-13)', () => {
	it.each([
		['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
		['https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PL1', 'youtube', 'dQw4w9WgXcQ'],
		['https://m.youtube.com/watch?v=dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
		['https://youtu.be/dQw4w9WgXcQ?si=abc', 'youtube', 'dQw4w9WgXcQ'],
		['https://www.youtube.com/shorts/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
		['https://www.youtube.com/embed/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
		['https://www.youtube.com/live/dQw4w9WgXcQ', 'youtube', 'dQw4w9WgXcQ'],
		['  https://WWW.YOUTUBE.COM/watch?v=dQw4w9WgXcQ  ', 'youtube', 'dQw4w9WgXcQ'],
		['https://vimeo.com/76979871', 'vimeo', '76979871'],
		['https://www.vimeo.com/76979871#t=10', 'vimeo', '76979871'],
		['https://player.vimeo.com/video/76979871?h=abc', 'vimeo', '76979871'],
	])('accepts and normalizes %s', (raw, plataforma, id) => {
		const link = parseVideoUrl(raw)!;
		expect(link).toMatchObject({ plataforma, id });
		expect(link.url).toBe(plataforma === 'youtube' ? `https://www.youtube.com/watch?v=${id}` : `https://vimeo.com/${id}`);
		expect(link.embedUrl).toBe(
			plataforma === 'youtube' ? `https://www.youtube-nocookie.com/embed/${id}` : `https://player.vimeo.com/video/${id}`,
		);
		// The stored form parses to itself.
		expect(parseVideoUrl(link.url)).toEqual(link);
	});

	it.each([
		'http://www.youtube.com/watch?v=dQw4w9WgXcQ',
		'https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
		'https://evilyoutube.com/watch?v=dQw4w9WgXcQ',
		'https://user:pass@www.youtube.com/watch?v=dQw4w9WgXcQ',
		'https://www.youtube.com:8443/watch?v=dQw4w9WgXcQ',
		'https://www.youtube.com/watch',
		'https://www.youtube.com/watch?v=corto',
		'https://www.youtube.com/playlist?list=PL123',
		'https://www.youtube.com/@canal',
		'https://youtu.be/',
		'https://vimeo.com/channels/staffpicks',
		'https://vimeo.com/abc',
		'https://player.vimeo.com/76979871',
		'https://www.dailymotion.com/video/x7tgad0',
		'https://example.com/video.mp4',
		'javascript:alert(1)',
		'data:text/html,hola',
		'//www.youtube.com/watch?v=dQw4w9WgXcQ',
		'no es un enlace',
		`https://www.youtube.com/watch?v=dQw4w9WgXcQ&x=${'a'.repeat(3000)}`,
	])('rejects %s', (raw) => {
		expect(parseVideoUrl(raw)).toBeNull();
	});

	it('the allowed hosts are listed in one place', () => {
		expect(VIDEO_HOSTS).toEqual({
			youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
			vimeo: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
		});
	});
});
