import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
	adminBet,
	adminMatch,
	adminRoutes,
	auditRecord,
	counts,
	enrollment,
	enrollmentStats,
	league,
	pageOf,
	participant,
	sport,
	stats,
} from '../../test/admin-fixtures';
import { admin, apostador, fail, mockFetch, ok, pendiente, type RecordedCall } from '../../test/fetch-mock';
import { renderApp, where } from '../../test/render-app';

const writes = (calls: RecordedCall[]) => calls.filter((c) => c.method !== 'GET');

/** Types in a searchable chooser (D-019) and picks an option by its whole text. */
async function chooseOption(user: ReturnType<typeof userEvent.setup>, combo: HTMLElement, option: string, text = option.slice(0, 3)) {
	await user.type(combo, text);
	await user.click(await screen.findByRole('option', { name: option }));
}
const params = (call: RecordedCall) => Object.fromEntries(new URL(call.url, 'http://x').searchParams);
const gets = (calls: RecordedCall[], path: string) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === path);

describe('admin panel: access and navigation (T-21)', () => {
	it('a participant gets a clear 403 on any section, without the panel navigation', async () => {
		for (const user of [apostador, pendiente]) {
			const { calls } = mockFetch(adminRoutes({}, user));
			const router = renderApp('/admin/participantes');
			expect(await screen.findByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
			expect(screen.getByText(/solo para administradores/)).toBeTruthy();
			expect(screen.queryByRole('navigation', { name: 'Secciones del panel' })).toBeNull();
			expect(calls.some((c) => c.url.startsWith('/api/admin'))).toBe(false);
			router.dispose();
		}
	});

	it('nobody signed in goes to sign in, back to the section asked for', async () => {
		mockFetch(adminRoutes({ 'GET /api/auth/me': () => fail(401, 'UNAUTHENTICATED') }));
		const router = renderApp('/admin/partidos?estado=en_curso');
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fadmin%2Fpartidos%3Festado%3Den_curso'));
	});

	it('an admin sees the sections, the counts (participants only) and the pool figures', async () => {
		mockFetch(adminRoutes());
		renderApp('/admin');
		expect(await screen.findByRole('heading', { name: 'Resumen', level: 1 })).toBeTruthy();
		const nav = screen.getByRole('navigation', { name: 'Secciones del panel' });
		const links = within(nav).getAllByRole('link');
		expect(links.map((a) => a.textContent)).toEqual([
			'Resumen',
			'Inscritos',
			'Partidos',
			'Apuestas',
			'Ranking',
			'Deportes',
			'Competiciones',
			'Equipos',
			'Jugadores',
			'Planteles',
			'Auditoría',
		]);
		expect(within(nav).getByRole('link', { name: 'Resumen' }).getAttribute('aria-current')).toBe('page');
		// C-10 (D-039): the section is "Inscritos" (every registered account), and its card and the welcome say so.
		const participants = screen.getByRole('region', { name: 'Inscritos' });
		// The card's title already says "Inscritos": its figure is the "Total" (C-10 fix).
		expect(within(participants).getByText('Total', { selector: 'dt' }).nextElementSibling?.textContent).toBe(String(counts.inscritos));
		expect(within(participants).queryByText('Inscritos', { selector: 'dt' })).toBeNull();
		// The pending accounts are counted too, so the welcome doesn't call them participants: it only leaves admins out.
		const welcome = screen.getByText(/Valida inscritos, administra los partidos/);
		expect(welcome.textContent).toMatch(/Los administradores no participan: estas cifras no los cuentan\./);
		expect(welcome.textContent).not.toMatch(/participantes/);
		const figures = screen.getByRole('region', { name: 'Estadísticas de la polla' });
		// C-13: points only, no coin figures.
		expect(within(figures).queryByText(/Monedas/)).toBeNull();
		expect(figures.textContent).not.toMatch(/moneda|saldo|premio/i);
		expect(within(figures).getByText('Puntos').nextElementSibling?.textContent).toBe(String(stats.puntos));
		expect(within(figures).getByText('Tickets').nextElementSibling?.textContent).toBe('42 pendientes · 1 finalizado · 1 anulado');
		expect(within(figures).getByText('Selecciones').nextElementSibling?.textContent).toBe('73 pendientes · 2 acertadas · 1 no acertada · 1 anulada');
	});

	it('a failed read stays on the page with its notice and Reintentar, which loads it', async () => {
		let down = true;
		mockFetch(adminRoutes({ 'GET /api/admin/polla/estadisticas': () => (down ? new Response('', { status: 502 }) : ok(stats)) }));
		renderApp('/admin');
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/^No se pudo cargar el resumen\. El servidor no está disponible/);
		expect(screen.getByRole('heading', { name: 'Resumen', level: 1 })).toBeTruthy();
		down = false;
		await userEvent.setup().click(within(alert).getByRole('button', { name: 'Reintentar' }));
		expect(await screen.findByRole('region', { name: 'Estadísticas de la polla' })).toBeTruthy();
		expect(screen.queryByRole('alert')).toBeNull();
	});

	it('with no known session and the server down, the first visit is the error page; its Reintentar loads the section', async () => {
		let down = true;
		mockFetch(adminRoutes({ 'GET /api/auth/me': () => (down ? new Response('', { status: 502 }) : ok({ user: admin, csrfToken: 't' })) }));
		renderApp('/admin/ranking');
		expect(await screen.findByRole('heading', { name: 'No se pudo cargar' })).toBeTruthy();
		const user = userEvent.setup();
		// A retry that fails again says so.
		await user.click(screen.getByRole('button', { name: 'Reintentar' }));
		await waitFor(() => expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain('Sigue sin poder cargarse. Espera un momento y vuelve a intentarlo.'));
		down = false;
		await user.click(screen.getByRole('button', { name: 'Reintentar' }));
		const title = await screen.findByRole('heading', { name: 'Ranking completo', level: 1 });
		// The loaded page's title takes the focus (the button is gone).
		await waitFor(() => expect(document.activeElement).toBe(title));
	});
});

