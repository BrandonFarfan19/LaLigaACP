import { describe, expect, it } from 'vitest';
import { apostador, fail, mockFetch, ok } from '../test/fetch-mock';
import { getCsrfToken } from './api';
import {
	cachedSession,
	getSessionState,
	login,
	logout,
	readSession,
	refreshCoinBalance,
	refreshSession,
	SESSION_CACHE_MS,
	subscribeSession,
} from './auth';

describe('session store (T-18)', () => {
	it('reads /auth/me once for concurrent callers, and a 401 means no session', async () => {
		const { calls } = mockFetch(() => fail(401, 'UNAUTHENTICATED'));
		const [a, b] = await Promise.all([cachedSession(), refreshSession()]);
		expect([a, b]).toEqual([null, null]);
		expect(calls).toHaveLength(1);
		expect(getSessionState()).toEqual({ status: 'ready', user: null });
	});

	it(`public pages use the copy for ${SESSION_CACHE_MS / 1000} s; protected pages always read (D-009)`, async () => {
		const { calls } = mockFetch(() => ok({ user: apostador, csrfToken: 't' }));
		const start = Date.now();
		await cachedSession(start);
		expect(calls).toHaveLength(1);
		await cachedSession(start + 1);
		await cachedSession(start + SESSION_CACHE_MS - 1);
		expect(calls).toHaveLength(1);
		await cachedSession(start + SESSION_CACHE_MS + 1_000);
		expect(calls).toHaveLength(2);

		await readSession();
		await readSession();
		expect(calls).toHaveLength(4);
	});

	it('a failed or refused read is not a fresh copy: the next public page asks again', async () => {
		const { calls } = mockFetch(() => fail(429, 'RATE_LIMITED', 'x', { limite: 'sesion' }));
		await expect(cachedSession()).rejects.toMatchObject({ status: 429 });
		expect(getSessionState().status).toBe('error');
		await expect(cachedSession()).rejects.toMatchObject({ status: 429 });
		expect(calls).toHaveLength(2);
	});

	it('an unchanged answer does not notify the subscribers', async () => {
		mockFetch(() => ok({ user: { ...apostador }, csrfToken: 't' }));
		await refreshSession();
		let notified = 0;
		const stop = subscribeSession(() => notified++);
		await refreshSession();
		await refreshSession();
		expect(notified).toBe(0);
		stop();
	});

	it('the server unreachable keeps the last known user and marks the state', async () => {
		mockFetch(() => ok({ user: apostador, csrfToken: 't' }));
		await refreshSession();
		mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
		await expect(refreshSession()).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
		expect(getSessionState()).toEqual({ status: 'error', user: apostador });
	});

	it('logout clears the user and the CSRF token; a session already gone counts as done; other failures keep it', async () => {
		mockFetch(() => ok({ user: apostador, csrfToken: 't', expiraEn: 'x' }));
		await login('ana@liga.test', 'clave-segura-1');
		const { calls } = mockFetch(() => ok(null));
		await logout();
		expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/auth/logout', headers: { 'x-csrf-token': 't' } });
		expect(getSessionState().user).toBeNull();
		expect(getCsrfToken()).toBeNull();

		mockFetch(() => ok({ user: apostador, csrfToken: 't', expiraEn: 'x' }));
		await login('ana@liga.test', 'clave-segura-1');
		mockFetch(() => fail(401, 'UNAUTHENTICATED'));
		await logout();
		expect(getSessionState().user).toBeNull();

		mockFetch(() => ok({ user: apostador, csrfToken: 't', expiraEn: 'x' }));
		await login('ana@liga.test', 'clave-segura-1');
		mockFetch(() => fail(500, 'INTERNAL_ERROR', 'Error interno.'));
		await expect(logout()).rejects.toMatchObject({ status: 500 });
		expect(getSessionState().user).toEqual(apostador);
	});

	it('a new balance reaches the subscribers (the coin counter)', async () => {
		mockFetch(() => ok({ user: apostador, csrfToken: 't' }));
		await refreshSession();
		let notified = 0;
		const stop = subscribeSession(() => notified++);
		mockFetch(() => ok({ saldoMonedas: 7 }));
		await expect(refreshCoinBalance()).resolves.toBe(7);
		expect(getSessionState().user?.saldoMonedas).toBe(7);
		expect(notified).toBe(1);
		// The same balance changes nothing.
		await refreshCoinBalance();
		expect(notified).toBe(1);
		stop();
	});

	it('any 401 from another call signs the user out of the store', async () => {
		mockFetch(() => ok({ user: apostador, csrfToken: 't' }));
		await refreshSession();
		mockFetch(() => fail(401, 'UNAUTHENTICATED'));
		await expect(refreshCoinBalance()).rejects.toMatchObject({ status: 401 });
		expect(getSessionState()).toEqual({ status: 'ready', user: null });
	});
});
