import type { ApiFieldIssue } from '../types/api';

/**
 * The only client of the backend API (D-006 in `docs/decisiones.md`).
 *
 * - Same origin: every call goes to a relative path under `API_PREFIX`. In
 *   development Vite's proxy forwards it to the backend without the prefix
 *   (`vite.config.ts`); in production a reverse proxy does the same (README,
 *   "Despliegue"). So the session cookie (`HttpOnly`, `SameSite=Strict`,
 *   `__Host-` in production) and the backend's `Origin` check work as they are.
 * - JSON in and out, unwrapping the `{ data }` / `{ error }` envelope. The one
 *   exception is an image upload (T-21): a `FormData` body sent as multipart.
 *   A 2xx without that envelope is a `BAD_RESPONSE` with status 0, so every
 *   page treats it as a transient failure and offers "Reintentar".
 * - Keeps the CSRF token that `/auth/login` and `/auth/me` return, in memory
 *   only, and sends it as `X-CSRF-Token` on every write.
 * - A 401 other than a failed login means the session is gone: the token is
 *   dropped and the session listeners are told.
 * - Only builds URLs from an explicit path and an explicit `query` object:
 *   nothing from the page's own URL (`?next=` and friends) ever reaches the API.
 */

export const API_PREFIX = '/api';

/** Gives up on a request that hangs, so a page never waits forever on the backend. */
const TIMEOUT_MS = 15_000;

export type ApiMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class ApiError extends Error {
	/** HTTP status; 0 when the server could not be reached. */
	readonly status: number;
	/** The envelope's `error.code` (`VALIDATION_ERROR`, `EMAIL_TAKEN`...), or a client-side one. */
	readonly code: string;
	readonly details: unknown;
	/** Seconds to wait before retrying, from `Retry-After` / `RateLimit-Reset` (429). */
	readonly retryAfterSeconds: number | null;

	constructor(status: number, code: string, message: string, details?: unknown, retryAfterSeconds: number | null = null) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.details = details;
		this.retryAfterSeconds = retryAfterSeconds;
	}
}

/** Client-side codes, never sent by the backend. */
export const CLIENT_ERROR = {
	NETWORK: 'NETWORK_ERROR',
	TIMEOUT: 'TIMEOUT',
	BAD_RESPONSE: 'BAD_RESPONSE',
} as const;

let csrfToken: string | null = null;

/** Set by the auth calls (`src/lib/auth.ts`); `null` on logout. */
export function setCsrfToken(token: string | null): void {
	csrfToken = token;
}

export function getCsrfToken(): string | null {
	return csrfToken;
}

type UnauthorizedListener = () => void;
const unauthorizedListeners = new Set<UnauthorizedListener>();

/** Called whenever the backend says the session is gone (a 401 that isn't a failed login). */
export function onUnauthorized(listener: UnauthorizedListener): () => void {
	unauthorizedListeners.add(listener);
	return () => unauthorizedListeners.delete(listener);
}

/**
 * How to get a fresh CSRF token when a write is refused with `CSRF_FAILED`
 * (for example, after the server's secret changed). Registered by
 * `src/lib/auth.ts`, so this module doesn't depend on it.
 */
let csrfRefresher: (() => Promise<void>) | null = null;
export function setCsrfRefresher(refresher: (() => Promise<void>) | null): void {
	csrfRefresher = refresher;
}

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestOptions {
	body?: unknown;
	/** A multipart body (image uploads, T-13): sent as it is, instead of `body`. */
	form?: FormData;
	/** Explicit query parameters. `undefined` and `null` values are left out. */
	query?: Record<string, QueryValue>;
	/** Extra request headers (e.g. `Idempotency-Key` in T-19). */
	headers?: Record<string, string>;
	signal?: AbortSignal;
}

const SAFE_PATH = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@%/]*$/;

/**
 * `/auth/me` → `/api/auth/me`. The path is fixed by the caller's code: it
 * may not carry its own query string, fragment or `//`, so a value taken from
 * the page can't smuggle parameters or another host into the request.
 */
