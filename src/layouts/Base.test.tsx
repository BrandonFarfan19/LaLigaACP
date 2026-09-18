import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { getSessionState, refreshSession, resetSessionForTests, SESSION_CACHE_MS } from '../lib/auth';
import { admin, apostador, fail, mockFetch, ok, type RecordedCall } from '../test/fetch-mock';
import { adminRoutes } from '../test/admin-fixtures';
import { renderApp, where } from '../test/render-app';
import { apiRoutes, page } from '../test/betting-fixtures';

const unauthenticated = () => fail(401, 'UNAUTHENTICATED', 'Inicia sesión.');
const meCalls = (calls: RecordedCall[]) => calls.filter((c) => c.url === '/api/auth/me').length;

function reset() {
	cleanup();
	resetSessionForTests();
}

/** Records whether `text` was ever on screen while the test ran. */
function watchFor(text: string) {
	let seen = false;
	const check = () => {
		if (document.body.textContent?.includes(text)) seen = true;
	};
	const observer = new MutationObserver(check);
	observer.observe(document.body, { childList: true, subtree: true, characterData: true });
	return {
		seen: () => {
			check();
			return seen;
		},
		stop: () => observer.disconnect(),
	};
}

/** The betting page's reads, so a validated participant can land there (D-008). */
const bettingReads = {
	'GET /api/public/deportes': () => ok([]),
	'GET /api/apuestas/partidos': () => ok(page([])),
};

/** The same attacks as in next-path.test.ts, as the raw `?next=` value. */
const ESCAPES = [
	'/.//evil.com',
	'/..//evil.com',
	'/%2e//evil.com',
	'/%2e%2e//evil.com',
	'/a/..//evil.com',
	'/.%2e/.%2e//x.com',
	'/.///evil.com/x',
	'//evil.com',
	'https://evil.com',
];

describe('open redirect through ?next= (T-18 fix, real router)', () => {
	it('a signed-in visitor on /ingresar?next=<attack> stays on the site (loader)', async () => {
		const origin = window.location.href;
		for (const next of ESCAPES) {
			mockFetch(apiRoutes({ 'GET /api/auth/me': () => ok({ user: apostador, csrfToken: 't' }), ...bettingReads }));
			const router = renderApp(`/ingresar?next=${encodeURIComponent(next)}`);
			await waitFor(() => expect(where(router), next).toBe('/apuestas'));
			expect(window.location.href).toBe(origin);
			router.dispose();
			reset();
		}
	});

	it('signing in with ?next=<attack> lands on the own account, never elsewhere (action)', async () => {
		const origin = window.location.href;
		for (const next of ESCAPES) {
			let signedIn = false;
			mockFetch(
				apiRoutes({
					'POST /api/auth/login': () => {
						signedIn = true;
						return ok({ user: apostador, csrfToken: 't', expiraEn: 'x' });
					},
					'GET /api/auth/me': () => (signedIn ? ok({ user: apostador, csrfToken: 't' }) : unauthenticated()),
					...bettingReads,
				}),
			);
			const router = renderApp(`/ingresar?next=${encodeURIComponent(next)}`);
			const user = userEvent.setup();
			await user.type(await screen.findByLabelText('Correo'), apostador.email);
			await user.type(screen.getByLabelText('Contraseña'), 'clave-segura-1');
			await user.click(screen.getByRole('button', { name: 'Ingresar' }));
			await waitFor(() => expect(where(router), next).toBe('/apuestas'));
			expect(window.location.href).toBe(origin);
			router.dispose();
			reset();
		}
	}, 30_000);
});

