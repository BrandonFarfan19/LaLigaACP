import { useEffect, useRef, useState } from 'react';
import { isRouteErrorResponse, Link, useLocation, useRevalidator, useRouteError } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { ApiError, waitText } from '../lib/api';
import type { RoleRequired } from '../lib/route-guards';
import shared from './Apuestas.module.css';
import styles from './NotFound.module.css';

interface ErrorPageProps {
	kicker: string;
	title: string;
	lead: string;
	/** A failure worth retrying (no connection, the server down, a limit): offers "Reintentar". */
	retry?: boolean;
}

function ErrorPage({ kicker, title, lead, retry = false }: ErrorPageProps) {
	useDocumentTitle(`${title} · La Liga ACP`);
	// Inside the admin panel (T-21) its layout already leaves room for the navbar.
	const inPanel = useLocation().pathname.startsWith('/admin');

	return (
		<section className={`${styles['not-found']} ${inPanel ? styles.inPanel : ''}`} aria-labelledby="not-found-title">
			<header className={styles.head}>
				<p className={styles.kicker}>{kicker}</p>
				<h1 className={styles.title} id="not-found-title">
					{title}
				</h1>
				<p className={styles.lead}>{lead}</p>
			</header>

			{retry && <RetryButton />}

			<Link className={styles.back} to="/#inicio">
				&lt; Volver al inicio
			</Link>
		</section>
	);
}

/** The loaded page's title takes the focus (the button that had it is gone). */
function focusPageTitle() {
	const title = document.querySelector<HTMLElement>('main h1');
	if (!title) return;
	if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
	title.focus();
}

/**
 * Runs the page's loaders again: the page shows up as soon as they load, and
 * its title takes the focus. A retry that fails again says so (T-20 fix).
 */
function RetryButton() {
	const revalidator = useRevalidator();
	const error = useRouteError();
	const busy = revalidator.state !== 'idle';
	// The error the retry started from: another one means it failed again.
	const retriedFrom = useRef<unknown>(null);
	/** A retry is under way or loaded the page (not a later visit to another page after a failed one). */
	const retried = useRef(false);
	const [news, setNews] = useState('');
	useEffect(() => {
		if (retriedFrom.current === null || error === retriedFrom.current) return;
		retriedFrom.current = null;
		retried.current = false;
		setNews('Sigue sin poder cargarse. Espera un momento y vuelve a intentarlo.');
	}, [error]);
	useEffect(
		() => () => {
			// Unmounted after a retry: the page loaded.
			if (retried.current) setTimeout(focusPageTitle, 0);
		},
		[],
	);
	return (
		<>
			<p>
				{/* aria-disabled, never disabled: a disabled button would drop the focus. */}
				<button
					type="button"
					className={shared.button}
					aria-disabled={busy || undefined}
					onClick={() => {
						if (busy) return;
						retried.current = true;
						retriedFrom.current = error;
						setNews('');
						void revalidator.revalidate();
					}}
				>
					{busy ? 'Cargando…' : 'Reintentar'}
				</button>
			</p>
			<p className={styles.lead} role="status">
				{busy ? 'Cargando…' : news}
			</p>
		</>
	);
}

/** Unknown URLs, and team ids the data layer doesn't know. */
export default function NotFound() {
	return <ErrorPage kicker="Error 404" title="Página no encontrada" lead="La página que buscas no existe." />;
}

/**
 * Anything the cases below don't name: a render error (a date the API sent
 * broken reaching `formatKickoff`), a bug, something thrown that isn't an
 * `ApiError`. It is drawn like every other failure — inside the layout, with
 * the way back — and **the detail goes to the console, never to the screen**:
 * a stack trace tells a visitor nothing and says how the app is built (T-23 fix).
 */
function UnexpectedError({ error }: { error: unknown }) {
	useEffect(() => {
		console.error('La Liga ACP: error inesperado al mostrar la página.', error);
	}, [error]);
	return <ErrorPage kicker="Error inesperado" title="No se pudo mostrar la página" lead="Algo se rompió al mostrar esta página. Vuelve al inicio e inténtalo otra vez." />;
}

/**
 * Route error boundary: a 404 thrown by a loader renders the page above, a
 * 403 (a protected page for another role, T-18) says so, an API that can't be
 * reached says that, and anything else — including an error thrown while
 * rendering — is the unexpected page. Nothing reaches the router's own bare
 * screen, so the navbar and the layout are always there.
 */
export function RouteError() {
	const error = useRouteError();
	if (isRouteErrorResponse(error) && error.status === 404) return <NotFound />;
	if (isRouteErrorResponse(error) && error.status === 403) {
		// The betting pages need a participant: an admin is told why (BR-001).
		const lead =
			(error.data as RoleRequired | null)?.role === 'apostador'
				? 'Esta página es para los participantes de la polla. Los administradores no participan: no tienen monedas ni pueden apostar.'
				: (error.data as RoleRequired | null)?.role === 'admin'
					? 'Esta página es solo para administradores. Tu cuenta de participante no tiene acceso al panel.'
					: 'Tu cuenta no tiene permiso para ver esta página.';
		return <ErrorPage kicker="Error 403" title="Acceso restringido" lead={lead} />;
	}
	if (error instanceof ApiError && error.code === 'RATE_LIMITED') {
		const wait = waitText(error.retryAfterSeconds);
		return (
			<ErrorPage
				kicker="Demasiadas solicitudes"
				title="Espera un momento"
				lead={`Se hicieron demasiadas solicitudes desde esta conexión. ${wait ? `Espera ${wait}` : 'Espera unos minutos'} y vuelve a cargar la página.`}
				retry
			/>
		);
	}
	if (error instanceof ApiError && (error.status === 0 || error.status >= 500)) {
		return <ErrorPage kicker="Sin conexión" title="No se pudo cargar" lead={error.message} retry />;
	}
	if (error instanceof ApiError) {
		return <ErrorPage kicker={`Error ${error.status}`} title="No se pudo cargar" lead={error.message} />;
	}
	return <UnexpectedError error={error} />;
}