export function apiUrl(path: string, query?: Record<string, QueryValue>): string {
	// No dot segments either, plain or encoded (`..`, `%2e%2e`): once normalized they would leave `/api`.
	const dotSegment = path.split('/').some((segment) => /^(?:\.|%2e){1,2}$/i.test(segment));
	if (!SAFE_PATH.test(path) || path.includes('//') || dotSegment) {
		throw new Error(`Ruta de API inválida: ${path}`);
	}
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(query ?? {})) {
		if (value !== undefined && value !== null) params.append(key, String(value));
	}
	const search = params.toString();
	return `${API_PREFIX}${path}${search ? `?${search}` : ''}`;
}

/** `Retry-After` in seconds or as an HTTP date, else the standard `RateLimit-Reset` (seconds). */
export function retryAfterFrom(headers: Headers, now = Date.now()): number | null {
	const retryAfter = headers.get('Retry-After');
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
		const date = Date.parse(retryAfter);
		if (!Number.isNaN(date)) return Math.max(0, Math.ceil((date - now) / 1000));
	}
	const reset = Number(headers.get('RateLimit-Reset'));
	return headers.has('RateLimit-Reset') && Number.isFinite(reset) && reset >= 0 ? Math.ceil(reset) : null;
}

function withTimeout(signal: AbortSignal | undefined): { signal: AbortSignal; timedOut: () => boolean } {
	const timer = AbortSignal.timeout(TIMEOUT_MS);
	return {
		signal: signal ? AbortSignal.any([signal, timer]) : timer,
		timedOut: () => timer.aborted,
	};
}

