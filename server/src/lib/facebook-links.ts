/**
 * The live stream of the «En vivo» section (C-14, D-043): only a link to a
 * public Facebook video, never HTML and never visited by the server. Like
 * `lib/video-links.ts` (T-13), a link is validated and stored in one
 * canonical form, and the embed URL is derived from it: the frontend may put
 * exactly that URL, and nothing else, in its player.
 */

/**
 * Hosts accepted, compared in lowercase and whole (never by suffix: `xfacebook.com` and
 * `facebook.com.evil.com` are other hosts). The canonical form always uses `www.facebook.com`.
 * `facebook.com` without a subdomain since the C-14 fix (coordinator's decision after review).
 */
export const FACEBOOK_HOSTS: readonly string[] = ['www.facebook.com', 'facebook.com', 'm.facebook.com', 'web.facebook.com'];

/** The short-link host: resolving it would mean visiting it, so it is refused with its own message. */
export const FACEBOOK_SHORT_HOST = 'fb.watch';

/** `transmision_en_vivo.url` is VARCHAR(255): the canonical link must fit. */
export const MAX_FACEBOOK_URL_LENGTH = 255;

/** What is read before parsing: anything longer is refused without looking at it. */
export const MAX_FACEBOOK_INPUT_LENGTH = 2048;

export interface FacebookVideoLink {
	/** Facebook's numeric video id. */
	id: string;
	/** Canonical link, what is stored. */
	url: string;
	/** The only URL the frontend may put in the embedded player. */
	embedUrl: string;
}

/** A page or profile name in `/<pagina>/videos/<id>`: letters, digits, dots, dashes and underscores. */
const PAGE = /^[A-Za-z0-9._-]{1,100}$/;
const VIDEO_ID = /^\d{1,25}$/;
/** Path segments that are Facebook's own routes, never a page name. */
const RESERVED_PAGES = new Set(['watch', 'plugins', 'video.php', 'videos', 'reel', 'share', 'login']);

/**
 * The width the plugin lays its player out at. Without it Facebook renders an
 * empty frame (checked in Chrome, C-14); 560 is what Facebook's own embed code
 * uses. The page sizes the iframe itself, at 16:9.
 */
export const FACEBOOK_EMBED_WIDTH = 560;

/** The player URL for a canonical link (Facebook's embedded video plugin). */
export function facebookEmbedUrl(canonical: string): string {
	return `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonical)}&show_text=false&width=${FACEBOOK_EMBED_WIDTH}`;
}

function link(id: string, url: string): FacebookVideoLink | null {
	if (url.length > MAX_FACEBOOK_URL_LENGTH) return null;
	return { id, url, embedUrl: facebookEmbedUrl(url) };
}

export type FacebookLinkProblem = 'short_link' | 'not_https' | 'host' | 'shape' | 'too_long';

/**
 * The video a link points to, or why it isn't accepted. Accepted shapes, on
 * `https` and one of `FACEBOOK_HOSTS`:
 * - `/<pagina>/videos/<id>` (a page's or a profile's video, with or without a
 *   trailing slash) → `https://www.facebook.com/<pagina>/videos/<id>/`;
 * - `/watch/?v=<id>` → `https://www.facebook.com/watch/?v=<id>`;
 * - `/watch/live/?v=<id>` → `https://www.facebook.com/watch/live/?v=<id>`;
 * - `/reel/<id>` (C-14 fix: Facebook publishes every video as a reel) →
 *   `https://www.facebook.com/watch/?v=<id>`, the same id. Checked in Chrome
 *   with a public reel: the plugin plays it through `/watch/?v=<id>` without
 *   stopping; through `/reel/<id>/` it loaded and stopped after two seconds.
 * Share links (`fb.watch/...`, `facebook.com/share/v/...`, `/share/r/...`)
 * don't carry the video id, and resolving them means visiting them: refused
 * (`short_link`), asking for the link in the address bar.
 * Any other query parameter (tracking such as `mibextid`) and the fragment
 * are dropped. A repeated `v`, credentials, a port or another scheme are
 * refused. The link is only parsed: nothing is fetched.
 */
export function parseFacebookVideo(raw: unknown): { ok: true; video: FacebookVideoLink } | { ok: false; problem: FacebookLinkProblem } {
	if (typeof raw !== 'string') return { ok: false, problem: 'shape' };
	if (raw.length > MAX_FACEBOOK_INPUT_LENGTH) return { ok: false, problem: 'too_long' };
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return { ok: false, problem: 'shape' };
	}
	const host = url.hostname.toLowerCase();
	if (host === FACEBOOK_SHORT_HOST || host === `www.${FACEBOOK_SHORT_HOST}`) return { ok: false, problem: 'short_link' };
	if (url.protocol !== 'https:') return { ok: false, problem: 'not_https' };
	if (url.username || url.password || url.port) return { ok: false, problem: 'shape' };
	if (!FACEBOOK_HOSTS.includes(host)) return { ok: false, problem: 'host' };

	const parts = url.pathname.split('/').filter(Boolean);
	if (parts[0] === 'share') return { ok: false, problem: 'short_link' };
	let video: FacebookVideoLink | null = null;
	if (parts[0] === 'reel' && parts.length === 2 && VIDEO_ID.test(parts[1]!)) {
		video = link(parts[1]!, `https://www.facebook.com/watch/?v=${parts[1]}`);
	} else if (parts[0] === 'watch' && (parts.length === 1 || (parts.length === 2 && parts[1] === 'live'))) {
		const ids = url.searchParams.getAll('v');
		if (ids.length !== 1 || !VIDEO_ID.test(ids[0]!)) return { ok: false, problem: 'shape' };
		const base = parts.length === 2 ? 'https://www.facebook.com/watch/live/' : 'https://www.facebook.com/watch/';
		video = link(ids[0]!, `${base}?v=${ids[0]}`);
	} else if (parts.length === 3 && parts[1] === 'videos' && PAGE.test(parts[0]!) && !RESERVED_PAGES.has(parts[0]!.toLowerCase()) && VIDEO_ID.test(parts[2]!)) {
		video = link(parts[2]!, `https://www.facebook.com/${parts[0]}/videos/${parts[2]}/`);
	} else {
		return { ok: false, problem: 'shape' };
	}
	return video ? { ok: true, video } : { ok: false, problem: 'too_long' };
}

/** A stored canonical link, back to its parts. `null` if it isn't one (never expected: only canonical links are stored). */
export function storedFacebookVideo(value: unknown): FacebookVideoLink | null {
	const parsed = parseFacebookVideo(value);
	return parsed.ok && parsed.video.url === value ? parsed.video : null;
}

const SHAPES = '/<página>/videos/<id>, /watch/?v=<id>, /watch/live/?v=<id> o /reel/<id>';

/** The message of each problem, for the per-field error of the admin form. */
export const FACEBOOK_LINK_MESSAGES: Readonly<Record<FacebookLinkProblem, string>> = {
	short_link:
		'Los links para compartir (fb.watch o facebook.com/share/…) no llevan el número del video: abre el video en Facebook y copia el link de la barra de direcciones del navegador (empieza con https://www.facebook.com/).',
	not_https: `Tiene que ser un enlace https a un video de Facebook (${FACEBOOK_HOSTS.join(', ')}).`,
	host: `Tiene que ser un enlace a un video de Facebook (${FACEBOOK_HOSTS.join(', ')}).`,
	shape: `No es un enlace a un video de Facebook. Formas admitidas: ${SHAPES}.`,
	too_long: `El enlace es demasiado largo (máximo ${MAX_FACEBOOK_URL_LENGTH} caracteres una vez normalizado).`,
};
