import MatchCard from './MatchCard';
import { FIXTURE_PAGE_SIZE, MAX_FIXTURE_PAGES } from '../lib/league';
import type { Matchday } from '../types';
import styles from './Fixture.module.css';

interface Props {
	/** Read by the page loader from the public API: each match already carries its two teams. */
	rounds: Matchday[];
	/** The competition has more matches than the read asked for (T-22 fix): say so, never cut in silence. */
	truncated?: boolean;
	/** Whether a competition is on screen at all, so the empty state can say why. */
	hasCompetition?: boolean;
	/** The page could not read this time: an empty list means "unknown", not "none". */
	failed?: boolean;
}

/** How many matches of one competition the landing reads at most (`listFixture`). */
const LIMIT = FIXTURE_PAGE_SIZE * MAX_FIXTURE_PAGES;

/** What the empty section says: a failed read never claims there are no matches. */
const emptyText = (failed: boolean, hasCompetition: boolean) =>
	failed ? 'No se pudieron cargar los partidos.' : hasCompetition ? 'Esta competición todavía no tiene partidos cargados.' : 'Todavía no hay partidos cargados.';

export default function Fixture({ rounds, truncated = false, hasCompetition = true, failed = false }: Props) {
	return (
		<section className={styles.fixture} id="fixture" aria-labelledby="fixture-title">
			<header className={styles.head}>
				<p className={styles.kicker}>Calendario</p>
				<h2 className={styles.title} id="fixture-title">
					Fixture
				</h2>
				<p className={styles.lead}>Todos los enfrentamientos del torneo, jornada por jornada.</p>
			</header>

			{/* The section always renders, so `/#fixture` exists as an anchor: when
			    there is nothing to list it says so instead of leaving a bare title. */}
			{rounds.length === 0 ? (
				<p className={`${styles.note} pixel-box`}>{emptyText(failed, hasCompetition)}</p>
			) : (
				<>
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
					{truncated && <p className={`${styles.note} pixel-box`}>Esta competición tiene más partidos de los que caben aquí: se muestran los primeros {LIMIT}.</p>}
				</>
			)}
		</section>
	);
}
