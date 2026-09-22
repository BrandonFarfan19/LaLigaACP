import type { ApiTeam } from '../types/betting';
import styles from './TeamCrest.module.css';

/**
 * A crest that comes from the API (`equipo.escudo`): an `https://` URL or a
 * path relative to the site root. Shown only with `<img>` (T-06/T-13 notes:
 * never inline SVG, background or iframe), small and upscaled with
 * nearest-neighbour. Anything else shows the team's initials instead.
 */
export function crestSrc(escudo: string): string | null {
	if (/^https:\/\//i.test(escudo)) return escudo;
	if (/^[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:png|jpe?g|webp|avif|svg|gif)$/i.test(escudo) && !escudo.includes('..') && !escudo.includes('//')) {
		return `/${escudo}`;
	}
	return null;
}

export default function TeamCrest({ team, size = 32 }: { team: Pick<ApiTeam, 'escudo' | 'nombreCorto' | 'colorAcento'>; size?: 24 | 32 }) {
	const src = crestSrc(team.escudo);
	return (
		<span className={styles.frame} style={{ width: size, height: size }} aria-hidden="true">
			{src ? (
				<img className={`${styles.img} pixelated`} src={src} alt="" width={size} height={size} loading="lazy" decoding="async" referrerPolicy="no-referrer" />
			) : (
				<span className={styles.initials}>{team.nombreCorto.slice(0, 3)}</span>
			)}
		</span>
	);
}
