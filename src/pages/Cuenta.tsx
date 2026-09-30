import { Link, type LoaderFunctionArgs } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';
import { requireUser } from '../lib/route-guards';
import { formatDateOnly } from '../utils/format-date';
import styles from './AuthPage.module.css';

/** Needs a session, read from the backend before anything shows (T-18, D-009). */
export async function loader(args: LoaderFunctionArgs): Promise<null> {
	await requireUser(args);
	return null;
}

/**
 * The account state (BR-005, BR-006): who is signed in and whether the
 * account is validated and paid. A pending participant is told why they can't
 * bet yet; an admin is told they don't take part. No balance or coin
 * movements since C-13 (D-042): the pool is points only.
 */
export default function Cuenta() {
	useDocumentTitle('Mi cuenta · La Liga ACP');
	// Only the live session: if it ends, nothing from it stays on screen (the layout goes to sign in).
	const { user } = useSession();
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
						Cuando lo haga podrás participar en la polla.
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
					<p>Los administradores no participan en la polla: no pueden apostar.</p>
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
						</>
					)}
				</dl>
			</div>
		</section>
	);
}
