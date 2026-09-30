import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import logo from '../assets/liga-acp-2026-pixel-art.png?pixel=logo';
import PixelImage from './PixelImage';
import styles from './Navbar.module.css';

interface NavLink {
	label: string;
	href: string;
	/** Hidden on the narrowest phones, where the logo (same destination) stands for it (C-14). */
	home?: true;
}

// Root-relative, not bare hashes: the navbar also renders on /plantilla/:id,
// where "#fixture" would point at a section that isn't on the page.
const links: NavLink[] = [
	{ label: 'Inicio', href: '/#inicio', home: true },
	{ label: 'Fixture', href: '/#fixture' },
	{ label: 'Posiciones', href: '/posiciones' },
	// C-14 (D-043): a site section, in the site's colour (C-02), not the pool's gold.
	{ label: 'En vivo', href: '/en-vivo' },
];

// Compare without a trailing slash, so `/posiciones/` still counts as current.
const trimSlash = (path: string) => path.replace(/\/+$/, '') || '/';

// A few pixels of travel is enough to count as "scrolled".
const THRESHOLD = 8;

interface NavbarProps {
	/** The account corner (`<SessionBar />`): a second row below 64rem, the end of the bar from there. */
	session: ReactNode;
}

export default function Navbar({ session }: NavbarProps) {
	const currentPath = trimSlash(useLocation().pathname);
	const isCurrent = (href: string) => !href.includes('#') && trimSlash(href) === currentPath;

	// When the sections don't fit a narrow phone the row scrolls sideways: the
	// current one is brought into it, only along the row (never the page).
	const listRef = useRef<HTMLUListElement>(null);
	useEffect(() => {
		const list = listRef.current;
		const current = list?.querySelector<HTMLElement>('[aria-current="page"]');
		if (!list || !current || list.scrollWidth <= list.clientWidth) return;
		const right = current.offsetLeft + current.offsetWidth - list.clientWidth;
		if (current.offsetLeft < list.scrollLeft) list.scrollLeft = current.offsetLeft;
		else if (right > list.scrollLeft) list.scrollLeft = right;
	}, [currentPath]);

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
			<div className={styles.inner}>
				<nav className={styles.main} aria-label="Principal">
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

					<ul className={styles.links} ref={listRef}>
						{links.map((link) => (
							<li key={link.href} className={link.home ? styles.home : undefined}>
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

				<nav className={styles.session} aria-label="Cuenta">
					{session}
				</nav>
			</div>
		</header>
	);
}
