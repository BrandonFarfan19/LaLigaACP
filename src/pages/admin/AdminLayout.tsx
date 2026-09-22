import { NavLink, Outlet } from 'react-router';
import { useSession } from '../../hooks/useSession';
import styles from './Admin.module.css';

/** The panel's sections, in the order an admin works through them. */
export const ADMIN_SECTIONS = [
	{ to: '/admin', label: 'Resumen' },
	{ to: '/admin/participantes', label: 'Participantes' },
	{ to: '/admin/partidos', label: 'Partidos' },
	{ to: '/admin/apuestas', label: 'Apuestas' },
	{ to: '/admin/ranking', label: 'Ranking' },
	{ to: '/admin/deportes', label: 'Deportes' },
	{ to: '/admin/competiciones', label: 'Competiciones' },
	{ to: '/admin/equipos', label: 'Equipos' },
	{ to: '/admin/jugadores', label: 'Jugadores' },
	{ to: '/admin/planteles', label: 'Planteles' },
	{ to: '/admin/auditoria', label: 'Auditoría' },
] as const;

/**
 * `/admin` and its sections (T-21). Each section's loader checks the session
 * and the role itself (`requireKnownUser(args, 'admin')`); this shell only
 * adds the panel's navigation, and only for an admin, so a participant who
 * lands here sees the 403 page alone. The navigation is a list of links
 * that wraps (44px targets, nothing cut at 320px, D-014); the site navbar
 * stays as it is (D-007, D-018).
 */
export default function AdminLayout() {
	const { user } = useSession();
	const admin = user?.rol === 'admin';
	return (
		<div className={styles.layout}>
			{admin && (
				<nav className={`${styles.nav} pixel-box`} aria-label="Secciones del panel">
					<p className={styles.navTitle}>Panel de administración</p>
					<ul className={styles.navList}>
						{ADMIN_SECTIONS.map((section) => (
							<li key={section.to}>
								<NavLink className={styles.navLink} to={section.to} end={section.to === '/admin'}>
									{section.label}
								</NavLink>
							</li>
						))}
					</ul>
				</nav>
			)}
			<Outlet />
		</div>
	);
}
