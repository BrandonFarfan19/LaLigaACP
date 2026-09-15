import type { CSSProperties } from 'react';
import { data, Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import PixelImage from '../components/PixelImage';
import SquadBoard from '../components/SquadBoard';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getPlayersByTeamId, getPlayerStatsByTeamId, getSquadPlacementsByTeamId } from '../lib/players';
import { getTeamById } from '../lib/teams';
import styles from './Plantilla.module.css';

/**
 * One page per team, read from the data layer. When the backend arrives this
 * keeps working untouched: `getTeamById()` starts returning rows from the API.
 * An id the data layer doesn't know is a 404.
 */
export async function loader({ params }: LoaderFunctionArgs) {
	const team = params.id ? await getTeamById(params.id) : undefined;
	if (!team) throw data(null, { status: 404 });

	const [players, stats, placements] = await Promise.all([
		getPlayersByTeamId(team.id),
		getPlayerStatsByTeamId(team.id),
		getSquadPlacementsByTeamId(team.id),
	]);
	return { team, players, stats, placements };
}

export default function Plantilla() {
	const { team, players, stats, placements } = useLoaderData<typeof loader>();
	useDocumentTitle(`Plantilla · ${team.name}`);

	return (
		// Keyed by team so moving between squads starts from a fresh board.
		<section key={team.id} className={styles.squad} style={{ '--team-accent': team.accent } as CSSProperties}>
			<Link className={styles.back} to="/#inicio">
				&lt; Volver
			</Link>

			<header className={styles.identity}>
				<div className={styles.badge}>
					<PixelImage
						className={`${styles.crest} pixelated`}
						image={team.crest}
						alt={`Escudo de ${team.name}`}
						width={32}
						densities={[2]}
						loading="eager"
						fetchPriority="high"
					/>
				</div>

				<h1 className={styles.name}>{team.name}</h1>
			</header>

			<SquadBoard teamName={team.name} players={players} stats={stats} placements={placements} />
		</section>
	);
}
