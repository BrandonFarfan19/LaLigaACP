import { useRef, useState } from 'react';
import { Link, type LoaderFunctionArgs, useLoaderData } from 'react-router';
import CoinAmount from '../components/CoinAmount';
import CoinIcon from '../components/CoinIcon';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useRetryFocus } from '../hooks/useRetryFocus';
import { useSession } from '../hooks/useSession';
import { ApiError, waitText } from '../lib/api';
import { isPrize, listRecentMovements, MOVEMENTS_SHOWN } from '../lib/coin-history';
import { requireUser } from '../lib/route-guards';
import type { CoinMovement } from '../types/api';
import type { ApiPage } from '../types/betting';
import { formatDateOnly } from '../utils/format-date';
import styles from './AuthPage.module.css';

export interface AccountData {
	/** A participant's latest coin movements; `null` for an admin, or when the read failed (`loadError`). */
	movimientos: ApiPage<CoinMovement> | null;
	loadError: string | null;
}

/**
 * Needs a session, read from the backend before anything shows (T-18, D-009).
 * A participant's latest coin movements come too (C-09: the prizes of right
 * forecasts show there); if they can't be read, the page still shows the
 * account, with a notice and "Reintentar".
 */
export async function loader(args: LoaderFunctionArgs): Promise<AccountData> {
	const user = await requireUser(args);
	if (user.rol !== 'apostador') return { movimientos: null, loadError: null };
	try {
		return { movimientos: await listRecentMovements(args.request.signal), loadError: null };
	} catch (error) {
		if (!(error instanceof ApiError)) throw error;
		const message =
			error.code === 'RATE_LIMITED'
				? `No se pudieron cargar tus movimientos: demasiadas solicitudes. Espera ${waitText(error.retryAfterSeconds) ?? 'unos minutos'} y vuelve a intentarlo.`
				: `No se pudieron cargar tus movimientos. ${error.message}`;
		return { movimientos: null, loadError: message };
	}
}

const coins = new Intl.NumberFormat('es');

/**
 * The account state (BR-005, BR-006, BR-009): who is signed in, whether the
 * account is validated and paid, and the coin balance. A pending participant
 * is told why they can't bet yet; an admin is told they don't take part.
 */
export default function Cuenta() {
	useDocumentTitle('Mi cuenta · La Liga ACP');
	// Only the live session: if it ends, nothing from it stays on screen (the layout goes to sign in).
	const { user } = useSession();
	const data = useLoaderData<typeof loader>();
	if (!user) return null;
	const participant = user.rol === 'apostador';
	const validated = user.estadoValidacion === 'validado';
	const paid = user.estadoPago === 'confirmado';

	return (
		<section className={styles.page} aria-labelledby="account-title">
			<header className={styles.head}>
				<p className={styles.kicker}>{participant ? 'Participante' : 'Administrador'}</p>
				<h1 className={styles.title} id="account-title">
					Mi cuenta
				</h1>
				<p className={styles.lead}>Hola, {user.nombre}.</p>
			</header>

			{participant && !validated && (
				<div className={`${styles.notice} pixel-box`} role="status">
					<h2 className={styles.boxTitle}>Cuenta pendiente de validación</h2>
					<p>Todavía no puedes apostar.</p>
					<p>
						{paid
							? 'Tu pago ya está confirmado: falta que un administrador valide tu cuenta.'
							: 'Un administrador tiene que confirmar tu pago y validar tu cuenta.'}{' '}
						Cuando lo haga recibirás tus monedas y podrás participar en la polla.
					</p>
				</div>
			)}
			{participant && validated && (
				<div className={`${styles.success} pixel-box`} role="status">
					<p>Tu cuenta está validada: ya puedes participar en la polla.</p>
				</div>
			)}
			{!participant && (
				<div className={`${styles.notice} pixel-box`} role="status">
					<p>Los administradores no participan en la polla: no tienen monedas ni pueden apostar.</p>
					<p>
						<Link className={styles.textLink} to="/admin">
							Ir a administración
						</Link>
					</p>
				</div>
			)}

			<div className={`${styles.panel} pixel-box`}>
				<dl className={styles.facts}>
					<div className={styles.fact}>
						<dt>Nombre</dt>
						<dd>{user.nombre}</dd>
					</div>
					<div className={`${styles.fact} ${styles.factWide}`}>
						<dt>Correo</dt>
						<dd>{user.email}</dd>
					</div>
					<div className={styles.fact}>
						<dt>Inscripción</dt>
						<dd>{formatDateOnly(user.creadoEn)}</dd>
					</div>
					{participant && (
						<>
							<div className={styles.fact}>
								<dt>Validación</dt>
								<dd>
									<span className={`${styles.tag} ${validated ? '' : styles.tagPending}`}>{validated ? 'Validada' : 'Pendiente'}</span>
								</dd>
							</div>
							<div className={styles.fact}>
								<dt>Pago</dt>
								<dd>
									<span className={`${styles.tag} ${paid ? '' : styles.tagPending}`}>{paid ? 'Confirmado' : 'Pendiente'}</span>
								</dd>
							</div>
							<div className={styles.fact}>
								<dt>Saldo</dt>
								<dd>
									<CoinIcon />
									<span className={styles.balance}>{coins.format(user.saldoMonedas)}</span>
									<span>{user.saldoMonedas === 1 ? 'moneda' : 'monedas'}</span>
								</dd>
							</div>
						</>
					)}
				</dl>
			</div>

			{participant && <Movements data={data} />}
		</section>
	);
}

