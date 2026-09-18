import { cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { getSessionState, resetSessionForTests } from '../lib/auth';
import { admin, apostador, fail, mockFetch, ok, pendiente, type RecordedCall } from '../test/fetch-mock';
import { adminRoutes } from '../test/admin-fixtures';
import { locationOf, renderRoutes, screen } from '../test/render-routes';

function resetBetweenRenders() {
	cleanup();
	resetSessionForTests();
}

const guest = () => fail(401, 'UNAUTHENTICATED', 'Inicia sesión.');

/** The input with that label, and the text of its error (via aria-describedby). */
function field(label: string) {
	const input = screen.getByLabelText(label) as HTMLInputElement;
	const described = (input.getAttribute('aria-describedby') ?? '')
		.split(' ')
		.filter(Boolean)
		.map((id) => document.getElementById(id)?.textContent ?? '')
		.join(' | ');
	return { input, invalid: input.getAttribute('aria-invalid') === 'true', described };
}

describe('sign in (/ingresar)', () => {
	it('checks the fields before calling the API and ties each error to its field', async () => {
		const { calls } = mockFetch(guest);
		renderRoutes('/ingresar');
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Ingresar' }));

		await waitFor(() => expect(field('Correo').invalid).toBe(true));
		expect(field('Correo').described).toMatch(/Escribe tu correo/);
		expect(field('Contraseña').invalid).toBe(true);
		expect(field('Contraseña').described).toMatch(/Escribe tu contraseña/);
		expect(screen.getByRole('alert').textContent).toMatch(/Revisa los datos marcados/);
		expect(document.activeElement).toBe(field('Correo').input);
		expect(calls.filter((c) => c.url === '/api/auth/login')).toHaveLength(0);
	});

	it('401: one message that never says which part was wrong', async () => {
		mockFetch(({ url }) => (url === '/api/auth/login' ? fail(401, 'INVALID_CREDENTIALS', 'x') : guest()));
		renderRoutes('/ingresar');
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText('Correo'), 'ana@liga.test');
		await user.type(screen.getByLabelText('Contraseña'), 'clave-incorrecta');
		await user.click(screen.getByRole('button', { name: 'Ingresar' }));

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe('Correo o contraseña incorrectos.');
		expect(document.activeElement).toBe(alert);
		expect(field('Correo').invalid).toBe(false);
		expect(field('Contraseña').invalid).toBe(false);
		expect((screen.getByLabelText('Correo') as HTMLInputElement).value).toBe('ana@liga.test');
		expect((screen.getByLabelText('Contraseña') as HTMLInputElement).value).toBe('');
	});

	it('429: says how long to wait', async () => {
		mockFetch(({ url }) =>
			url === '/api/auth/login' ? fail(429, 'RATE_LIMITED', 'x', { limite: 'ingreso' }, { 'Retry-After': '600' }) : guest(),
		);
		renderRoutes('/ingresar');
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText('Correo'), 'ana@liga.test');
		await user.type(screen.getByLabelText('Contraseña'), 'clave');
		await user.click(screen.getByRole('button', { name: 'Ingresar' }));
		expect((await screen.findByRole('alert')).textContent).toBe('Demasiados intentos de ingreso. Espera 10 minutos y vuelve a intentarlo.');
	});

	it('429 from the general limit is not called too many sign-in attempts', async () => {
		mockFetch(({ url }) =>
			url === '/api/auth/login' ? fail(429, 'RATE_LIMITED', 'x', { limite: 'general' }, { 'Retry-After': '120' }) : guest(),
		);
		renderRoutes('/ingresar');
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText('Correo'), 'ana@liga.test');
		await user.type(screen.getByLabelText('Contraseña'), 'clave');
		await user.click(screen.getByRole('button', { name: 'Ingresar' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe('Demasiadas solicitudes desde esta conexión. Espera 2 minutos y vuelve a intentarlo.');
		expect(alert.textContent).not.toMatch(/intentos de ingreso/);
	});

	it('goes back to a safe ?next= after signing in, and never sends it to the API', async () => {
		const calls: RecordedCall[] = [];
		const { calls: recorded } = mockFetch(({ url }) =>
			url === '/api/auth/login' ? ok({ user: apostador, csrfToken: 't', expiraEn: '2026-09-18T00:00:00.000Z' }) : guest(),
		);
		const router = renderRoutes('/ingresar?next=%2Fposiciones%3Fx%3D1');
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText('Correo'), '  Ana@Liga.test ');
		await user.type(screen.getByLabelText('Contraseña'), 'clave-segura-1');
		await user.click(screen.getByRole('button', { name: 'Ingresar' }));

		await screen.findByText('Página de posiciones');
		expect(locationOf(router)).toBe('/posiciones?x=1');
		calls.push(...recorded);
		const loginCall = calls.find((c) => c.url.startsWith('/api/auth/login'))!;
		expect(loginCall.url).toBe('/api/auth/login');
		expect(loginCall.body).toEqual({ email: 'Ana@Liga.test', password: 'clave-segura-1' });
		expect(calls.every((c) => !c.url.includes('next') && !c.url.includes('posiciones'))).toBe(true);
		expect(getSessionState().user).toEqual(apostador);
	});

	it('a failed attempt keeps ?next= for the next one', async () => {
		let attempts = 0;
		mockFetch(({ url }) => {
			if (url !== '/api/auth/login') return guest();
			attempts++;
			return attempts === 1 ? fail(401, 'INVALID_CREDENTIALS', 'x') : ok({ user: pendiente, csrfToken: 't', expiraEn: 'x' });
		});
		const router = renderRoutes('/ingresar?next=%2Fposiciones');
		const user = userEvent.setup();
		await user.type(await screen.findByLabelText('Correo'), pendiente.email);
		await user.type(screen.getByLabelText('Contraseña'), 'mala-123');
		await user.click(screen.getByRole('button', { name: 'Ingresar' }));
		await screen.findByRole('alert');
		expect(locationOf(router)).toBe('/ingresar?next=%2Fposiciones');
		await user.type(screen.getByLabelText('Contraseña'), 'clave-segura-1');
		await user.click(screen.getByRole('button', { name: 'Ingresar' }));
		await screen.findByText('Página de posiciones');
	});

	it('an external ?next= is ignored: a validated participant lands on betting (D-008), a pending one on their account, the admin on administration', async () => {
		for (const [who, expected] of [
			[apostador, '/apuestas'],
			[pendiente, '/cuenta'],
			[admin, '/admin'],
		] as const) {
			let signedIn = false;
			mockFetch(({ url }) => {
				if (url === '/api/auth/login') {
					signedIn = true;
					return ok({ user: who, csrfToken: 't', expiraEn: 'x' });
				}
				return signedIn ? ok({ user: who, csrfToken: 't' }) : guest();
			});
			const router = renderRoutes('/ingresar?next=%2F%2Fevil.test%2Fcuenta');
			const user = userEvent.setup();
			await user.type(await screen.findByLabelText('Correo'), who.email);
			await user.type(screen.getByLabelText('Contraseña'), 'clave-segura-1');
			await user.click(screen.getByRole('button', { name: 'Ingresar' }));
			await waitFor(() => expect(locationOf(router)).toBe(expected));
			router.dispose();
			resetBetweenRenders();
		}
	});

	it('someone already signed in goes straight to ?next=', async () => {
		mockFetch(() => ok({ user: apostador, csrfToken: 't' }));
		const router = renderRoutes('/ingresar?next=%2Fposiciones');
		await screen.findByText('Página de posiciones');
		expect(locationOf(router)).toBe('/posiciones');
	});
});

