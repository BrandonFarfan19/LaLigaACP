import leagueLogo from '../assets/logo-la-liga-acp-copa-dorada.png?pixel=logo';
import Carousel from './Carousel';
import PixelImage from './PixelImage';
import type { CarouselSlide, Team } from '../types';
import styles from './Hero.module.css';

interface Props {
	/** Read by the page loader through the data layer, never from the API directly. */
	teams: Team[];
	/** The competition on screen (D-021): shown above each crest. */
	competition?: string;
}

export default function Hero({ teams, competition }: Props) {
	// Map the domain entity onto the carousel's own contract, so the carousel
	// stays reusable for anything else we need to feature later.
	const slides: CarouselSlide[] = teams.map((team) => ({
		id: team.id,
		team,
		alt: `Escudo de ${team.name}`,
		eyebrow: competition,
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
					{/* No teams read means no figure to give: a count of 0 beside the
					    page's notice read as if the tournament had no clubs (T-22 fix). */}
					{teams.length > 0 && (
						<p className={styles.lead}>
							{teams.length === 1 ? 'El club que disputa' : `Los ${teams.length} clubes que disputan`} {competition ? `la ${competition}` : 'el torneo'}.
						</p>
					)}
				</header>

				{teams.length > 0 && <Carousel slides={slides} label="Equipos participantes" />}
			</div>
		</section>
	);
}
