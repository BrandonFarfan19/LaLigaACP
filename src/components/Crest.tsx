import { useState } from 'react';
import type { Team } from '../types';
import styles from './TeamCrest.module.css';

/**
 * A league crest as the API gives it (T-22): an `https://` URL or a path
 * inside the site, already checked by `src/lib/league.ts`. Shown only with
 * `<img>` (never inline SVG, background or iframe: T-06 and T-13 notes),
 * small and upscaled with nearest-neighbour so it still reads as pixel art.
 * Without a usable crest it shows the team's initials.
 *
 * The size is fixed by the caller and written on the element: the layout never
 * depends on the real file, which is not a build-time rendition (`PixelImage`
 * only works with those).
 */
export default function Crest({ team, size, alt = '', loading = 'lazy' }: { team: Pick<Team, 'crest' | 'shortName'>; size: number; alt?: string; loading?: 'lazy' | 'eager' }) {
	// A crest whose file isn't there (a path the API keeps but the site doesn't serve)
	// would leave a hole: the initials take its place instead.
	const [broken, setBroken] = useState(false);
	const src = broken ? null : team.crest;
	return (
		<span className={styles.frame} style={{ width: size, height: size }} aria-hidden={alt ? undefined : 'true'}>
			{src ? (
				<img
					className={`${styles.img} pixelated`}
					src={src}
					alt={alt}
					width={size}
					height={size}
					loading={loading}
					decoding="async"
					referrerPolicy="no-referrer"
					onError={() => setBroken(true)}
				/>
			) : (
				<span className={styles.initials}>{team.shortName.slice(0, 3)}</span>
			)}
		</span>
	);
}
