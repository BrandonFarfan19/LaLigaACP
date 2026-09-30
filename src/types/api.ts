/**
 * Contracts of the backend API (server/README.md) as the frontend reads
 * them. Field names are the API's (Spanish, camelCase); dates arrive as ISO
 * 8601 text in UTC.
 */

/** Every response is one of these two envelopes. */
export interface ApiSuccess<T> {
	data: T;
}

/**
 * One field problem of a `400 VALIDATION_ERROR`.
 *
 * `path` is the route zod took to the value, joined with dots
 * (`error-handler.ts`): a top-level field is its own name (`email`), and a
 * nested one carries the whole path (`selecciones.0.pronostico`). `fieldErrors`
 * indexes by that text as it comes, so a form only marks the fields it names.
 */
export interface ApiFieldIssue {
	path: string;
	message: string;
}

export interface ApiFailure {
	error: {
		code: string;
		message: string;
		details?: unknown;
	};
}

/** `rol.codigo`: `apostador` is BR-002's "Usuario". Roles don't include each other. */
export type UserRole = 'apostador' | 'admin';
/** BR-005. */
export type ValidationState = 'pendiente' | 'validado';
/** BR-006. */
export type PaymentState = 'pendiente' | 'confirmado';

/** The signed-in account (`user` of `/auth/login` and `/auth/me`). Never includes the password hash. */
export interface AuthUser {
	id: number;
	nombre: string;
	email: string;
	rol: UserRole;
	estadoValidacion: ValidationState;
	estadoPago: PaymentState;
	/** Sign-up date, UTC. */
	creadoEn: string;
}

/** `GET /auth/me`. */
export interface MeResponse {
	user: AuthUser;
	csrfToken: string;
}

/** `POST /auth/login`. */
export interface LoginResponse extends MeResponse {
	/** When the session expires, UTC. */
	expiraEn: string;
}

/** `POST /auth/register`: the account is created pending, without signing in. */
export interface RegisterResponse {
	user: AuthUser;
}

/**
 * C-14 (D-043): the one live stream of the site, a public Facebook video.
 * `GET /public/transmision`, and the admin's `GET`/`PUT`/`DELETE
 * /admin/transmision`. With no stream every field is `null`. `embedUrl` is
 * the only address a player may load (the backend builds it from the
 * canonical `url`); the front never builds one.
 */
export interface LiveStream {
	/** The canonical link of the Facebook video, to open it there. */
	url: string | null;
	embedUrl: string | null;
	/** When the admin set it, UTC. */
	actualizadoEn: string | null;
}
