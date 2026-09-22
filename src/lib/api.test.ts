import { describe, expect, it, vi } from 'vitest';
import { fail, json, mockFetch, ok } from '../test/fetch-mock';
import { api, ApiError, apiUrl, fieldErrors, getCsrfToken, isTransientError, onUnauthorized, rateLimitKind, retryAfterFrom, setCsrfToken, waitText } from './api';
import { login, refreshSession } from './auth';

describe('API client (T-18, D-006)', () => {
	it('calls the same origin under /api, sends and receives JSON, and unwraps { data }', async () => {
		const { calls } = mockFetch(() => ok({ hola: 'mundo' }, 201));
		await expect(api.post('/auth/register', { nombre: 'Ana' })).resolves.toEqual({ hola: 'mundo' });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			url: '/api/auth/register',
			method: 'POST',
			body: { nombre: 'Ana' },
			headers: { accept: 'application/json', 'content-type': 'application/json' },
		});
	});

	it('turns { error } into an ApiError with status, code, message and details', async () => {
		const details = [{ path: 'email', message: 'El correo no es válido.' }];
		mockFetch(() => fail(400, 'VALIDATION_ERROR', 'Solicitud inválida.', details));
		const error = await api.post('/auth/register', {}).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', message: 'Solicitud inválida.', details });
		expect(fieldErrors(error)).toEqual({ email: 'El correo no es válido.' });
		expect(fieldErrors(new Error('x'))).toEqual({});
	});

	it('a response without the envelope, or the server unreachable, is still an ApiError with a clear message', async () => {
		mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
		await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 502, code: 'BAD_RESPONSE', message: expect.stringMatching(/no está disponible/) });

		mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
		await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 0, code: 'NETWORK_ERROR', message: expect.stringMatching(/No se pudo conectar/) });
	});

	it('keeps the CSRF token from login and /auth/me in memory and sends it only on writes', async () => {
		const { calls } = mockFetch(({ url }) =>
			url === '/api/auth/login' ? ok({ user: { id: 1 }, csrfToken: 'token-login', expiraEn: 'x' }) : ok({ user: { id: 1 }, csrfToken: 'token-me' }),
		);
		await login('ana@liga.test', 'clave-segura-1');
		expect(calls[0]!.headers['x-csrf-token']).toBeUndefined();
		expect(getCsrfToken()).toBe('token-login');

		await api.post('/algo', { a: 1 });
		expect(calls[1]!.headers['x-csrf-token']).toBe('token-login');
		await api.get('/algo');
		expect(calls[2]!.headers['x-csrf-token']).toBeUndefined();

		await refreshSession();
		expect(getCsrfToken()).toBe('token-me');
		for (const method of ['put', 'patch'] as const) await api[method]('/algo', {});
		await api.delete('/algo');
		expect(calls.slice(4).map((c) => c.headers['x-csrf-token'])).toEqual(['token-me', 'token-me', 'token-me']);
	});

	it('a 401 means the session is gone: token dropped and listeners told; a failed login is not that', async () => {
		const listener = vi.fn();
		const stop = onUnauthorized(listener);
		try {
			setCsrfToken('viejo');
			mockFetch(() => fail(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.'));
			await expect(api.post('/auth/login', {})).rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
			expect(listener).not.toHaveBeenCalled();
			expect(getCsrfToken()).toBe('viejo');

			mockFetch(() => fail(401, 'UNAUTHENTICATED', 'Inicia sesión.'));
			await expect(api.post('/auth/logout')).rejects.toMatchObject({ status: 401, code: 'UNAUTHENTICATED' });
			expect(listener).toHaveBeenCalledTimes(1);
			expect(getCsrfToken()).toBeNull();
		} finally {
			stop();
		}
	});

	it('a refused CSRF token is renewed once through /auth/me and the write retried', async () => {
		setCsrfToken('vencido');
		let refused = false;
		const { calls } = mockFetch(({ url, headers }) => {
			if (url === '/api/auth/me') return ok({ user: { id: 1 }, csrfToken: 'nuevo' });
			if (headers['x-csrf-token'] === 'vencido') {
				refused = true;
				return fail(403, 'CSRF_FAILED');
			}
			return ok({ hecho: true });
		});
		await expect(api.post('/algo', {})).resolves.toEqual({ hecho: true });
		expect(refused).toBe(true);
		expect(calls.map((c) => `${c.method} ${c.url} ${c.headers['x-csrf-token'] ?? '-'}`)).toEqual([
			'POST /api/algo vencido',
			'GET /api/auth/me -',
			'POST /api/algo nuevo',
		]);

		// Only once: a second refusal is reported.
		mockFetch(({ url }) => (url === '/api/auth/me' ? ok({ user: { id: 1 }, csrfToken: 'otro' }) : fail(403, 'CSRF_FAILED')));
		await expect(api.post('/algo', {})).rejects.toMatchObject({ status: 403, code: 'CSRF_FAILED' });
	});

	it('never forwards the page URL: paths are fixed, and query parameters only come from an explicit object', () => {
		expect(apiUrl('/auth/me')).toBe('/api/auth/me');
		expect(apiUrl('/apuestas/partidos', { deporteId: 3, desde: undefined, hasta: null, q: 'a b&c' })).toBe('/api/apuestas/partidos?deporteId=3&q=a+b%26c');
		for (const bad of [
			'/auth/login?next=/x',
			'/auth/me#x',
			'//evil.test/x',
			'auth/me',
			'https://evil.test/',
			'/a//b',
			'/a b',
			// Dot segments, plain or encoded, would leave /api once normalized (T-18 fix).
			'/..',
			'/../auth/me',
			'/auth/../../x',
			'/./auth/me',
			'/%2e%2e/x',
			'/%2E%2E/x',
			'/.%2e/x',
			'/%2e./x',
			'/%2e/x',
			'/auth/%2e%2e',
		]) {
			expect(() => apiUrl(bad), bad).toThrow(/Ruta de API inválida/);
		}
	});

	it('reads the wait of a 429 from Retry-After or RateLimit-Reset', async () => {
		expect(retryAfterFrom(new Headers({ 'Retry-After': '120' }))).toBe(120);
		expect(retryAfterFrom(new Headers({ 'Retry-After': new Date(90_000).toUTCString() }), 0)).toBe(90);
		expect(retryAfterFrom(new Headers({ 'RateLimit-Reset': '42' }))).toBe(42);
		expect(retryAfterFrom(new Headers())).toBeNull();
		expect([waitText(null), waitText(1), waitText(30), waitText(60), waitText(61), waitText(900)]).toEqual([
			null,
			'1 segundo',
			'30 segundos',
			'1 minuto',
			'2 minutos',
			'15 minutos',
		]);

		mockFetch(() => fail(429, 'RATE_LIMITED', 'Demasiados intentos.', undefined, { 'Retry-After': '300' }));
		await expect(api.post('/auth/login', {})).rejects.toMatchObject({ status: 429, retryAfterSeconds: 300 });
	});

	it('keeps ordinary names that only contain dots', () => {
		expect(apiUrl('/archivos/a.b.webp')).toBe('/api/archivos/a.b.webp');
		expect(apiUrl('/x/...')).toBe('/api/x/...');
	});

	it('an error whose code or message is not text shows a generic message, never [object Object]', async () => {
		for (const error of [
			{ code: { a: 1 }, message: { b: 2 } },
			{ code: 42, message: ['x'] },
			{ code: null, message: null },
			{ code: '', message: '   ' },
			{},
		]) {
			mockFetch(() => json(409, { error }));
			const caught = (await api.post('/x', {}).catch((e: unknown) => e)) as ApiError;
			expect(caught).toBeInstanceOf(ApiError);
			expect(caught.code).toBe('BAD_RESPONSE');
			expect(caught.message).toBe('Ocurrió un error inesperado. Intenta de nuevo.');
			expect(String(caught.message)).not.toMatch(/object/);
		}
		mockFetch(() => json(500, { error: 'texto' }));
		await expect(api.get('/x')).rejects.toMatchObject({ code: 'BAD_RESPONSE', message: expect.stringMatching(/no está disponible/) });
	});

	it('tells which backend limit refused a 429', () => {
		expect(rateLimitKind(new ApiError(429, 'RATE_LIMITED', 'x', { limite: 'ingreso' }))).toBe('ingreso');
		expect(rateLimitKind(new ApiError(429, 'RATE_LIMITED', 'x'))).toBeNull();
		expect(rateLimitKind(new ApiError(429, 'RATE_LIMITED', 'x', { limite: 3 }))).toBeNull();
		expect(rateLimitKind(new ApiError(409, 'OTRO', 'x', { limite: 'ingreso' }))).toBeNull();
	});

	it('an empty or broken JSON body on an error still rejects cleanly', async () => {
		mockFetch(() => json(500, undefined));
		await expect(api.get('/x')).rejects.toMatchObject({ status: 500, code: 'BAD_RESPONSE' });
	});

	describe('a 2xx that is not the envelope (T-22 second fix)', () => {
		/** What a misconfigured proxy, a cut connection or a wrong route may serve with a 200. */
		const bodies: [string, () => Response][] = [
			['HTML with 200 (a proxy serving index.html for /api)', () => new Response('<!doctype html><html><body>La Liga ACP</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } })],
			['broken JSON', () => new Response('{"data": {', { status: 200, headers: { 'Content-Type': 'application/json' } })],
			['loose text', () => json(200, 'hola')],
			['loose array', () => json(200, [1, 2, 3])],
			['loose null', () => json(200, null)],
			['an envelope without data', () => json(200, { items: [] })],
			['no body at all', () => new Response(null, { status: 204 })],
		];

		it('is transient with status 0, so a page offers "Reintentar" instead of an "Error 200" page', async () => {
			for (const [name, body] of bodies) {
				mockFetch(body);
				const caught = (await api.get('/public/deportes').catch((e: unknown) => e)) as ApiError;
				expect(caught, name).toBeInstanceOf(ApiError);
				expect(caught.status, name).toBe(0);
				expect(caught.code, name).toBe('BAD_RESPONSE');
				expect(isTransientError(caught), name).toBe(true);
				expect(caught.message, name).toMatch(/algo inesperado/);
			}
		});

		it('holds for every call of the front, whatever the method or the route', async () => {
			for (const call of [() => api.get('/apuestas/partidos'), () => api.post('/apuestas/vista-previa', {}), () => api.get('/ranking'), () => api.get('/admin/polla/apuestas'), () => api.patch('/admin/deportes/1', {}), () => api.delete('/admin/partidos/1')]) {
				mockFetch(() => json(200, { sin: 'sobre' }));
				await expect(call()).rejects.toMatchObject({ status: 0, code: 'BAD_RESPONSE' });
			}
		});

		it('an envelope that is there is read as always, even with an odd `data`', async () => {
			for (const data of [null, 'texto', [1, 2], { otra: 'forma' }, 0, false]) {
				mockFetch(() => ok(data));
				await expect(api.get('/x')).resolves.toEqual(data);
			}
		});

		it('the statuses outside 2xx keep the treatment they had', async () => {
			for (const [status, code] of [
				[400, 'VALIDATION_ERROR'],
				[401, 'UNAUTHENTICATED'],
				[403, 'FORBIDDEN'],
				[404, 'NOT_FOUND'],
				[409, 'TICKET_REJECTED'],
				[429, 'RATE_LIMITED'],
				[500, 'INTERNAL_ERROR'],
			] as const) {
				mockFetch(() => fail(status, code, 'mensaje del backend'));
				const caught = (await api.get('/x').catch((e: unknown) => e)) as ApiError;
				expect(caught.status, code).toBe(status);
				expect(caught.code, code).toBe(code);
				expect(caught.message, code).toBe('mensaje del backend');
			}
			// And one without an envelope: the status is still the server's, not 0.
			mockFetch(() => new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }));
			await expect(api.get('/x')).rejects.toMatchObject({ status: 502, code: 'BAD_RESPONSE' });
		});
	});
});
