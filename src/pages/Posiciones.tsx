import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import CompetitionPicker from '../components/CompetitionPicker';
import Crest from '../components/Crest';
import LeagueNotice from '../components/LeagueNotice';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { isTransientError } from '../lib/api';
import { listStandings } from '../lib/league';
import { leagueLoadError, readLeagueChoice } from '../lib/league-view';
import type { ResolvedStanding } from '../types';
import styles from './Posiciones.module.css';

/**
 * The table of the competition on screen (BR-050, D-021). The API computes it
 * and sends it in order: this page only shows it.
 *
 * **Every column of BR-050** (D-023): played, won, drawn, lost, goals for and
 * against, goal difference and points. Ten columns never fit a 390 px phone,
 * so the table lives in a container with **its own horizontal scroll**, which
 * is focusable and labelled (the page itself never scrolls sideways), and the
 * team stays pinned to the left edge so a scrolled row is still identifiable.
 * The headings are the abbreviations anyone reading a league table expects
 * (PJ, PG, GF…), each carrying its full words for screen readers.
 */

export async function loader({ request }: LoaderFunctionArgs) {
	const { signal } = request;
	const choice = await readLeagueChoice(new URL(request.url), { signal });
	if (!choice.competition) return { ...choice, rows: [] as ResolvedStanding[] };
	try {
		return { ...choice, rows: await listStandings(choice.competition.id, signal) };
	} catch (error) {
		if (!isTransientError(error)) throw error;
		return { ...choice, rows: [] as ResolvedStanding[], loadError: leagueLoadError(error) };
	}
}

/** A column heading: the abbreviation on screen, the whole words for a screen reader. */
function Heading({ short, long, className }: { short: string; long: string; className?: string }) {
	return (
		<th scope="col" className={className}>
			<span aria-hidden="true">{short}</span>
			<span className={styles['visually-hidden']}>{long}</span>
		</th>
	);
}

/** Goal difference reads as a difference: `+4`, `0`, `-2`. */
const difference = (value: number) => (value > 0 ? `+${value}` : String(value));

export default function Posiciones() {
	const { sports, competitions, sportId, competition, rows, loadError } = useLoaderData<typeof loader>();
	useDocumentTitle(competition ? `Posiciones · ${competition.name}` : 'Posiciones · La Liga ACP');

	return (
		<section className={styles.standings} aria-labelledby="standings-title">
			<header className={styles.head}>
				<p className={styles.kicker}>Clasificación</p>
				<h1 className={styles.title} id="standings-title">
					Posiciones
				</h1>
				<p className={styles.lead}>
					{competition ? `${competition.name} (${competition.sport.name}): los equipos ordenados por puntos obtenidos.` : 'Los equipos ordenados por puntos obtenidos.'}
				</p>
			</header>

			<CompetitionPicker sports={sports} competitions={competitions} sportId={sportId} competitionId={competition?.id ?? ''} path="/posiciones" />
			<LeagueNotice
				error={loadError}
				empty={
					competition
						? rows.length === 0
							? 'Esta competición todavía no tiene equipos: la tabla aparecerá cuando se carguen.'
							: null
						: 'Todavía no hay ninguna competición con partidos: cuando se carguen aparecerán aquí.'
				}
			/>

			{/* Its own scroll, keyboard reachable: the page never scrolls sideways.
			    Its name is its own ("Tabla de posiciones"), not the page heading's,
			    so the two regions are told apart. Nothing is drawn without rows:
			    a head of empty columns beside the notice said nothing. */}
			{rows.length > 0 && (
				<div className={`${styles.scroller} pixel-box`} role="region" aria-label="Tabla de posiciones" tabIndex={0}>
					<table className={styles.table}>
						<caption className={styles['visually-hidden']}>Partidos jugados, ganados, empatados y perdidos, goles a favor y en contra, diferencia y puntos.</caption>
						<thead>
							<tr>
								<Heading short="#" long="Posición" className={styles['col-position']} />
								<th scope="col" className={styles['col-team']}>
									Equipo
								</th>
								<Heading short="PJ" long="Partidos jugados" className={styles['col-number']} />
								<Heading short="PG" long="Partidos ganados" className={styles['col-number']} />
								<Heading short="PE" long="Partidos empatados" className={styles['col-number']} />
								<Heading short="PP" long="Partidos perdidos" className={styles['col-number']} />
								<Heading short="GF" long="Goles a favor" className={styles['col-number']} />
								<Heading short="GC" long="Goles en contra" className={styles['col-number']} />
								<Heading short="DG" long="Diferencia de goles" className={styles['col-number']} />
								<Heading short="Pts" long="Puntos" className={styles['col-points']} />
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr key={row.team.id} className={row.position === 1 ? styles.leader : undefined}>
									<td className={styles['col-position']}>{row.position}</td>
									<th scope="row" className={styles['col-team']}>
										<span className={styles.team}>
											<Crest team={row.team} size={32} loading="eager" />
											<span className={styles['team-name']}>{row.team.name}</span>
										</span>
									</th>
									<td className={styles['col-number']}>{row.played}</td>
									<td className={styles['col-number']}>{row.won}</td>
									<td className={styles['col-number']}>{row.drawn}</td>
									<td className={styles['col-number']}>{row.lost}</td>
									<td className={styles['col-number']}>{row.goalsFor}</td>
									<td className={styles['col-number']}>{row.goalsAgainst}</td>
									<td className={styles['col-number']}>{difference(row.goalDifference)}</td>
									<td className={styles['col-points']}>{row.points}</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}
		</section>
	);
}
