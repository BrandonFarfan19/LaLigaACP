import type { LiveStream } from '../types/api';

/** A canonical Facebook video link, as the backend stores it (C-14). */
export const FB_VIDEO = 'https://www.facebook.com/laligaacp/videos/1234567890123456/';

/** The player address the backend derives from it: the only thing an iframe may load. */
export const FB_EMBED = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(FB_VIDEO)}&show_text=false&width=560`;

/** `GET /public/transmision` (and the admin's) with a stream on the air. */
export const liveStream = (overrides: Partial<LiveStream> = {}): LiveStream => ({
	url: FB_VIDEO,
	embedUrl: FB_EMBED,
	actualizadoEn: '2026-09-30T20:15:00.000Z',
	...overrides,
});

/** The same, with no stream. */
export const noLiveStream = (): LiveStream => ({ url: null, embedUrl: null, actualizadoEn: null });