describe('participants (T-21, BR-006, BR-007)', () => {
	it('lists participants with their states and points (no balance since C-13); the filters live in the URL and reach the API', async () => {
		const { calls } = mockFetch(adminRoutes());
		const router = renderApp('/admin/participantes?estadoPago=pendiente&q=ros&foo=1');
		const table = await screen.findByRole('table', { name: 'Inscritos' });
		expect(params(gets(calls, '/api/admin/participantes')[0]!)).toEqual({ estadoPago: 'pendiente', q: 'ros', page: '1', pageSize: '20' });
		const row = within(table).getAllByRole('row')[1]!;
		expect(within(row).getByText('Rosa')).toBeTruthy();
		expect(within(row).getByText('rosa@liga.test')).toBeTruthy();
		expect(row.textContent).not.toMatch(/moneda|saldo/i);
		expect(within(table).queryByRole('columnheader', { name: 'Saldo' })).toBeNull();
		const user = userEvent.setup();
		await user.selectOptions(screen.getByLabelText('Validación'), 'validado');
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		await waitFor(() => expect(where(router)).toBe('/admin/participantes?q=ros&estadoPago=pendiente&estadoValidacion=validado'));
		await waitFor(() => expect(document.activeElement?.textContent).toBe('1 inscrito.'));
		// C-10 (D-039): the section says "Inscritos" everywhere it names itself or the accounts it lists.
		expect(document.title).toBe('Inscritos · Administración · La Liga ACP');
		expect(screen.getByRole('heading', { name: 'Inscritos', level: 1 })).toBeTruthy();
		// The heading already says "Inscritos": the figure is the "Total", as on the home card (C-10 fix).
		expect(screen.getByText('Total', { selector: 'dt' }).nextElementSibling?.textContent).toBe(String(counts.inscritos));
		expect(screen.queryByText('Inscritos', { selector: 'dt' })).toBeNull();
		expect(screen.getByRole('form', { name: 'Filtrar inscritos' })).toBeTruthy();
		expect(screen.getByText(/al validar, el inscrito puede apostar/)).toBeTruthy();
		expect(screen.queryByText(/participante/i)).toBeNull();
		// No role actions anywhere.
		expect(screen.queryByText(/rol/i, { selector: 'button' })).toBeNull();
	});

	it('confirms a payment with an explicit step, then validates, with no coins (C-13)', async () => {
		let who = participant();
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/participantes': () => ok(pageOf([who])),
				'POST /api/admin/participantes/21/pago/confirmar': () => {
					who = participant({ estadoPago: 'confirmado' });
					return ok({ participante: who });
				},
				'POST /api/admin/participantes/21/validar': () => {
					who = participant({ estadoPago: 'confirmado', estadoValidacion: 'validado' });
					return ok({ participante: who });
				},
			}),
		);
		renderApp('/admin/participantes');
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Confirmar pago' }));
		// Nothing is sent until the explicit step.
		expect(writes(calls)).toHaveLength(0);
		const step = screen.getByRole('group', { name: '¿Confirmar el pago de Rosa?' });
		expect(document.activeElement).toBe(step);
		await user.click(within(step).getByRole('button', { name: 'Sí, confirmar pago' }));
		const done = await screen.findByText(/El pago de Rosa quedó confirmado/);
		expect(done.closest('[role="status"]')).toBeTruthy();
		expect(writes(calls).map((c) => [c.method, c.url, c.headers['x-csrf-token']])).toEqual([['POST', '/api/admin/participantes/21/pago/confirmar', 't']]);

		await user.click(await screen.findByRole('button', { name: 'Validar' }));
		expect(screen.getByText(/^Podrá apostar\. La validación no se deshace\./)).toBeTruthy();
		await user.click(screen.getByRole('button', { name: 'Sí, validar' }));
		expect(await screen.findByText('Rosa quedó validado: ya puede apostar.')).toBeTruthy();
		await waitFor(() => expect(screen.getByText('Ya está validado: no le quedan pasos.')).toBeTruthy());
		expect(screen.getByRole('main').textContent).not.toMatch(/moneda/i);
	});

	it('explains a refusal with the backend reason and what to do; revert has its own step', async () => {
		mockFetch(
			adminRoutes({
				'GET /api/admin/participantes': () => ok(pageOf([participant({ estadoPago: 'confirmado' })])),
				'POST /api/admin/participantes/21/validar': () => fail(409, 'PAYMENT_NOT_CONFIRMED', 'El pago todavía no está confirmado.'),
				'POST /api/admin/participantes/21/pago/revertir': () => fail(409, 'USER_ALREADY_VALIDATED', 'El usuario ya está validado.'),
			}),
		);
		renderApp('/admin/participantes');
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Validar' }));
		await user.click(screen.getByRole('button', { name: 'Sí, validar' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe('No se pudo: El pago todavía no está confirmado. Primero confirma el pago; después valida.');
		await waitFor(() => expect(document.activeElement).toBe(alert));

		await user.click(screen.getByRole('button', { name: 'Revertir pago' }));
		const revert = screen.getByRole('group', { name: '¿Revertir el pago de Rosa?' });
		await user.click(within(revert).getByRole('button', { name: 'Volver' }));
		expect(document.activeElement?.textContent).toBe('Revertir pago');
	});
});

describe('bets, ranking and audit (T-21)', () => {
	it('bets placed: participant and match links, filters by participant, read only', async () => {
		const { calls } = mockFetch(adminRoutes());
		renderApp('/admin/apuestas?usuarioId=21&estado=pendiente');
		const table = await screen.findByRole('table', { name: 'Apuestas' });
		expect(params(gets(calls, '/api/admin/polla/apuestas')[0]!)).toEqual({ usuarioId: '21', estado: 'pendiente', page: '1', pageSize: '20' });
		expect(within(table).getByRole('link', { name: 'Rosa (id 21)' }).getAttribute('href')).toBe('/admin/apuestas?usuarioId=21');
		const bet = adminBet();
		expect(within(table).getByRole('link', { name: /vs/ }).getAttribute('href')).toBe(`/admin/partidos/${bet.partido.id}`);
		expect(screen.queryByRole('button', { name: /Borrar|Anular/ })).toBeNull();
	});

	it('the full ranking marks shared positions and links each participant to their bets', async () => {
		mockFetch(
			adminRoutes({
				'GET /api/admin/polla/ranking': () =>
					ok(
						pageOf([
							{ posicion: 1, empatados: 2, participante: { id: 21, nombre: 'Rosa' }, puntos: 6, aciertos: 2 },
							{ posicion: 3, empatados: 1, participante: { id: 23, nombre: 'Uma' }, puntos: 0, aciertos: 0 },
							{ posicion: 4, empatados: 3, participante: { id: 22, nombre: 'Tito' }, puntos: 0, aciertos: 0 },
						]),
					),
			}),
		);
		renderApp('/admin/ranking');
		const table = await screen.findByRole('table', { name: 'Ranking completo' });
		const cells = within(table)
			.getAllByRole('row')
			.slice(1)
			.map((row) => within(row).getAllByRole('cell')[0]!.textContent);
		// A tie that carries on into another page is still marked: the API counts it whole (T-21 fix).
		expect(cells).toEqual(['=1 (compartida con 1 más)', '3', '=4 (compartida con 2 más)']);
		expect(within(table).getByRole('link', { name: 'Tito (id 22)' }).getAttribute('href')).toBe('/admin/apuestas?usuarioId=22');
	});

	it('the audit log reads as words: before and after, dates in Lima time, the admin by name', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/auditoria': () =>
					ok(
						pageOf([
							auditRecord(),
							// The detail is the backend's own: a validation recorded before C-13 carries the id of the
							// coin movement it wrote (the log is never rewritten), and a sport row always carries its slug.
							auditRecord({ id: 2, accion: { codigo: 'validacion_usuario', nombre: 'Validación de usuario' }, entidad: 'usuario', entidadId: 21, detalle: { estadoValidacion: { antes: 'pendiente', despues: 'validado' }, monedasAsignadas: 10, movimientoId: 77 } }),
							auditRecord({ id: 3, accion: { codigo: 'alta_deporte', nombre: 'Alta de deporte' }, entidad: 'deporte', entidadId: 1, detalle: { nuevo: { id: 1, nombre: 'Fútbol', slug: 'futbol', permiteEmpate: true } } }),
						]),
					),
			}),
		);
		renderApp('/admin/auditoria?entidadId=4&accion=nada');
		const table = await screen.findByRole('table', { name: 'Registro de auditoría' });
		expect(screen.getByText('Para buscar un registro por su id elige también el tipo de dato: se ignoró el id.')).toBeTruthy();
		expect(screen.getByText('El filtro accion no es válido: se ignoró.')).toBeTruthy();
		expect(params(gets(calls, '/api/admin/auditoria')[0]!)).toEqual({ page: '1', pageSize: '20' });
		const rows = within(table).getAllByRole('row').slice(1);
		expect(rows[0]!.textContent).toMatch(/Sede: Estadio Norte → Estadio Sur/);
		expect(rows[0]!.textContent).toMatch(/Fecha y hora: 17 sept 2026 10:00 \(Lima\) → 18 sept 2026 10:00 \(Lima\)/);
		expect(rows[0]!.textContent).toMatch(/Admin \(id 1\)/);
		expect(rows[1]!.textContent).toMatch(/Validación: pendiente → validado/);
		expect(rows[1]!.textContent).toMatch(/Monedas asignadas: 10/);
		expect(rows[1]!.textContent).toMatch(/Movimiento: 77/);
		// Every field of the row the API sends, slug included, each one named.
		expect(rows[2]!.textContent).toMatch(/Creado: Id: 1 · Nombre: Fútbol · Slug: futbol · Admite empate: sí/);
		expect(admin.email).not.toBe('');
		expect(table.textContent).not.toContain(admin.email);
	});
});

