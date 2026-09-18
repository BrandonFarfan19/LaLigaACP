import { useEffect, useRef } from 'react';
import { type ActionFunctionArgs, Form, Link, useActionData, useNavigation } from 'react-router';
import TextField from '../components/TextField';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useFocusOnError } from '../hooks/useFocusOnError';
import { register } from '../lib/auth';
import { failureOf, type FormFailure } from '../lib/auth-messages';
import { checkRegistration, EMAIL_MAX_LENGTH, NOMBRE_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/auth-rules';
import { guestOnly } from '../lib/route-guards';
import styles from './AuthPage.module.css';

/** Someone already signed in doesn't need a new account. */
export const loader = guestOnly;

type RegisterResult =
	| { ok: true; email: string }
	| ({ ok: false; nombre: string; email: string } & FormFailure);

/**
 * BR-003: every account is born a pending participant with 0 coins, and
 * registering doesn't sign in. The backend decides; the checks here only help.
 */
export async function action({ request }: ActionFunctionArgs): Promise<RegisterResult> {
	const form = await request.formData();
	const nombre = String(form.get('nombre') ?? '');
	const email = String(form.get('email') ?? '');
	const password = String(form.get('password') ?? '');

	const errors = checkRegistration({ nombre, email, password });
	if (Object.keys(errors).length > 0) {
		return { ok: false, nombre, email, formError: 'Revisa los datos marcados.', fieldErrors: errors };
	}
	try {
		const user = await register(nombre.trim(), email.trim(), password);
		return { ok: true, email: user.email };
	} catch (error) {
		return { ok: false, nombre, email, ...failureOf(error, 'register') };
	}
}

export default function Registro() {
	useDocumentTitle('Crear cuenta · La Liga ACP');
	const result = useActionData<RegisterResult>();
	const navigation = useNavigation();
	const formRef = useRef<HTMLFormElement>(null);
	const alertRef = useRef<HTMLDivElement>(null);
	const successRef = useRef<HTMLDivElement>(null);
	const failure = result && !result.ok ? result : undefined;
	useFocusOnError(failure, formRef, alertRef);

	useEffect(() => {
		if (result?.ok) successRef.current?.focus();
	}, [result]);

	const submitting = navigation.state !== 'idle' && navigation.formAction?.startsWith('/registro') === true;
	const errors = failure?.fieldErrors ?? {};

	return (
		<section className={styles.page} aria-labelledby="register-title">
			<header className={styles.head}>
				<p className={styles.kicker}>Polla deportiva</p>
				<h1 className={styles.title} id="register-title">
					Crear cuenta
				</h1>
				<p className={styles.lead}>Regístrate para participar en la polla. Un administrador valida cada cuenta.</p>
			</header>

			{result?.ok ? (
				<div className={`${styles.success} pixel-box`} role="status" tabIndex={-1} ref={successRef}>
					<h2 className={styles.boxTitle}>Cuenta creada</h2>
					<p>
						Tu cuenta <strong>{result.email}</strong> quedó <strong>pendiente de validación</strong>.
					</p>
					<p>
						Ya puedes ingresar y recorrer la polla, pero no podrás apostar hasta que un administrador confirme tu pago y valide tu
						cuenta. Entonces recibirás tus monedas.
					</p>
					<p>
						<Link className={styles.textLink} to="/ingresar" state={{ email: result.email }}>
							Ir a ingresar
						</Link>
					</p>
				</div>
			) : (
				<>
					<div className={`${styles.panel} pixel-box`}>
						{failure?.formError && (
							<div className={`${styles.alert} pixel-box`} role="alert" tabIndex={-1} ref={alertRef}>
								<p>{failure.formError}</p>
								{failure.code === 'EMAIL_TAKEN' && (
									<p>
										<Link className={styles.textLink} to="/ingresar" state={{ email: failure.email }}>
											Ingresar con ese correo
										</Link>
									</p>
								)}
							</div>
						)}

						<Form method="post" action="/registro" className={styles.form} noValidate ref={formRef} aria-labelledby="register-title">
							<TextField
								label="Nombre a mostrar"
								name="nombre"
								autoComplete="nickname"
								required
								maxLength={NOMBRE_MAX_LENGTH}
								defaultValue={failure?.nombre}
								hint="Es el nombre que verán los demás en el ranking. Debe tener al menos una letra o un número."
								error={errors.nombre}
							/>
							<TextField
								label="Correo"
								name="email"
								type="email"
								autoComplete="email"
								inputMode="email"
								spellCheck={false}
								required
								maxLength={EMAIL_MAX_LENGTH}
								defaultValue={failure?.email}
								hint="Con él ingresarás. No se muestra a nadie."
								error={errors.email}
							/>
							<TextField
								label="Contraseña"
								name="password"
								type="password"
								autoComplete="new-password"
								required
								// No native minLength/maxLength: the browser counts UTF-16 units, so it
								// would cut a password of emoji halfway and disagree with the rule.
								// `checkRegistration` and the backend count characters (C-01).
								hint={`De ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres. Nada más: no hacen falta mayúsculas, números ni símbolos. Algunos emoji, como una familia o una bandera, cuentan más de un carácter.`}
								error={errors.password}
							/>
							<button className={styles.button} type="submit" disabled={submitting} aria-busy={submitting || undefined}>
								{submitting ? 'Creando…' : 'Crear cuenta'}
							</button>
						</Form>
					</div>

					<p className={styles.aside}>
						¿Ya tienes cuenta?{' '}
						<Link className={styles.textLink} to="/ingresar">
							Ingresar
						</Link>
					</p>
				</>
			)}
		</section>
	);
}
