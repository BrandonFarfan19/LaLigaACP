import MatchCard from './MatchCard';
import type { Matchday } from '../types';
import styles from './Fixture.module.css';

interface Props {
	/** Read by the page loader through `getFixturesByMatchday()` — the join onto teams already happened there. */
	rounds: Matchday[];
}

export default function Fixture({ rounds }: Props) {
	return (
		<section className={styles.fixture} id="fixture" aria-labelledby="fixture-title">
			<header className={styles.head}>
				<p className={styles.kicker}>Calendario</p>
				<h2 className={styles.title} id="fixture-title">
					Fixture
				</h2>
				<p className={styles.lead}>Todos los enfrentamientos del torneo, jornada por jornada.</p>
			</header>

			<div className={styles.rounds}>
				{rounds.map((round) => (
					<section key={round.matchday} className={styles.round} aria-label={`Jornada ${round.matchday}`}>
						<h3 className={styles['round-title']}>
							<span className={styles['round-number']}>{String(round.matchday).padStart(2, '0')}</span>
							<span className={styles['round-word']}>Jornada</span>
						</h3>

						<div className={styles.matches}>
							{round.matches.map((match) => (
								<MatchCard key={match.id} match={match} />
							))}
						</div>
					</section>
				))}
			</div>
		</section>
	);
}
