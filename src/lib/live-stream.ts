import type { LiveStream } from '../types/api';
import { api, ApiError, CLIENT_ERROR } from './api';

/**
 * The live stream section (C-14, D-043): one public Facebook video for the
 * whole site, set by the admin. The public page reads `/public/transmision`
 * (no session); the panel reads and writes `/admin/transmision`. Both answer
 * the same shape, checked here before any screen sees it.
 */

/** The only player address a page may load: Facebook's video plugin, as the backend builds it. */
export const FACEBOOK_PLUGIN_PREFIX = 'https://www.facebook.com/plugins/video.php?';

/** The Facebook links the backend stores: https, Facebook's own host. */
const FACEBOOK_LINK = /^https:\/\/www\.facebook\.com\//;

/** Not the contract: a transient failure (status 0), like the league reads (T-22 fix). */
function badResponse(): never {
	throw new ApiError(0, CLIENT_ERROR.BAD_RESPONSE, 'El servidor respondió algo inesperado. Intenta de nuevo.');
}

const isIsoDate = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value));

/**
 * The stream as the API sends it, or `BAD_RESPONSE`. With a link, the three
 * fields must be there: the link on Facebook's host, the player address on
 * Facebook's plugin (never anything else in an iframe) and the date. Without
 * one, all three are `null`.
 */
export function liveStreamOf(value: unknown): LiveStream {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) badResponse();
	const { url, embedUrl, actualizadoEn } = value as Record<string, unknown>;
	if (url === null) {
		if (embedUrl != null) badResponse();
		return { url: null, embedUrl: null, actualizadoEn: null };
	}
	if (typeof url !== 'string' || !FACEBOOK_LINK.test(url)) badResponse();
	if (typeof embedUrl !== 'string' || !embedUrl.startsWith(FACEBOOK_PLUGIN_PREFIX)) badResponse();
	if (!isIsoDate(actualizadoEn)) badResponse();
	return { url, embedUrl, actualizadoEn };
}

/** The public page (`/en-vivo`): what is on the air now, if anything. */
export async function getLiveStream(signal?: AbortSignal): Promise<LiveStream> {
	return liveStreamOf(await api.get<unknown>('/public/transmision', { signal }));
}

/** The panel's section: the same stream, read with the admin's session. */
export async function getAdminLiveStream(signal?: AbortSignal): Promise<LiveStream> {
	return liveStreamOf(await api.get<unknown>('/admin/transmision', { signal }));
}

/** Sets (or, with `null`, removes) the link. The backend validates and normalizes it. */
export async function saveLiveStream(url: string | null): Promise<LiveStream> {
	return liveStreamOf(await api.put<unknown>('/admin/transmision', { url }));
}

/** Removes the link: the page then says there is no stream. */
export async function removeLiveStream(): Promise<LiveStream> {
	return liveStreamOf(await api.delete<unknown>('/admin/transmision'));
}
