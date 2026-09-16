/**
 * Videos (T-13, BR-033): only a link to an allowed platform, never a file and
 * never downloaded by the server. The platforms are listed here and nowhere
 * else. A link is validated and stored in one canonical form; the embed URL
 * is derived from it for the frontend (T-18/T-22), which must use exactly
 * that URL in its player.
 */

export type VideoPlatform = 'youtube' | 'vimeo';

/** Hosts accepted per platform (compared in lowercase). */
export const VIDEO_HOSTS: Readonly<Record<VideoPlatform, readonly string[]>> = {
	youtube: ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'],
	vimeo: ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'],
};

export const MAX_VIDEO_URL_LENGTH = 255;

export interface VideoLink {
	plataforma: VideoPlatform;
	/** The platform's video id. */
	id: string;
	/** Canonical link, what is stored. */
	url: string;
	/** The only URL the frontend may put in an embedded player. */
	embedUrl: string;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const VIMEO_ID = /^\d{1,12}$/;

function platformOf(host: string): VideoPlatform | null {
	for (const [platform, hosts] of Object.entries(VIDEO_HOSTS) as Array<[VideoPlatform, readonly string[]]>) {
		if (hosts.includes(host)) return platform;
	}
	return null;
}

function youtube(id: string): VideoLink {
	return {
		plataforma: 'youtube',
		id,
		url: `https://www.youtube.com/watch?v=${id}`,
		embedUrl: `https://www.youtube-nocookie.com/embed/${id}`,
	};
}

function vimeo(id: string): VideoLink {
	return { plataforma: 'vimeo', id, url: `https://vimeo.com/${id}`, embedUrl: `https://player.vimeo.com/video/${id}` };
}

/**
 * The video a link points to, or `null` if it isn't an `https` link to an
 * allowed platform with a recognizable video id. Accepted shapes:
 * - YouTube: `youtube.com/watch?v=ID`, `youtube.com/shorts/ID`,
 *   `youtube.com/embed/ID`, `youtube.com/live/ID`, `youtu.be/ID`.
 * - Vimeo: `vimeo.com/NUMBER`, `player.vimeo.com/video/NUMBER`.
 * Credentials, ports other than the default and other schemes are refused.
 */
export function parseVideoUrl(raw: string): VideoLink | null {
	if (typeof raw !== 'string' || raw.length > 2048) return null;
	let url: URL;
	try {
		url = new URL(raw.trim());
	} catch {
		return null;
	}
	if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
	const platform = platformOf(url.hostname.toLowerCase());
	if (!platform) return null;
	const parts = url.pathname.split('/').filter(Boolean);

	if (platform === 'youtube') {
		let id: string | null | undefined;
		if (url.hostname.toLowerCase() === 'youtu.be') id = parts.length === 1 ? parts[0] : null;
		else if (parts.length === 1 && parts[0] === 'watch') id = url.searchParams.get('v');
		else if (parts.length === 2 && ['shorts', 'embed', 'live'].includes(parts[0]!)) id = parts[1];
		return id && YOUTUBE_ID.test(id) ? youtube(id) : null;
	}

	let id: string | undefined;
	if (url.hostname.toLowerCase() === 'player.vimeo.com') id = parts.length === 2 && parts[0] === 'video' ? parts[1] : undefined;
	else id = parts.length === 1 ? parts[0] : undefined;
	return id && VIMEO_ID.test(id) ? vimeo(id) : null;
}

/** A stored canonical link, back to its parts. `null` if it isn't one (never expected). */
export function storedVideo(value: unknown): VideoLink | null {
	return typeof value === 'string' ? parseVideoUrl(value) : null;
}

export const ALLOWED_VIDEO_MESSAGE = `Tiene que ser un enlace https a un video de YouTube (${VIDEO_HOSTS.youtube.join(', ')}) o de Vimeo (${VIDEO_HOSTS.vimeo.join(', ')}).`;