describe('sign up (/registro)', () => {
	async function fill(values: { nombre?: string; email?: string; password?: string }) {
		const user = userEvent.setup();
		if (values.nombre) await user.type(await screen.findByLabelText('Nombre a mostrar'), values.nombre);
		if (values.email) await user.type(screen.getByLabelText('Correo'), values.email);
		if (values.password) await user.type(screen.getByLabelText('Contraseña'), values.password);
		await user.click(await screen.findByRole('button', { name: 'Crear cuenta' }));
	}

	it('helps with the same rules as the backend before sending', async () => {
		const { calls } = mockFetch(guest);
		renderRoutes('/registro');
		await fill({ nombre: '   ', email: 'no-es-correo', password: 'corta' });
		await waitFor(() => expect(field('Nombre a mostrar').invalid).toBe(true));
		expect(field('Nombre a mostrar').described).toMatch(/Escribe tu nombre/);
		expect(field('Correo').described).toMatch(/El correo no es válido/);
		expect(field('Contraseña').described).toMatch(/al menos 10 caracteres/);
		// The hint stays tied to the field too.
		expect(field('Contraseña').described).toMatch(/De 10 a 128 caracteres/);
		expect(calls.some((c) => c.url === '/api/auth/register')).toBe(false);
	});

	it('the name follows the catalog name rules (D-011): no emoji-only, invisible or control names', async () => {
		const cp = (...points: number[]) => String.fromCodePoint(...points);
		for (const [nombre, message] of [
			[cp(0x1f985), /al menos una letra o un número/],
			['¡¿!?', /al menos una letra o un número/],
			[`An${cp(0x200b)}a`, /invisibles/],
			[cp(0x3164), /invisibles/],
			[`Ana${cp(0x07)}`, /control/],
			['a'.repeat(101), /no puede superar los 100/],
		] as const) {
			const { calls } = mockFetch(guest);
			renderRoutes('/registro');
			const user = userEvent.setup();
			const input = (await screen.findByLabelText('Nombre a mostrar')) as HTMLInputElement;
			// Set directly: user-event can't type every one of these characters, and maxlength would cut the long one.
			input.removeAttribute('maxlength');
			input.value = nombre;
			await user.type(screen.getByLabelText('Correo'), 'ana@liga.test');
			await user.type(screen.getByLabelText('Contraseña'), 'clave-segura-1');
			await user.click(screen.getByRole('button', { name: 'Crear cuenta' }));
			await waitFor(() => expect(field('Nombre a mostrar').described, JSON.stringify(nombre)).toMatch(message));
			expect(calls.some((c) => c.url === '/api/auth/register')).toBe(false);
			resetBetweenRenders();
		}
	});

	it('shows the backend errors per field (400) and keeps what was typed, except the password', async () => {
		mockFetch(({ url }) =>
			url === '/api/auth/register'
				? fail(400, 'VALIDATION_ERROR', 'Solicitud inválida.', [
						{ path: 'email', message: 'El correo no es válido.' },
						{ path: 'nombre', message: 'El nombre no puede superar los 100 caracteres.' },
					])
				: guest(),
		);
		renderRoutes('/registro');
		await fill({ nombre: 'Ana', email: 'ana@liga.test', password: 'clave-segura-1' });
		await waitFor(() => expect(field('Correo').invalid).toBe(true));
		expect(field('Correo').described).toMatch(/El correo no es válido/);
		expect(field('Nombre a mostrar').described).toMatch(/no puede superar los 100/);
		expect(field('Contraseña').invalid).toBe(false);
		expect(field('Nombre a mostrar').input.value).toBe('Ana');
		expect(field('Correo').input.value).toBe('ana@liga.test');
		expect(field('Contraseña').input.value).toBe('');
		expect(document.activeElement).toBe(field('Nombre a mostrar').input);
	});

	it('409 EMAIL_TAKEN: the email field says so, with a way to sign in', async () => {
		mockFetch(({ url }) => (url === '/api/auth/register' ? fail(409, 'EMAIL_TAKEN', 'x') : guest()));
		renderRoutes('/registro');
		await fill({ nombre: 'Ana', email: 'ana@liga.test', password: 'clave-segura-1' });
		await waitFor(() => expect(field('Correo').described).toMatch(/Ya existe una cuenta con ese correo/));
		expect(screen.getByRole('link', { name: 'Ingresar con ese correo' })).toBeTruthy();
	});

	it('429: says how long to wait', async () => {
		mockFetch(({ url }) => (url === '/api/auth/register' ? fail(429, 'RATE_LIMITED', 'x', { limite: 'registro' }, { 'RateLimit-Reset': '45' }) : guest()));
		renderRoutes('/registro');
		await fill({ nombre: 'Ana', email: 'ana@liga.test', password: 'clave-segura-1' });
		expect((await screen.findByRole('alert')).textContent).toBe(
			'Demasiados registros desde esta conexión. Espera 45 segundos y vuelve a intentarlo.',
		);
	});

	it('after signing up: explains the pending validation and leads to sign in with the email filled', async () => {
		const { calls } = mockFetch(({ url }) => (url === '/api/auth/register' ? ok({ user: pendiente }, 201) : guest()));
		const router = renderRoutes('/registro');
		await fill({ nombre: 'Beto', email: 'beto@liga.test', password: 'clave-segura-1' });

		const status = await screen.findByRole('status');
		expect(status.textContent).toMatch(/pendiente de validación/);
		expect(status.textContent).toMatch(/no podrás apostar hasta que un administrador confirme tu pago/);
		expect(calls.find((c) => c.url === '/api/auth/register')!.body).toEqual({ nombre: 'Beto', email: 'beto@liga.test', password: 'clave-segura-1' });
		// Registering doesn't sign in.
		expect(getSessionState().user).toBeNull();

		await userEvent.setup().click(screen.getByRole('link', { name: 'Ir a ingresar' }));
		await waitFor(() => expect(locationOf(router)).toBe('/ingresar'));
		expect((await screen.findByLabelText('Correo') as HTMLInputElement).value).toBe('beto@liga.test');
	});
});