async function send<T>(method: ApiMethod, path: string, options: RequestOptions): Promise<T> {
	const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
	// The browser sets the multipart boundary itself.
	if (options.body !== undefined && !options.form) headers['Content-Type'] = 'application/json';
	if (method !== 'GET' && csrfToken) headers['X-CSRF-Token'] = csrfToken;

	const { signal, timedOut } = withTimeout(options.signal);
	let response: Response;
	try {
		response = await fetch(apiUrl(path, options.query), {
			method,
			headers,
			body: options.form ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
			credentials: 'same-origin',
			signal,
		});
	} catch (error) {
		if (timedOut()) throw new ApiError(0, CLIENT_ERROR.TIMEOUT, 'El servidor tardó demasiado en responder. Intenta de nuevo.');
		if (options.signal?.aborted) throw error;
		throw new ApiError(0, CLIENT_ERROR.NETWORK, 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.');
	}

	let payload: unknown = null;
	if ((response.headers.get('Content-Type') ?? '').includes('application/json')) {
		try {
			payload = await response.json();
		} catch {
			payload = null;
		}
	}

	if (response.ok) {
		if (payload && typeof payload === 'object' && 'data' in payload) return (payload as { data: T }).data;
		// A 2xx that doesn't carry the `{ data }` envelope is not an answer this
		// client can read: a proxy serving `index.html` for `/api`, a truncated
		// or broken body, a bare array, a `null`. It is reported with **status 0**,
		// like a connection that failed, so `isTransientError` treats it as
		// transient: the page keeps what it shows with its notice and
		// "Reintentar", instead of an error page titled "Error 200" with no way
		// out (T-22 second fix). Statuses outside 2xx keep their own handling.
		throw new ApiError(0, CLIENT_ERROR.BAD_RESPONSE, 'El servidor respondió algo inesperado. Intenta de nuevo.');
	}

	const envelope = payload && typeof payload === 'object' && 'error' in payload ? (payload as { error: unknown }).error : null;
	const failure = envelope && typeof envelope === 'object' ? (envelope as Record<string, unknown>) : null;
	// Only text is shown: anything else in `code` or `message` (an object, a number) becomes a generic one.
	const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
	const error = failure
		? new ApiError(
				response.status,
				text(failure.code) ?? CLIENT_ERROR.BAD_RESPONSE,
				text(failure.message) ?? 'Ocurrió un error inesperado. Intenta de nuevo.',
				failure.details,
				response.status === 429 ? retryAfterFrom(response.headers) : null,
			)
		: new ApiError(
				response.status,
				// A proxy in front of the API answers 413 in HTML, with no envelope: say what it means (T-21 fix).
				response.status === 413 ? 'PAYLOAD_TOO_LARGE' : CLIENT_ERROR.BAD_RESPONSE,
				response.status === 413
					? 'El archivo es demasiado grande: el servidor lo rechazó antes de recibirlo entero.'
					: response.status >= 500 || response.status === 0
						? 'El servidor no está disponible en este momento. Intenta más tarde.'
						: 'El servidor respondió algo inesperado. Intenta de nuevo.',
				undefined,
				response.status === 429 ? retryAfterFrom(response.headers) : null,
			);

	if (error.status === 401 && error.code !== 'INVALID_CREDENTIALS') {
		csrfToken = null;
		for (const listener of [...unauthorizedListeners]) listener();
	}
	throw error;
}

/**
 * One API call: resolves with the envelope's `data`, or rejects with an
 * `ApiError`. A write refused with `CSRF_FAILED` while a token was known
 * refreshes the token once and retries.
 */
export async function apiRequest<T>(method: ApiMethod, path: string, options: RequestOptions = {}): Promise<T> {
	try {
		return await send<T>(method, path, options);
	} catch (error) {
		const canRetry = method !== 'GET' && csrfToken !== null && csrfRefresher !== null;
		if (!(error instanceof ApiError) || error.code !== 'CSRF_FAILED' || !canRetry) throw error;
		await csrfRefresher!();
		return send<T>(method, path, options);
	}
}

export const api = {
	get: <T>(path: string, options?: Omit<RequestOptions, 'body'>) => apiRequest<T>('GET', path, options),
	post: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('POST', path, { ...options, body }),
	put: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('PUT', path, { ...options, body }),
	patch: <T>(path: string, body?: unknown, options?: RequestOptions) => apiRequest<T>('PATCH', path, { ...options, body }),
	delete: <T>(path: string, options?: RequestOptions) => apiRequest<T>('DELETE', path, options),
	/** A multipart upload (one image in `form`), with the CSRF token like any write. */
	upload: <T>(method: 'POST' | 'PUT', path: string, form: FormData, options?: Omit<RequestOptions, 'body' | 'form'>) =>
		apiRequest<T>(method, path, { ...options, form }),
};

/**
 * The per-field messages of a `400 VALIDATION_ERROR` (`{ email: '...' }`).
 * The first message of each field wins.
 */
export function fieldErrors(error: unknown): Record<string, string> {
	if (!(error instanceof ApiError) || !Array.isArray(error.details)) return {};
	const out: Record<string, string> = {};
	for (const issue of error.details as Partial<ApiFieldIssue>[]) {
		if (typeof issue?.path === 'string' && typeof issue.message === 'string' && !(issue.path in out)) {
			out[issue.path] = issue.message;
		}
	}
	return out;
}

/** Which backend limit refused a 429 (`details.limite`: `ingreso`, `registro`, `sesion`, `general`...), or `null`. */
export function rateLimitKind(error: unknown): string | null {
	if (!(error instanceof ApiError) || error.code !== 'RATE_LIMITED') return null;
	const limite = (error.details as { limite?: unknown } | null | undefined)?.limite;
	return typeof limite === 'string' ? limite : null;
}

/**
 * A failure worth waiting out and retrying (no connection, a timeout, a limit,
 * the server down), not a wrong request: pages keep what they show and offer
 * to retry (T-19, T-20).
 */
export const isTransientError = (error: unknown): error is ApiError =>
	error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500);

/** "5 minutos", "30 segundos": how long to wait after a 429. */
export function waitText(seconds: number | null): string | null {
	if (seconds === null) return null;
	if (seconds < 60) return `${Math.max(1, seconds)} ${seconds === 1 ? 'segundo' : 'segundos'}`;
	const minutes = Math.ceil(seconds / 60);
	return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}
