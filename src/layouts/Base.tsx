import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useRevalidator } from 'react-router';
import Navbar from '../components/Navbar';
import SessionBar from '../components/SessionBar';
import { useRequestedPath } from '../hooks/useRequestedPath';
import { useScrollManagement } from '../hooks/useScrollManagement';
import { useSession } from '../hooks/useSession';
import { ApiError } from '../lib/api';
import { cachedSession, logout } from '../lib/auth';
import { loginPathFor } from '../lib/next-path';
import { isProtectedPath } from '../lib/route-guards';
import { clearAllDrafts } from '../lib/ticket-draft';
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
 *
 * It also keeps the session current (T-18, D-009) for the coin counter and
 * the account corner (BR-010): on a page change or when the tab becomes
 * visible again it uses the session copy while it is fresh
 * (`SESSION_CACHE_MS`) and reads `/auth/me` otherwise. Protected pages read
 * it themselves in their loader. If the session ends while a protected page
 * is showing (a 401 anywhere), it goes to sign in; if the role changes, the
 * page's loader runs again.
 */
export default function Base() {
	useScrollManagement();
	const { pathname, search, hash } = useLocation();
	const navigate = useNavigate();
	const revalidator = useRevalidator();
	const session = useSession();
	const [loggingOut, setLoggingOut] = useState(false);
	const [logoutError, setLogoutError] = useState<string | null>(null);
	/** Set while signing out on purpose: that exit goes home, not to sign in. */
	const leaving = useRef(false);
	const current = `${pathname}${search}${hash}`;

	useEffect(() => {
		leaving.current = false;
		// A failed read keeps the last known state; the navbar still works.
		cachedSession().catch(() => undefined);
		setLogoutError(null);
	}, [pathname]);

	useEffect(() => {
		const onVisible = () => {
			if (document.visibilityState === 'visible') cachedSession().catch(() => undefined);
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => document.removeEventListener('visibilitychange', onVisible);
	}, []);

	const requested = useRequestedPath(current);

	// The session changed under a protected page: never keep showing it as it was.
	const userKey = session.status === 'ready' ? (session.user ? `${session.user.id}:${session.user.rol}` : 'none') : null;
	const shownFor = useRef<string | null>(null);
	useEffect(() => {
		if (!isProtectedPath(pathname) || userKey === null) {
			shownFor.current = userKey;
			return;
		}
		const previous = shownFor.current;
		shownFor.current = userKey;
		if (previous === userKey || leaving.current) return;
		if (userKey === 'none') {
			// Sign in with the URL asked for, not with what is still on screen (T-21 fix).
			const target = requested();
			if (isProtectedPath(target.split(/[?#]/)[0]!)) navigate(loginPathFor(target), { replace: true });
		}
		else if (previous !== null) void revalidator.revalidate();
	}, [userKey, pathname, current, navigate, revalidator, requested]);

	const onLogout = useCallback(async () => {
		setLoggingOut(true);
		setLogoutError(null);
		leaving.current = isProtectedPath(pathname);
		try {
			await logout();
			// D-012: signing out removes the ticket being built.
			clearAllDrafts();
			if (leaving.current) navigate('/', { replace: true });
		} catch (error) {
			leaving.current = false;
			setLogoutError(error instanceof ApiError ? `No se pudo cerrar la sesión. ${error.message}` : 'No se pudo cerrar la sesión.');
		} finally {
			setLoggingOut(false);
		}
	}, [navigate, pathname]);

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
			<Navbar
				key={pathname}
				session={
					<SessionBar
						session={session}
						currentPath={`${pathname}${search}${hash}`}
						onLogout={onLogout}
						loggingOut={loggingOut}
						logoutError={logoutError}
					/>
				}
			/>
			<main className={styles.main}>
				<Outlet />
			</main>
		</>
	);
}
