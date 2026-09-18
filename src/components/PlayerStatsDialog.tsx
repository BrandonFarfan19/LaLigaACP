import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type Ref } from 'react';
// Placeholder portrait shared by every player until real photos exist.
import portrait from '../assets/jugadoresPixel/futbol/jugador-marron-claro-fifa2002.png?pixel=portrait';
import { GRID, radarLabels, rasterizeRadar, type RadarPixel } from '../utils/pixel-radar';
import { captureElement } from '../utils/share-image';
import PixelImage from './PixelImage';
import type { Player, PlayerStatKey, PlayerStats } from '../types';
import styles from './PlayerStatsDialog.module.css';

/**
 * A player's attribute card: portrait, pixel radar and the numbers behind
 * it, in a native modal `<dialog>`. `SquadBoard` opens it from the player's
 * buttons, or on landing with `#<this dialog's id>` — the link the share
 * buttons hand out. The shared image is a capture of this dialog itself.
 */
interface Props {
	ref?: Ref<HTMLDialogElement>;
	id: string;
	/** For the share text: "Plantilla de <team> en La Liga ACP". */
	teamName: string;
	player: Player;
	stats: PlayerStats;
}

// Axis order around the radar, clockwise from the top.
const ATTRIBUTES: { key: PlayerStatKey; short: string; label: string }[] = [
	{ key: 'shooting', short: 'DIS', label: 'Disparo' },
	{ key: 'passing', short: 'PAS', label: 'Pase' },
	{ key: 'strength', short: 'FUE', label: 'Fuerza' },
	{ key: 'defense', short: 'DEF', label: 'Defensa' },
	{ key: 'speed', short: 'VEL', label: 'Velocidad' },
	{ key: 'dribbling', short: 'DRI', label: 'Dribbling' },
];

const labels = radarLabels(ATTRIBUTES.length);

/** Every kind `rasterizeRadar()` produces; matches the CSS Module classes below. */
const RADAR_KINDS: RadarPixel[] = ['disc', 'ring', 'fill', 'edge'];

/** Desktop: the networks only take a link, so they get the team page's. */
const WEB_SHARE: Record<string, ((url: string, text: string) => string) | undefined> = {
	whatsapp: (url, text) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`,
	facebook: (url) => `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
};

let sharesImagesResult: boolean | undefined;

/**
 * A phone with a share sheet that takes files. Only then does sharing
 * carry the image; everywhere else it is the team link alone. Checked once.
 */
function sharesImages(): boolean {
	if (sharesImagesResult === undefined) {
		const probe = new File([''], 'probe.png', { type: 'image/png' });
		sharesImagesResult = matchMedia('(pointer: coarse)').matches && Boolean(navigator.canShare?.({ files: [probe] }));
	}
	return sharesImagesResult;
}

const NETWORKS = [
	{ key: 'whatsapp', label: 'WhatsApp' },
	{ key: 'facebook', label: 'Facebook' },
	{ key: 'instagram', label: 'Instagram' },
];

