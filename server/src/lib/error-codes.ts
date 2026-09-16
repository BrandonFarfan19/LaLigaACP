/**
 * Stable, machine-readable error codes for the response envelope (see
 * `lib/response.ts`). English constants, Spanish `message` text — matches
 * the rest of the project's language split (identifiers in English/code
 * conventions, user- and dev-facing text in Spanish).
 */
export const ErrorCode = {
	NOT_FOUND: 'NOT_FOUND',
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	// Request-body failures raised by express.json() (body-parser) before any
	// route runs — see middleware/error-handler.ts.
	INVALID_JSON: 'INVALID_JSON',
	PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
	UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
	BAD_REQUEST: 'BAD_REQUEST',
	RATE_LIMITED: 'RATE_LIMITED',
	// Auth (T-03).
	UNAUTHENTICATED: 'UNAUTHENTICATED',
	INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
	FORBIDDEN: 'FORBIDDEN',
	USER_NOT_VALIDATED: 'USER_NOT_VALIDATED',
	CSRF_FAILED: 'CSRF_FAILED',
	EMAIL_TAKEN: 'EMAIL_TAKEN',
	// Participants (T-04).
	USER_NOT_FOUND: 'USER_NOT_FOUND',
	PAYMENT_ALREADY_CONFIRMED: 'PAYMENT_ALREADY_CONFIRMED',
	PAYMENT_NOT_CONFIRMED: 'PAYMENT_NOT_CONFIRMED',
	USER_ALREADY_VALIDATED: 'USER_ALREADY_VALIDATED',
	NOT_A_PARTICIPANT: 'NOT_A_PARTICIPANT',
	ADMIN_CANNOT_BET: 'ADMIN_CANNOT_BET',
	DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
	INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