describe('a session that ended on the server (T-18 fix, D-009)', () => {
	for (const [label, who, link, path] of [
		['Mi cuenta', apostador, 'Mi cuenta', '/cuenta'],
		['Admin', admin, 'Admin', '/admin'],
	] as const) {
		it(`clicking ${label} with a stale copy goes to sign in and never shows the old data`, async () => {
			let alive = true;
			const { calls } = mockFetch(({ url }) => (url === '/api/auth/me' && alive ? ok({ user: who, csrfToken: 't' }) : unauthenticated()));
			const router = renderApp('/posiciones');
			const user = userEvent.setup();
			const nav = await screen.findByRole('link', { name: link });
			expect(meCalls(calls)).toBe(1);

			// The session is deleted in the database; the copy in memory still says signed in.
			alive = false;
			const shown = watchFor(`Hola, ${who.nombre}`);
			await user.click(nav);
			await waitFor(() => expect(where(router)).toBe(`/ingresar?next=${encodeURIComponent(path)}`));
			expect(shown.seen()).toBe(false);
			shown.stop();
			expect(await screen.findByRole('link', { name: 'Ingresar' })).toBeTruthy();
			// The protected page read the session itself instead of trusting the copy.
			expect(meCalls(calls)).toBeGreaterThanOrEqual(2);
			router.dispose();
		});
	}

	it('a 401 anywhere while /cuenta is showing: the data goes away and sign in opens, with ?next=', async () => {
		let alive = true;
		mockFetch(({ url }) => (alive ? ok(url === '/api/auth/me' ? { user: apostador, csrfToken: 't' } : { saldoMonedas: 10 }) : unauthenticated()));
		const router = renderApp('/cuenta');
		expect(await screen.findByText(`Hola, ${apostador.nombre}.`)).toBeTruthy();

		alive = false;
		await act(async () => {
			await api.get('/monedas/saldo').catch(() => undefined);
		});
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fcuenta'));
		expect(screen.queryByText(`Hola, ${apostador.nombre}.`)).toBeNull();
		router.dispose();
	});

	it('a role change under /admin runs its loader again (403 page)', async () => {
		let who: typeof admin | typeof apostador = admin;
		mockFetch(adminRoutes({ 'GET /api/auth/me': () => ok({ user: who, csrfToken: 't' }) }));
		renderApp('/admin');
		expect(await screen.findByRole('heading', { name: 'Resumen', level: 1 })).toBeTruthy();

		who = apostador;
		await act(async () => {
			await refreshSession();
		});
		expect(await screen.findByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'Resumen' })).toBeNull();
		// The panel's navigation is only for an admin.
		expect(screen.queryByRole('navigation', { name: 'Secciones del panel' })).toBeNull();
	});

	it('signing out on /cuenta goes home, not to sign in', async () => {
		let alive = true;
		mockFetch(({ url }) => {
			if (url === '/api/auth/logout') {
				alive = false;
				return ok(null);
			}
			return alive ? ok({ user: apostador, csrfToken: 't' }) : unauthenticated();
		});
		const router = renderApp('/cuenta');
		await screen.findByText(`Hola, ${apostador.nombre}.`);
		await userEvent.setup().click(screen.getByRole('button', { name: 'Salir' }));
		await waitFor(() => expect(where(router)).toBe('/'));
		expect(await screen.findByRole('link', { name: 'Ingresar' })).toBeTruthy();
	});
});

describe('browsing public pages does not read the session every time (D-009)', () => {
	it(`uses the copy for ${SESSION_CACHE_MS / 1000} s, then reads again; protected pages always read`, async () => {
		const now = vi.spyOn(Date, 'now');
		let clock = 1_000_000;
		now.mockImplementation(() => clock);
		const { calls } = mockFetch(() => ok({ user: apostador, csrfToken: 't' }));
		const router = renderApp('/');
		await screen.findByTestId('coin-counter');
		expect(meCalls(calls)).toBe(1);

		for (const path of ['/posiciones', '/plantilla/1', '/', '/posiciones', '/#fixture', '/']) {
			await act(() => router.navigate(path));
		}
		expect(meCalls(calls)).toBe(1);

		clock += SESSION_CACHE_MS + 1;
		await act(() => router.navigate('/posiciones'));
		await waitFor(() => expect(meCalls(calls)).toBe(2));

		// A protected page reads it even though the copy is fresh.
		await act(() => router.navigate('/cuenta'));
		await screen.findByText(`Hola, ${apostador.nombre}.`);
		expect(meCalls(calls)).toBe(3);
		await act(() => router.navigate('/posiciones'));
		expect(meCalls(calls)).toBe(3);
		router.dispose();
	});

	it('a 429 or no network on reading the session at load is unknown: never shown as signed out (T-19 step 0)', async () => {
		for (const failure of [() => fail(429, 'RATE_LIMITED', 'x', { limite: 'sesion' }), () => Promise.reject(new TypeError('Failed to fetch'))]) {
			let broken = true;
			mockFetch(() => (broken ? failure() : ok({ user: apostador, csrfToken: 't' })));
			const now = vi.spyOn(Date, 'now');
			let clock = 5_000_000;
			now.mockImplementation(() => clock);
			const router = renderApp('/');
			await screen.findByRole('heading', { name: 'Página de inicio' });
			await waitFor(() => expect(getSessionState().status).toBe('error'));
			expect(screen.queryByRole('link', { name: 'Ingresar' })).toBeNull();
			// The next page reads again, and the session shows up.
			broken = false;
			clock += 1;
			await act(() => router.navigate('/posiciones'));
			expect(await screen.findByTestId('coin-counter')).toBeTruthy();
			now.mockRestore();
			router.dispose();
			reset();
		}
	});

	it('a 429 on the session read shows the real reason on a protected page', async () => {
		mockFetch(() => fail(429, 'RATE_LIMITED', 'x', { limite: 'sesion' }, { 'Retry-After': '30' }));
		renderApp('/cuenta');
		expect(await screen.findByRole('heading', { name: 'Espera un momento' })).toBeTruthy();
		expect(screen.getByText(/Espera 30 segundos y vuelve a cargar la página/)).toBeTruthy();
		expect(screen.queryByText(/Sin conexión/)).toBeNull();
	});
});
