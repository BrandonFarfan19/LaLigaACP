import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import logo from '../assets/logo-la-liga-acp-copa-dorada.png?pixel=logo';
import PixelImage from './PixelImage';
import styles from './Navbar.module.css';

interface NavLink {
	label: string;
	href: string;
}

// Root-relative, not bare hashes: the navbar also renders on /plantilla/:id,
// where "#fixture" would point at a section that isn't on the page.
const links: NavLink[] = [
	{ label: 'Inicio', href: '/#inicio' },
	{ label: 'Fixture', href: '/#fixture' },
	{ label: 'Posiciones', href: '/posiciones' },
];

// Compare without a trailing slash, so `/posiciones/` still counts as current.
const trimSlash = (path: string) => path.replace(/\/+$/, '') || '/';

// A few pixels of travel is enough to count as "scrolled".
const THRESHOLD = 8;

export default function Navbar() {
	const currentPath = trimSlash(useLocation().pathname);
	const isCurrent = (href: string) => !href.includes('#') && trimSlash(href) === currentPath;

	const [scrolled, setScrolled] = useState(false);

	useEffect(() => {
		let ticking = false;
		let frame = 0;

		const sync = () => {
			setScrolled(window.scrollY > THRESHOLD);
			ticking = false;
		};

		// Coalesce scroll events into one read per frame.
		const onScroll = () => {
			if (ticking) return;
			ticking = true;
			frame = requestAnimationFrame(sync);
		};

		sync(); // Restored scroll position on reload starts in the right state.
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => {
			cancelAnimationFrame(frame);
			window.removeEventListener('scroll', onScroll);
		};
	}, []);

	return (
		<header className={styles.navbar} data-navbar data-scrolled={scrolled ? '' : undefined}>
			<nav className={styles.inner} aria-label="Principal">
				<Link className={styles.brand} to="/#inicio" aria-label="La Liga ACP, inicio">
					{/* Rendered small on purpose, then upscaled with nearest-neighbour
					    so the cup reads as a sprite rather than a shrunk photo. */}
					<PixelImage
						className={`${styles.logo} pixelated`}
						image={logo}
						alt=""
						width={32}
						height={32}
						densities={[2]}
						loading="eager"
					/>
					<span className={styles.wordmark}>
						La Liga <span className={styles.accent}>ACP</span>
					</span>
				</Link>

				<ul className={styles.links}>
					{links.map((link) => (
						<li key={link.href}>
							<Link
								className={styles.link}
								to={link.href}
								aria-current={isCurrent(link.href) ? 'page' : undefined}
							>
								{link.label}
							</Link>
						</li>
					))}
				</ul>
			</nav>
		</header>
	);
}
