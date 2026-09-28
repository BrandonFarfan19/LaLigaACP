import PixelImage from './PixelImage';
import grupoAcp from '../assets/empresas/grupo-acp-verde.png?pixel=company';
import finantty from '../assets/empresas/finantty.png?pixel=company';
import finzul from '../assets/empresas/finzul.webp?pixel=company';
import styles from './Footer.module.css';

/**
 * Company logos under every page. On phones they are a plain list with
 * Grupo ACP first; from 48rem Grupo ACP sits above the other two, forming a
 * triangle. The list order is the reading order in both layouts.
 */
const COMPANIES = [
	{ name: 'Grupo ACP', image: grupoAcp, className: styles.top },
	{ name: 'Finantty', image: finantty },
	{ name: 'Finzul', image: finzul },
];

export default function Footer() {
	return (
		<footer className={styles.footer}>
			<ul className={styles.list} aria-label="Empresas">
				{COMPANIES.map(({ name, image, className }) => (
					<li key={name} className={className}>
						<PixelImage className={`pixelated ${styles.logo}`} image={image} width={96} densities={[2]} alt={name} />
					</li>
				))}
			</ul>
		</footer>
	);
}
