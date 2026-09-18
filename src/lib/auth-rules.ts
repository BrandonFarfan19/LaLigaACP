/**
 * The account rules of the backend (`server/src/schemas/auth.schema.ts`),
 * repeated here only to help while typing. The backend validates again and
 * its answer is the one that counts (NFR-005).
 */

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;
export const NOMBRE_MAX_LENGTH = 100;
export const EMAIL_MAX_LENGTH = 254;

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** A loose shape check: the backend's `z.email()` decides. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function checkEmail(raw: string): string | undefined {
	const email = raw.trim();
	if (!email) return 'Escribe tu correo.';
	if (email.length > EMAIL_MAX_LENGTH) return 'El correo es demasiado largo.';
	if (!EMAIL_SHAPE.test(email)) return 'El correo no es válido.';
	return undefined;
}

/** A high surrogate not followed by a low one, or a low one not preceded by a high one. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Format characters (invisible, text direction) except ZWJ and ZWNJ, which emoji and some scripts need. */
const FORMAT_CHARACTER = /(?![\u200C\u200D])\p{Cf}/u;
const LINE_BREAK = /[\p{Zl}\p{Zp}]/u;
const BLANK_LOOKING = /[\u115F\u1160\u2800\u3164\uFFA0]/;

/**
 * The display name, with the backend's name rules (`displayName`, D-011):
 * trimmed, 1 to 100 characters, printable, and at least one letter or digit.
 */
export function checkNombre(raw: string): string | undefined {
	const nombre = raw.trim();
	if (!nombre) return 'Escribe tu nombre.';
	if (nombre.length > NOMBRE_MAX_LENGTH) return `El nombre no puede superar los ${NOMBRE_MAX_LENGTH} caracteres.`;
	if (/\p{Cc}/u.test(nombre)) return 'El nombre no puede tener caracteres de control.';
	if (FORMAT_CHARACTER.test(nombre) || BLANK_LOOKING.test(nombre)) return 'El nombre no puede tener caracteres invisibles.';
	if (LINE_BREAK.test(nombre)) return 'El nombre debe ir en una sola línea.';
	if (LONE_SURROGATE.test(nombre)) return 'El nombre tiene caracteres inválidos.';
	if (!/[\p{L}\p{N}]/u.test(nombre)) return 'El nombre tiene que tener al menos una letra o un número.';
	return undefined;
}

export function checkRegistration(input: { nombre: string; email: string; password: string }): FieldErrors<'nombre' | 'email' | 'password'> {
	const errors: FieldErrors<'nombre' | 'email' | 'password'> = {};
	const nombre = checkNombre(input.nombre);
	if (nombre) errors.nombre = nombre;
	const email = checkEmail(input.email);
	if (email) errors.email = email;
	if (input.password.length < PASSWORD_MIN_LENGTH) {
		errors.password = `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
	} else if (input.password.length > PASSWORD_MAX_LENGTH) {
		errors.password = `La contraseña no puede superar los ${PASSWORD_MAX_LENGTH} caracteres.`;
	}
	return errors;
}

export function checkLogin(input: { email: string; password: string }): FieldErrors<'email' | 'password'> {
	const errors: FieldErrors<'email' | 'password'> = {};
	const email = checkEmail(input.email);
	if (email) errors.email = email;
	if (!input.password) errors.password = 'Escribe tu contraseña.';
	return errors;
}
