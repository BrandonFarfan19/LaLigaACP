import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { adminMatch, adminRoutes, cancellation, cancelled, confirmedResult, enrollment, goal, pageOf, resultPreview } from '../../test/admin-fixtures';
import { fail, mockFetch, ok, type RecordedCall } from '../../test/fetch-mock';
import { renderApp, where } from '../../test/render-app';
import { action as matchAction } from './Partido';

const writes = (calls: RecordedCall[]) => calls.filter((c) => c.method !== 'GET');
const params = (call: RecordedCall) => Object.fromEntries(new URL(call.url, 'http://x').searchParams);
const gets = (calls: RecordedCall[], path: string) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === path);
const section = (name: string) => screen.getByRole('region', { name });

/** Types in a searchable chooser (D-019) and picks an option by its whole text. */
async function chooseOption(user: ReturnType<typeof userEvent.setup>, combo: HTMLElement, option: string, text: string) {
	await user.type(combo, text);
	await user.click(await screen.findByRole('option', { name: option }));
}

/**
 * A multipart submission as the route action reads it (its headers and its
 * form). Here, not a real Request: jsdom's FormData and File can't travel in
 * Node's Request (a browser's can; the review checks the whole trip).
 */
function multipartRequest(fields: Record<string, string | File>) {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	return { headers: new Headers({ 'Content-Type': 'multipart/form-data; boundary=x' }), formData: async () => form } as unknown as Request;
}

