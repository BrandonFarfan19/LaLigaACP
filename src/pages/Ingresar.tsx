import { useRef } from 'react';
import { type ActionFunctionArgs, Form, Link, redirect, useActionData, useLocation, useNavigation, useSearchParams } from 'react-router';
import TextField from '../components/TextField';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useFocusOnError } from '../hooks/useFocusOnError';
import { login } from '../lib/auth';
import { failureOf, type FormFailure } from '../lib/auth-messages';
import { checkLogin, PASSWORD_MAX_LENGTH } from '../lib/auth-rules';
import { guestOnly, homeFor } from '../lib/route-guards';
import { safeNextPath } from '../lib/next-path';
import styles from './AuthPage.module.css';

/** Someone already signed in goes straight on. */
export const loader = guestOnly;

interface LoginResult extends Partial<FormFailure> {
	email: string;
}

/**
 * Signs in (BR-004) and goes back to `next`, which comes from this page's
 * URL: only an in-app path is accepted (`safeNextPath`), and it is never sent
 * to the API.
 */
export async function action({ request }: ActionFunctionArgs): Promise<LoginResult | Response> {
	const form = await request.formData();
	const email = String(form.get('email') ?? '');
	const password = String(form.get('password') ?? '');
	const next = form.get('next');

	const errors = checkLogin({ email, password });
	if (Object.keys(errors).length > 0) {
		return { email, formError: 'Revisa los datos marcados.', fieldErrors: errors };
	}
	try {
		const user = await login(email.trim(), password);
		return redirect(safeNextPath(typeof next === 'string' ? next : null, homeFor(user)));
	} catch (error) {
		return { email, ...failureOf(error, 'login') };
	}
}

export default function Ingresar() {
	useDocumentTitle('Ingresar · La Liga ACP');
	const result = useActionData<LoginResult>();
	const navigation = useNavigation();
	const [params] = useSearchParams();
	const location = useLocation();
	const formRef = useRef<HTMLFormElement>(null);
	const alertRef = useRef<HTMLDivElement>(null);
	useFocusOnError(result, formRef, alertRef);

	const submitting = navigation.state !== 'idle' && navigation.formAction?.startsWith('/ingresar') === true;
	const next = params.get('next') ?? '';
	// The email just registered, handed over by /registro in the history state (never in the URL).
	const registeredEmail = (location.state as { email?: unknown } | null)?.email;
	const defaultEmail = result?.email ?? (typeof registeredEmail === 'string' ? registeredEmail : '');
	const errors = result?.fieldErrors ?? {};

	return (
		<section className={styles.page} aria-labelledby="login-title">
			<header className={styles.head}>
				<p className={styles.kicker}>Polla deportiva</p>
				<h1 className={styles.title} id="login-title">
					Ingresar
				</h1>
				<p className={styles.lead}>Entra con tu correo para ver tus monedas y participar en la polla.</p>
			</header>

			<div className={`${styles.panel} pixel-box`}>
				{result?.formError && (
					<div className={`${styles.alert} pixel-box`} role="alert" tabIndex={-1} ref={alertRef}>
						<p>{result.formError}</p>
					</div>
				)}

				{/* The page's own query stays in the action, so a failed attempt keeps `?next=`. */}
				<Form method="post" action={`/ingresar${location.search}`} className={styles.form} noValidate ref={formRef} aria-labelledby="login-title">
					<input type="hidden" name="next" value={next} />
					<TextField
						label="Correo"
						name="email"
						type="email"
						autoComplete="username"
						inputMode="email"
						spellCheck={false}
						required
						defaultValue={defaultEmail}
						key={`email-${defaultEmail}`}
						error={errors.email}
					/>
					<TextField
						label="Contraseña"
						name="password"
						type="password"
						autoComplete="current-password"
						required
						maxLength={PASSWORD_MAX_LENGTH}
						error={errors.password}
					/>
					<button className={styles.button} type="submit" disabled={submitting} aria-busy={submitting || undefined}>
						{submitting ? 'Ingresando…' : 'Ingresar'}
					</button>
				</Form>
			</div>

			<p className={styles.aside}>
				¿No tienes cuenta?{' '}
				<Link className={styles.textLink} to="/registro">
					Crear una cuenta
				</Link>
			</p>
		</section>
	);
}
