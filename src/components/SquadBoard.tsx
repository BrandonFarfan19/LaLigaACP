import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useNavigationType } from 'react-router';
import pitch from '../assets/backgrounds/cancha-vertical.png?pixel=pitch';
import voleyCourt from '../assets/backgrounds/cancha-voley-vertical.png?pixel=pitch';
import { isInAppHistoryTraversal } from '../hooks/useScrollManagement';
import PixelImage from './PixelImage';
import PlayerStatsDialog from './PlayerStatsDialog';
import { type Court, type Random, seededRandom, squadPlacements } from '../lib/squad-layout';
import type { Player, PlayerStats } from '../types';
import styles from './SquadBoard.module.css';

/**
 * A team's squad: the pitch on one side, the roster table on the other.
 * Stacked on a phone, side by side from 48rem up. Each name opens that
 * player's card: the real statistics (C-05) or, without them, "Sin
 * estadísticas".
 */
interface Props {
	teamName: string;
	players: Player[];
	/** Only the players who have them (C-05). */
	stats: PlayerStats[];
	/** The drawing and formation of the team's sport (`courtFor`). */
	court?: Court;
	/** Where the draw's seed comes from (C-06): `Math.random` unless a test fixes it. */
	random?: Random;
}

const COURT_ART = { futbol: pitch, voley: voleyCourt };

const dialogId = (player: Player) => `stats-${player.id}`;

/** The label under a player on the pitch: the first two words of the name. The table and the card keep it whole. */
const pitchName = (name: string) => name.trim().split(/\s+/).slice(0, 2).join(' ');

export default function SquadBoard({ teamName, players, stats, court = 'futbol', random = Math.random }: Props) {
	const statsByPlayer = new Map(stats.map((row) => [row.playerId, row]));
	// Who stands on the drawing, and where, is drawn at random (C-06, D-035): the schema has
	// no position. One seed per mount, so the draw holds while the page is on screen (a
	// card opening, a new render or a reload of the same data land the same way) and a
	// new visit or another team (the page is keyed by team) draws again.
	const [seed] = useState(() => random());
	const placements = useMemo(() => squadPlacements(players, court, seededRandom(seed)), [players, court, seed]);
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
							image={COURT_ART[court]}
							alt=""
							data-court={court}
							width={240}
							densities={[2]}
							loading="lazy"
						/>
						<ul className={styles['pitch-players']} aria-label="Jugadores en la cancha">
							{placements.map(({ id, player, shirtNumber, x, y }) => {
								return (
									<li
										key={id}
										className={styles['pitch-position']}
										style={{ '--x': `${x}%`, '--y': `${y}%` } as CSSProperties}
									>
										<button
											className={styles['pitch-player']}
											type="button"
											aria-label={`Ver estadísticas de ${player.name}, dorsal ${shirtNumber}`}
											aria-haspopup="dialog"
											aria-controls={dialogId(player)}
											data-stats-open={dialogId(player)}
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
											<span className={styles['pitch-name']}>{pitchName(player.name)}</span>
										</button>
									</li>
								);
							})}
						</ul>
					</div>
					<p className={styles['pitch-hint']}>Toca un jugador para ver su ficha</p>
					{/* Two facts, kept short (C-04, C-06): who is drawn and where is random,
					    so nobody stands where they really play; the shirt number is the real
					    one, which nobody would assume if only the first half were said. */}
					<p className={styles['pitch-hint']}>Jugadores y puestos al azar; dorsal real</p>
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
									<button
										className={styles.player}
										type="button"
										aria-haspopup="dialog"
										aria-controls={dialogId(player)}
										data-stats-open={dialogId(player)}
										onClick={() => open(player)}
									>
										{player.name}
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{players.map((player) => {
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
						stats={statsByPlayer.get(player.id) ?? null}
					/>
				);
			})}
		</>
	);
}
