import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiRoutes, futbol, myBet, summaryOf, voley } from '../test/betting-fixtures';
import { admin, apostador, fail, mockFetch, ok, pendiente, type RecordedCall } from '../test/fetch-mock';
import { renderApp, where } from '../test/render-app';
import type { AuthUser } from '../types/api';
import type { ApiPage, MyBet } from '../types/betting';

const pageOf = (items: MyBet[], extra: Partial<ApiPage<MyBet>> = {}): ApiPage<MyBet> => ({
	items,
	page: 1,
	pageSize: 20,
	total: items.length,
	totalPages: items.length ? 1 : 0,
	...extra,
});

/** Three tickets in every state: a two-selection pending one, a finished one and a voided one. */
const ROWS: MyBet[] = [
	myBet(
		30,
		{ estado: 'pendiente', puntosObtenidos: null, resultadoReal: null, tipo: 'marcador_exacto', pronostico: null, golesLocal: 3, golesVisitante: 1 },
		{ estado: 'pendiente', cantidadSelecciones: 2, monedasUtilizadas: 2, puntosObtenidos: 1, creadoEn: '2026-09-19T15:00:00.000Z' },
	),
	myBet(30, { estado: 'acertada', pronostico: 'empate', puntosObtenidos: 1 }, { estado: 'pendiente', cantidadSelecciones: 2, monedasUtilizadas: 2, puntosObtenidos: 1 }),
	myBet(20, { estado: 'no_acertada', pronostico: 'visitante_gana', puntosObtenidos: 0 }, { estado: 'finalizado', puntosObtenidos: 0 }),
	myBet(10, { estado: 'anulada', puntosObtenidos: null, resultadoReal: null }, { estado: 'anulado', monedasDevueltas: 1, puntosObtenidos: 0 }),
];

const calls = (list: RecordedCall[], path: string) => list.filter((c) => c.method === 'GET' && c.url.split('?')[0] === path);
const params = (call: RecordedCall) => Object.fromEntries(new URL(call.url, 'http://x').searchParams);

function historyApi(extra: Record<string, Parameters<typeof apiRoutes>[0][string]> = {}, user: AuthUser = apostador) {
	return mockFetch(
		apiRoutes({
			'GET /api/auth/me': () => ok({ user, csrfToken: 't' }),
			'GET /api/public/deportes': () => ok([futbol, voley]),
			'GET /api/public/competiciones': () => ok({ items: [{ id: 10, nombre: 'Liga', slug: 'liga', deporte: futbol }], page: 1, pageSize: 100, total: 1, totalPages: 1 }),
			'GET /api/apuestas/mis-apuestas': () => ok(pageOf(ROWS)),
			'GET /api/apuestas/mis-apuestas/resumen': () => ok(summaryOf()),
			...extra,
		}),
	);
}