const IMAGE = `/admin/archivos/${'a'.repeat(32)}.webp`;
const VIDEO = { plataforma: 'youtube' as const, id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' };

describe('matches list and new match (T-21, BR-011 to BR-013)', () => {
	it('lists in the API order with league times, states and a link to each; filters by dates in Lima time', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/partidos': () => ok(pageOf([adminMatch(), adminMatch({ id: 43, estado: 'cancelado', local: { equipoId: 101, nombre: 'Pumas', goles: 1 }, visita: { equipoId: 100, nombre: 'Halcones', goles: 0 } })])),
			}),
		);
		renderApp('/admin/partidos?desde=2026-09-01&hasta=2026-09-30&estado=en_curso');
		const table = await screen.findByRole('table', { name: 'Partidos' });
		expect(params(gets(calls, '/api/admin/partidos')[0]!)).toEqual({
			desde: '2026-09-01T00:00:00-05:00',
			hasta: '2026-09-30T23:59:59-05:00',
			estado: 'en_curso',
			page: '1',
			pageSize: '20',
		});
		const rows = within(table).getAllByRole('row').slice(1);
		expect(rows[0]!.textContent).toMatch(/17 sept 2026 10:00/);
		expect(rows[0]!.textContent).toMatch(/En curso/);
		expect(rows[0]!.textContent).toMatch(/Sin cargar/);
		expect(rows[1]!.textContent).toMatch(/Cancelado/);
		expect(rows[1]!.textContent).toMatch(/1 - 0 \(sin confirmar\)/);
		expect(within(rows[0]!).getByRole('link', { name: 'Gestionar Halcones vs Pumas' }).getAttribute('href')).toBe('/admin/partidos/42');
	});

	it('a new match: the teams are the chosen competition\'s, the time goes with the league zone', async () => {
		const { calls } = mockFetch(adminRoutes({ 'POST /api/admin/partidos': () => ok(adminMatch({ id: 77, estado: 'programado' }), 201) }));
		renderApp('/admin/partidos');
		const form = await screen.findByRole('form', { name: 'Nuevo partido' });
		const user = userEvent.setup();
		// Without a competition there is nothing to choose from yet (D-019).
		expect(within(form).queryByRole('combobox', { name: 'Equipo local' })).toBeNull();
		expect(within(form).getAllByText('Elige antes la competición.')).toHaveLength(2);
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Competición' }), 'Liga (Fútbol)', 'lig');
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Equipo local' }), 'Halcones · Liga (Fútbol)', 'hal');
		// The teams offered are the chosen competition's: the API filters them, page by page.
		expect(params(gets(calls, '/api/admin/equipos').at(-1)!)).toEqual({ competicionId: '10', q: 'hal', page: '1', pageSize: '20' });
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Equipo visitante' }), 'Pumas · Liga (Fútbol)', 'pum');
		await user.type(within(form).getByLabelText('Jornada'), '4');
		await user.type(within(form).getByLabelText('Sede'), 'Estadio Sur');

		// No date: refused here, the field takes the focus, nothing is sent.
		await user.click(within(form).getByRole('button', { name: 'Crear partido' }));
		const fecha = within(form).getByLabelText('Fecha y hora (Lima)');
		await waitFor(() => expect(document.activeElement).toBe(fecha));
		expect(fecha.getAttribute('aria-invalid')).toBe('true');
		expect(writes(calls)).toHaveLength(0);

		await user.type(fecha, '2026-10-01T20:00');
		await user.click(within(form).getByRole('button', { name: 'Crear partido' }));
		expect(await screen.findByText('Se creó el partido Halcones vs Pumas.')).toBeTruthy();
		expect(writes(calls)[0]!.body).toEqual({ competicionId: 10, localId: 100, visitaId: 101, jornada: 4, fechaHora: '2026-10-01T20:00:00-05:00', sede: 'Estadio Sur' });
		expect(screen.getByRole('link', { name: 'Gestionar el partido nuevo' }).getAttribute('href')).toBe('/admin/partidos/77');
	});

	it('a refused match says why (a date in the past, the same team)', async () => {
		mockFetch(adminRoutes({ 'POST /api/admin/partidos': () => fail(400, 'SAME_TEAM', 'El equipo local y el visitante tienen que ser distintos.') }));
		renderApp('/admin/partidos');
		const form = await screen.findByRole('form', { name: 'Nuevo partido' });
		const user = userEvent.setup();
		await user.type(within(form).getByLabelText('Fecha y hora (Lima)'), '2026-10-01T20:00');
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Competición' }), 'Liga (Fútbol)', 'lig');
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Equipo local' }), 'Halcones · Liga (Fútbol)', 'hal');
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Equipo visitante' }), 'Halcones · Liga (Fútbol)', 'hal');
		await user.click(within(form).getByRole('button', { name: 'Crear partido' }));
		// The hint adds what to do instead of repeating the reason (T-21 fix), and the field is marked.
		expect((await screen.findByRole('alert')).textContent).toBe('No se pudo: El equipo local y el visitante tienen que ser distintos. Cambia uno de los dos.');
		const visitante = within(form).getByRole('combobox', { name: 'Equipo visitante' });
		await waitFor(() => expect(visitante.getAttribute('aria-invalid')).toBe('true'));
		await waitFor(() => expect(document.activeElement).toBe(visitante));
	});
});

