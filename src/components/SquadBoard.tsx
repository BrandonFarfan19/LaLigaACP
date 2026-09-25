import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { useNavigationType } from 'react-router';
import pitch from '../assets/backgrounds/cancha-vertical.png?pixel=pitch';
import { isInAppHistoryTraversal } from '../hooks/useScrollManagement';
import PixelImage from './PixelImage';
import PlayerStatsDialog from './PlayerStatsDialog';
import { squadPlacements } from '../lib/squad-layout';
import type { Player, PlayerStats } from '../types';
import styles from './SquadBoard.module.css';

/**
 * A team's squad: the pitch on one side, the roster table on the other.
 * Stacked on a phone, side by side from 48rem up. Each name opens that
 * player's stats card.
 */
interface Props {
	teamName: string;
	players: Player[];
	stats: PlayerStats[];
}

const dialogId = (player: Player) => `stats-${player.id}`;

export default function SquadBoard({ teamName, players, stats }: Props) {
	const statsByPlayer = new Map(stats.map((row) => [row.playerId, row]));
	// Where each one stands is a sample layout (D-022): the schema has no position.
	const placements = squadPlacements(players);
	const dialogs = useRef(new Map<string, HTMLDialogElement>());

	const open = (player: Player) => dialogs.current.get(dialogId(player))?.showModal();

	const navigationType = useNavigationType();

	// A shared link (`#stats-<player id>`) lands straight on that player's card.
	// A layout effect, so the card is open before the layout places the scroll:
	// it scrolls to the open card the way a page load scrolled to its fragment.
	// Back/Forward returns to the page as it was left, so it doesn't reopen it.
	useLayoutEffect(() => {
		if (isInAppHistoryTraversal(navigationType)) return;
		let id = '';
		try {
			id = decodeURIComponent(location.hash.slice(1));
		} catch {
			return;
		}
		const shared = id ? dialogs.current.get(id) : undefined;
		if (shared && !shared.open) shared.showModal();
		// Only on mount: the page landing, not later renders.
	}, []);

	return (
		<>
			<div className={styles.board}>
				<figure className={styles.pitch}>
					<div className={styles['pitch-field']}>
						<PixelImage
							className={`${styles['pitch-art']} pixelated`}
							image={pitch}
							alt=""
							width={240}
							densities={[2]}
							loading="lazy"
						/>
						<ul className={styles['pitch-players']} aria-label="Jugadores en la cancha">
							{placements.map(({ id, player, shirtNumber, x, y }) => {
								const hasStats = statsByPlayer.has(player.id);
								return (
									<li
										key={id}
										className={styles['pitch-position']}
										style={{ '--x': `${x}%`, '--y': `${y}%` } as CSSProperties}
									>
										<button
											className={styles['pitch-player']}
											type="button"
											disabled={!hasStats}
											aria-label={`Ver estadísticas de ${player.name}, dorsal ${shirtNumber}`}
											aria-haspopup="dialog"
											aria-controls={hasStats ? dialogId(player) : undefined}
											data-stats-open={hasStats ? dialogId(player) : undefined}
											onClick={() => open(player)}
										>
											<span className={styles.sprite} aria-hidden="true">
												<svg viewBox="0 0 16 24" shapeRendering="crispEdges">
													<path className={styles['sprite-shadow']} d="M3 22h10v2H3z" />
													<path className={styles['sprite-head']} d="M5 1h6v6H5z" />
													<path className={styles['sprite-hair']} d="M5 0h6v3H5zM4 1h1v4H4zM11 1h1v4h-1z" />
													<path className={styles['sprite-shirt']} d="M4 7h8v2h2v6h-3v2H5v-2H2V9h2z" />
													<path className={styles['sprite-head']} d="M2 15h3v2H2zM11 15h3v2h-3z" />
													<path className={styles['sprite-shorts']} d="M5 17h6v3H5z" />
													<path className={styles['sprite-socks']} d="M5 20h2v2H5zM9 20h2v2H9z" />
													<path className={styles['sprite-hair']} d="M4 22h3v1H4zM9 22h3v1H9z" />
												</svg>
												<span className={styles['shirt-number']}>{shirtNumber}</span>
											</span>
											<span className={styles['pitch-name']}>{player.name}</span>
										</button>
									</li>
								);
							})}
						</ul>
					</div>
					<p className={styles['pitch-hint']}>Toca un jugador para ver su ficha</p>
					{/* <p className={styles['pitch-hint']}>La ubicación en la cancha es de muestra; el dorsal es el inscrito en el plantel.</p> */}
				</figure>

				<table className={`${styles.roster} pixel-box`}>
					<caption className={styles.caption}>Plantilla</caption>
					<thead>
						<tr>
							<th scope="col">Jugador</th>
						</tr>
					</thead>
					<tbody>
						{players.map((player) => (
							<tr key={player.id}>
								<td>
									{statsByPlayer.has(player.id) ? (
										<button
											className={styles.player}
											type="button"
											aria-haspopup="dialog"
											data-stats-open={dialogId(player)}
											onClick={() => open(player)}
										>
											{player.name}
										</button>
									) : (
										player.name
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{players.map((player) => {
				const playerStats = statsByPlayer.get(player.id);
				if (!playerStats) return null;
				const id = dialogId(player);
				return (
					<PlayerStatsDialog
						key={player.id}
						ref={(dialog) => {
							if (dialog) dialogs.current.set(id, dialog);
							return () => {
								dialogs.current.delete(id);
							};
						}}
						id={id}
						teamName={teamName}
						player={player}
						stats={playerStats}
					/>
				);
			})}
		</>
	);
}
