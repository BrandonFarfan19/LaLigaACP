import { useLoaderData } from 'react-router';
import PixelImage from '../components/PixelImage';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getStandings } from '../lib/standings';
import styles from './Posiciones.module.css';

// Already sorted best-first by the data layer.
export async function loader() {
	return { standings: await getStandings() };
}

export default function Posiciones() {
	const { standings } = useLoaderData<typeof loader>();
	useDocumentTitle('Posiciones · La Liga ACP');

	return (
		<section className={styles.standings} aria-labelledby="standings-title">
			<header className={styles.head}>
				<p className={styles.kicker}>Clasificación</p>
				<h1 className={styles.title} id="standings-title">
					Posiciones
				</h1>
				<p className={styles.lead}>Los equipos ordenados por puntos obtenidos.</p>
			</header>

			<table className={`${styles.table} pixel-box`}>
				<caption className={styles['visually-hidden']}>Tabla de posiciones</caption>
				<thead>
					<tr>
						<th scope="col" className={styles['col-position']}>
							<abbr title="Posición">#</abbr>
						</th>
						<th scope="col" className={styles['col-team']}>
							Equipo
						</th>
						<th scope="col" className={styles['col-points']}>
							<abbr title="Puntos">Pts</abbr>
						</th>
					</tr>
				</thead>
				<tbody>
					{standings.map((row) => (
						<tr key={row.team.id} className={row.position === 1 ? styles.leader : undefined}>
							<td className={styles['col-position']}>{row.position}</td>
							<th scope="row" className={styles['col-team']}>
								<span className={styles.team}>
									<PixelImage
										className={`${styles.crest} pixelated`}
										image={row.team.crest}
										alt=""
										width={32}
										height={32}
										densities={[2]}
										loading="eager"
									/>
									<span className={styles['team-name']}>{row.team.name}</span>
								</span>
							</th>
							<td className={styles['col-points']}>{row.points}</td>
						</tr>
					))}
				</tbody>
			</table>
		</section>
	);
}