export default function PlayerStatsDialog({ ref, id, teamName, player, stats }: Props) {
	const dialogRef = useRef<HTMLDialogElement>(null);
	const radarRef = useRef<SVGSVGElement>(null);
	const image = useRef<Promise<File> | null>(null);
	const [status, setStatus] = useState('');
	const withImages = sharesImages();

	const values = ATTRIBUTES.map((attribute) => stats[attribute.key]);
	const average = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
	const runs = rasterizeRadar(values);
	const titleId = `${id}-title`;

	const playerText = `${player.name} · Media ${average} en La Liga ACP`;
	const teamText = `Plantilla de ${teamName} en La Liga ACP`;
	const teamUrl = () => `${location.origin}${location.pathname}`;
	// On a phone the link opens this player's card; on desktop it is the team page.
	const shareUrl = () => (withImages ? `${teamUrl()}#${id}` : teamUrl());

	// Captured as soon as the dialog opens, so by the time a button is
	// tapped the file is ready and the share sheet still counts as a
	// response to that tap.
	const getImage = () =>
		(image.current ??= captureElement(dialogRef.current!)
			.then((blob) => new File([blob], `la-liga-acp-${player.id}.png`, { type: 'image/png' }))
			.catch((error) => {
				image.current = null;
				throw error;
			}));

	useEffect(() => {
		const dialog = dialogRef.current;
		if (!dialog || !withImages) return;
		const observer = new MutationObserver(() => {
			if (dialog.open) getImage().catch(() => {});
		});
		observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
		return () => observer.disconnect();
		// `getImage` only reads refs, so the observer is set up once per dialog.
	}, [withImages]);

	/**
	 * `html-to-image` (via `captureElement`) clones this `<svg>` with a plain
	 * `cloneNode(true)` and never inlines computed style onto its descendants,
	 * nor embeds this stylesheet in the exported document — see the note in
	 * `share-image.ts`. Every `<rect>` would keep only its CSS Module `class`,
	 * which resolves to nothing there, and SVG's initial `fill: black` would
	 * paint the whole radar as one solid black disc: the bug this works around.
	 *
	 * A presentation attribute is the lowest-priority source of `fill` in the
	 * cascade, so copying the resolved color onto `fill="…"` changes nothing on
	 * screen — the class rule keeps winning here — and becomes the only paint
	 * source once the class is gone.
	 */
	useLayoutEffect(() => {
		const svg = radarRef.current;
		if (!svg) return;
		for (const kind of RADAR_KINDS) {
			const rects = svg.getElementsByClassName(styles[kind]);
			if (rects.length === 0) continue;
			const fill = getComputedStyle(rects[0]).fill;
			for (const rect of rects) rect.setAttribute('fill', fill);
		}
	}, []);

	const shareTo = async (network: string) => {
		setStatus('');

		if (!withImages) {
			const target = WEB_SHARE[network];
			if (target) window.open(target(teamUrl(), teamText), '_blank', 'noopener,noreferrer');
			return;
		}

		try {
			const file = await getImage();
			// Instagram drops shares that carry text; the others use it as the caption.
			await navigator.share(
				network === 'instagram' ? { files: [file] } : { files: [file], text: `${playerText} ${shareUrl()}` },
			);
		} catch (error) {
			if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('No se pudo compartir');
		}
	};

	const copyLink = async () => {
		const url = shareUrl();
		try {
			await navigator.clipboard.writeText(url);
			setStatus('¡Enlace copiado!');
		} catch {
			setStatus(url);
		}
	};

	return (
		<dialog
			ref={(dialog) => {
				dialogRef.current = dialog;
				if (typeof ref === 'function') return ref(dialog);
				if (ref) ref.current = dialog;
			}}
			className={`${styles.stats} pixel-box`}
			id={id}
			aria-labelledby={titleId}
			data-player-card
			data-player-id={player.id}
			// A click that lands on the dialog element itself hit the backdrop.
			onClick={(event) => {
				if (event.target === event.currentTarget) event.currentTarget.close();
			}}
			onClose={() => setStatus('')}
		>
			<header className={styles.head}>
				<div>
					<h2 className={styles.name} id={titleId}>
						{player.name}
					</h2>
					<p className={styles.average}>
						Media <span className={styles['average-value']}>{average}</span>
					</p>
					{/* D-022: the six attributes are a sample; the player and the squad are real. */}
					<p className={styles.sample}>Atributos de muestra: todavía no hay estadísticas oficiales.</p>
				</div>
				<form method="dialog" data-capture-exclude>
					<button className={styles.close} aria-label="Cerrar">
						X
					</button>
				</form>
			</header>

			<div className={styles.body}>
				{/* Rendered small and upscaled ×2 by CSS: real pixel art. */}
				<figure className={`${styles.portrait} pixel-bevel`}>
					<PixelImage
						className={`${styles['portrait-art']} pixelated`}
						image={portrait}
						alt=""
						width={96}
						loading="eager"
						data-card-portrait
					/>
				</figure>

				{/* Decorative: the table below carries every value. */}
				<div className={styles.radar} aria-hidden="true">
					<svg ref={radarRef} viewBox={`0 0 ${GRID} ${GRID}`} shapeRendering="crispEdges">
						{runs.map((run) => (
							<rect
								key={`${run.x}-${run.y}`}
								className={styles[run.kind]}
								x={run.x}
								y={run.y}
								width={run.width}
								height="1"
							/>
						))}
					</svg>
					{ATTRIBUTES.map((attribute, i) => (
						<span
							key={attribute.key}
							className={styles.axis}
							style={{ left: `${labels[i].left}%`, top: `${labels[i].top}%` }}
						>
							{attribute.short}
						</span>
					))}
				</div>

				<table className={styles.values}>
					<caption className={styles['visually-hidden']}>Estadísticas de {player.name}</caption>
					<tbody>
						{ATTRIBUTES.map((attribute) => (
							<tr key={attribute.key} style={{ '--value': stats[attribute.key] } as CSSProperties}>
								<th scope="row">{attribute.label}</th>
								<td>{stats[attribute.key]}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>

			{/* Left out of the captured image. */}
			<footer className={styles['share-bar']} data-capture-exclude data-share>
				<p className={styles['share-title']}>Compartir</p>
				<div className={styles['share-grid']}>
					{NETWORKS.map((network) => (
						<button
							key={network.key}
							className={styles['share-option']}
							type="button"
							data-share-to={network.key}
							// Instagram has no web share link: it only takes the image from the phone's sheet.
							hidden={network.key === 'instagram' && !withImages}
							onClick={() => shareTo(network.key)}
						>
							{network.label}
						</button>
					))}
					<button className={styles['share-option']} type="button" data-share-copy onClick={copyLink}>
						Copiar enlace
					</button>
				</div>
				<p className={styles['share-status']} role="status" data-share-status>
					{status}
				</p>
			</footer>
		</dialog>
	);
}