describe('protected routes', () => {
	it('without a session, /cuenta and /admin send to /ingresar with ?next=', async () => {
		for (const path of ['/cuenta', '/admin']) {
			mockFetch(guest);
			const router = renderRoutes(path);
			await waitFor(() => expect(locationOf(router)).toBe(`/ingresar?next=${encodeURIComponent(path)}`));
			router.dispose();
			resetBetweenRenders();
		}
	});

	it('a pending participant sees the notice on /cuenta, with 0 coins', async () => {
		mockFetch(() => ok({ user: pendiente, csrfToken: 't' }));
		renderRoutes('/cuenta');
		const notice = await screen.findByRole('status');
		expect(notice.textContent).toMatch(/Cuenta pendiente de validación/);
		expect(notice.textContent).toMatch(/Todavía no puedes apostar/);
		expect(screen.getByText('Saldo').nextElementSibling?.textContent).toMatch(/0\s*monedas/);
	});

	it('a participant cannot open /admin (403 page); an admin can, and has no coins on /cuenta', async () => {
		mockFetch(() => ok({ user: apostador, csrfToken: 't' }));
		let router = renderRoutes('/admin');
		expect(await screen.findByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
		router.dispose();
		resetBetweenRenders();

		mockFetch(adminRoutes());
		router = renderRoutes('/admin');
		expect(await screen.findByRole('heading', { name: 'Resumen', level: 1 })).toBeTruthy();
		router.dispose();
		resetBetweenRenders();

		renderRoutes('/cuenta');
		expect((await screen.findByRole('status')).textContent).toMatch(/no participan en la polla/);
		expect(screen.queryByText('Saldo')).toBeNull();
	});

	it('the API unreachable on a protected page: a clear message, not a crash', async () => {
		mockFetch(() => Promise.reject(new TypeError('Failed to fetch')));
		renderRoutes('/cuenta');
		expect(await screen.findByRole('heading', { name: 'No se pudo cargar' })).toBeTruthy();
		expect(screen.getByText(/No se pudo conectar con el servidor/)).toBeTruthy();
	});
});
