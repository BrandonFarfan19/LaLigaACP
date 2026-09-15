import { Outlet, useLocation } from 'react-router';
import Navbar from '../components/Navbar';
import { useScrollManagement } from '../hooks/useScrollManagement';
import bgDesktop from '../assets/backgrounds/estadio-aficion.png?pixel=backdrop-landscape';
import bgMobile from '../assets/backgrounds/estadio-aficion-vertical.png?pixel=backdrop-portrait';
import styles from './Base.module.css';

/**
 * Shell shared by every route: stadium backdrop, navbar and `<main>`. The
 * `<head>` (charset, viewport, favicon) lives in `index.html`; each page sets
 * its own title with `useDocumentTitle()`.
 *
 * The backdrop is rendered small and upscaled by CSS with nearest-neighbour,
 * like every other image here — it is what makes the crowd read as a tiled
 * background rather than a photo sitting behind pixel art.
 */
export default function Base() {
	useScrollManagement();
	const { pathname } = useLocation();

	const landscape = bgDesktop['480'];
	const portrait = bgMobile['240'];

	return (
		<>
			{/* Art direction: the portrait crop on phones, the landscape one from
			    48rem up. `<source media>` means only one of the two is downloaded. */}
			<picture className={styles.backdrop} aria-hidden="true">
				<source media="(min-width: 48rem)" srcSet={landscape.src} />
				<img
					className="pixelated"
					src={portrait.src}
					alt=""
					width={portrait.width}
					height={portrait.height}
					loading="eager"
					fetchPriority="high"
				/>
			</picture>

			{/* A new page gets a fresh bar, as a page load did: without the key its
			    panel would fade out while the new route jumps to the top. */}
			<Navbar key={pathname} />
			<main className={styles.main}>
				<Outlet />
			</main>
		</>
	);
}