describe('one match (T-21)', () => {
	it('an unknown or malformed id is the not-found page', async () => {
		const { calls } = mockFetch(adminRoutes({ 'GET /api/admin/partidos/9': () => fail(404, 'MATCH_NOT_FOUND', 'No existe.') }));
		let router = renderApp('/admin/partidos/9');
		expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
		router.dispose();
		router = renderApp('/admin/partidos/abc');
		expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
		expect(calls.some((c) => c.url.includes('/partidos/abc'))).toBe(false);
	});

	it('loads and corrects the score; confirming waits for the 60 minutes and says why', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'PUT /api/admin/partidos/42/resultado': () => ok(adminMatch({ local: { equipoId: 100, nombre: 'Halcones', goles: 2 }, visita: { equipoId: 101, nombre: 'Pumas', goles: 1 } })),
				'GET /api/admin/partidos/42/resultado': () =>
					ok(resultPreview({ marcador: { golesLocal: 2, golesVisitante: 1 }, resultado: 'local_gana', problemas: [{ code: 'MATCH_NOT_ENDED', message: 'El partido todavía no terminó.' }] })),
			}),
		);
		renderApp('/admin/partidos/42');
		const result = await screen.findByRole('region', { name: 'Resultado' });
		expect(result.textContent).toMatch(/Privado hasta confirmarlo\./);
		expect(result.textContent).toMatch(/Gana Halcones/);
		expect(within(result).getByText('Todavía no se puede confirmar: El partido todavía no terminó.')).toBeTruthy();
		expect((within(result).getByRole('button', { name: 'Confirmar resultado' }) as HTMLButtonElement).disabled).toBe(true);
		const user = userEvent.setup();
		const form = within(result).getByRole('form', { name: 'Cargar el marcador' });
		await user.clear(within(form).getByLabelText('Goles de Halcones'));
		await user.type(within(form).getByLabelText('Goles de Halcones'), '2');
		await user.clear(within(form).getByLabelText('Goles de Pumas'));
		await user.type(within(form).getByLabelText('Goles de Pumas'), '1');
		await user.click(within(form).getByRole('button', { name: 'Corregir marcador' }));
		expect(await within(result).findByText(/Marcador cargado: 2 - 1\. Todavía no es público/)).toBeTruthy();
		expect(writes(calls).map((c) => [c.method, c.url, c.body])).toEqual([['PUT', '/api/admin/partidos/42/resultado', { golesLocal: 2, golesVisitante: 1 }]]);
	});

	it('confirms the result with an explicit step and the score seen; RESULT_CHANGED is explained', async () => {
		let confirmed = 0;
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/partidos/42/resultado': () =>
					ok(resultPreview({ marcador: { golesLocal: 1, golesVisitante: 1 }, resultado: 'empate', puedeConfirmar: true, problemas: [], avisos: [{ code: 'GOALS_UNATTRIBUTED', message: 'Hay 2 goles sin autor.' }] })),
				'POST /api/admin/partidos/42/resultado/confirmar': () => {
					confirmed++;
					return confirmed === 1
						? fail(409, 'RESULT_CHANGED', 'El marcador cambió desde la vista previa.', { golesLocal: 2, golesVisitante: 1 })
						: ok(confirmedResult(adminMatch({ estado: 'finalizado' }), 1, 1));
				},
			}),
		);
		renderApp('/admin/partidos/42');
		const result = await screen.findByRole('region', { name: 'Resultado' });
		expect(within(result).getByText('Aviso: Hay 2 goles sin autor.')).toBeTruthy();
		const user = userEvent.setup();
		await user.click(within(result).getByRole('button', { name: 'Confirmar resultado' }));
		const step = within(result).getByRole('group', { name: 'Confirmación definitiva del resultado' });
		expect(step.textContent).toMatch(/Vas a confirmar Halcones 1 - 1 Pumas \(Empate\)\./);
		expect(step.textContent).toMatch(/Se liquidarán 4 apuestas\./);
		// The backend's own warning, word for word: the screen shows what it sends.
		expect(step.textContent).toMatch(/Confirmar el resultado es definitivo: el partido pasa a finalizado/);
		expect(writes(calls)).toHaveLength(0);
		await user.click(within(step).getByRole('button', { name: 'Sí, confirmar 1 - 1' }));
		const alert = await within(result).findByRole('alert');
		expect(alert.textContent).toMatch(/El marcador cambió desde la vista previa\. Alguien corrigió el marcador mientras tanto/);
		expect(writes(calls)[0]!.body).toEqual({ confirmar: true, golesLocal: 1, golesVisitante: 1 });
		await user.click(within(step).getByRole('button', { name: 'Sí, confirmar 1 - 1' }));
		expect(await within(result).findByText(/Resultado confirmado: 1 - 1\. El partido quedó finalizado/)).toBeTruthy();
	});

	it('a finished match: no edits, no score, no goals changes; media still allowed; cannot be cancelled', async () => {
		const finished = adminMatch({ estado: 'finalizado', local: { equipoId: 100, nombre: 'Halcones', goles: 2 }, visita: { equipoId: 101, nombre: 'Pumas', goles: 1 } });
		mockFetch(
			adminRoutes({
				'GET /api/admin/partidos/42': () => ok(finished),
				'GET /api/admin/partidos/42/resultado': () => ok(resultPreview({ partido: finished, marcador: { golesLocal: 2, golesVisitante: 1 }, resultado: 'local_gana' })),
				'GET /api/admin/partidos/42/goles': () => ok([goal()]),
				'GET /api/admin/partidos/42/cancelacion': () =>
					ok(cancellation({ puedeCancelar: false, problemas: [{ code: 'MATCH_ALREADY_FINISHED', message: 'El partido ya tiene su resultado confirmado: no se puede cancelar.' }] })),
			}),
		);
		renderApp('/admin/partidos/42');
		await screen.findByRole('region', { name: 'Resultado' });
		expect(screen.queryByRole('form', { name: 'Editar el partido' })).toBeNull();
		expect(screen.queryByRole('form', { name: 'Cargar el marcador' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Confirmar resultado' })).toBeNull();
		expect(screen.queryByRole('button', { name: 'Borrar partido' })).toBeNull();
		expect(section('Resultado').textContent).toMatch(/Confirmado y público\./);
		const goals = section('Goles');
		expect(within(goals).queryByRole('button', { name: 'Editar gol' })).toBeNull();
		expect(within(goals).getByRole('form', { name: 'Imagen del gol' })).toBeTruthy();
		expect(within(section('Imágenes y videos del partido')).getByRole('form', { name: 'Agregar imagen' })).toBeTruthy();
		expect(within(section('Cancelación')).getByText('El partido ya tiene su resultado confirmado: no se puede cancelar.')).toBeTruthy();
		expect(within(section('Cancelación')).queryByRole('button', { name: 'Cancelar partido' })).toBeNull();
	});

	it('a match with bets that has not started: teams locked, the date can only be postponed', async () => {
		const scheduled = adminMatch({ estado: 'programado', fechaHora: '2026-12-01T20:00:00.000Z' });
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/partidos/42': () => ok(scheduled),
				'GET /api/admin/partidos/42/resultado': () => ok(resultPreview({ partido: scheduled, seleccionesPendientes: 3 })),
				'PATCH /api/admin/partidos/42': () => fail(409, 'MATCH_HAS_BETS', 'El partido tiene apuestas: su fecha solo puede postergarse.', { apuestas: 3 }),
			}),
		);
		renderApp('/admin/partidos/42');
		const form = await screen.findByRole('form', { name: 'Editar el partido' });
		expect(form.textContent).toMatch(/No cambian porque el partido tiene apuestas\./);
		expect(within(form).queryByLabelText('Competición')).toBeNull();
		expect(form.textContent).toMatch(/Con apuestas, la fecha solo puede postergarse\./);
		const user = userEvent.setup();
		const fecha = within(form).getByLabelText('Fecha y hora (Lima)') as HTMLInputElement;
		expect(fecha.value).toBe('2026-12-01T15:00');
		await user.clear(fecha);
		await user.type(fecha, '2026-11-30T15:00');
		await user.click(within(form).getByRole('button', { name: 'Guardar datos' }));
		expect((await screen.findByRole('alert')).textContent).toMatch(/Con apuestas, un partido solo se posterga/);
		expect(writes(calls)[0]!.body).toEqual({ jornada: 3, sede: 'Estadio Norte', fechaHora: '2026-11-30T15:00:00-05:00' });
		expect(screen.getByRole('button', { name: 'Borrar partido' })).toBeTruthy();
	});

	it('deletes a match with its explicit step and goes back to the list, which says so', async () => {
		const scheduled = adminMatch({ estado: 'programado', fechaHora: '2026-12-01T20:00:00.000Z' });
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/partidos/42': () => ok(scheduled),
				'GET /api/admin/partidos/42/resultado': () => ok(resultPreview({ partido: scheduled, seleccionesPendientes: 0 })),
				'GET /api/admin/partidos/42/cancelacion': () => ok(cancellation({ selecciones: 0 })),
				'DELETE /api/admin/partidos/42': () => ok({ id: 42 }),
			}),
		);
		const router = renderApp('/admin/partidos/42');
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Borrar partido' }));
		// What the user reads never names a decision code (T-21 fix).
		expect(screen.getByText(/Solo se borra un partido sin apuestas, goles, resultado ni multimedia\./)).toBeTruthy();
		expect(screen.queryByText(/D-00\d/)).toBeNull();
		await user.click(screen.getByRole('button', { name: 'Sí, borrar' }));
		await waitFor(() => expect(where(router)).toBe('/admin/partidos'));
		const message = await screen.findByText('Se borró el partido Halcones vs Pumas.');
		await waitFor(() => expect(document.activeElement).toBe(message.closest('p')));
		expect(writes(calls).map((c) => [c.method, c.url])).toEqual([['DELETE', '/api/admin/partidos/42']]);
		// The deleted match isn't read again.
		expect(gets(calls, '/api/admin/partidos/42')).toHaveLength(1);
	});

	it('cancels with an explicit step that shows what happens, including the voided selections without a refund (D-002)', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'POST /api/admin/partidos/42/cancelacion/confirmar': () => ok(cancelled(adminMatch({ estado: 'cancelado' }))),
			}),
		);
		renderApp('/admin/partidos/42');
		const cancel = await screen.findByRole('region', { name: 'Cancelación' });
		expect(cancel.textContent).toMatch(/Apuestas a anular4/);
		expect(cancel.textContent).toMatch(/1 apuesta de una cuenta que hoy administra/);
		expect(cancel.textContent).not.toMatch(/D-002/);
		const user = userEvent.setup();
		await user.click(within(cancel).getByRole('button', { name: 'Cancelar partido' }));
		const step = within(cancel).getByRole('group', { name: 'Cancelación definitiva del partido' });
		expect(step.textContent).toMatch(/Se anularán 4 apuestas y se devolverán 3 monedas a 2 usuarios\./);
		expect(step.textContent).toMatch(/Cancelar el partido es definitivo: sus apuestas pendientes quedan anuladas/);
		await user.click(within(step).getByRole('button', { name: 'Sí, cancelar el partido' }));
		expect(await within(cancel).findByText('Partido cancelado: se anularon 4 apuestas y se devolvieron 3 monedas.')).toBeTruthy();
		expect(writes(calls).map((c) => [c.url, c.body])).toEqual([['/api/admin/partidos/42/cancelacion/confirmar', { confirmar: true }]]);
	});
});

