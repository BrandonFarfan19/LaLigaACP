import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiRoutes, rankingOf, rankingRow } from '../test/betting-fixtures';
import { admin, apostador, fail, mockFetch, ok, pendiente } from '../test/fetch-mock';
import { renderApp, where } from '../test/render-app';
import type { AuthUser } from '../types/api';
import type { RankingData } from '../types/betting';

type Answer = RankingData | Response;

function rankingApi(data: () => Answer | Promise<Answer>, user: AuthUser = apostador) {
	return mockFetch(
		apiRoutes({
			'GET /api/auth/me': () => ok({ user, csrfToken: 't' }),
			'GET /api/ranking': async () => {
				const value = await data();
				return value instanceof Response ? value : ok(value);
			},
		}),
	);
}

const board = () => screen.getByRole('table');
const bodyRows = () => within(board()).getAllByRole('row').slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole('cell').map((cell) => cell.textContent);

describe('Ranking (T-20)', () => {
	it('shows the top as a table with shared positions, and the own row marked in words', async () => {
		const top = [
			rankingRow(1, 'Ana', 9, 3),
			rankingRow(1, 'Beto', 9, 3, true),
			rankingRow(3, 'Carla', 6, 2),
			rankingRow(4, 'Dani con un nombre larguísimo para ver que se parte en líneas', 0, 0),
		];
		const { calls } = rankingApi(() => rankingOf(top, { participantes: 4, propia: { ...top[1]!, enTop: true, enLista: true } }));
		renderApp('/ranking');
		expect(await screen.findByRole('heading', { name: 'Ranking', level: 1 })).toBeTruthy();
		expect(calls.find((c) => c.url.startsWith('/api/ranking'))!.url).toBe('/api/ranking');

		// Headings: the full words for screen readers.
		expect(within(board()).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['#Posición', 'NombreParticipante', 'PtsPuntos', 'AcAciertos']);
		expect(within(board()).getByText('Top 10 · 4 participantes')).toBeTruthy();
		const rows = bodyRows();
		expect(rows.map(cells)).toEqual([
			['=11, compartido', 'Ana', '9', '3'],
			['=11, compartido', 'TÚTu fila:Beto', '9', '3'],
			['3', 'Carla', '6', '2'],
			['4', 'Dani con un nombre larguísimo para ver que se parte en líneas', '0', '0'],
		]);
		expect(rows[1]!.getAttribute('data-own')).toBe('true');
		expect(rows.filter((row) => row.hasAttribute('data-own'))).toHaveLength(1);

		const own = screen.getByText('Tu puesto').parentElement!;
		expect(own.textContent).toMatch(/#19 puntos · 3 aciertos/);
		expect(own.textContent).toMatch(/Estás en el top: tu fila está marcada con TÚ\./);
		expect(screen.getByRole('link', { name: 'Ver mis apuestas y mis puntos' }).getAttribute('href')).toBe('/mis-apuestas');
	});

	it('caps the list at 50 rows, says how many tied ones are left out, and shows the own row apart', async () => {
		const top = Array.from({ length: 50 }, (_, i) => rankingRow(1, `Jugador ${i + 1}`, 0, 0));
		const propia = { ...rankingRow(1, 'Zoe', 0, 0, true), enTop: true, enLista: false };
		rankingApi(() => rankingOf(top, { participantes: 63, topSinMostrar: 13, propia }));
		renderApp('/ranking');
		await screen.findByRole('table');
		// The dotted separator is decoration (aria-hidden): 50 rows, the notice and the own row.
		const rows = bodyRows();
		expect(rows).toHaveLength(50 + 2);
		expect(rows[50]!.textContent).toBe('Y 13 participantes más empatados en el top que no entran en la lista.');
		expect(board().querySelectorAll('tbody tr')).toHaveLength(53);
		// Observation e: the same shared mark as in the list.
		expect(cells(rows[51]!)).toEqual(['=11, compartido', 'TÚTu fila:Zoe', '0', '0']);
		expect(rows[51]!.getAttribute('data-own')).toBe('true');
		expect(screen.getByText('Tu puesto').parentElement!.textContent).toMatch(/Estás en el top, pero la lista no alcanza a mostrar tu fila: va al final\./);
		expect(screen.queryByText(/fuera del top/)).toBeNull();
	});

	it('an own row below the top goes after it; one left-out participant in singular', async () => {
		const top = [rankingRow(1, 'Ana', 9, 3)];
		const propia = { ...rankingRow(12, 'Zoe', 0, 0, true), enTop: false, enLista: false };
		rankingApi(() => rankingOf(top, { participantes: 15, topSinMostrar: 1, propia }));
		renderApp('/ranking');
		await screen.findByRole('table');
		const rows = bodyRows();
		expect(rows[1]!.textContent).toBe('Y 1 participante más empatado en el top que no entra en la lista.');
		expect(cells(rows[2]!)).toEqual(['12', 'TÚTu fila:Zoe', '0', '0']);
		expect(screen.getByText('Tu puesto').parentElement!.textContent).toMatch(/Todavía no estás en el top: tu fila va al final\./);
		expect(screen.getByText('El resto de los participantes está fuera del top 10.')).toBeTruthy();
	});

	it('a pending participant and an admin have no row, and are told why', async () => {
		const top = [rankingRow(1, 'Ana', 9, 3)];
		rankingApi(() => rankingOf(top), pendiente);
		renderApp('/ranking');
		expect(await screen.findByText('Tu cuenta está pendiente de validación: aparecerás en el ranking cuando un administrador la valide.')).toBeTruthy();
		expect(bodyRows().some((row) => row.hasAttribute('data-own'))).toBe(false);
	});

	it('an admin sees the ranking without a row of their own, and no link to bets', async () => {
		rankingApi(() => rankingOf([rankingRow(1, 'Ana', 9, 3)]), admin);
		renderApp('/ranking');
		expect(await screen.findByText('Los administradores no participan en la polla: no tienen fila en el ranking.')).toBeTruthy();
		expect(screen.queryByRole('link', { name: /Ver mis apuestas/ })).toBeNull();
	});

	it('an empty pool says so', async () => {
		rankingApi(() => rankingOf([], { participantes: 0 }), admin);
		renderApp('/ranking');
		expect(await screen.findByText('Todavía no hay participantes validados.')).toBeTruthy();
	});

	it('an own row apart shares its position with a listed row, when one holds it (observation e)', async () => {
		const top = [rankingRow(1, 'Ana', 9, 3), rankingRow(4, 'Beto', 0, 0)];
		const propia = { ...rankingRow(4, 'Zoe', 0, 0, true), enTop: true, enLista: false };
		rankingApi(() => rankingOf(top, { participantes: 3, topSinMostrar: 1, propia }));
		renderApp('/ranking');
		await screen.findByRole('table');
		// Beto alone in the list shows a plain 4; the own row apart shows it is shared with him.
		expect(cells(bodyRows()[1]!)).toEqual(['4', 'Beto', '0', '0']);
		expect(cells(bodyRows().at(-1)!)).toEqual(['=44, compartido', 'TÚTu fila:Zoe', '0', '0']);
	});

	it('"Actualizar" reads it again (BR-044), keeps the focus and says how it went; a failure keeps the last table', async () => {
		let answer: () => Answer = () => rankingOf([rankingRow(1, 'Ana', 3, 1)]);
		let release: () => void = () => {};
		let hold = false;
		const { calls } = rankingApi(async () => {
			if (hold) await new Promise<void>((done) => (release = done));
			return answer();
		});
		renderApp('/ranking');
		await screen.findByRole('table');
		const user = userEvent.setup();
		const status = () => screen.getAllByRole('status').find((s) => s.closest('p')?.querySelector('button'))!;

		answer = () => rankingOf([rankingRow(1, 'Ana', 6, 2)]);
		hold = true;
		const button = screen.getByRole('button', { name: 'Actualizar' });
		await user.click(button);
		// While it loads: still focused, marked (not really) disabled, and a second click asks nothing more.
		await waitFor(() => expect(button.getAttribute('aria-disabled')).toBe('true'));
		expect(button.hasAttribute('disabled')).toBe(false);
		expect(document.activeElement).toBe(button);
		expect(status().textContent).toBe('Actualizando el ranking…');
		await user.click(button);
		hold = false;
		release();
		await waitFor(() => expect(cells(bodyRows()[0]!)).toEqual(['1', 'Ana', '6', '2']));
		expect(calls.filter((c) => c.url === '/api/ranking')).toHaveLength(2);
		expect(document.activeElement).toBe(button);
		expect(button.hasAttribute('aria-disabled')).toBe(false);
		await waitFor(() => expect(status().textContent).toMatch(/^Ranking actualizado a las \d\d:\d\d\.$/));

		answer = () => fail(429, 'RATE_LIMITED', 'x', { limite: 'general' }, { 'Retry-After': '30' });
		await user.click(button);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe(
			'No se pudo cargar el ranking: demasiadas solicitudes. Espera 30 segundos y vuelve a intentarlo.Abajo sigue el ranking que se cargó antes.',
		);
		// The last table stays, and the failure is announced.
		expect(cells(bodyRows()[0]!)).toEqual(['1', 'Ana', '6', '2']);
		await waitFor(() => expect(status().textContent).toBe('No se pudo actualizar el ranking.'));
		const retry = screen.getByRole('button', { name: 'Reintentar' });
		expect(document.activeElement).toBe(retry);
		answer = () => rankingOf([rankingRow(1, 'Ana', 9, 3)]);
		await user.click(retry);
		await waitFor(() => expect(cells(bodyRows()[0]!)).toEqual(['1', 'Ana', '9', '3']));
		expect(screen.queryByRole('alert')).toBeNull();
		await waitFor(() => expect(status().textContent).toMatch(/^Ranking actualizado/));
	});

	it('with the session check down, Actualizar keeps the table, says it failed and offers Reintentar (T-20 fix)', async () => {
		let down = false;
		const { calls } = mockFetch(
			apiRoutes({
				'GET /api/auth/me': () => (down ? new Response('', { status: 502 }) : ok({ user: apostador, csrfToken: 't' })),
				'GET /api/ranking': () => ok(rankingOf([rankingRow(1, 'Ana', 3, 1)])),
			}),
		);
		renderApp('/ranking');
		await screen.findByRole('table');
		const user = userEvent.setup();
		const status = () => screen.getAllByRole('status').find((s) => s.closest('p')?.querySelector('button'))!;
		down = true;
		const button = screen.getByRole('button', { name: 'Actualizar' });
		await user.click(button);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toBe('No se pudo cargar el ranking. El servidor no está disponible en este momento. Intenta más tarde.Abajo sigue el ranking que se cargó antes.');
		expect(cells(bodyRows()[0]!)).toEqual(['1', 'Ana', '3', '1']);
		expect(screen.queryByRole('heading', { name: 'No se pudo cargar' })).toBeNull();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reintentar' }));
		await waitFor(() => expect(status().textContent).toBe('No se pudo actualizar el ranking.'));
		// The ranking itself wasn't asked while the session couldn't be checked.
		expect(calls.filter((c) => c.url === '/api/ranking')).toHaveLength(1);

		down = false;
		await user.click(screen.getByRole('button', { name: 'Reintentar' }));
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
		await waitFor(() => expect(status().textContent).toMatch(/^Ranking actualizado/));
		expect(calls.filter((c) => c.url === '/api/ranking')).toHaveLength(2);
	});

	it('the session ended (401) during Actualizar still sends to sign in', async () => {
		let gone = false;
		mockFetch(
			apiRoutes({
				'GET /api/auth/me': () => (gone ? fail(401, 'UNAUTHENTICATED') : ok({ user: apostador, csrfToken: 't' })),
				'GET /api/ranking': () => ok(rankingOf([rankingRow(1, 'Ana', 3, 1)])),
			}),
		);
		const router = renderApp('/ranking');
		await screen.findByRole('table');
		gone = true;
		await userEvent.setup().click(screen.getByRole('button', { name: 'Actualizar' }));
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Franking'));
	});

	it('a first load that fails shows no table, only the notice and "Reintentar"', async () => {
		rankingApi(() => fail(429, 'RATE_LIMITED', 'x', { limite: 'general' }, { 'Retry-After': '30' }));
		renderApp('/ranking');
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).not.toMatch(/Abajo sigue/);
		expect(screen.queryByRole('table')).toBeNull();
		expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
	});

	it('needs a session', async () => {
		rankingApi(() => fail(401, 'UNAUTHENTICATED'));
		mockFetch(apiRoutes({ 'GET /api/auth/me': () => fail(401, 'UNAUTHENTICATED') }));
		const router = renderApp('/ranking');
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Franking'));
	});
});

