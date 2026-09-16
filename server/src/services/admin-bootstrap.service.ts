import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { hashPassword } from '../lib/password.js';
import { emailSchema, newPasswordSchema, nombreSchema } from '../schemas/auth.schema.js';
import { findCredentialsByEmail, findUserById, insertUser, type PublicUser } from './users.service.js';

/**
 * The only way to get an admin (BR-001): there is no admin registration in
 * the API. Run from the server (`npm run admin:create`), never over HTTP.
 */
const adminInputSchema = z.object({
	email: emailSchema,
	nombre: nombreSchema.optional(),
});

export interface AdminInput {
	email: string;
	nombre?: string | undefined;
	/**
	 * A known password, or a function that asks for it. The function is only
	 * called when the account has to be created: promoting never asks.
	 */
	password?: string | (() => Promise<string>) | undefined;
}

export interface AdminResult {
	action: 'created' | 'promoted' | 'unchanged';
	user: PublicUser;
	/** A password was given, but the account already existed: it was not used. */
	passwordIgnored: boolean;
}

export class AdminInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AdminInputError';
	}
}

/**
 * Only an account that never took part in the pool can become an admin
 * (admins don't take part, BR-001): still `pendiente`, payment still
 * `pendiente`, 0 coins, no coin movements and no tickets. Anything else
 * would leave an admin with coins, a paid entry or live bets riding on the
 * results they load. Checked in the same UPDATE that promotes, so nothing
 * can slip in between.
 */
const PROMOTABLE = `rol_id = (SELECT id FROM rol WHERE codigo = 'apostador')
	AND estado_usuario_id = (SELECT id FROM estado_usuario WHERE codigo = 'pendiente')
	AND estado_pago_id = (SELECT id FROM estado_pago WHERE codigo = 'pendiente')
	AND saldo_monedas = 0
	AND NOT EXISTS (SELECT 1 FROM movimiento_moneda m WHERE m.usuario_id = usuario.id)
	AND NOT EXISTS (SELECT 1 FROM ticket t WHERE t.usuario_id = usuario.id)`;

/** Why an existing account can't be promoted, in words for the operator. */
async function promotionBlockers(pool: Pool, userId: number): Promise<string[]> {
	const [[row]] = await pool.query<RowDataPacket[]>(
		`SELECT eu.codigo AS estado, ep.codigo AS pago, u.saldo_monedas AS saldo,
			(SELECT COUNT(*) FROM movimiento_moneda m WHERE m.usuario_id = u.id) AS movimientos,
			(SELECT COUNT(*) FROM ticket t WHERE t.usuario_id = u.id) AS tickets
		FROM usuario u
		JOIN estado_usuario eu ON eu.id = u.estado_usuario_id
		JOIN estado_pago ep ON ep.id = u.estado_pago_id
		WHERE u.id = ?`,
		[userId],
	);
	if (!row) return ['la cuenta ya no existe'];
	const blockers: string[] = [];
	if (row.estado !== 'pendiente') blockers.push('está validada');
	if (row.pago !== 'pendiente') blockers.push('tiene el pago confirmado');
	if (Number(row.saldo) !== 0) blockers.push(`tiene ${row.saldo} monedas`);
	if (Number(row.movimientos) > 0) blockers.push(`tiene ${row.movimientos} movimiento(s) de monedas`);
	if (Number(row.tickets) > 0) blockers.push(`tiene ${row.tickets} ticket(s) de apuestas`);
	return blockers;
}

/**
 * Creates the admin if the email is new (then `nombre` and a password are
 * required), or promotes the existing account if it never took part in the
 * pool (see PROMOTABLE). Promoting never touches the password.
 */
export async function ensureAdmin(pool: Pool, rawInput: AdminInput): Promise<AdminResult> {
	const input = adminInputSchema.parse(rawInput);
	const existing = await findCredentialsByEmail(pool, input.email);

	if (existing) {
		const passwordIgnored = typeof rawInput.password === 'string';
		if (existing.user.rol === 'admin') return { action: 'unchanged', user: existing.user, passwordIgnored };
		const [result] = await pool.query<ResultSetHeader>(
			`UPDATE usuario SET rol_id = (SELECT id FROM rol WHERE codigo = 'admin') WHERE id = ? AND ${PROMOTABLE}`,
			[existing.user.id],
		);
		if (result.affectedRows !== 1) {
			const blockers = await promotionBlockers(pool, existing.user.id);
			throw new AdminInputError(
				`No se puede promover a ${existing.user.email}: ${blockers.join(', ')}. Los administradores no participan en la polla, así que solo se promueve una cuenta que nunca participó (pendiente, sin pago, sin monedas, sin movimientos ni tickets). Usá otro correo para el administrador.`,
			);
		}
		return { action: 'promoted', user: (await findUserById(pool, existing.user.id))!, passwordIgnored };
	}

	if (!input.nombre) {
		throw new AdminInputError('No existe una cuenta con ese correo: para crearla falta ADMIN_NOMBRE.');
	}
	const given = typeof rawInput.password === 'function' ? await rawInput.password() : rawInput.password;
	if (given === undefined) {
		throw new AdminInputError(
			'No existe una cuenta con ese correo: para crearla falta la contraseña. Corré el comando en una terminal para que la pida, o usá ADMIN_PASSWORD_FILE o ADMIN_PASSWORD_STDIN=1.',
		);
	}
	const password = newPasswordSchema.parse(given);

	const passwordHash = await hashPassword(password);
	const id = await insertUser(pool, { nombre: input.nombre, email: input.email, passwordHash, rol: 'admin' }, new Date());
	return { action: 'created', user: (await findUserById(pool, id))!, passwordIgnored: false };
}
