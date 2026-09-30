import { z } from 'zod';
import { FACEBOOK_LINK_MESSAGES, type FacebookVideoLink, parseFacebookVideo } from '../lib/facebook-links.js';

/**
 * C-14 (D-043): the body of `PUT /admin/transmision`. `url` is a link to a
 * public Facebook video, turned into its canonical form (`lib/facebook-links.ts`),
 * or `null` to take the stream down. Nothing else is accepted.
 */
export const setLiveStreamBody = z.strictObject({
	url: z
		.string({ error: 'Pega el enlace del video de Facebook, o null para quitar la transmisión.' })
		.transform((raw, ctx): FacebookVideoLink => {
			const parsed = parseFacebookVideo(raw);
			if (!parsed.ok) {
				ctx.addIssue({ code: 'custom', message: FACEBOOK_LINK_MESSAGES[parsed.problem] });
				return z.NEVER;
			}
			return parsed.video;
		})
		.nullable(),
});

export type SetLiveStreamBody = z.output<typeof setLiveStreamBody>;