describe('catalog (T-21, BR-001)', () => {
	it('adds a sport: an empty slug is left to the backend; a field error takes the focus', async () => {
		let attempt = 0;
		const { calls } = mockFetch(
			adminRoutes({
				'POST /api/admin/deportes': () => {
					attempt++;
					return attempt === 1
						? fail(400, 'VALIDATION_ERROR', 'Datos inválidos.', [{ path: 'nombre', message: 'Tiene que tener al menos una letra o un número.' }])
						: ok({ id: 3, nombre: 'Básquet', slug: 'basquet', permiteEmpate: false }, 201);
				},
			}),
		);
		renderApp('/admin/deportes');
		const form = await screen.findByRole('form', { name: 'Agregar el deporte' });
		const user = userEvent.setup();
		await user.type(within(form).getByLabelText('Nombre'), '!!');
		await user.click(within(form).getByRole('button', { name: 'Agregar' }));
		const nombre = await within(form).findByRole('textbox', { name: 'Nombre' });
		await waitFor(() => expect(document.activeElement).toBe(nombre));
		expect(nombre.getAttribute('aria-invalid')).toBe('true');
		expect(within(form).getByText('Tiene que tener al menos una letra o un número.')).toBeTruthy();
		// No profile chosen: "Sin estadísticas" sends null (C-05).
		expect(writes(calls)[0]!.body).toEqual({ nombre: '!!', permiteEmpate: false, perfilEstadistico: null });

		await user.clear(within(form).getByLabelText('Nombre'));
		await user.type(within(form).getByLabelText('Nombre'), 'Básquet');
		await user.click(within(form).getByRole('button', { name: 'Agregar' }));
		expect(await screen.findByText('Se agregó el deporte.')).toBeTruthy();
		// A clean form for the next one.
		await waitFor(() => expect((within(screen.getByRole('form', { name: 'Agregar el deporte' })).getByLabelText('Nombre') as HTMLInputElement).value).toBe(''));
	});

	it('edits inline (only its form closes on success) and explains DRAW_RULE_LOCKED and *_IN_USE', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'PATCH /api/admin/deportes/1': ({ body }) =>
					(body as { permiteEmpate: boolean }).permiteEmpate === false
						? fail(409, 'DRAW_RULE_LOCKED', 'No se puede cambiar si el deporte admite empate: sus partidos tienen apuestas.', { motivos: ['x'] })
						: ok({ ...sport, nombre: 'Fútbol 11' }),
				'DELETE /api/admin/deportes/1': () => fail(409, 'SPORT_IN_USE', 'No se puede borrar el deporte: tiene 1 competición.', { competiciones: 1 }),
			}),
		);
		renderApp('/admin/deportes');
		const table = await screen.findByRole('table', { name: 'Deportes' });
		const user = userEvent.setup();
		const firstRow = within(table).getAllByRole('row')[1]!;
		await user.click(within(firstRow).getByRole('button', { name: 'Editar' }));
		const form = screen.getByRole('form', { name: 'Editar el deporte' });
		expect((within(form).getByLabelText('Nombre') as HTMLInputElement).value).toBe('Fútbol');
		await user.click(within(form).getByRole('checkbox', { name: 'Admite empate' }));
		await user.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
		expect((await screen.findByRole('alert')).textContent).toMatch(
			/sus partidos tienen apuestas\. Si necesitas otra regla, crea un deporte nuevo con ella\./,
		);
		expect(writes(calls)[0]!.body).toEqual({ nombre: 'Fútbol', slug: 'futbol', permiteEmpate: false, perfilEstadistico: 'futbol' });

		await user.click(within(form).getByRole('checkbox', { name: 'Admite empate' }));
		await user.clear(within(form).getByLabelText('Nombre'));
		await user.type(within(form).getByLabelText('Nombre'), 'Fútbol 11');
		await user.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
		expect(await screen.findByText('Se guardaron los cambios del deporte Fútbol.')).toBeTruthy();
		await waitFor(() => expect(screen.queryByRole('form', { name: 'Editar el deporte' })).toBeNull());

		await user.click(within(within(table).getAllByRole('row')[1]!).getByRole('button', { name: 'Borrar' }));
		expect(screen.getByText('Solo se borra un deporte sin competiciones. Queda en la auditoría.')).toBeTruthy();
		await user.click(screen.getByRole('button', { name: 'Sí, borrar' }));
		expect((await screen.findByRole('alert')).textContent).toBe('No se pudo: No se puede borrar el deporte: tiene 1 competición. Borra antes sus competiciones.');
	});

	it('sports: the statistics profile is a short fixed list, shown in the table, and STATS_PROFILE_LOCKED marks it (C-05)', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'PATCH /api/admin/deportes/1': () =>
					fail(409, 'STATS_PROFILE_LOCKED', 'No se puede cambiar el perfil de estadísticas: 1 inscripción del deporte tiene estadísticas cargadas con el perfil actual.', {
						inscripcionesConEstadisticas: 1,
					}),
			}),
		);
		renderApp('/admin/deportes');
		const table = await screen.findByRole('table', { name: 'Deportes' });
		expect(within(table).getAllByRole('row')[1]!.textContent).toMatch(/Fútbol.*Fútbol/);
		const add = screen.getByRole('form', { name: 'Agregar el deporte' });
		const choice = within(add).getByRole('combobox', { name: 'Estadísticas de los jugadores' }) as HTMLSelectElement;
		expect([...choice.options].map((option) => option.value)).toEqual(['', 'futbol', 'voley']);
		// Short options (nothing cut at 320 px, D-014); the chosen profile's attributes go in the hint.
		expect([...choice.options].map((option) => option.textContent)).toEqual(['Sin estadísticas', 'Fútbol', 'Vóley']);
		expect(choice.value).toBe('');
		const hint = () => document.getElementById(choice.getAttribute('aria-describedby')!.split(' ')[0]!)!.textContent;
		expect(hint()).toMatch(/no llevan estadísticas/);
		await userEvent.setup().selectOptions(choice, 'voley');
		expect(hint()).toMatch(/Mate, Saque, Recepción, Armado y Bloqueo/);

		const user = userEvent.setup();
		await user.click(within(within(table).getAllByRole('row')[1]!).getByRole('button', { name: 'Editar' }));
		const form = screen.getByRole('form', { name: 'Editar el deporte' });
		const current = within(form).getByRole('combobox', { name: 'Estadísticas de los jugadores' }) as HTMLSelectElement;
		expect(current.value).toBe('futbol');
		await user.selectOptions(current, 'voley');
		await user.click(within(form).getByRole('button', { name: 'Guardar cambios' }));
		expect((await screen.findByRole('alert')).textContent).toMatch(/Quita antes las estadísticas de esas inscripciones/);
		expect(writes(calls)[0]!.body).toMatchObject({ perfilEstadistico: 'voley' });
		await waitFor(() => expect(current.getAttribute('aria-invalid')).toBe('true'));
	});

	it('squads: each row says whether it has statistics, and its panel edits them one field per attribute (C-05)', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'PUT /api/admin/planteles/700/estadisticas': ({ body }) => {
					const valores = (body as { valores: Record<string, number> }).valores;
					if (valores.pase === 100) return fail(400, 'VALIDATION_ERROR', 'Solicitud inválida.', [{ path: 'valores.pase', message: 'Tiene que estar entre 0 y 99.' }]);
					return ok(enrollmentStats({ valores }));
				},
				'DELETE /api/admin/planteles/700/estadisticas': () => ok(enrollmentStats({ valores: null })),
			}),
		);
		renderApp('/admin/planteles');
		const table = await screen.findByRole('table', { name: 'Planteles' });
		const row = (name: string) => within(table).getAllByRole('row').find((line) => line.textContent?.includes(name))!;
		expect(row('Luis Paredes').textContent).toMatch(/Cargadas/);
		expect(row('Sofía Díaz').textContent).toMatch(/Sin estadísticas/);

		const user = userEvent.setup();
		await user.click(within(row('Luis Paredes')).getByRole('button', { name: 'Estadísticas' }));
		const form = await screen.findByRole('form', { name: 'Estadísticas de Luis Paredes' });
		const fields = within(form).getAllByRole('spinbutton') as HTMLInputElement[];
		expect(fields.map((field) => [field.labels?.[0]?.textContent, field.value])).toEqual([
			['Disparo', '88'],
			['Pase', '75'],
			['Fuerza', '60'],
			['Defensa', '42'],
			['Velocidad', '91'],
			['Dribbling', '80'],
		]);

		// A value out of range: the backend's message on that field, which takes the focus.
		await user.clear(within(form).getByLabelText('Pase'));
		await user.type(within(form).getByLabelText('Pase'), '100');
		await user.click(within(form).getByRole('button', { name: 'Guardar estadísticas' }));
		const pase = within(form).getByLabelText('Pase');
		await waitFor(() => expect(document.activeElement).toBe(pase));
		expect(pase.getAttribute('aria-invalid')).toBe('true');
		expect(within(form).getByText('Tiene que estar entre 0 y 99.')).toBeTruthy();

		await user.clear(pase);
		await user.type(pase, '76');
		await user.click(within(form).getByRole('button', { name: 'Guardar estadísticas' }));
		expect(await screen.findByText('Se guardaron las estadísticas de Luis Paredes.')).toBeTruthy();
		expect(writes(calls).at(-1)!.body).toEqual({ valores: { disparo: 88, pase: 76, fuerza: 60, defensa: 42, velocidad: 91, dribbling: 80 } });

		// Removing them takes its explicit step.
		await user.click(screen.getByRole('button', { name: 'Quitar estadísticas' }));
		await user.click(screen.getByRole('button', { name: 'Sí, quitar' }));
		expect(await screen.findByText('Se quitaron las estadísticas de Luis Paredes.')).toBeTruthy();
		expect(writes(calls).at(-1)!.method).toBe('DELETE');
		await waitFor(() => expect((within(screen.getByRole('form', { name: 'Estadísticas de Luis Paredes' })).getByLabelText('Disparo') as HTMLInputElement).value).toBe(''));
		expect(screen.queryByRole('button', { name: 'Quitar estadísticas' })).toBeNull();
	});

	it('squads: an empty field goes missing and the backend names it; a sport without a profile says where to choose one (C-05)', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				// What the backend answers: zod's message for a decimal, the service's for a missing attribute.
				'PUT /api/admin/planteles/701/estadisticas': ({ body }) =>
					Number.isInteger((body as { valores: Record<string, unknown> }).valores.dribbling) || !('dribbling' in (body as { valores: object }).valores)
						? fail(400, 'VALIDATION_ERROR', 'Solicitud inválida.', [{ path: 'valores.dribbling', message: 'Falta Dribbling: se cargan todos los atributos juntos.' }])
						: fail(400, 'VALIDATION_ERROR', 'Solicitud inválida.', [{ path: 'valores.dribbling', message: 'Debe ser un número entero.' }]),
				'GET /api/admin/planteles/700/estadisticas': () => ok(enrollmentStats({ perfil: null, valores: null })),
			}),
		);
		renderApp('/admin/planteles');
		const table = await screen.findByRole('table', { name: 'Planteles' });
		const row = (name: string) => within(table).getAllByRole('row').find((line) => line.textContent?.includes(name))!;
		const user = userEvent.setup();

		await user.click(within(row('Sofía Díaz')).getByRole('button', { name: 'Estadísticas' }));
		const form = await screen.findByRole('form', { name: 'Estadísticas de Sofía Díaz' });
		expect(within(form).getByText(/Todavía no tiene/)).toBeTruthy();
		const typed: Array<[string, string]> = [['Disparo', '70'], ['Pase', '71'], ['Fuerza', '72'], ['Defensa', '73'], ['Velocidad', '74']];
		for (const [label, value] of typed) await user.type(within(form).getByLabelText(label), value);
		await user.click(within(form).getByRole('button', { name: 'Guardar estadísticas' }));
		expect(await within(form).findByText('Falta Dribbling: se cargan todos los atributos juntos.')).toBeTruthy();
		expect(writes(calls)[0]!.body).toEqual({ valores: { disparo: 70, pase: 71, fuerza: 72, defensa: 73, velocidad: 74 } });

		// A decimal goes as a number, so the backend says it has to be whole (C-05 fix), not "Debe ser un número".
		await user.type(within(form).getByLabelText('Dribbling'), '7.5');
		await user.click(within(form).getByRole('button', { name: 'Guardar estadísticas' }));
		expect(await within(form).findByText('Debe ser un número entero.')).toBeTruthy();
		expect(writes(calls)[1]!.body).toEqual({ valores: { disparo: 70, pase: 71, fuerza: 72, defensa: 73, velocidad: 74, dribbling: 7.5 } });

		await user.click(within(row('Luis Paredes')).getByRole('button', { name: 'Estadísticas' }));
		const explained = await screen.findByText(/no tiene perfil de estadísticas/);
		expect(within(explained).getByRole('link', { name: 'Deportes' }).getAttribute('href')).toBe('/admin/deportes');
		expect(screen.queryByRole('form', { name: 'Estadísticas de Luis Paredes' })).toBeNull();
	});

	it('teams: crests only as images, and the competition is searched in the API (D-019)', async () => {
		const { calls } = mockFetch(adminRoutes());
		renderApp('/admin/equipos');
		const table = await screen.findByRole('table', { name: 'Equipos' });
		expect(within(table).getAllByRole('row')[1]!.textContent).toMatch(/Liga \(Fútbol\)/);
		const images = [...table.querySelectorAll('img')].map((img) => img.getAttribute('src'));
		expect(images).toEqual(['/favicon.png', 'https://img.test/pumas.png']);
		expect(document.body.querySelector('svg image, object, embed')).toBeNull();
		// Nothing is loaded before it is needed: no list of competitions on arrival.
		expect(gets(calls, '/api/admin/competiciones')).toHaveLength(0);

		const form = screen.getByRole('form', { name: 'Agregar el equipo' });
		const user = userEvent.setup();
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Competición' }), 'Liga (Fútbol)', 'lig');
		// Only what was typed goes to the API, one page at a time.
		expect(params(gets(calls, '/api/admin/competiciones').at(-1)!)).toEqual({ q: 'lig', page: '1', pageSize: '20' });
		expect(within(form).getByText('Liga (Fútbol)')).toBeTruthy();
		expect(form.querySelector('input[name="competicionId"]')).toHaveProperty('value', '10');
	});

	it('squads: a new enrollment sends the ids; an edit only the shirt number (no transfers)', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'POST /api/admin/planteles': () => fail(409, 'PLAYER_ALREADY_ENROLLED', 'El jugador ya está inscrito en otro equipo de esa competición.', { equipoId: 101 }),
				// The API answers the whole row, not just its id (`enrollments.service.ts`).
				'PATCH /api/admin/planteles/700': () => ok({ ...enrollment, numeroCamiseta: 10 }),
			}),
		);
		renderApp('/admin/planteles');
		const form = await screen.findByRole('form', { name: 'Agregar la inscripción' });
		const user = userEvent.setup();
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Jugador' }), 'Luis Paredes');
		await chooseOption(user, within(form).getByRole('combobox', { name: 'Equipo' }), 'Halcones · Liga (Fútbol)');
		await user.type(within(form).getByLabelText('Número de camiseta'), '9');
		await user.click(within(form).getByRole('button', { name: 'Agregar' }));
		expect((await screen.findByRole('alert')).textContent).toMatch(/Elige otro jugador, o da de baja antes esa inscripción\./);
		expect(writes(calls)[0]!.body).toEqual({ jugadorId: 500, equipoId: 100, numeroCamiseta: 9 });

		// A 409 that names no field still marks the one it is about (T-21 fix).
		await waitFor(() => expect(within(form).getByRole('combobox', { name: 'Jugador' }).getAttribute('aria-invalid')).toBe('true'));

		const table = screen.getByRole('table', { name: 'Planteles' });
		// Two squads are listed (one per team): edit the one of Luis Paredes.
		const row = within(table).getAllByRole('row').find((line) => line.textContent?.includes('Luis Paredes'))!;
		await user.click(within(row).getByRole('button', { name: 'Editar' }));
		const edit = screen.getByRole('form', { name: 'Editar la inscripción' });
		expect(within(edit).queryByRole('combobox', { name: 'Jugador' })).toBeNull();
		await user.clear(within(edit).getByLabelText('Número de camiseta'));
		await user.type(within(edit).getByLabelText('Número de camiseta'), '10');
		await user.click(within(edit).getByRole('button', { name: 'Guardar cambios' }));
		await waitFor(() => expect(writes(calls)).toHaveLength(2));
		expect(writes(calls)[1]!.body).toEqual({ numeroCamiseta: 10 });
	});

	it('players: an emptied photo is removed (null)', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/jugadores': () => ok(pageOf([{ id: 500, nombre: 'Luis Paredes', foto: 'https://img.test/luis.png' }])),
				'PATCH /api/admin/jugadores/500': () => ok({ id: 500, nombre: 'Luis Paredes', foto: null }),
			}),
		);
		renderApp('/admin/jugadores');
		const table = await screen.findByRole('table', { name: 'Jugadores' });
		const user = userEvent.setup();
		await user.click(within(table).getByRole('button', { name: 'Editar' }));
		const edit = screen.getByRole('form', { name: 'Editar el jugador' });
		await user.clear(within(edit).getByLabelText('Foto (opcional)'));
		await user.click(within(edit).getByRole('button', { name: 'Guardar cambios' }));
		await waitFor(() => expect(writes(calls)).toHaveLength(1));
		expect(writes(calls)[0]!.body).toEqual({ nombre: 'Luis Paredes', foto: null });
	});

	it('competitions: sport names, and the sport filter in the URL', async () => {
		const { calls } = mockFetch(adminRoutes());
		renderApp(`/admin/competiciones?deporteId=${sport.id}`);
		const table = await screen.findByRole('table', { name: 'Competiciones' });
		expect(within(table).getAllByRole('row')[1]!.textContent).toMatch(new RegExp(`${league.nombre}.*Fútbol`));
		expect(params(gets(calls, '/api/admin/competiciones').find((c) => params(c).deporteId)!)).toEqual({ deporteId: '1', page: '1', pageSize: '20' });
		// The filter in the URL reads with its whole name, from the API (D-019).
		expect(within(screen.getByRole('form', { name: 'Filtrar competiciones' })).getByText('Fútbol')).toBeTruthy();
	});

	it('a filter that chooses a record shows the value of the URL even if it is not on the page shown', async () => {
		mockFetch(adminRoutes({ 'GET /api/admin/planteles': () => ok(pageOf([])) }));
		renderApp('/admin/planteles?equipoId=100');
		const form = await screen.findByRole('form', { name: 'Filtrar planteles' });
		// The row isn't in the list, and the name still comes from the API by id.
		expect(await within(form).findByText('Halcones · Liga (Fútbol)')).toBeTruthy();
	});
});

