import { useRef } from 'react';
import { useLoaderData, type LoaderFunctionArgs } from 'react-router';
import { useCrtHole } from '../hooks/useCrtHole';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRetryFocus } from '../hooks/useRetryFocus';
import { isTransientError } from '../lib/api';
import { getLiveStream } from '../lib/live-stream';
import { leagueLoadError } from '../lib/league-view';
import type { LiveStream } from '../types/api';
import styles from './EnVivo.module.css';

/**
 * «En vivo» (C-14, D-043): the site's one live stream, a public Facebook
 * video the admin sets from the panel. Informative and public: no session.
 *
 * The player loads **only** the `embedUrl` the API sends (Facebook's video
 * plugin, built by the backend from the canonical link and checked again by
 * `liveStreamOf`): never an address built here, never HTML from the admin.
 * The iframe is sandboxed with what the plugin needs to play (`PLAYER_SANDBOX`)
 * and sends only the origin as referrer.
 */

/**
 * What Facebook's video plugin needs inside the sandbox, and nothing more:
 * - `allow-scripts`: the player is a script;
 * - `allow-same-origin`: it keeps its own origin (facebook.com) to read its
 *   cookies and storage; without it the plugin shows an error instead of the video;
 * - `allow-popups` and `allow-popups-to-escape-sandbox`: its links («Ver en
 *   Facebook», the page name) open facebook.com in a new tab, which must not
 *   inherit the sandbox or Facebook won't work there;
 * - `allow-presentation`: casting the video from the player.
 * No `allow-forms`, `allow-top-navigation` or `allow-modals`: it never needs to
 * send a form, move this page or open a dialog over it.
 */
export const PLAYER_SANDBOX = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation';

/** What the player may use: its own autoplay (not on phones), copying its link, protected media and picture in picture. */
export const PLAYER_ALLOW = 'autoplay; clipboard-write; encrypted-media; picture-in-picture';

type Loaded = { stream: LiveStream; loadError?: undefined } | { stream: null; loadError: string };

export async function loader({ request }: LoaderFunctionArgs): Promise<Loaded> {
	try {
		return { stream: await getLiveStream(request.signal) };
	} catch (error) {
		// No network, 5xx, 429 or a body that isn't the contract: the page stays, with its notice and «Reintentar».
		if (!isTransientError(error)) throw error;
		return { stream: null, loadError: leagueLoadError(error).replace('la liga', 'la transmisión') };
	}
}

export default function EnVivo() {
	const data = useLoaderData<typeof loader>();
	const { stream, loadError } = data;
	useDocumentTitle('En vivo · La Liga ACP');
	// A «Reintentar» that loads moves the focus to what it loaded; one that fails again keeps it on the button.
	const contentRef = useRef<HTMLDivElement>(null);
	const { retry, busy } = useRetryFocus(data, (next) => !next.loadError, () => contentRef.current?.focus());
	// The site's scanlines never draw over the player (C-14 fix).
	const frameRef = useRef<HTMLDivElement>(null);
	useCrtHole(frameRef, Boolean(!loadError && stream?.embedUrl && stream.url));

	return (
		<section className={styles.page} aria-labelledby="live-title" aria-busy={busy || undefined}>
			<header className={styles.head}>
				<p className={styles.kicker}>Transmisión</p>
				<h1 className={styles.title} id="live-title">
					En vivo
				</h1>
				<p className={styles.lead}>La transmisión de los partidos de la liga, en directo desde Facebook.</p>
			</header>

			{loadError ? (
				<div className={`${styles.notice} pixel-box`} role="alert">
					<p className={styles.text}>{loadError}</p>
					<p>
						<button type="button" className={styles.button} onClick={retry} aria-disabled={busy || undefined}>
							{busy ? 'Cargando…' : 'Reintentar'}
						</button>
					</p>
				</div>
			) : (
				<div className={styles.content} ref={contentRef} tabIndex={-1}>
					{stream?.embedUrl && stream.url ? (
						<>
							<div className={`${styles.frame} pixel-box`} ref={frameRef}>
								<iframe
									className={styles.player}
									src={stream.embedUrl}
									title="Transmisión en vivo de La Liga ACP (Facebook)"
									sandbox={PLAYER_SANDBOX}
									allow={PLAYER_ALLOW}
									allowFullScreen
									referrerPolicy="strict-origin-when-cross-origin"
									loading="lazy"
								/>
							</div>
							<p className={styles.note}>
								Si el video no carga, ábrelo en Facebook:{' '}
								<a className={styles.link} href={stream.url} target="_blank" rel="noopener noreferrer">
									Ver la transmisión en Facebook
								</a>
							</p>
						</>
					) : (
						<div className={`${styles.notice} pixel-box`} role="status">
							<p className={styles.text}>No hay transmisión en vivo en este momento.</p>
						</div>
					)}
				</div>
			)}
		</section>
	);
}
