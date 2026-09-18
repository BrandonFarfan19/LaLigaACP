import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { loginPathFor } from '../lib/next-path';
import type { SessionState } from '../lib/auth';
import CoinIcon from './CoinIcon';
import styles from './SessionBar.module.css';

interface SessionBarProps {
	session: SessionState;
	/** The page showing, sent back after signing in (`?next=`). */
	currentPath: string;
	onLogout: () => void;
	loggingOut: boolean;
	/** Why the last logout failed, if it did. */
	logoutError: string | null;
}

const formatCoins = new Intl.NumberFormat('es');

/**
 * The account corner of the navbar (T-18): sign in / sign up for a guest;
 * coins, account and sign out for a participant (BR-010: always visible,
 * also while pending, with 0); administration and sign out for an admin, who
 * has no coins because they don't take part (BR-001).
 */
export default function SessionBar({ session, currentPath, onLogout, loggingOut, logoutError }: SessionBarProps) {
	const { status, user } = session;

	// Nothing known yet, or the session couldn't be read (a 429, no network) and
	// nobody was known before: keep the row's room, and never claim the visitor
	// is signed out. The next page change reads the session again.
	if (status === 'unknown' || (status === 'error' && !user)) return <div className={styles.bar} aria-hidden="true" />;

	if (!user) {
		return (
			<ul className={styles.bar}>
				<li>
					<Link className={styles.link} to={loginPathFor(currentPath)}>
						Ingresar
					</Link>
				</li>
				<li>
					<Link className={`${styles.link} ${styles.primary}`} to="/registro">
						Crear cuenta
					</Link>
				</li>
			</ul>
		);
	}

	const pending = user.rol === 'apostador' && user.estadoValidacion !== 'validado';
	const coins = formatCoins.format(user.saldoMonedas);

	return (
		<>
			<ul className={styles.bar}>
				{user.rol === 'apostador' ? (
					<>
						<li>
							<Link
								className={styles.coins}
								to="/cuenta"
								aria-label={`Saldo: ${coins} ${user.saldoMonedas === 1 ? 'moneda' : 'monedas'}${pending ? '. Cuenta pendiente de validación' : ''}`}
								data-testid="coin-counter"
							>
								<CoinIcon />
								<span className={styles.amount}>{coins}</span>
								{pending && <span className={styles.badge}>Pendiente</span>}
							</Link>
						</li>
						<li className={styles.menuItem}>
							<PoolMenu currentPath={currentPath} />
						</li>
						<li>
							<Link className={styles.link} to="/cuenta">
								Mi cuenta
							</Link>
						</li>
					</>
				) : (
					<>
						<li>
							<Link className={styles.link} to="/admin">
								Admin
							</Link>
						</li>
						<li>
							<NavLink className={styles.link} to="/ranking">
								Ranking
							</NavLink>
						</li>
					</>
				)}
				<li>
					<button className={styles.link} type="button" onClick={onLogout} disabled={loggingOut} aria-busy={loggingOut || undefined}>
						{loggingOut ? 'Saliendo…' : 'Salir'}
					</button>
				</li>
			</ul>
			{logoutError && (
				<p className={`${styles.alert} pixel-box`} role="alert">
					{logoutError}
				</p>
			)}
		</>
	);
}

const POOL_LINKS = [
	{ to: '/apuestas', label: 'Apostar' },
	{ to: '/mis-apuestas', label: 'Mis apuestas' },
	{ to: '/ranking', label: 'Ranking' },
] as const;

/**
 * The pool's pages for a participant (T-20): one "Polla" button that opens
 * their links, so the session row keeps its room at 320px (D-007, D-014).
 * A disclosure: Escape or a click elsewhere closes it (Escape returns the
 * focus to the button), and so does going to another page.
 */
function PoolMenu({ currentPath }: { currentPath: string }) {
	const [open, setOpen] = useState(false);
	const listId = useId();
	const rootRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const inPool = POOL_LINKS.some((link) => currentPath === link.to || currentPath.startsWith(`${link.to}/`));

	useEffect(() => setOpen(false), [currentPath]);

	useEffect(() => {
		if (!open) return;
		const onPointer = (event: PointerEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			setOpen(false);
			buttonRef.current?.focus();
		};
		document.addEventListener('pointerdown', onPointer);
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('pointerdown', onPointer);
			document.removeEventListener('keydown', onKey);
		};
	}, [open]);

	return (
		<div
			className={styles.menu}
			ref={rootRef}
			onBlur={(event) => {
				// Tabbing out of the menu closes it. A blur with no target (a click on a
				// non-focusable spot, inside or outside) is left to the pointer handler.
				const next = event.relatedTarget as Node | null;
				if (open && next && !rootRef.current?.contains(next)) setOpen(false);
			}}
		>
			<button
				ref={buttonRef}
				type="button"
				className={styles.link}
				aria-expanded={open}
				aria-controls={listId}
				data-current={inPool || undefined}
				onClick={() => setOpen((value) => !value)}
			>
				Polla
				<span className={styles.caret} aria-hidden="true" data-open={open || undefined} />
			</button>
			<ul className={`${styles.menuList} pixel-box`} id={listId} hidden={!open}>
				{POOL_LINKS.map((link) => (
					<li key={link.to}>
						<NavLink className={styles.menuLink} to={link.to} end={link.to === '/apuestas'} onClick={() => setOpen(false)}>
							{link.label}
						</NavLink>
					</li>
				))}
			</ul>
		</div>
	);
}
