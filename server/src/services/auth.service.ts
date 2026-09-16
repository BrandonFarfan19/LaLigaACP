import type { Pool } from 'mysql2/promise';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../lib/password.js';
import type { LoginInput, RegisterInput } from '../schemas/auth.schema.js';
import { createSession, deleteSession, type NewSession } from './session.service.js';
import { findCredentialsByEmail, findUserById, insertUser, isDuplicateEntry, type PublicUser } from './users.service.js';

/**
 * BR-003: a new account is always `apostador`, `pendiente`, pago `pendiente`,
 * 0 coins. There is no parameter that could make it an admin.
 */
export async function register(pool: Pool, input: RegisterInput): Promise<PublicUser> {
	const passwordHash = await hashPassword(input.password);
	let id: number;
	try {
		id = await insertUser(pool, { ...input, passwordHash, rol: 'apostador' }, new Date());
	} catch (error) {
		if (isDuplicateEntry(error)) {
			throw HttpError.conflict(ErrorCode.EMAIL_TAKEN, 'Ya existe una cuenta con ese correo.');
		}
		throw error;
	}
	const user = await findUserById(pool, id);
	if (!user) throw new Error(`El usuario ${id} recién creado no se encontró.`);
	return user;
}

/** One answer for "no such email" and "wrong password" (BR-004): same status, code and message. */
function invalidCredentials(): HttpError {
	return new HttpError(401, ErrorCode.INVALID_CREDENTIALS, 'Correo o contraseña incorrectos.');
}

/**
 * BR-004/BR-005: checks the credentials and opens a session. A `pendiente`
 * user logs in like anyone else; validation only gates betting. An unknown
 * email still runs one argon2 verification, so both failures take about the
 * same time.
 */
export async function login(
	pool: Pool,
	input: LoginInput,
	options: { ttlMs: number; replacedToken: string | undefined },
): Promise<{ user: PublicUser; session: NewSession }> {
	const credentials = await findCredentialsByEmail(pool, input.email);
	if (!credentials) {
		await verifyAgainstDummy(input.password);
		throw invalidCredentials();
	}
	if (!(await verifyPassword(credentials.passwordHash, input.password))) {
		throw invalidCredentials();
	}

	const session = await createSession(pool, credentials.user.id, options.ttlMs, options.replacedToken);
	return { user: credentials.user, session };
}

export function logout(pool: Pool, token: string): Promise<void> {
	return deleteSession(pool, token);
}
