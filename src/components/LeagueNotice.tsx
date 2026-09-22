import { useRevalidator } from 'react-router';
import styles from './LeagueNotice.module.css';

/**
 * What a league screen says when it could not read this time, or when there is
 * nothing to show (T-22). A failure keeps the page as it is and offers
 * "Reintentar" (the same behaviour as T-19 to T-21); an empty state just
 * explains it. Nothing here covers the page.
 */
export default function LeagueNotice({ error, empty }: { error?: string | null; empty?: string | null }) {
	const revalidator = useRevalidator();
	const busy = revalidator.state !== 'idle';
	if (!error && !empty) return null;

	if (error) {
		return (
			<div className={`${styles.notice} pixel-box`} role="alert">
				<p className={styles.text}>{error}</p>
				<p>
					<button
						type="button"
						className={styles.button}
						aria-disabled={busy || undefined}
						onClick={() => {
							if (!busy) void revalidator.revalidate();
						}}
					>
						{busy ? 'Cargando…' : 'Reintentar'}
					</button>
				</p>
			</div>
		);
	}

	return (
		<div className={`${styles.notice} pixel-box`} role="status">
			<p className={styles.text}>{empty}</p>
		</div>
	);
}