describe('Mis apuestas (T-20)', () => {
	it('shows the summary and the bets grouped by ticket, with every state in words and icons', async () => {
		historyApi();
		renderApp('/mis-apuestas');
		expect(await screen.findByRole('heading', { name: 'Mis apuestas', level: 1 })).toBeTruthy();

		const summary = screen.getByRole('region', { name: 'Resumen' });
		const fact = (label: string) => within(summary).getByText(label).parentElement!.textContent;
		expect(fact('Tickets')).toBe('Tickets31 pendiente · 1 finalizado · 1 anulado');
		// Plural where the count isn't 1.
		expect(fact('Selecciones')).toBe('Selecciones51 pendiente · 2 acertadas · 1 no acertada · 1 anulada');
		expect(fact('Puntos')).toBe('Puntos4');
		expect(fact('Aciertos')).toBe('Aciertos2');
		expect(fact('Monedas usadas')).toBe('Monedas usadas5 monedas');
		expect(fact('Monedas devueltas')).toBe('Monedas devueltas1 moneda');

		expect(screen.getByText('4 selecciones, del ticket más reciente al más antiguo.')).toBeTruthy();
		const tickets = within(screen.getByRole('list', { name: 'Tickets' })).getAllByRole('article');
		expect(tickets.map((t) => within(t).getByRole('heading').textContent)).toEqual(['Ticket #30', 'Ticket #20', 'Ticket #10']);

		// The two-selection ticket: its state, totals, both selections, and its receipt.
		const first = tickets[0]!;
		expect(within(first.querySelector('header')!).getByText('Pendiente').querySelector('[aria-hidden="true"]')).not.toBeNull();
		expect(within(first).getByText('Confirmado el', { exact: false }).textContent).toBe('Confirmado el 19 sept 10:00');
		const rows = within(first).getAllByRole('listitem');
		expect(rows).toHaveLength(2);
		expect(rows[0]!.textContent).toMatch(/Halcones vs Pumas/);
		expect(rows[0]!.textContent).toMatch(/Marcador exacto3 - 1/);
		expect(rows[0]!.textContent).toMatch(/Resultado realTodavía no hay/);
		expect(rows[0]!.textContent).toMatch(/PuntosPor definir/);
		expect(rows[1]!.textContent).toMatch(/Resultado generalEmpate/);
		expect(rows[1]!.textContent).toMatch(/Resultado real2 - 1 \(Gana Halcones\)/);
		expect(within(rows[1]!).getByText('Acertada').querySelector('[aria-hidden="true"]')).not.toBeNull();
		expect(within(first).getByRole('link', { name: 'Ver el comprobante del ticket #30' }).getAttribute('href')).toBe('/apuestas/tickets/30');
		expect(within(first).getByText('Monedas').parentElement!.textContent).toBe('Monedas2 monedas');

		expect(within(tickets[1]!).getByText('No acertada')).toBeTruthy();
		expect(within(tickets[2]!).getByText('Anulado')).toBeTruthy();
		expect(within(tickets[2]!).getByText('Anulada')).toBeTruthy();
		expect(within(tickets[2]!).getByText('Monedas').parentElement!.textContent).toBe('Monedas1 moneda (1 devuelta)');
		expect(within(tickets[2]!).getByText(/Sin puntos/)).toBeTruthy();
	});

	it('says when a page cuts a ticket', async () => {
		historyApi({ 'GET /api/apuestas/mis-apuestas': () => ok(pageOf([myBet(40, {}, { cantidadSelecciones: 30 })], { total: 45, totalPages: 3 })) });
		renderApp('/mis-apuestas');
		expect(await screen.findByText('Esta página muestra 1 de sus 30 selecciones: el comprobante tiene todas.')).toBeTruthy();
	});

	it('filters live in the page URL with the API names; days in Lima time; the form writes them back', async () => {
		const { calls: all } = historyApi();
		const router = renderApp('/mis-apuestas?estado=acertada&estadoTicket=finalizado&deporteId=1&competicionId=10&desde=2026-09-01&hasta=2026-09-30&foo=1');
		await screen.findByRole('heading', { name: 'Mis apuestas', level: 1 });
		expect(params(calls(all, '/api/apuestas/mis-apuestas')[0]!)).toEqual({
			estado: 'acertada',
			estadoTicket: 'finalizado',
			deporteId: '1',
			competicionId: '10',
			desde: '2026-09-01T00:00:00-05:00',
			hasta: '2026-09-30T23:59:59-05:00',
			page: '1',
			pageSize: '20',
		});
		// Every competition, in one call: they fit in a page.
		expect(calls(all, '/api/public/competiciones').map(params)).toEqual([{ pageSize: '100' }]);
		expect((screen.getByLabelText('Estado de la apuesta') as HTMLSelectElement).value).toBe('acertada');
		expect((screen.getByLabelText('Estado del ticket') as HTMLSelectElement).value).toBe('finalizado');
		expect((within(screen.getByRole('group', { name: 'Deporte' })).getByRole('radio', { name: 'Fútbol' }) as HTMLInputElement).checked).toBe(true);
		expect((within(screen.getByRole('group', { name: 'Competición' })).getByRole('radio', { name: 'Liga' }) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByLabelText('Desde') as HTMLInputElement).value).toBe('2026-09-01');

		const user = userEvent.setup();
		// Another sport, with no competitions: the competition is dropped.
		await user.click(within(screen.getByRole('group', { name: 'Deporte' })).getByRole('radio', { name: 'Vóley' }));
		expect(screen.queryByRole('group', { name: 'Competición' })).toBeNull();
		expect(screen.getByText('Este deporte no tiene competiciones para filtrar.')).toBeTruthy();
		await user.selectOptions(screen.getByLabelText('Estado de la apuesta'), 'anulada');
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		await waitFor(() => expect(where(router)).toBe('/mis-apuestas?estado=anulada&estadoTicket=finalizado&deporteId=2&desde=2026-09-01&hasta=2026-09-30'));
		await waitFor(() => expect(calls(all, '/api/apuestas/mis-apuestas')).toHaveLength(2));
		// The page (and its form, remounted with the new filters) is ready before the next click.
		await waitFor(() => expect(router.state.navigation.state).toBe('idle'));
		// The form shows the new filters, and the results take the focus and are announced (observation b).
		expect((screen.getByLabelText('Estado de la apuesta') as HTMLSelectElement).value).toBe('anulada');
		await waitFor(() => expect(document.activeElement?.textContent).toBe('4 selecciones, del ticket más reciente al más antiguo.'));
		expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain('4 selecciones, del ticket más reciente al más antiguo.');

		await user.click(screen.getByRole('link', { name: 'Quitar filtros' }));
		await waitFor(() => expect(where(router)).toBe('/mis-apuestas'));
	});

	it('choosing a sport shows its competitions at once, before filtering (observation f)', async () => {
		const { calls: all } = historyApi();
		const router = renderApp('/mis-apuestas');
		await screen.findByRole('heading', { name: 'Mis apuestas', level: 1 });
		expect(screen.getByText('Elige un deporte para filtrar por competición.')).toBeTruthy();
		const user = userEvent.setup();
		await user.click(within(screen.getByRole('group', { name: 'Deporte' })).getByRole('radio', { name: 'Fútbol' }));
		const group = screen.getByRole('group', { name: 'Competición' });
		expect((within(group).getByRole('radio', { name: 'Todas' }) as HTMLInputElement).checked).toBe(true);
		expect(where(router)).toBe('/mis-apuestas');
		expect(calls(all, '/api/public/competiciones')).toHaveLength(1);
		await user.click(within(group).getByRole('radio', { name: 'Liga' }));
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		await waitFor(() => expect(where(router)).toBe('/mis-apuestas?deporteId=1&competicionId=10'));
		// Back to all sports: the competition goes away with it. First the new results (they take the
		// focus once painted), with the form remounted for the new filters.
		await waitFor(() => expect(document.activeElement?.textContent).toBe('4 selecciones, del ticket más reciente al más antiguo.'));
		expect((within(screen.getByRole('group', { name: 'Competición' })).getByRole('radio', { name: 'Liga' }) as HTMLInputElement).checked).toBe(true);
		await user.click(within(screen.getByRole('group', { name: 'Deporte' })).getByRole('radio', { name: 'Todos' }));
		await waitFor(() => expect(screen.queryByRole('group', { name: 'Competición' })).toBeNull());
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		await waitFor(() => expect(where(router)).toBe('/mis-apuestas'));
	});

	it('with more competitions than one page, only the chosen sport has them until filtering', async () => {
		const { calls: all } = historyApi({
			'GET /api/public/competiciones': ({ url }) => {
				const deporteId = new URL(url, 'http://x').searchParams.get('deporteId');
				const liga = { id: 10, nombre: 'Liga', slug: 'liga', deporte: futbol };
				return ok(deporteId ? { items: [liga], page: 1, pageSize: 100, total: 1, totalPages: 1 } : { items: [liga], page: 1, pageSize: 100, total: 150, totalPages: 2 });
			},
		});
		renderApp('/mis-apuestas');
		await screen.findByRole('heading', { name: 'Mis apuestas', level: 1 });
		const user = userEvent.setup();
		await user.click(within(screen.getByRole('group', { name: 'Deporte' })).getByRole('radio', { name: 'Fútbol' }));
		expect(screen.queryByRole('group', { name: 'Competición' })).toBeNull();
		expect(screen.getByText('Filtra por el deporte elegido para ver sus competiciones.')).toBeTruthy();
		expect(calls(all, '/api/public/competiciones').map(params)).toEqual([{ pageSize: '100' }]);
	});

	it('a page past the end says so and shows the last one, or the first when there is nothing (defect A1)', async () => {
		const { calls: all } = historyApi({
			'GET /api/apuestas/mis-apuestas': ({ url }) => {
				const page = Number(new URL(url, 'http://x').searchParams.get('page'));
				return ok(pageOf(page <= 3 ? [myBet(page)] : [], { page, total: 45, totalPages: 3 }));
			},
		});
		const router = renderApp('/mis-apuestas?estado=acertada&page=999');
		expect(await screen.findByText('La página 999 no existe: se muestra la última (3).')).toBeTruthy();
		expect(screen.getAllByRole('article')).toHaveLength(1);
		expect(within(screen.getByRole('navigation', { name: 'Páginas de mis apuestas' })).getByText('Página 3 de 3')).toBeTruthy();
		// Observation c: the URL says the page shown, replacing the entry, without reading everything again.
		await waitFor(() => expect(where(router)).toBe('/mis-apuestas?estado=acertada&page=3'));
		expect(router.state.historyAction).toBe('REPLACE');
		expect(screen.getByText('La página 999 no existe: se muestra la última (3).')).toBeTruthy();
		expect(calls(all, '/api/apuestas/mis-apuestas').map((c) => params(c).page)).toEqual(['999', '3']);
		expect(calls(all, '/api/apuestas/mis-apuestas/resumen')).toHaveLength(1);

		historyApi({ 'GET /api/apuestas/mis-apuestas': () => ok(pageOf([], { page: 5 })) });
		await act(() => router.navigate('/mis-apuestas?page=5'));
		expect(await screen.findByText('La página 5 no existe: se muestra la primera.')).toBeTruthy();
		expect(screen.getByText('Todavía no tienes apuestas.')).toBeTruthy();
		await waitFor(() => expect(where(router)).toBe('/mis-apuestas'));
	});

	it('with the session check down, filtering, paginating and retrying keep the page, its list and its form (T-20 fix)', async () => {
		let down = false;
		let hold: Promise<void> | null = null;
		const { calls: all } = historyApi({
			'GET /api/auth/me': async () => {
				if (hold) await hold;
				return down ? new Response('', { status: 502 }) : ok({ user: apostador, csrfToken: 't' });
			},
			'GET /api/apuestas/mis-apuestas': ({ url }) => {
				const page = Number(new URL(url, 'http://x').searchParams.get('page'));
				return ok(pageOf([myBet(page)], { page, total: 45, totalPages: 3 }));
			},
		});
		const router = renderApp('/mis-apuestas');
		await screen.findByText('45 selecciones, del ticket más reciente al más antiguo. Página 1 de 3.');
		const user = userEvent.setup();
		const before = calls(all, '/api/apuestas/mis-apuestas').length;

		// Filtering with the backend down: the page, the list and the form stay, with the notice, which takes the focus.
		down = true;
		await user.selectOptions(screen.getByLabelText('Estado de la apuesta'), 'acertada');
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/No se pudieron cargar tus apuestas\. El servidor no está disponible/);
		expect(alert.textContent).toMatch(/La lista de abajo es la anterior/);
		expect(where(router)).toBe('/mis-apuestas?estado=acertada');
		await waitFor(() => expect(document.activeElement).toBe(alert));
		expect(screen.getAllByRole('article')).toHaveLength(1);
		expect(screen.getByText('45 selecciones, del ticket más reciente al más antiguo. Página 1 de 3.')).toBeTruthy();
		expect(within(screen.getByRole('group', { name: 'Deporte' })).getByRole('radio', { name: 'Fútbol' })).toBeTruthy();
		expect((screen.getByLabelText('Estado de la apuesta') as HTMLSelectElement).value).toBe('acertada');
		expect(screen.queryByRole('heading', { name: 'No se pudo cargar' })).toBeNull();
		// Nothing but the session was asked.
		expect(calls(all, '/api/apuestas/mis-apuestas')).toHaveLength(before);

		// Paginating too: the links are the list's own.
		await user.click(screen.getByRole('link', { name: 'Siguiente >' }));
		await waitFor(() => expect(where(router)).toBe('/mis-apuestas?page=2'));
		expect(screen.getByRole('alert').textContent).toMatch(/La lista de abajo es la anterior/);
		expect(screen.getAllByRole('article')).toHaveLength(1);
		expect(screen.queryByRole('heading', { name: 'No se pudo cargar' })).toBeNull();
		// The click left the focus on the link; the notice takes it once this arrival is painted.
		await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('alert')));

		// Reintentar (observation a): keeps the focus while it loads, then the new list takes it.
		let release: () => void = () => {};
		hold = new Promise((done) => (release = done));
		down = false;
		const retry = screen.getByRole('button', { name: 'Reintentar' });
		await user.click(retry);
		await waitFor(() => expect(retry.getAttribute('aria-disabled')).toBe('true'));
		expect(retry.hasAttribute('disabled')).toBe(false);
		expect(document.activeElement).toBe(retry);
		await user.click(retry);
		hold = null;
		release();
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
		await waitFor(() => expect(document.activeElement?.textContent).toBe('45 selecciones, del ticket más reciente al más antiguo. Página 2 de 3.'));
		expect(screen.getAllByRole('status').map((s) => s.textContent)).toContain('45 selecciones, del ticket más reciente al más antiguo. Página 2 de 3.');
	});

	it('a retry that fails again keeps the focus on its button', async () => {
		let down = false;
		historyApi({ 'GET /api/auth/me': () => (down ? new Response('', { status: 502 }) : ok({ user: apostador, csrfToken: 't' })) });
		const router = renderApp('/mis-apuestas');
		await screen.findAllByRole('article');
		down = true;
		await act(() => router.navigate('/mis-apuestas?estado=acertada'));
		const user = userEvent.setup();
		const retry = await screen.findByRole('button', { name: 'Reintentar' });
		await user.click(retry);
		await waitFor(() => expect(retry.hasAttribute('aria-disabled')).toBe(false));
		expect(document.activeElement).toBe(retry);
		expect(screen.getByRole('alert')).toBeTruthy();
	});

	it('a first visit with the session check down is the error page, and its Reintentar loads the page', async () => {
		let down = true;
		historyApi({ 'GET /api/auth/me': () => (down ? new Response('', { status: 502 }) : ok({ user: apostador, csrfToken: 't' })) });
		renderApp('/mis-apuestas');
		expect(await screen.findByRole('heading', { name: 'No se pudo cargar' })).toBeTruthy();
		down = false;
		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'Reintentar' }));
		expect(await screen.findByRole('heading', { name: 'Mis apuestas', level: 1 })).toBeTruthy();
		expect(screen.getAllByRole('article')).toHaveLength(3);
	});

	it('a known user of another role still gets the error page when the session check fails', async () => {
		let down = false;
		mockFetch(
			apiRoutes({
				'GET /api/auth/me': () => (down ? new Response('', { status: 502 }) : ok({ user: admin, csrfToken: 't' })),
				'GET /api/ranking': () => ok({ top: [], topSinMostrar: 0, propia: null, participantes: 0, posicionesTop: 10, maxFilasTop: 50 }),
			}),
		);
		const router = renderApp('/ranking');
		await screen.findByRole('heading', { name: 'Ranking', level: 1 });
		down = true;
		await act(() => router.navigate('/mis-apuestas'));
		expect(await screen.findByRole('heading', { name: 'No se pudo cargar' })).toBeTruthy();
	});

	it('drops invalid filters with a notice, and never sends them', async () => {
		const { calls: all } = historyApi();
		renderApp('/mis-apuestas?estado=ganada&estadoTicket=x&deporteId=abc&competicionId=10&desde=2026-02-30&page=0');
		await screen.findByRole('heading', { name: 'Mis apuestas', level: 1 });
		for (const text of [
			'El estado de apuesta elegido no es válido: se muestran todos.',
			'El estado de ticket elegido no es válido: se muestran todos.',
			'El deporte elegido no es válido: se muestran todos.',
			'La fecha "desde" no es válida: se ignoró.',
			'La página no es válida: se muestra la primera.',
			'Para filtrar por competición elige también su deporte: se muestran todas.',
		]) {
			expect(screen.getByText(text), text).toBeTruthy();
		}
		expect(params(calls(all, '/api/apuestas/mis-apuestas')[0]!)).toEqual({ page: '1', pageSize: '20' });
	});

	it('a sport that no longer exists, or a competition of another sport, is dropped with a notice', async () => {
		const { calls: all } = historyApi();
		renderApp('/mis-apuestas?deporteId=99');
		expect(await screen.findByText('El deporte elegido ya no existe: se muestran todos.')).toBeTruthy();
		expect(params(calls(all, '/api/apuestas/mis-apuestas')[0]!)).toEqual({ page: '1', pageSize: '20' });
	});

	it('a competition of another sport is dropped with a notice', async () => {
		const { calls: all } = historyApi();
		renderApp('/mis-apuestas?deporteId=1&competicionId=77');
		expect(await screen.findByText('La competición elegida no es de ese deporte: se muestran todas.')).toBeTruthy();
		expect(params(calls(all, '/api/apuestas/mis-apuestas')[0]!)).toEqual({ deporteId: '1', page: '1', pageSize: '20' });
	});

	it('paginates with links that keep the filters', async () => {
		const { calls: all } = historyApi({
			'GET /api/apuestas/mis-apuestas': ({ url }) => {
				const page = Number(new URL(url, 'http://x').searchParams.get('page'));
				return ok(pageOf([myBet(page)], { page, total: 45, totalPages: 3 }));
			},
		});
		const router = renderApp('/mis-apuestas?estado=acertada&page=2');
		const nav = await screen.findByRole('navigation', { name: 'Páginas de mis apuestas' });
		expect(within(nav).getByText('Página 2 de 3')).toBeTruthy();
		expect(within(nav).getByRole('link', { name: '< Anterior' }).getAttribute('href')).toBe('/mis-apuestas?estado=acertada');
		const user = userEvent.setup();
		await user.click(within(nav).getByRole('link', { name: 'Siguiente >' }));
		await waitFor(() => expect(where(router)).toBe('/mis-apuestas?estado=acertada&page=3'));
		await waitFor(() => expect(within(screen.getByRole('navigation', { name: 'Páginas de mis apuestas' })).getByText('Página 3 de 3')).toBeTruthy());
		expect(screen.queryByRole('link', { name: 'Siguiente >' })).toBeNull();
		expect(params(calls(all, '/api/apuestas/mis-apuestas').at(-1)!).page).toBe('3');
		// Defect A2: the focus goes to the top of the new list, which says the page, and it is announced.
		const statuses = () => screen.getAllByRole('status').map((s) => s.textContent);
		const count = (n: number) => `45 selecciones, del ticket más reciente al más antiguo. Página ${n} de 3.`;
		await waitFor(() => expect(document.activeElement?.textContent).toBe(count(3)));
		expect(statuses()).toContain(count(3));

		await user.click(screen.getByRole('link', { name: '< Anterior' }));
		await waitFor(() => expect(document.activeElement?.textContent).toBe(count(2)));
		// Observation d: Back and Forward don't move the focus nor announce (the browser handles history).
		const anterior = screen.getByRole('link', { name: '< Anterior' });
		anterior.focus();
		await act(() => router.navigate(-1));
		await waitFor(() => expect(screen.getByText(count(3))).toBeTruthy());
		expect(document.activeElement?.textContent).not.toBe(count(3));
		expect(statuses()).not.toContain(count(3));
		// A navigation that isn't a page link leaves the focus alone and clears the notice.
		await user.click(screen.getByRole('link', { name: '< Anterior' }));
		await waitFor(() => expect(document.activeElement?.textContent).toBe(count(2)));
		await act(() => router.navigate('/mis-apuestas?estado=acertada'));
		await waitFor(() => expect(statuses()).not.toContain(count(2)));
		expect(statuses()).not.toContain(count(1));
	});

	it('empty: no bets yet, with a way to bet; or none with these filters', async () => {
		historyApi({ 'GET /api/apuestas/mis-apuestas': () => ok(pageOf([])), 'GET /api/apuestas/mis-apuestas/resumen': () => ok(summaryOf({ tickets: { total: 0, pendiente: 0, finalizado: 0, anulado: 0 } })) });
		const router = renderApp('/mis-apuestas');
		expect(await screen.findByText('Todavía no tienes apuestas.')).toBeTruthy();
		expect(screen.getByRole('link', { name: 'Ir a apostar' }).getAttribute('href')).toBe('/apuestas');
		expect(screen.queryByRole('navigation', { name: 'Páginas de mis apuestas' })).toBeNull();
		await act(() => router.navigate('/mis-apuestas?estado=anulada'));
		expect(await screen.findByText('No hay apuestas con esos filtros.')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Ir a apostar' })).toBeNull();
	});

	it('a failed load stays on the page with "Reintentar", and keeps what it showed', async () => {
		let down = true;
		const { calls: all } = historyApi({
			'GET /api/apuestas/mis-apuestas': () => (down ? fail(429, 'RATE_LIMITED', 'x', { limite: 'general' }, { 'Retry-After': '120' }) : ok(pageOf(ROWS))),
		});
		const router = renderApp('/mis-apuestas');
		expect(await screen.findByText('No se pudieron cargar tus apuestas: demasiadas solicitudes. Espera 2 minutos y vuelve a intentarlo.')).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Mis apuestas', level: 1 })).toBeTruthy();
		expect(screen.queryByRole('list', { name: 'Tickets' })).toBeNull();

		down = false;
		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'Reintentar' }));
		await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3));
		expect(screen.queryByRole('alert')).toBeNull();

		// A later failure (the server down) keeps the list, with the error on top.
		down = true;
		const failing = historyApi({ 'GET /api/apuestas/mis-apuestas': () => new Response('', { status: 502 }) });
		await act(() => router.navigate('/mis-apuestas?estado=acertada'));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/No se pudieron cargar tus apuestas\. El servidor no está disponible/);
		// Observation b: the form and the URL show the new filters; the notice says the list is the previous one.
		expect(alert.textContent).toMatch(/La lista de abajo es la anterior: no corresponde a los filtros ni a la página elegidos\./);
		expect((screen.getByLabelText('Estado de la apuesta') as HTMLSelectElement).value).toBe('acertada');
		expect(screen.getAllByRole('article')).toHaveLength(3);
		expect(screen.getByText('4 selecciones, del ticket más reciente al más antiguo.')).toBeTruthy();
		expect(calls(failing.calls, '/api/apuestas/mis-apuestas')).toHaveLength(1);
		expect(calls(all, '/api/apuestas/mis-apuestas').length).toBeGreaterThanOrEqual(2);
	});

	it('a pending participant sees the empty history and why', async () => {
		historyApi(
			{
				'GET /api/apuestas/mis-apuestas': () => ok(pageOf([])),
				'GET /api/apuestas/mis-apuestas/resumen': () =>
					ok(summaryOf({ tickets: { total: 0, pendiente: 0, finalizado: 0, anulado: 0 }, selecciones: { total: 0, pendiente: 0, acertada: 0, no_acertada: 0, anulada: 0 }, monedasUtilizadas: 0, monedasDevueltas: 0, puntos: 0, aciertos: 0 })),
			},
			pendiente,
		);
		renderApp('/mis-apuestas');
		expect(await screen.findByText(/Tu cuenta está pendiente de validación\./)).toBeTruthy();
		expect(screen.getByText('Todavía no tienes apuestas.')).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Ir a apostar' })).toBeNull();
	});

	it('an admin gets the 403 page and nothing is asked', async () => {
		const { calls: all } = historyApi({}, admin);
		renderApp('/mis-apuestas');
		expect(await screen.findByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
		expect(screen.getByText(/Los administradores no participan/)).toBeTruthy();
		expect(all.some((c) => c.url.startsWith('/api/apuestas'))).toBe(false);
	});

	it('without a session it sends to sign in, and back here after', async () => {
		historyApi({ 'GET /api/auth/me': () => fail(401, 'UNAUTHENTICATED') });
		const router = renderApp('/mis-apuestas?estado=acertada');
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fmis-apuestas%3Festado%3Dacertada'));
	});

	it('a session that ends while the filter is loading still signs in with the URL asked for (T-21 fix)', async () => {
		let alive = true;
		let release = () => undefined as void;
		const held = new Promise<void>((resolve) => {
			release = () => resolve();
		});
		historyApi({
			'GET /api/auth/me': () => (alive ? ok({ user: apostador, csrfToken: 't' }) : fail(401, 'UNAUTHENTICATED')),
			// The list of the filtered page never answers: only the session says anything.
			'GET /api/apuestas/mis-apuestas': async ({ url }) => {
				if (new URL(url, 'http://x').searchParams.get('estado')) await held;
				return ok(pageOf(ROWS));
			},
		});
		const router = renderApp('/mis-apuestas');
		const user = userEvent.setup();
		await screen.findByText('4 selecciones, del ticket más reciente al más antiguo.');
		await user.selectOptions(screen.getByLabelText('Estado de la apuesta'), 'acertada');
		alive = false;
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		// The layout notices the session is gone while that page is still loading: it must not
		// fall back to the URL on screen, which has no filter.
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fmis-apuestas%3Festado%3Dacertada'));
		release();
	});

	it('a session gone while filtering or paginating sends to sign in with the URL asked for (T-20 final note)', async () => {
		let alive = true;
		historyApi({
			'GET /api/auth/me': () => (alive ? ok({ user: apostador, csrfToken: 't' }) : fail(401, 'UNAUTHENTICATED')),
			'GET /api/apuestas/mis-apuestas': ({ url }) => {
				const page = Number(new URL(url, 'http://x').searchParams.get('page'));
				return ok(pageOf([myBet(page)], { page, total: 45, totalPages: 3 }));
			},
		});
		let router = renderApp('/mis-apuestas');
		const user = userEvent.setup();
		await screen.findByText('45 selecciones, del ticket más reciente al más antiguo. Página 1 de 3.');
		alive = false;
		await user.selectOptions(screen.getByLabelText('Estado de la apuesta'), 'acertada');
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fmis-apuestas%3Festado%3Dacertada'));
		router.dispose();

		alive = true;
		router = renderApp('/mis-apuestas');
		await screen.findByText('45 selecciones, del ticket más reciente al más antiguo. Página 1 de 3.');
		alive = false;
		await user.click(screen.getByRole('link', { name: 'Siguiente >' }));
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fmis-apuestas%3Fpage%3D2'));
	});

	it('reads the history again on every visit: a ticket just confirmed is there', async () => {
		let rows = ROWS.slice(2);
		const { calls: all } = historyApi({ 'GET /api/apuestas/mis-apuestas': () => ok(pageOf(rows)) });
		const router = renderApp('/mis-apuestas');
		await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2));
		await act(() => router.navigate('/posiciones'));
		rows = ROWS;
		await act(() => router.navigate('/mis-apuestas'));
		await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(3));
		expect(calls(all, '/api/apuestas/mis-apuestas')).toHaveLength(2);
	});
});
