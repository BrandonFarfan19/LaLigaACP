import { vi } from 'vitest';

export interface RecordedCall {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: unknown;
	/** A multipart body (image uploads, T-21). */
	form?: FormData;
}

export type Handler = (call: RecordedCall) => Response | Promise<Response>;

/** A JSON response with the API's envelope already applied by the caller. */
export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
	});
}

export const ok = (data: unknown, status = 200) => json(status, { data });
export const fail = (status: number, code: string, message = code, details?: unknown, headers?: Record<string, string>) =>
	json(status, { error: { code, message, ...(details === undefined ? {} : { details }) } }, headers);

/**
 * Replaces `fetch` with `handler` and records every call. The handler gets
 * the URL, method, headers (lowercase names) and the parsed JSON body.
 */
export function mockFetch(handler: Handler) {
	const calls: RecordedCall[] = [];
	const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
		const headers: Record<string, string> = {};
		new Headers(init.headers).forEach((value, key) => {
			headers[key] = value;
		});
		const call: RecordedCall = {
			url: String(input),
			method: (init.method ?? 'GET').toUpperCase(),
			headers,
			body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
			form: init.body instanceof FormData ? init.body : undefined,
		};
		calls.push(call);
		return handler(call);
	});
	vi.stubGlobal('fetch', fn);
	return { calls, fn };
}

export const apostador = {
	id: 7,
	nombre: 'Ana',
	email: 'ana@liga.test',
	rol: 'apostador' as const,
	estadoValidacion: 'validado' as const,
	estadoPago: 'confirmado' as const,
	saldoMonedas: 10,
	creadoEn: '2026-09-17T12:00:00.000Z',
};

export const pendiente = { ...apostador, id: 8, nombre: 'Beto', email: 'beto@liga.test', estadoValidacion: 'pendiente' as const, estadoPago: 'pendiente' as const, saldoMonedas: 0 };

export const admin = { ...apostador, id: 1, nombre: 'Admin', email: 'admin@liga.test', rol: 'admin' as const, saldoMonedas: 0 };
