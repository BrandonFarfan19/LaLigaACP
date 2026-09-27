import type { CSSProperties } from 'react';
import { data, Link, useLoaderData, type LoaderFunctionArgs } from 'react-router';
import Crest from '../components/Crest';
import SquadBoard from '../components/SquadBoard';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getTeamWithSquad } from '../lib/league';
import { courtFor } from '../lib/squad-layout';
import styles from './Plantilla.module.css';

/**
 * One page per team, read from the public API (T-22). The id in the URL is the
 * team's numeric id (`/plantilla/42`, decision of the user in T-08): an id that
 * is not one, or that no team has, is the not-found page — the API answers 400
 * or 404 and `src/lib/league.ts` treats both the same.
 */
export async function loader({ params, request }: LoaderFunctionArgs) {
	const found = params.id ? await getTeamWithSquad(params.id, request.signal) : undefined;
	if (!found) throw data(null, { status: 404 });
	// The real statistics (C-05, D-034) travel with the squad; a player without them says so on the card.
	return found;
}

export default function Plantilla() {
	const { team, competition, players, stats } = useLoaderData<typeof loader>();
	useDocumentTitle(`Plantilla · ${team.name}`);

	return (
		// Keyed by team so moving between squads starts from a fresh board.
		<section key={team.id} className={styles.squad} style={{ '--team-accent': team.accent } as CSSProperties}>
			<Link className={styles.back} to="/#inicio">
				&lt; Volver
			</Link>

			<header className={styles.identity}>
				<div className={styles.badge}>
					<Crest team={team} size={32} alt={`Escudo de ${team.name}`} loading="eager" />
				</div>

				<h1 className={styles.name}>{team.name}</h1>
				<p className={styles.competition}>
					{competition.name} · {competition.sport.name}
				</p>
			</header>

			{players.length === 0 ? (
				<p className={styles.empty}>Este equipo todavía no tiene jugadores inscritos.</p>
			) : (
				<SquadBoard teamName={team.name} players={players} stats={stats} court={courtFor(competition.sport.name)} />
			)}
		</section>
	);
}
