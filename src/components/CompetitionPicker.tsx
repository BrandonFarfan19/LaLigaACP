import { Link } from 'react-router';
import type { Competition, Sport } from '../types';
import styles from './CompetitionPicker.module.css';

/**
 * Which competition the league screens show (D-021, BR-048). Sport and
 * competition live in the page URL (`?deporteId=&competicionId=`), so what is
 * on screen can be shared as a link; without them the page opens on the
 * competition with the next scheduled match.
 *
 * They are visible options, not a dropdown that would cut a long name at
 * 320 px (D-017), and each one is a link: choosing is a page of its own, and
 * the browser's Back button undoes it.
 */
export default function CompetitionPicker({
	sports,
	competitions,
	sportId,
	competitionId,
	path,
}: {
	sports: Sport[];
	competitions: Competition[];
	/** The sport chosen, `''` for every sport. */
	sportId: string;
	competitionId: string;
	/** The page the choice belongs to (`/` or `/posiciones`). */
	path: string;
}) {
	if (sports.length === 0) return null;
	const to = (next: { sportId?: string; competitionId?: string }) => {
		const search = new URLSearchParams();
		if (next.sportId) search.set('deporteId', next.sportId);
		if (next.competitionId) search.set('competicionId', next.competitionId);
		const query = search.toString();
		return `${path}${query ? `?${query}` : ''}`;
	};

	return (
		<nav className={`${styles.picker} pixel-box`} aria-label="Elegir deporte y competición">
			<div className={styles.group}>
				<p className={styles.legend} id="picker-sport">
					Deporte
				</p>
				<ul className={styles.options} aria-labelledby="picker-sport">
					<li>
						<Link className={styles.choice} to={to({})} aria-current={sportId === '' ? 'page' : undefined}>
							Todos
						</Link>
					</li>
					{sports.map((sport) => (
						<li key={sport.id}>
							<Link className={styles.choice} to={to({ sportId: sport.id })} aria-current={sport.id === sportId ? 'page' : undefined}>
								{sport.name}
							</Link>
						</li>
					))}
				</ul>
			</div>

			{competitions.length > 0 && (
				<div className={styles.group}>
					<p className={styles.legend} id="picker-competition">
						Competición
					</p>
					<ul className={styles.options} aria-labelledby="picker-competition">
						{competitions.map((competition) => (
							<li key={competition.id}>
								<Link
									className={styles.choice}
									to={to({ sportId, competitionId: competition.id })}
									aria-current={competition.id === competitionId ? 'page' : undefined}
								>
									{competition.name}
									<span className={styles.sport}>{competition.sport.name}</span>
								</Link>
							</li>
						))}
					</ul>
				</div>
			)}
		</nav>
	);
}
