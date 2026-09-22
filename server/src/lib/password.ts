import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';

/**
 * Password hashing (BR-004, NFR-005): argon2id, OWASP's first choice, with
 * its recommended minimum profile — 19 MiB of memory, 2 iterations, 1 lane.
 * Memory-hard, so GPU/ASIC guessing is expensive; ~25 ms per hash on a
 * developer machine, cheap enough for login under a rate limit. The
 * parameters travel inside the PHC string (`$argon2id$v=19$m=19456,p=1,t=2$...`),
 * so raising them later keeps old hashes verifiable.
 */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

/**
 * What a **new** password may be (BR-003, C-01): from 6 to 20 characters and
 * nothing else — no uppercase, digits or symbols are required. It applies
 * where a password is chosen: registration and `admin:create`.
 */
export const PASSWORD_MIN_LENGTH = 6;
export const PASSWORD_MAX_LENGTH = 20;

/**
 * Technical ceiling for a password that is only **verified** (login, D-024):
 * it exists so a huge body can't be used to burn CPU on argon2, and it is
 * high enough that an account created before C-01 still gets in. It never
 * changes the answer: a login that fails for any reason is the same
 * `401 INVALID_CREDENTIALS`, and it takes about the same time (BR-004).
 */
export const PASSWORD_VERIFY_MAX_LENGTH = 128;

export function hashPassword(plain: string): Promise<string> {
	return argon2.hash(plain, OPTIONS);
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
	try {
		return await argon2.verify(hash, plain);
	} catch {
		// A malformed stored hash is a failed login, never a 500 that hints at it.
		return false;
	}
}

// Hash of a random value, verified when the email doesn't exist: login then
// costs about the same whether the account exists or not. Computed at import,
// so the first unknown-email login doesn't pay an extra hash.
const dummyHash = hashPassword(randomUUID());

export async function verifyAgainstDummy(plain: string): Promise<false> {
	await verifyPassword(await dummyHash, plain);
	return false;
}
