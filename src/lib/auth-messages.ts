import { ApiError, fieldErrors, rateLimitKind, waitText } from './api';

/** What an auth form shows for a failed request: one message for the form, and per-field ones. */
export interface FormFailure {
	formError: string;
	fieldErrors: Record<string, string>;
	/** The backend's error code, or `null` for a check made here. */
	code?: string | null;
}

/** The single message of a failed sign-in (BR-004: never says whether the email exists). */
export const INVALID_CREDENTIALS_TEXT = 'Correo o contraseña incorrectos.';

export function failureOf(error: unknown, kind: 'login' | 'register'): FormFailure {
	if (!(error instanceof ApiError)) {
		return { formError: 'Ocurrió un error inesperado. Intenta de nuevo.', fieldErrors: {}, code: null };
	}
	return { ...describe(error, kind), code: error.code };
}

function describe(error: ApiError, kind: 'login' | 'register'): FormFailure {
	switch (error.code) {
		case 'INVALID_CREDENTIALS':
			return { formError: INVALID_CREDENTIALS_TEXT, fieldErrors: {} };
		case 'VALIDATION_ERROR':
			return { formError: 'Revisa los datos marcados.', fieldErrors: fieldErrors(error) };
		case 'EMAIL_TAKEN':
			return {
				formError: 'No se pudo crear la cuenta.',
				fieldErrors: { email: 'Ya existe una cuenta con ese correo.' },
			};
		case 'RATE_LIMITED': {
			const wait = waitText(error.retryAfterSeconds);
			// Only the auth limits speak of attempts or sign-ups; any other limit is "too many requests".
			const limit = rateLimitKind(error);
			const what =
				kind === 'login' && limit === 'ingreso'
					? 'Demasiados intentos de ingreso'
					: kind === 'register' && limit === 'registro'
						? 'Demasiados registros desde esta conexión'
						: 'Demasiadas solicitudes desde esta conexión';
			return {
				formError: wait ? `${what}. Espera ${wait} y vuelve a intentarlo.` : `${what}. Espera unos minutos y vuelve a intentarlo.`,
				fieldErrors: {},
			};
		}
		default:
			return { formError: error.message, fieldErrors: {} };
	}
}
