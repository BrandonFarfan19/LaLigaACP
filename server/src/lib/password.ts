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

export const PASSWORD_MIN_LENGTH = 10;
/** Upper bound so a huge "password" can't be used to burn CPU. */
export const PASSWORD_MAX_LENGTH = 128;

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
