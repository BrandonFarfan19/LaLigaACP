import { isRouteErrorResponse, Link, useRouteError } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import styles from './NotFound.module.css';

/** Unknown URLs, and team ids the data layer doesn't know. */
export default function NotFound() {
	useDocumentTitle('Página no encontrada · La Liga ACP');

	return (
		<section className={styles['not-found']} aria-labelledby="not-found-title">
			<header className={styles.head}>
				<p className={styles.kicker}>Error 404</p>
				<h1 className={styles.title} id="not-found-title">
					Página no encontrada
				</h1>
				<p className={styles.lead}>La página que buscas no existe.</p>
			</header>

			<Link className={styles.back} to="/#inicio">
				&lt; Volver al inicio
			</Link>
		</section>
	);
}

/** Route error boundary: a 404 thrown by a loader renders the page above. */
export function RouteError() {
	const error = useRouteError();
	if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
	throw error;
}