describe('every admin list: pages and filter problems (T-21)', () => {
	it('a page past the end shows the last one and says so', async () => {
		mockFetch(
			adminRoutes({
				'GET /api/admin/participantes': ({ url }) => {
					const page = Number(new URL(url, 'http://x').searchParams.get('page'));
					return ok(pageOf([participant()], { page, total: 25, totalPages: 2 }));
				},
			}),
		);
		renderApp('/admin/participantes?page=9');
		expect(await screen.findByText('La página 9 no existe: se muestra la última (2).')).toBeTruthy();
		expect(screen.getByText('25 inscritos. Página 2 de 2.')).toBeTruthy();
	});

	it('a page past the end also replaces the URL, without reading everything again', async () => {
		const { calls } = mockFetch(
			adminRoutes({
				'GET /api/admin/partidos': ({ url }) => {
					const page = Number(new URL(url, 'http://x').searchParams.get('page'));
					return ok(pageOf([adminMatch()], { page, total: 25, totalPages: 2 }));
				},
			}),
		);
		const router = renderApp('/admin/partidos?page=9');
		expect(await screen.findByText('La página 9 no existe: se muestra la última (2).')).toBeTruthy();
		// The URL says the page shown (T-21 second fix), and that replacement reads nothing again.
		await waitFor(() => expect(where(router)).toBe('/admin/partidos?page=2'));
		const reads = gets(calls, '/api/admin/partidos').map((call) => params(call).page);
		expect(reads).toEqual(['9', '2']);
	});

	it('the session gone while a page link loads signs in with that page, not with the one on screen', async () => {
		let alive = true;
		mockFetch(
			adminRoutes({
				'GET /api/auth/me': () => (alive ? ok({ user: admin, csrfToken: 't' }) : fail(401, 'UNAUTHENTICATED')),
				'GET /api/admin/participantes': ({ url }) => {
					const page = Number(new URL(url, 'http://x').searchParams.get('page'));
					return ok(pageOf([participant()], { page, total: 25, totalPages: 2 }));
				},
			}),
		);
		const router = renderApp('/admin/participantes');
		await screen.findByRole('table', { name: 'Inscritos' });
		alive = false;
		await userEvent.setup().click(screen.getByRole('link', { name: 'Siguiente >' }));

		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fadmin%2Fparticipantes%3Fpage%3D2'));
	});

	it('the session gone while a filter loads signs in with the filtered URL', async () => {
		let alive = true;
		mockFetch(
			adminRoutes({
				'GET /api/auth/me': () => (alive ? ok({ user: admin, csrfToken: 't' }) : fail(401, 'UNAUTHENTICATED')),
				'GET /api/admin/partidos': () => ok(pageOf([adminMatch()])),
			}),
		);
		const router = renderApp('/admin/partidos');
		const form = await screen.findByRole('form', { name: 'Filtrar partidos' });
		const user = userEvent.setup();
		alive = false;
		await user.selectOptions(within(form).getByLabelText('Estado'), 'en_curso');
		await user.click(within(form).getByRole('button', { name: 'Filtrar' }));

		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fadmin%2Fpartidos%3Festado%3Den_curso'));
	});

	it('two dates the wrong way round are announced and the field takes the focus', async () => {
		mockFetch(adminRoutes());
		const router = renderApp('/admin/partidos');
		const form = await screen.findByRole('form', { name: 'Filtrar partidos' });
		const user = userEvent.setup();
		await user.type(within(form).getByLabelText('Desde'), '2026-10-05');
		await user.type(within(form).getByLabelText('Hasta'), '2026-10-01');
		await user.click(within(form).getByRole('button', { name: 'Filtrar' }));

		const alert = await within(form).findByRole('alert');
		expect(alert.textContent).toMatch(/La fecha "desde" no puede ser posterior a "hasta"\./);
		await waitFor(() => expect(document.activeElement).toBe(within(form).getByLabelText('Hasta')));
		// Nothing was filtered: the URL stays as it was.
		expect(where(router)).toBe('/admin/partidos');
	});

	it('after a failed filter the focus goes to the notice, not to a count of other results', async () => {
		let down = false;
		mockFetch(adminRoutes({ 'GET /api/admin/partidos': () => (down ? fail(429, 'RATE_LIMITED', 'Demasiadas solicitudes.') : ok(pageOf([adminMatch()]))) }));
		renderApp('/admin/partidos');
		const form = await screen.findByRole('form', { name: 'Filtrar partidos' });
		const user = userEvent.setup();
		down = true;
		await user.selectOptions(within(form).getByLabelText('Estado'), 'en_curso');
		await user.click(within(form).getByRole('button', { name: 'Filtrar' }));

		const notice = await screen.findByRole('alert');
		expect(notice.textContent).toMatch(/No se pudieron cargar los partidos: demasiadas solicitudes/);
		await waitFor(() => expect(document.activeElement?.contains(notice)).toBe(true));
	});
});

describe('the section is called "Inscritos" (C-10, D-039)', () => {
	it('its failed read and the bets help name it that way; the URL stays /admin/participantes', async () => {
		mockFetch(adminRoutes({ 'GET /api/admin/participantes': () => new Response('', { status: 502 }) }));
		const router = renderApp('/admin/participantes');
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/^No se pudieron cargar los inscritos./);
		expect(where(router)).toBe('/admin/participantes');
	});

	it('the bets query says the id is in Inscritos, and still calls the bettor "Participante"', async () => {
		mockFetch(adminRoutes());
		renderApp('/admin/apuestas');
		expect(await screen.findByText('El id está en Inscritos y en el ranking.')).toBeTruthy();
		expect(screen.getByLabelText(/Participante \(id\)/)).toBeTruthy();
	});
});
