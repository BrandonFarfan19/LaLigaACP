import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/password.js';
import { displayName } from './catalog.schema.js';

/** `usuario.nombre` is VARCHAR(100). */
export const NOMBRE_MAX_LENGTH = 100;

/**
 * Request bodies for `/auth`. Parsing with these throws a `ZodError`, which
 * the error handler turns into `400 VALIDATION_ERROR` with per-field details.
 * Unknown keys are dropped (`z.object` strips them), so a body with
 * `rol: "admin"` registers a plain user.
 */

/** Trimmed and lowercased before validating: `Ana@Mail.com ` and `ana@mail.com` are the same account. */
export const emailSchema = z
	.string({ error: 'El correo es obligatorio.' })
	.trim()
	.toLowerCase()
	.max(254, 'El correo es demasiado largo.')
	.pipe(z.email('El correo no es válido.'));

/**
 * A password being chosen (BR-003, C-01): from `PASSWORD_MIN_LENGTH` to
 * `PASSWORD_MAX_LENGTH` characters and **nothing else** — no uppercase, digit
 * or symbol is required, and spaces, accents and emoji are ordinary
 * characters. Used by registration and by `admin:create`.
 */
export const newPasswordSchema = z
	.string({ error: 'La contraseña es obligatoria.' })
	// Counted in characters, not in UTF-16 units: an emoji is one character for
	// whoever types it, so `🦅` counts once and not twice (C-01).
	.refine((value) => [...value].length >= PASSWORD_MIN_LENGTH, `La contraseña es muy corta: debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`)
	.refine((value) => [...value].length <= PASSWORD_MAX_LENGTH, `La contraseña es muy larga: no puede superar los ${PASSWORD_MAX_LENGTH} caracteres.`);

/**
 * The display name (BR-003) follows the catalog's name rules (D-011): it is
 * shown to others in the ranking, so it must have a letter or digit and no
 * control or invisible characters. Also used by `admin:create`.
 */
export const nombreSchema = displayName(NOMBRE_MAX_LENGTH);

export const registerSchema = z.object({
	nombre: nombreSchema,
	email: emailSchema,
	password: newPasswordSchema,
});

/**
 * Login never re-applies the rules above (D-024): an account created before
 * C-01 may hold a password longer than 20 characters, and rejecting it here
 * would lock its owner out and hint at what is stored. Any non-empty text is
 * taken; `auth.service.ts` fails one that is too long to verify exactly like
 * a wrong one (same 401, same message, same time). The body parser already
 * caps what can arrive at 100 kb.
 */
export const loginSchema = z.object({
	email: emailSchema,
	password: z.string({ error: 'La contraseña es obligatoria.' }).min(1, 'La contraseña es obligatoria.'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
