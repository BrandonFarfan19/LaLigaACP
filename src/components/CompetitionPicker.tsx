import { Link } from 'react-router';
import type { Sport } from '../types';
import styles from './CompetitionPicker.module.css';

/**
 * Which sport the league screens show (D-021, BR-048). The sport lives in the
 * page URL (`?deporteId=`), so what is on screen can be shared as a link;
 * without it the page opens on fútbol (`defaultSport` in `league-view.ts`).
 * The competition is not offered: each sport opens on its own by the usual
 * rule (`defaultCompetition`), and a shared `?competicionId=` still works.
 *
 * They are visible options, not a dropdown that would cut a long name at
 * 320 px (D-017), and each one is a link: choosing is a page of its own, and
 * the browser's Back button undoes it.
 */
export default function CompetitionPicker({
	sports,
	sportId,
	path,
}: {
	sports: Sport[];
	/** The sport on screen, `''` for every sport. */
	sportId: string;
	/** The page the choice belongs to (`/` or `/posiciones`). */
	path: string;
}) {
	if (sports.length === 0) return null;

	return (
		<nav className={`${styles.picker} pixel-box`} aria-label="Elegir deporte">
			<div className={styles.group}>
				<p className={styles.legend} id="picker-sport">
					Deporte
				</p>
				<ul className={styles.options} aria-labelledby="picker-sport">
					{sports.map((sport) => (
						<li key={sport.id}>
							<Link className={styles.choice} to={`${path}?deporteId=${sport.id}`} aria-current={sport.id === sportId ? 'page' : undefined}>
								{sport.name}
							</Link>
						</li>
					))}
				</ul>
			</div>
		</nav>
	);
}
