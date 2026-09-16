/**
 * Stable, machine-readable error codes for the response envelope (see
 * `lib/response.ts`). English constants, Spanish `message` text — matches
 * the rest of the project's language split (identifiers in English/code
 * conventions, user- and dev-facing text in Spanish).
 */
export const ErrorCode = {
	NOT_FOUND: 'NOT_FOUND',
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	RATE_LIMITED: 'RATE_LIMITED',
	DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
	INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
