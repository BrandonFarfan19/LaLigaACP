import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { adminBet, adminRoutes, pageOf, stats } from '../test/admin-fixtures';
import { apiRoutes, myBet, receipt, summaryOf } from '../test/betting-fixtures';
import { admin, apostador, fail, mockFetch, ok } from '../test/fetch-mock';
import { renderApp } from '../test/render-app';
import type { CoinMovement } from '../types/api';

/**
 * C-09 (BR-057, D-038): the coins won by right forecasts, paid automatically
 * when a result is confirmed, on every screen that reads them. Always with
 * the pixel-art coin and in coins, never points.
 */

const movement = (id: number, codigo: CoinMovement['tipo']['codigo'], nombre: string, cantidad: number, seleccion = true): CoinMovement => ({
	id,
	tipo: { codigo, nombre },
	cantidad,
	creadoEn: '2026-09-20T15:00:00.000Z',
	seleccion: seleccion ? { id: 100 + id, ticketId: 7, partidoId: 900 } : null,
});

/** What `GET /monedas/movimientos` answers, newest first. */
const MOVEMENTS = {
	items: [
		movement(5, 'premio_marcador_exacto', 'Premio por acertar el marcador exacto', 2),
		movement(4, 'premio_resultado_general', 'Premio por acertar el resultado general', 1),
		movement(3, 'seleccion_confirmada', 'Selección confirmada', -1),
		movement(2, 'seleccion_confirmada', 'Selección confirmada', -1),
		movement(1, 'validacion', 'Validación de usuario', 10, false),
	],
	page: 1,
	pageSize: 20,
	total: 25,
	totalPages: 2,
};

const coinShown = (element: HTMLElement) => element.querySelector('[aria-hidden="true"]') !== null;

