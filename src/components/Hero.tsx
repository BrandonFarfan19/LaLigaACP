import leagueLogo from '../assets/logo-la-liga-acp-copa-dorada.png?pixel=logo';
import Carousel from './Carousel';
import PixelImage from './PixelImage';
import type { CarouselSlide, Team } from '../types';
import styles from './Hero.module.css';

interface Props {
	/** Read by the page loader through `getTeams()`, never from `src/data`. */
	teams: Team[];
}

export default function Hero({ teams }: Props) {
	// Map the domain entity onto the carousel's own contract, so the carousel
	// stays reusable for anything else we need to feature later.
	const slides: CarouselSlide[] = teams.map((team) => ({
		id: team.id,
		image: team.crest,
		alt: `Escudo de ${team.name}`,
		eyebrow: team.country,
		title: team.shortName,
		accent: team.accent,
		href: `/plantilla/${team.id}`,
		hrefLabel: `Ver plantilla de ${team.name}`,
	}));

	return (
		<section className={styles.hero} id="inicio">
			<div className={styles.content}>
				<header className={styles.intro}>
					<PixelImage
						className={`${styles['league-logo']} pixelated`}
						image={leagueLogo}
						alt="La Liga ACP"
						width={96}
						height={96}
						densities={[2]}
						loading="eager"
						fetchPriority="high"
					/>
					<h1 className={styles.title}>
						Conoce a los <span className={styles.accent}>equipos</span>
					</h1>
					<p className={styles.lead}>Los {teams.length} clubes que disputan el torneo.</p>
				</header>

				<Carousel slides={slides} label="Equipos participantes" />
			</div>
		</section>
	);
}
