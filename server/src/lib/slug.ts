/** Same length as the `slug` columns. */
export const SLUG_MAX_LENGTH = 100;

/**
 * Letters that Unicode decomposition doesn't reduce to a base letter plus an
 * accent (so `\p{M}` removal would drop them): spelled out instead.
 * Applied after lowercasing, so `ẞ` (→ `ß`) and `Æ` (→ `æ`) are covered too.
 */
const TRANSLITERATIONS: Record<string, string> = {
	ß: 'ss',
	æ: 'ae',
	œ: 'oe',
	ø: 'o',
	đ: 'd',
	ð: 'd',
	þ: 'th',
	ł: 'l',
	ı: 'i',
	ħ: 'h',
	ŧ: 't',
	ŋ: 'ng',
	ĸ: 'k',
};
const TRANSLITERABLE = new RegExp(`[${Object.keys(TRANSLITERATIONS).join('')}]`, 'g');

/**
 * URL-safe identifier from any text: lowercase, the letters above spelled
 * out, accents removed, anything that isn't a letter or a digit collapsed
 * into single dashes, no dashes at the ends. "Fútbol 5 – Apertura" →
 * "futbol-5-apertura", "Straße" → "strasse". May return "" (text with no
 * letters or digits); callers reject that.
 */
export function slugify(text: string): string {
	return text
		.toLowerCase()
		.replace(TRANSLITERABLE, (ch) => TRANSLITERATIONS[ch]!)
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, SLUG_MAX_LENGTH)
		.replace(/-+$/, '');
}
