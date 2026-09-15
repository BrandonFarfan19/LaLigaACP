import PixelImage from './PixelImage';
import { formatKickoff } from '../utils/format-date';
import type { ResolvedMatch } from '../types';
import styles from './MatchCard.module.css';

interface Props {
	match: ResolvedMatch;
}

const statusLabel: Record<ResolvedMatch['status'], string> = {
	scheduled: 'Programado',
	live: 'En vivo',
	finished: 'Finalizado',
};

export default function MatchCard({ match }: Props) {
	const { homeTeam, awayTeam, status, score, venue, kickoff } = match;

	// Same text in every browser and visitor zone: fixed month names, league time.
	const { day: dayLabel, time: timeLabel } = formatKickoff(kickoff);

	const played = status === 'finished' && score !== undefined;

	return (
		<article className={`${styles.match} pixel-box`} data-status={status}>
			<header className={styles.meta}>
				<span className={styles.status}>{statusLabel[status]}</span>
				<time dateTime={kickoff}>
					{dayLabel} · {timeLabel}
				</time>
			</header>

			<div className={styles.board}>
				<div className={styles.team}>
					<PixelImage
						className={`${styles.crest} pixelated`}
						image={homeTeam.crest}
						alt={`Escudo de ${homeTeam.name}`}
						width={48}
						densities={[2]}
						loading="lazy"
					/>
					<span className={styles.name}>{homeTeam.shortName}</span>
				</div>

				<div className={styles.result}>
					{played ? (
						<span className={styles.score}>
							{score!.home}
							<span className={styles.dash}>-</span>
							{score!.away}
						</span>
					) : (
						<span className={styles.versus}>VS</span>
					)}
				</div>

				<div className={styles.team}>
					<PixelImage
						className={`${styles.crest} pixelated`}
						image={awayTeam.crest}
						alt={`Escudo de ${awayTeam.name}`}
						width={48}
						densities={[2]}
						loading="lazy"
					/>
					<span className={styles.name}>{awayTeam.shortName}</span>
				</div>
			</div>

			<footer className={styles.venue}>{venue}</footer>
		</article>
	);
}