describe('coins won by right forecasts (C-09)', () => {
	it('the receipt: the ticket total and each right selection, with the coin', async () => {
		mockFetch(
			apiRoutes({
				'GET /api/auth/me': () => ok({ user: apostador, csrfToken: 't' }),
				'GET /api/apuestas/tickets/55': () => ok(receipt(55, apostador.id)),
			}),
		);
		renderApp('/apuestas/tickets/55');
		expect(await screen.findByRole('heading', { name: 'Ticket #55' })).toBeTruthy();
		const total = screen.getAllByText('Monedas ganadas')[0]!.parentElement!;
		expect(total.textContent).toBe('Monedas ganadas1 moneda');
		expect(coinShown(total)).toBe(true);
		const items = within(screen.getByRole('list', { name: 'Selecciones del ticket' })).getAllByRole('listitem');
		expect(items[0]!.textContent).toMatch(/Monedas ganadas\+1 moneda/);
		// A miss shows no prize line at all.
		expect(items[1]!.textContent).not.toMatch(/ganad/i);
		expect(document.body.textContent).not.toMatch(/puntos? ganad/i);
	});

	it('my bets: the summary, each ticket and each right selection', async () => {
		mockFetch(
			apiRoutes({
				'GET /api/auth/me': () => ok({ user: apostador, csrfToken: 't' }),
				'GET /api/public/deportes': () => ok([]),
				'GET /api/public/competiciones': () => ok({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 }),
				'GET /api/apuestas/mis-apuestas': () =>
					ok({
						items: [
							myBet(40, { tipo: 'marcador_exacto', pronostico: null, golesLocal: 2, golesVisitante: 1, monedasGanadas: 2 }, { monedasGanadas: 2 }),
							myBet(41, { estado: 'no_acertada', puntosObtenidos: 0, monedasGanadas: 0 }, { monedasGanadas: 0, puntosObtenidos: 0 }),
						],
						page: 1,
						pageSize: 20,
						total: 2,
						totalPages: 1,
					}),
				'GET /api/apuestas/mis-apuestas/resumen': () => ok(summaryOf()),
			}),
		);
		renderApp('/mis-apuestas');
		const summary = await screen.findByRole('region', { name: 'Resumen' });
		const won = within(summary).getByText('Monedas ganadas').parentElement!;
		expect(won.textContent).toBe('Monedas ganadas3 monedas');
		expect(coinShown(won)).toBe(true);
		const tickets = screen.getAllByRole('article');
		expect(within(tickets[0]!).getByText('Ganadas').parentElement!.textContent).toBe('Ganadas2 monedas');
		expect(within(tickets[0]!).getByText('Ganó').parentElement!.textContent).toBe('Ganó+2 monedas');
		// A ticket that won nothing says nothing about it.
		expect(within(tickets[1]!).queryByText('Ganadas')).toBeNull();
		expect(within(tickets[1]!).queryByText('Ganó')).toBeNull();
	});

	it('my account: the latest movements, prizes marked, with their signed amounts', async () => {
		const { calls } = mockFetch(
			apiRoutes({
				'GET /api/auth/me': () => ok({ user: apostador, csrfToken: 't' }),
				'GET /api/monedas/movimientos': () => ok(MOVEMENTS),
			}),
		);
		renderApp('/cuenta');
		const list = await screen.findByRole('list', { name: /Tus últimos movimientos de monedas/ });
		const rows = within(list).getAllByRole('listitem');
		expect(rows.map((r) => r.textContent)).toEqual([
			'PremioPremio por acertar el marcador exacto20 sept 2026+2 monedas',
			'PremioPremio por acertar el resultado general20 sept 2026+1 moneda',
			'Selección confirmada20 sept 2026-1 moneda',
			'Selección confirmada20 sept 2026-1 moneda',
			'Validación de usuario20 sept 2026+10 monedas',
		]);
		expect(rows.every(coinShown)).toBe(true);
		expect(screen.getByText('Los 5 más recientes de 25.')).toBeTruthy();
		const asked = calls.find((c) => c.url.startsWith('/api/monedas/movimientos'))!;
		expect(Object.fromEntries(new URL(asked.url, 'http://x').searchParams)).toEqual({ page: '1', pageSize: '20' });
	});

	it('my account: movements that fail to load keep the account, with the reason and "Reintentar"', async () => {
		let attempts = 0;
		mockFetch(
			apiRoutes({
				'GET /api/auth/me': () => ok({ user: apostador, csrfToken: 't' }),
				'GET /api/monedas/movimientos': () => (++attempts <= 2 ? fail(503, 'DATABASE_UNAVAILABLE', 'La base de datos no responde.') : ok(MOVEMENTS)),
			}),
		);
		renderApp('/cuenta');
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/No se pudieron cargar tus movimientos\. La base de datos no responde\./);
		// The account itself is there.
		expect(screen.getByText('Saldo')).toBeTruthy();
		const user = userEvent.setup();

		// A retry that fails again: the notice stays, and the focus stays on its button.
		const button = within(alert).getByRole('button', { name: 'Reintentar' });
		await user.click(button);
		await waitFor(() => expect(attempts).toBe(2));
		await waitFor(() => expect(within(screen.getByRole('alert')).getByRole('button', { name: 'Reintentar' })).toBe(document.activeElement));

		// A retry that loads (C-09 fix): the notice goes, and the focus goes to the count, announced, never to the body.
		await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Reintentar' }));
		expect(await screen.findByRole('list', { name: /Tus últimos movimientos de monedas/ })).toBeTruthy();
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
		const [count, announced] = [
			screen.getAllByText('Los 5 más recientes de 25.').find((p) => !p.hasAttribute('aria-live'))!,
			screen.getAllByText('Los 5 más recientes de 25.').find((p) => p.getAttribute('aria-live') === 'polite'),
		];
		await waitFor(() => expect(document.activeElement).toBe(count));
		expect(announced).toBeTruthy();
	});

	it('an admin account asks for no movements and shows none', async () => {
		const { calls } = mockFetch(apiRoutes({ 'GET /api/auth/me': () => ok({ user: admin, csrfToken: 't' }) }));
		renderApp('/cuenta');
		expect((await screen.findByRole('status')).textContent).toMatch(/no participan en la polla/);
		expect(screen.queryByText('Movimientos de monedas')).toBeNull();
		expect(calls.some((c) => c.url.startsWith('/api/monedas'))).toBe(false);
	});

	it('the panel: the pool figures and the bets placed show the coins won', async () => {
		mockFetch(
			adminRoutes({
				'GET /api/admin/polla/apuestas': () => ok(pageOf([adminBet({ monedasGanadas: 2 }), adminBet({ id: 7001, estado: 'no_acertada', puntosObtenidos: 0, monedasGanadas: 0 })])),
			}),
		);
		renderApp('/admin');
		const home = await screen.findByText('Monedas ganadas');
		expect(home.parentElement!.textContent).toMatch(/Monedas ganadas3 monedasPremios de los aciertos: 1 por resultado general, 2 por marcador exacto\./);
		expect(stats.monedasGanadas).toBe(3);
	});

	it('the admin bets query: a column with what each selection won', async () => {
		mockFetch(
			adminRoutes({
				'GET /api/admin/polla/apuestas': () => ok(pageOf([adminBet({ monedasGanadas: 2 }), adminBet({ id: 7001, estado: 'no_acertada', puntosObtenidos: 0, monedasGanadas: 0 })])),
			}),
		);
		renderApp('/admin/apuestas');
		const table = await screen.findByRole('table');
		const rows = within(table).getAllByRole('row').slice(1);
		const cell = (row: HTMLElement) => within(row).getAllByRole('cell').find((c) => c.getAttribute('data-label') === 'Ganó')!;
		expect(cell(rows[0]!).textContent).toBe('+2 monedas');
		expect(cell(rows[1]!).textContent).toBe('—');
	});
});
