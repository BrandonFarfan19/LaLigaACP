import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { adminRoutes } from '../../test/admin-fixtures';
import { fail, mockFetch, ok, type RecordedCall } from '../../test/fetch-mock';
import { FB_EMBED, FB_VIDEO, liveStream, noLiveStream } from '../../test/live-stream-fixtures';
import { renderApp } from '../../test/render-app';
import { PLAYER_SANDBOX } from '../EnVivo';

const writes = (calls: RecordedCall[]) => calls.filter((c) => c.method !== 'GET');
const PASTED = 'https://m.facebook.com/watch/?v=1234567890123456&mibextid=abc';

/** C-14 (D-043): the panel's «Transmisión» section. */
describe('panel: the live stream link (C-14)', () => {
	it('is in the panel navigation, and with no stream it says so and shows no player or «Quitar»', async () => {
		mockFetch(adminRoutes());
		renderApp('/admin/transmision');

		expect(await screen.findByRole('heading', { name: 'Transmisión en vivo' })).toBeTruthy();
		const nav = screen.getByRole('navigation', { name: 'Secciones del panel' });
		expect(within(nav).getByRole('link', { name: 'Transmisión' }).getAttribute('aria-current')).toBe('page');
		expect(screen.getByText(/No hay transmisión: la página «En vivo»/)).toBeTruthy();
		expect(document.querySelector('iframe')).toBeNull();
		expect(screen.queryByRole('button', { name: 'Quitar' })).toBeNull();
		expect(document.title).toBe('Transmisión · Administración · La Liga ACP');
	});

	it('saves the pasted link as { url } with the CSRF token; the preview plays only the embedUrl the API answered', async () => {
		let stored = noLiveStream();
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/transmision': () => ok(stored),
				'PUT /api/admin/transmision': () => {
					stored = liveStream();
					return ok(stored);
				},
			}),
		);
		renderApp('/admin/transmision');
		const user = userEvent.setup();

		const field = await screen.findByLabelText('Link del video de Facebook');
		await user.type(field, `  ${PASTED}  `);
		// Nothing plays until the API answers: the front never builds a player address.
		expect(document.querySelector('iframe')).toBeNull();
		await user.click(screen.getByRole('button', { name: 'Guardar' }));

		expect(await screen.findByText(/La transmisión quedó publicada/)).toBeTruthy();
		const put = writes(calls)[0]!;
		expect(put.method).toBe('PUT');
		expect(put.url).toBe('/api/admin/transmision');
		expect(put.body).toEqual({ url: PASTED });
		expect(put.headers['x-csrf-token']).toBe('t');

		const preview = await screen.findByTitle('Vista previa de la transmisión (Facebook)');
		expect(preview.getAttribute('src')).toBe(FB_EMBED);
		expect(preview.getAttribute('sandbox')).toBe(PLAYER_SANDBOX);
		expect(screen.getByRole('link', { name: 'Abrir la transmisión en Facebook' }).getAttribute('href')).toBe(FB_VIDEO);
		// The field now shows the link as the backend stored it.
		await waitFor(() => expect((screen.getByLabelText('Link del video de Facebook') as HTMLInputElement).value).toBe(FB_VIDEO));
		expect(screen.getByText(/Publicada el 30 sept 2026 15:15 \(hora de Lima\)/)).toBeTruthy();
	});

	it('a link the backend refuses shows its reason on the field, which takes the focus', async () => {
		const reason = 'Los links para compartir (fb.watch o facebook.com/share/…) no llevan el número del video: abre el video en Facebook y copia el link de la barra de direcciones del navegador (empieza con https://www.facebook.com/).';
		const { calls } = mockFetch(
			adminRoutes({
				'PUT /api/admin/transmision': () => fail(400, 'VALIDATION_ERROR', 'Datos inválidos.', [{ path: 'url', message: reason }]),
			}),
		);
		renderApp('/admin/transmision');
		const user = userEvent.setup();

		const field = await screen.findByLabelText('Link del video de Facebook');
		await user.type(field, 'https://fb.watch/abc123/');
		await user.click(screen.getByRole('button', { name: 'Guardar' }));

		expect(await screen.findByText(reason)).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Link del video de Facebook')));
		expect(screen.getByLabelText('Link del video de Facebook').getAttribute('aria-invalid')).toBe('true');
		expect(writes(calls)).toHaveLength(1);
		expect(document.querySelector('iframe')).toBeNull();
	});

	it('an empty field is not sent: removing has its own button and step', async () => {
		const { calls } = mockFetch(adminRoutes());
		renderApp('/admin/transmision');
		const user = userEvent.setup();

		await screen.findByLabelText('Link del video de Facebook');
		await user.click(screen.getByRole('button', { name: 'Guardar' }));

		expect(await screen.findByText('Pega el link del video en vivo de Facebook.')).toBeTruthy();
		expect(writes(calls)).toEqual([]);
	});

	it('«Quitar» goes through its explicit step and sends DELETE; then the section says there is none', async () => {
		let stored = liveStream();
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/transmision': () => ok(stored),
				'DELETE /api/admin/transmision': () => {
					stored = noLiveStream();
					return ok(stored);
				},
			}),
		);
		renderApp('/admin/transmision');
		const user = userEvent.setup();

		await user.click(await screen.findByRole('button', { name: 'Quitar' }));
		expect(writes(calls)).toEqual([]);
		const step = screen.getByRole('group', { name: '¿Quitar la transmisión?' });
		await user.click(within(step).getByRole('button', { name: 'Sí, quitar' }));

		expect(await screen.findByText(/Se quitó la transmisión/)).toBeTruthy();
		expect(writes(calls).map((c) => `${c.method} ${c.url}`)).toEqual(['DELETE /api/admin/transmision']);
		await waitFor(() => expect(document.querySelector('iframe')).toBeNull());
		expect(screen.getByText(/No hay transmisión: la página «En vivo»/)).toBeTruthy();
	});

	it('a player address that is not Facebook\'s plugin never reaches an iframe: the section shows its load notice', async () => {
		mockFetch(adminRoutes({ 'GET /api/admin/transmision': () => ok({ ...liveStream(), embedUrl: 'https://evil.example/x' }) }));
		renderApp('/admin/transmision');

		expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeTruthy();
		expect(screen.getByRole('alert').textContent).toMatch(/No se pudo cargar la transmisión/);
		expect(document.querySelector('iframe')).toBeNull();
	});
});
