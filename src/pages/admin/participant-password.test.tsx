import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { adminRoutes, pageOf, participant } from '../../test/admin-fixtures';
import { fail, mockFetch, ok, type RecordedCall } from '../../test/fetch-mock';
import { renderApp, where } from '../../test/render-app';

const writes = (calls: RecordedCall[]) => calls.filter((c) => c.method !== 'GET');
const NEW_PASSWORD = 'otra-clave-99';

/** Opens Rosa's reset form and returns its password field. */
async function openReset(user: ReturnType<typeof userEvent.setup>) {
	await user.click(await screen.findByRole('button', { name: 'Restablecer contraseña' }));
	const form = screen.getByRole('form', { name: 'Contraseña nueva de Rosa' });
	return { form, field: within(form).getByLabelText('Contraseña nueva') as HTMLInputElement };
}

/** Goes through the explicit step. */
async function confirm(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
	await user.click(within(form).getByRole('button', { name: 'Cambiar contraseña' }));
	const step = within(form).getByRole('group', { name: '¿Cambiar la contraseña de Rosa?' });
	await user.click(within(step).getByRole('button', { name: 'Sí, cambiarla' }));
}

describe('participants: the admin resets a password (C-08, D-037)', () => {
	it('a password field that can be shown, with the rule and no cut; the explicit step sends it and the message says what to do', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'PUT /api/admin/participantes/21/contrasena': () => ok({ participante: participant(), sesionesCerradas: 2 }),
			}),
		);
		const router = renderApp('/admin/participantes');
		const user = userEvent.setup();
		const { form, field } = await openReset(user);

		// Opening moves the focus to the field (C-08 fix: it fell to the body), and the button says it is open.
		expect(document.activeElement).toBe(field);
		const opener = screen.getByRole('button', { name: 'Restablecer contraseña' });
		expect(opener.getAttribute('aria-expanded')).toBe('true');
		expect(opener.getAttribute('aria-controls')).toBe(form.id);
		// The form has a row of its own under the participant's, the whole width of the table
		// (in the stacked phone table a cell left it 128 px at 320 px).
		const row = form.closest('tr')!;
		expect(row.previousElementSibling?.textContent).toMatch(/Rosa/);
		expect(within(row).getAllByRole('cell')).toHaveLength(1);
		expect(within(row).getByRole('cell').getAttribute('colspan')).toBe('7');
		expect(field.type).toBe('password');
		expect(field.autocomplete).toBe('new-password');
		expect(field.maxLength).toBe(-1);
		expect(within(form).getByText(/De 6 a 20 caracteres/)).toBeTruthy();
		await user.type(field, NEW_PASSWORD);
		await user.click(within(form).getByLabelText('Mostrar la contraseña'));
		expect(field.type).toBe('text');
		// Shown whole, in lines, for checking it at 320 px; hidden from screen readers, which read the field.
		const revealed = within(form).getByText(NEW_PASSWORD, { selector: 'p' });
		expect(revealed.getAttribute('aria-hidden')).toBe('true');
		await user.click(within(form).getByLabelText('Mostrar la contraseña'));
		expect(field.type).toBe('password');
		expect(within(form).queryByText(NEW_PASSWORD, { selector: 'p' })).toBeNull();
		await user.click(within(form).getByLabelText('Mostrar la contraseña'));

		await user.click(within(form).getByRole('button', { name: 'Cambiar contraseña' }));
		// Nothing is sent until the explicit step.
		expect(writes(calls)).toHaveLength(0);
		expect(within(form).getByText(/Se cerrarán todas sus sesiones abiertas/)).toBeTruthy();
		await user.click(within(form).getByRole('button', { name: 'Sí, cambiarla' }));

		const done = await screen.findByText(/La contraseña de Rosa se cambió y se cerraron sus 2 sesiones abiertas/);
		expect(done.textContent).toMatch(/Comunícasela tú; la app no se la envía\./);
		await waitFor(() => expect(document.activeElement).toBe(done.closest('[role="status"]')));
		expect(writes(calls).map((c) => [c.method, c.url, c.body, c.headers['x-csrf-token']])).toEqual([
			['PUT', '/api/admin/participantes/21/contrasena', { contrasena: NEW_PASSWORD }, 't'],
		]);

		// The form closed, and the password is nowhere: not on screen, in the URL or in storage.
		expect(screen.queryByRole('form', { name: 'Contraseña nueva de Rosa' })).toBeNull();
		expect(document.body.innerHTML).not.toContain(NEW_PASSWORD);
		expect(where(router)).toBe('/admin/participantes');
		expect(JSON.stringify({ ...sessionStorage })).not.toContain(NEW_PASSWORD);
		expect(JSON.stringify({ ...localStorage })).not.toContain(NEW_PASSWORD);
		// Opened again, it starts empty.
		expect((await openReset(user)).field.value).toBe('');
	});

	it('says it in words when the participant had no open session', async () => {
		mockFetch(adminRoutes({ 'PUT /api/admin/participantes/21/contrasena': () => ok({ participante: participant(), sesionesCerradas: 0 }) }));
		renderApp('/admin/participantes');
		const user = userEvent.setup();
		const { form, field } = await openReset(user);
		await user.type(field, NEW_PASSWORD);
		await confirm(user, form);
		expect(await screen.findByText(/La contraseña de Rosa se cambió y no tenía sesiones abiertas/)).toBeTruthy();
	});

	it.each([
		['5 characters', 'abcde', /muy corta/],
		['21 characters', 'a'.repeat(21), /muy larga/],
		['four composed emoji and a letter (21 characters)', '👨‍👩‍👧'.repeat(4) + 'a', /muy larga/],
	])('%s: the field says why, takes the focus, and nothing is sent', async (_label, typed, reason) => {
		const { calls } = mockFetch(adminRoutes());
		renderApp('/admin/participantes');
		const user = userEvent.setup();
		const { form, field } = await openReset(user);
		await user.type(field, typed);
		await confirm(user, form);

		expect(within(form).getByText(reason)).toBeTruthy();
		expect(field.getAttribute('aria-invalid')).toBe('true');
		expect(document.activeElement).toBe(field);
		expect(writes(calls)).toHaveLength(0);
		// Nothing was cut: every character typed is still there.
		expect(field.value).toBe(typed);
		// Editing clears the error.
		await user.type(field, 'x');
		expect(field.getAttribute('aria-invalid')).toBeNull();
	});

	it('six emoji or a composed one with a letter are six characters: they are sent', async () => {
		const { calls } = mockFetch(adminRoutes({ 'PUT /api/admin/participantes/21/contrasena': () => ok({ participante: participant(), sesionesCerradas: 1 }) }));
		renderApp('/admin/participantes');
		const user = userEvent.setup();
		const { form, field } = await openReset(user);
		await user.type(field, '👨‍👩‍👧a');
		await confirm(user, form);
		await screen.findByText(/se cerró su sesión abierta/);
		expect(writes(calls).map((c) => c.body)).toEqual([{ contrasena: '👨‍👩‍👧a' }]);
	});

	it('a refusal on the field is shown on it and focuses it; the message never repeats the password', async () => {
		mockFetch(
			adminRoutes({
				'PUT /api/admin/participantes/21/contrasena': () =>
					fail(400, 'VALIDATION_ERROR', 'Solicitud inválida.', [{ path: 'contrasena', message: 'La contraseña es muy larga: no puede superar los 20 caracteres.' }]),
			}),
		);
		renderApp('/admin/participantes');
		const user = userEvent.setup();
		const { form, field } = await openReset(user);
		await user.type(field, NEW_PASSWORD);
		await confirm(user, form);

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe('No se pudo: Solicitud inválida. Revisa los campos marcados.');
		expect(within(form).getByText('La contraseña es muy larga: no puede superar los 20 caracteres.')).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(field));
		expect(alert.textContent).not.toContain(NEW_PASSWORD);
		// The admin can correct it: the field keeps what was typed.
		expect(field.value).toBe(NEW_PASSWORD);
	});

	it('an admin account is refused with the reason by code', async () => {
		mockFetch(
			adminRoutes({
				'PUT /api/admin/participantes/21/contrasena': () =>
					fail(404, 'NOT_A_PARTICIPANT', 'Esa cuenta es de un administrador: los administradores no participan en la polla.'),
			}),
		);
		renderApp('/admin/participantes');
		const user = userEvent.setup();
		const { form, field } = await openReset(user);
		await user.type(field, NEW_PASSWORD);
		await confirm(user, form);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe(
			'No se pudo: Esa cuenta es de un administrador: los administradores no participan en la polla. Los administradores no participan en la polla.',
		);
		await waitFor(() => expect(document.activeElement).toBe(alert));
	});

	it('a validated participant has it too, and "Cancelar" closes the form and gives the focus back', async () => {
		const { calls } = mockFetch(
			adminRoutes({ 'GET /api/admin/participantes': () => ok(pageOf([participant({ estadoPago: 'confirmado', estadoValidacion: 'validado', saldoMonedas: 10 })])) }),
		);
		renderApp('/admin/participantes');
		const user = userEvent.setup();
		expect(await screen.findByText('Ya está validado: no le quedan pasos.')).toBeTruthy();
		const { form, field } = await openReset(user);
		await user.type(field, NEW_PASSWORD);
		await user.click(within(form).getByRole('button', { name: 'Cancelar' }));
		expect(screen.queryByRole('form', { name: 'Contraseña nueva de Rosa' })).toBeNull();
		await waitFor(() => expect(document.activeElement?.textContent).toBe('Restablecer contraseña'));
		expect(document.activeElement?.getAttribute('aria-expanded')).toBe('false');
		expect(writes(calls)).toHaveLength(0);
		expect((await openReset(user)).field.value).toBe('');
	});
});

describe('participants: one password form at a time (C-08 fix)', () => {
	it('opening another participant closes the first, and the same button closes its own', async () => {
		mockFetch(adminRoutes({ 'GET /api/admin/participantes': () => ok(pageOf([participant(), participant({ id: 22, nombre: 'Tito', email: 'tito@liga.test' })])) }));
		renderApp('/admin/participantes');
		const user = userEvent.setup();
		const [rosa, tito] = await screen.findAllByRole('button', { name: 'Restablecer contraseña' });
		await user.click(rosa!);
		expect(screen.getByRole('form', { name: 'Contraseña nueva de Rosa' })).toBeTruthy();
		await user.click(tito!);
		expect(screen.queryByRole('form', { name: 'Contraseña nueva de Rosa' })).toBeNull();
		const field = within(screen.getByRole('form', { name: 'Contraseña nueva de Tito' })).getByLabelText('Contraseña nueva');
		expect(document.activeElement).toBe(field);
		await user.click(tito!);
		expect(screen.queryByRole('form', { name: 'Contraseña nueva de Tito' })).toBeNull();
	});
});
