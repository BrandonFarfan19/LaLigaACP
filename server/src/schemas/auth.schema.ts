import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../lib/password.js';

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

export const newPasswordSchema = z
	.string({ error: 'La contraseña es obligatoria.' })
	.min(PASSWORD_MIN_LENGTH, `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`)
	.max(PASSWORD_MAX_LENGTH, `La contraseña no puede superar los ${PASSWORD_MAX_LENGTH} caracteres.`);

export const nombreSchema = z
	.string({ error: 'El nombre es obligatorio.' })
	.trim()
	.min(1, 'El nombre es obligatorio.')
	.max(100, 'El nombre no puede superar los 100 caracteres.');

export const registerSchema = z.object({
	nombre: nombreSchema,
	email: emailSchema,
	password: newPasswordSchema,
});

// Login doesn't re-apply the registration rules to the password: a wrong one
// must fail as "invalid credentials", not reveal the policy per attempt.
export const loginSchema = z.object({
	email: emailSchema,
	password: z
		.string({ error: 'La contraseña es obligatoria.' })
		.min(1, 'La contraseña es obligatoria.')
		.max(PASSWORD_MAX_LENGTH, 'Correo o contraseña incorrectos.'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