describe('goals and media (T-21, BR-033)', () => {
	it('registers a goal with a player of the chosen team, and explains GOALS_EXCEED_SCORE', async () => {
		let attempt = 0;
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/planteles': ({ url }) => ok(pageOf(params({ url } as RecordedCall).equipoId === '100' ? [enrollment] : [])),
				'POST /api/admin/partidos/42/goles': () =>
					++attempt === 1 ? fail(409, 'GOALS_EXCEED_SCORE', 'Ese equipo ya tiene todos los goles del marcador con autor.') : ok(goal({ minuto: 44 }), 201),
			}),
		);
		renderApp('/admin/partidos/42');
		const goals = await screen.findByRole('region', { name: 'Goles' });
		const form = within(goals).getByRole('form', { name: 'Registrar un gol' });
		const user = userEvent.setup();
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Equipo' }), 'Pumas (visita)', 'pum');
		expect(within(form).queryByRole('combobox', { name: 'Jugador' })).toBeNull();
		expect(within(form).getByText('Ese equipo no tiene jugadores inscritos.')).toBeTruthy();
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Equipo' }), 'Halcones (local)', 'hal');
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Jugador' }), 'Luis Paredes (camiseta 9)', 'luis');
		await user.type(within(form).getByLabelText('Minuto'), '44');
		await user.click(within(form).getByRole('button', { name: 'Registrar gol' }));
		expect((await within(goals).findByRole('alert')).textContent).toMatch(/Primero sube el marcador de ese equipo\./);
		expect(writes(calls)[0]!.body).toEqual({ jugadorId: 500, equipoId: 100, minuto: 44 });
		await user.click(within(form).getByRole('button', { name: 'Registrar gol' }));
		expect(await within(goals).findByText('Gol de Luis Paredes (minuto 44) registrado.')).toBeTruthy();
	});

	it('uploads a goal image as multipart with the CSRF token; a file over 5 MB is refused before sending', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/partidos/42/goles': () => ok([goal()]),
				'PUT /api/admin/partidos/42/goles/900/imagen': () => ok(goal({ imagen: IMAGE })),
			}),
		);
		renderApp('/admin/partidos/42');
		const goals = await screen.findByRole('region', { name: 'Goles' });
		const form = within(goals).getByRole('form', { name: 'Imagen del gol' });
		const input = within(form).getByLabelText('Imagen del gol') as HTMLInputElement;
		expect(input.getAttribute('accept')).toBe('image/jpeg,image/png,image/webp,image/gif');
		const user = userEvent.setup();
		const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' });
		await user.upload(input, big);
		await user.click(within(form).getByRole('button', { name: 'Subir imagen' }));
		expect(await within(form).findByText(/La imagen supera el máximo de 5 MB: elige una más liviana\./)).toBeTruthy();
		await waitFor(() => expect(document.activeElement).toBe(input));
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(writes(calls)).toHaveLength(0);

		// The route action and the API call, on their own (see `multipartRequest`).
		const photo = new File([new Uint8Array([1, 2, 3])], 'gol.png', { type: 'image/png' });
		const request = multipartRequest({ intent: 'goalImage', target: 'gol-900', golId: '900', imagen: photo });
		const outcome = await matchAction({ request, params: { id: '42' }, context: {} } as never);
		expect(outcome).toMatchObject({ intent: 'goalImage', target: 'gol-900', ok: true, message: 'Imagen del gol guardada.' });
		const upload = writes(calls)[0]!;
		expect([upload.method, upload.url, upload.headers['x-csrf-token'], upload.headers['content-type']]).toEqual(['PUT', '/api/admin/partidos/42/goles/900/imagen', 't', undefined]);
		expect([...upload.form!.keys()]).toEqual(['imagen']);
	});

	it('a 413 in HTML from a proxy is explained, not shown as an unexpected answer (T-21 fix)', async () => {
		mockFetch(
			adminRoutes({
				'GET /api/admin/partidos/42/goles': () => ok([goal()]),
				'PUT /api/admin/partidos/42/goles/900/imagen': () => new Response('<html><body><h1>413 Request Entity Too Large</h1></body></html>', { status: 413, headers: { 'Content-Type': 'text/html' } }),
			}),
		);
		const request = multipartRequest({ intent: 'goalImage', target: 'gol-900', golId: '900', imagen: new File([new Uint8Array([1])], 'g.png', { type: 'image/png' }) });
		const outcome = await matchAction({ request, params: { id: '42' }, context: {} } as never);

		expect(outcome).toMatchObject({ ok: false, code: 'PAYLOAD_TOO_LARGE' });
		expect(outcome.message).toBe('El archivo es demasiado grande: el servidor lo rechazó antes de recibirlo entero. El máximo es 5 MB: elige una imagen más liviana.');
	});

	it('the route action refuses an upload without a file, before calling the API', async () => {
		const { calls } = mockFetch(adminRoutes());
		const request = multipartRequest({ intent: 'addImage', target: 'imagenes' });
		const outcome = await matchAction({ request, params: { id: '42' }, context: {} } as never);
		expect(outcome).toMatchObject({ ok: false, fields: { imagen: 'Elige un archivo de imagen.' } });
		expect(writes(calls)).toHaveLength(0);
	});

	it('shows uploaded images only from the server\'s own paths, and videos only through their embed address', async () => {
		mockFetch(
			adminRoutes({
				'GET /api/admin/partidos/42/goles': () => ok([goal({ imagen: IMAGE, video: VIDEO }), goal({ id: 901, imagen: 'https://evil.test/x.svg', video: { ...VIDEO, embedUrl: 'https://evil.test/embed' } })]),
				'GET /api/admin/partidos/42/multimedia': () => ok({ imagenes: [{ id: 1, tipo: 'imagen', url: IMAGE, creadoEn: '2026-09-17T15:30:00.000Z' }], videos: [{ id: 2, tipo: 'video', video: VIDEO, creadoEn: '2026-09-17T15:31:00.000Z' }] }),
			}),
		);
		renderApp('/admin/partidos/42');
		await screen.findByRole('region', { name: 'Goles' });
		const images = [...document.querySelectorAll('main img')].map((img) => img.getAttribute('src'));
		expect(images).toEqual([`/api${IMAGE}`, `/api${IMAGE}`]);
		const frames = [...document.querySelectorAll('main iframe')];
		expect(frames.map((f) => f.getAttribute('src'))).toEqual([VIDEO.embedUrl, VIDEO.embedUrl]);
		expect(frames.every((f) => f.getAttribute('sandbox') === 'allow-scripts allow-same-origin allow-presentation')).toBe(true);
		expect(document.querySelector('main svg image, main object, main embed')).toBeNull();
		const link = screen.getAllByRole('link', { name: 'Abrir el video en YouTube' })[0]!;
		expect([link.getAttribute('href'), link.getAttribute('rel')]).toEqual([VIDEO.url, 'noopener noreferrer']);
	});

	it('adds a match video; an invalid link shows the backend reason next to the field', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'POST /api/admin/partidos/42/multimedia/videos': ({ body }) =>
					(body as { url: string }).url.includes('youtube')
						? ok({ id: 3, tipo: 'video', video: VIDEO, creadoEn: '2026-09-17T15:31:00.000Z' }, 201)
						: fail(400, 'VALIDATION_ERROR', 'Datos inválidos.', [{ path: 'url', message: 'Solo se aceptan enlaces https de YouTube o Vimeo.' }]),
			}),
		);
		renderApp('/admin/partidos/42');
		const media = await screen.findByRole('region', { name: 'Imágenes y videos del partido' });
		const user = userEvent.setup();
		const form = within(media).getByRole('form', { name: 'Agregar video' });
		await user.type(within(form).getByLabelText('Agregar video'), 'https://otro.test/v');
		await user.click(within(form).getByRole('button', { name: 'Guardar video' }));
		const field = within(form).getByLabelText('Agregar video');
		await waitFor(() => expect(document.activeElement).toBe(field));
		expect(within(form).getByText('Solo se aceptan enlaces https de YouTube o Vimeo.')).toBeTruthy();
		await user.clear(field);
		await user.type(field, VIDEO.url);
		await user.click(within(form).getByRole('button', { name: 'Guardar video' }));
		expect(await within(media).findByText('Video de YouTube guardado.')).toBeTruthy();
		expect(writes(calls).map((c) => c.body)).toEqual([{ url: 'https://otro.test/v' }, { url: VIDEO.url }]);
	});

	it('removing a goal image or video asks first, and the file field forgets the file that is gone', async () => {
		let image: string | null = IMAGE;
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/partidos/42/goles': () => ok([goal({ imagen: image, video: VIDEO })]),
				'DELETE /api/admin/partidos/42/goles/900/imagen': () => {
					image = null;
					return ok(goal({ imagen: null, video: VIDEO }));
				},
				'DELETE /api/admin/partidos/42/goles/900/video': () => ok(goal({ imagen: null, video: null })),
			}),
		);
		renderApp('/admin/partidos/42');
		const goals = await screen.findByRole('region', { name: 'Goles' });
		const user = userEvent.setup();
		const upload = within(goals).getByRole('form', { name: 'Reemplazar imagen del gol' });
		await user.upload(within(upload).getByLabelText('Reemplazar imagen del gol'), new File([new Uint8Array([1])], 'g.jpg', { type: 'image/jpeg' }));
		expect(within(upload).getByText('Elegido: g.jpg')).toBeTruthy();

		// Nothing is deleted on the first click: the file on the server goes only after confirming (T-21 fix).
		await user.click(within(goals).getByRole('button', { name: 'Quitar imagen' }));
		expect(writes(calls)).toHaveLength(0);
		const step = within(goals).getByRole('group', { name: /¿Quitar la imagen del gol de Luis Paredes/ });
		expect(step.textContent).toMatch(/El archivo se borra del servidor\./);
		await user.click(within(step).getByRole('button', { name: 'Sí, quitar' }));
		expect(await within(goals).findByText('Imagen del gol quitada.')).toBeTruthy();
		expect(writes(calls).map((c) => [c.method, c.url])).toEqual([['DELETE', '/api/admin/partidos/42/goles/900/imagen']]);
		// The field no longer names a file that is gone.
		await waitFor(() => expect(screen.queryByText('Elegido: g.jpg')).toBeNull());

		await user.click(within(goals).getByRole('button', { name: 'Quitar video' }));
		const videoStep = within(goals).getByRole('group', { name: /¿Quitar el video del gol de Luis Paredes/ });
		expect(videoStep.textContent).toMatch(/el video sigue en su plataforma/);
		await user.click(within(videoStep).getByRole('button', { name: 'Sí, quitar' }));
		expect(await within(goals).findByText('Video del gol quitado.')).toBeTruthy();
	});

	it('sending a form clears the message another form left', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'PUT /api/admin/partidos/42/resultado': () => ok(adminMatch({ local: { equipoId: 100, nombre: 'Halcones', goles: 1 }, visita: { equipoId: 101, nombre: 'Pumas', goles: 0 } })),
				'POST /api/admin/partidos/42/multimedia/videos': () => ok({ id: 3, tipo: 'video', video: VIDEO, creadoEn: '2026-09-17T15:31:00.000Z' }, 201),
			}),
		);
		renderApp('/admin/partidos/42');
		const result = await screen.findByRole('region', { name: 'Resultado' });
		const user = userEvent.setup();
		const score = within(result).getByRole('form', { name: 'Cargar el marcador' });
		await user.type(within(score).getByLabelText('Goles de Halcones'), '1');
		await user.type(within(score).getByLabelText('Goles de Pumas'), '0');
		await user.click(within(score).getByRole('button', { name: 'Cargar marcador' }));
		expect(await within(result).findByText(/Marcador cargado: 1 - 0/)).toBeTruthy();

		const media = screen.getByRole('region', { name: 'Imágenes y videos del partido' });
		const videoForm = within(media).getByRole('form', { name: 'Agregar video' });
		await user.type(within(videoForm).getByLabelText('Agregar video'), VIDEO.url);
		await user.click(within(videoForm).getByRole('button', { name: 'Guardar video' }));
		expect(await within(media).findByText('Video de YouTube guardado.')).toBeTruthy();
		// The old message of the other form is gone (T-21 fix).
		expect(within(result).queryByText(/Marcador cargado: 1 - 0/)).toBeNull();
		expect(writes(calls)).toHaveLength(2);
	});
});