describe('the pool menu in the session bar (T-20)', () => {
	it('a participant opens "Polla" to reach bets, their bets and the ranking; Escape closes it', async () => {
		mockFetch(
			apiRoutes({
				'GET /api/auth/me': () => ok({ user: apostador, csrfToken: 't' }),
				'GET /api/ranking': () => ok(rankingOf([])),
			}),
		);
		const router = renderApp('/cuenta');
		const button = await screen.findByRole('button', { name: 'Polla' });
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(screen.queryByRole('link', { name: 'Mis apuestas' })).toBeNull();
		const user = userEvent.setup();
		await user.click(button);
		expect(button.getAttribute('aria-expanded')).toBe('true');
		const list = document.getElementById(button.getAttribute('aria-controls')!)!;
		expect(within(list).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
			['Apostar', '/apuestas'],
			['Mis apuestas', '/mis-apuestas'],
			['Ranking', '/ranking'],
		]);
		await user.keyboard('{Escape}');
		expect(button.getAttribute('aria-expanded')).toBe('false');
		expect(document.activeElement).toBe(button);

		await user.click(button);
		await user.click(within(list).getByRole('link', { name: 'Ranking' }));
		await waitFor(() => expect(where(router)).toBe('/ranking'));
		await screen.findByRole('heading', { name: 'Ranking', level: 1 });
		const again = screen.getByRole('button', { name: 'Polla' });
		expect(again.getAttribute('aria-expanded')).toBe('false');
		await user.click(again);
		const menu = document.getElementById(again.getAttribute('aria-controls')!)!;
		expect(within(menu).getByRole('link', { name: 'Ranking' }).getAttribute('aria-current')).toBe('page');
		// Observation a: a click inside the menu but off its links (the focus leaves the button for nothing) keeps it open.
		expect(document.activeElement).toBe(again);
		await user.click(menu);
		await user.click(menu.querySelector('li')!);
		expect(again.getAttribute('aria-expanded')).toBe('true');
		// Tabbing out of it still closes it.
		await user.click(again);
		await user.click(again);
		expect(again.getAttribute('aria-expanded')).toBe('true');
		await user.tab();
		await user.tab();
		await user.tab();
		await user.tab();
		expect(menu.contains(document.activeElement)).toBe(false);
		expect(again.getAttribute('aria-expanded')).toBe('false');
		await user.click(again);
		// A click elsewhere closes it.
		await user.click(screen.getByRole('heading', { name: 'Ranking', level: 1 }));
		expect(again.getAttribute('aria-expanded')).toBe('false');
		await act(() => router.navigate('/cuenta'));
	});

	it('an admin gets a direct link to the ranking, and no pool menu', async () => {
		mockFetch(apiRoutes({ 'GET /api/auth/me': () => ok({ user: admin, csrfToken: 't' }) }));
		renderApp('/cuenta');
		expect((await screen.findByRole('link', { name: 'Ranking' })).getAttribute('href')).toBe('/ranking');
		expect(screen.queryByRole('button', { name: 'Polla' })).toBeNull();
	});
});