/**
 * The latest movements of the balance, newest first (BR-010): validation,
 * bets, refunds and, since C-09, the coins won by right forecasts (BR-057),
 * marked as prizes. Read only.
 */
function Movements({ data }: { data: AccountData }) {
	const { movimientos, loadError } = data;
	const countRef = useRef<HTMLParagraphElement>(null);
	const [news, setNews] = useState('');
	// "Reintentar" reads again in place, and the notice with its button goes away when it loads: the focus
	// goes to the count and it is announced (C-09 fix, like C-07). One that fails again keeps it on the
	// button, inside the notice, which is still there.
	const { retry, busy } = useRetryFocus(data, (next) => Boolean(next.movimientos), () => {
		countRef.current?.focus();
		setNews(countRef.current?.textContent ?? '');
	});
	return (
		<section className={`${styles.panel} pixel-box`} aria-labelledby="movements-title">
			<h2 className={styles.boxTitle} id="movements-title">
				Movimientos de monedas
			</h2>
			{loadError && (
				<div className={`${styles.alert} pixel-box`} role="alert">
					<p>{loadError}</p>
					<p>
						<button
							type="button"
							className={styles.button}
							aria-disabled={busy || undefined}
							onClick={retry}
						>
							{busy ? 'Cargando…' : 'Reintentar'}
						</button>
					</p>
				</div>
			)}
			{/* A live region without the status role: the pending notice above already is the page's status. */}
			<p className={styles.status} aria-live="polite" aria-atomic="true">
				{busy ? 'Cargando tus movimientos…' : news}
			</p>
			{movimientos &&
				(movimientos.total === 0 ? (
					<p className={`${styles.aside} ${styles.focusable}`} ref={countRef} tabIndex={-1}>
						Todavía no tienes movimientos.
					</p>
				) : (
					<>
						<p className={`${styles.aside} ${styles.focusable}`} ref={countRef} tabIndex={-1}>
							{movimientos.total > movimientos.items.length
								? `Los ${movimientos.items.length} más recientes de ${movimientos.total}.`
								: `${movimientos.total} ${movimientos.total === 1 ? 'movimiento' : 'movimientos'}.`}
						</p>
						<ol className={styles.movements} aria-label={`Tus últimos movimientos de monedas (hasta ${MOVEMENTS_SHOWN})`}>
							{movimientos.items.map((movement) => (
								<li key={movement.id} className={styles.movement} data-premio={isPrize(movement) || undefined}>
									<span className={styles.movementWhat}>
										{isPrize(movement) && <span className={styles.tag}>Premio</span>}
										{movement.tipo.nombre}
									</span>
									<time className={styles.movementWhen} dateTime={movement.creadoEn}>
										{formatDateOnly(movement.creadoEn)}
									</time>
									<CoinAmount amount={movement.cantidad} signed />
								</li>
							))}
						</ol>
					</>
				))}
		</section>
	);
}
