/**
 * Builds the pixel-art cursor sprites in `public/cursors/`.
 *
 * The cursors have to be raster files: `image-rendering: pixelated` does not
 * apply to `cursor:`, so the art is drawn here on a 16x16 grid and written out
 * already upscaled by SCALE with nearest-neighbour. Edit the ASCII art below
 * and re-run `node scripts/generate-cursors.mjs`.
 *
 *   X = outline (--color-shadow)   o = fill (--color-text)   . = transparent
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const SCALE = 2; // one art pixel = 2 device pixels -> 32x32 sprites

const OUTLINE = [0x05, 0x06, 0x0f, 0xff]; // --color-shadow
const FILL = [0xf4, 0xf4, 0xfc, 0xff]; // --color-text
const EMPTY = [0x00, 0x00, 0x00, 0x00];

/** Classic arrow, hotspot on the tip at 0,0. */
const ARROW = [
	'X...............',
	'XX..............',
	'XoX.............',
	'XooX............',
	'XoooX...........',
	'XooooX..........',
	'XoooooX.........',
	'XooooooX........',
	'XoooooooX.......',
	'XooooooooX......',
	'XooooXXXXX......',
	'XooXoX..........',
	'XoXXooX.........',
	'XX..XooX........',
	'.....XooX.......',
	'.....XXXX.......',
];

/** Pointing hand, hotspot on the fingertip at 4,0. */
const HAND = [
	'....XX..........',
	'...XooX.........',
	'...XooX.........',
	'...XooX.........',
	'...XooXXX.......',
	'...XooXooXX.....',
	'...XooXooXooX...',
	'XX.XooXooXooX...',
	'XooXooooooooX...',
	'XoooooooooooX...',
	'.XooooooooooX...',
	'.XooooooooooX...',
	'..XoooooooooX...',
	'..XXXXXXXXXXX...',
	'................',
	'................',
];

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buf) {
	let c = 0xffffffff;
	for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const head = Buffer.alloc(8);
	head.writeUInt32BE(data.length, 0);
	head.write(type, 4, 'ascii');
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
	return Buffer.concat([head, data, crc]);
}

function toPng(art) {
	const w = art[0].length * SCALE;
	const h = art.length * SCALE;
	// One filter byte (0 = none) per scanline, then RGBA pixels.
	const raw = Buffer.alloc(h * (1 + w * 4));
	let i = 0;
	for (let y = 0; y < h; y++) {
		raw[i++] = 0;
		const row = art[Math.floor(y / SCALE)];
		for (let x = 0; x < w; x++) {
			const ch = row[Math.floor(x / SCALE)];
			const [r, g, b, a] = ch === 'X' ? OUTLINE : ch === 'o' ? FILL : EMPTY;
			raw[i++] = r;
			raw[i++] = g;
			raw[i++] = b;
			raw[i++] = a;
		}
	}

	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(w, 0);
	ihdr.writeUInt32BE(h, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA

	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

for (const [name, art] of [
	['arrow', ARROW],
	['hand', HAND],
]) {
	const file = new URL(`../public/cursors/${name}.png`, import.meta.url);
	writeFileSync(file, toPng(art));
	console.log(`wrote public/cursors/${name}.png`);
}
