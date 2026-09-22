import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { apiRoutes, bettingMatch, evaluationFor, page, receipt, voley } from '../test/betting-fixtures';
import { admin, apostador, fail, mockFetch, ok, pendiente, type RecordedCall } from '../test/fetch-mock';
import { renderApp, where } from '../test/render-app';
import type { AuthUser } from '../types/api';
import { action, type ConfirmFailure, type PreviewResult } from './Apuestas';

const me = (user: AuthUser) => () => ok({ user, csrfToken: 't' });
const posts = (calls: RecordedCall[], path: string) => calls.filter((c) => c.method === 'POST' && c.url === path);
const card = (name: RegExp) => screen.getByRole('article', { name });

const open = bettingMatch({ id: 1, local: 'Halcones', visita: 'Pumas' });
const openVoley = bettingMatch({ id: 2, local: 'Águilas', visita: 'Delfines', sport: voley });
const closed = bettingMatch({ id: 3, estado: 'cerrada', local: 'Cóndores', visita: 'Lobos' });
const live = bettingMatch({ id: 4, estado: 'en_curso', local: 'Toros', visita: 'Rayos' });
const finished = bettingMatch({ id: 5, estado: 'finalizado', local: 'Linces', visita: 'Osos', goles: [2, 1] });
const cancelled = bettingMatch({ id: 6, estado: 'cancelado', local: 'Tigres', visita: 'Zorros' });
const ALL = [open, openVoley, closed, live, finished, cancelled];

/** The standard fake API for a validated bettor with 10 coins. */
function bettorApi(extra: Record<string, Parameters<typeof apiRoutes>[0][string]> = {}, user: AuthUser = apostador) {
	return mockFetch(
		apiRoutes({
			'GET /api/auth/me': me(user),
			'GET /api/public/deportes': () => ok([open.deporte, voley]),
			'GET /api/apuestas/partidos': () => ok(page(ALL)),
			'POST /api/apuestas/vista-previa': ({ body }) => ok(evaluationFor((body as { selecciones: unknown[] }).selecciones, user.saldoMonedas, {}, ALL)),
			...extra,
		}),
	);
}

async function addWin(user: ReturnType<typeof userEvent.setup>, team = 'Halcones') {
	await user.click(screen.getByRole('button', { name: `Apostar: Gana ${team}` }));
}

describe('betting screen (T-19)', () => {
	afterEach(() => sessionStorage.clear());

	it('shows every betting state with a label and an icon, and bet controls only on open matches (BR-052)', async () => {
		bettorApi();
		renderApp('/apuestas');
		await screen.findByRole('heading', { name: 'Apuestas' });
		for (const [match, label] of [
			[/Halcones/, 'Disponible'],
			[/Cóndores/, 'Apuestas cerradas'],
			[/Toros/, 'En curso'],
			[/Linces/, 'Finalizado'],
			[/Tigres/, 'Cancelado'],
		] as const) {
			const article = card(match);
			expect(within(article).getByText(label), label).toBeTruthy();
			// The state never relies on color alone: an icon sits next to the word.
			expect(within(article).getByText(label).parentElement!.querySelector('[aria-hidden="true"]'), label).not.toBeNull();
			expect(within(article).queryAllByRole('button').length > 0, label).toBe(label === 'Disponible');
		}
		// The finished match shows its score; kick-off and close in Lima time.
		expect(within(card(/Linces/)).getByText('2 - 1')).toBeTruthy();
		expect(within(card(/Halcones/)).getByText('02 oct · 20:00')).toBeTruthy();
		expect(within(card(/Halcones/)).getByText('01 oct · 20:00')).toBeTruthy();
		// Crests only as small <img>, pixelated, from the site root.
		const img = card(/Halcones/).querySelector('img')!;
		expect(img.getAttribute('src')).toBe('/favicon.png');
		expect(img.className).toMatch(/pixelated/);
		expect(img.getAttribute('width')).toBe('32');
	});

	it('hides the draw where the sport has none (BR-015), and refuses a tied exact score there', async () => {
		bettorApi();
		renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		expect(within(card(/Halcones/)).getByRole('button', { name: 'Apostar: Empate' })).toBeTruthy();
		const voleyCard = card(/Águilas/);
		expect(within(voleyCard).queryByRole('button', { name: 'Apostar: Empate' })).toBeNull();
		const add = within(voleyCard).getByRole('button', { name: /Apostar: marcador/ });
		expect((add as HTMLButtonElement).disabled).toBe(true);
		expect(within(voleyCard).getByText(/no admite empate/)).toBeTruthy();
		await user.click(within(voleyCard).getByRole('button', { name: 'Sumar un gol a Águilas' }));
		expect((add as HTMLButtonElement).disabled).toBe(false);
		// Goal fields: labelled, 0 to 999.
		const goals = within(voleyCard).getByLabelText('Águilas') as HTMLInputElement;
		expect([goals.min, goals.max, goals.value]).toEqual(['0', '999', '1']);
		// Two quick clicks add two goals; typing is capped at 999.
		const plus = within(voleyCard).getByRole('button', { name: 'Sumar un gol a Delfines' });
		act(() => {
			plus.click();
			plus.click();
		});
		expect((within(voleyCard).getByLabelText('Delfines') as HTMLInputElement).value).toBe('2');
		await user.clear(goals);
		await user.type(goals, '5000');
		expect(goals.value).toBe('999');
	});

	it('filters come from the page URL, reach the API with its own names, and the form writes them back (BR-051)', async () => {
		const { calls } = bettorApi();
		const router = renderApp('/apuestas?deporteId=2&desde=2026-10-01&estadoApuesta=disponible&next=//evil.test&foo=1');
		await screen.findByRole('heading', { name: 'Apuestas' });
		const list = calls.find((c) => c.url.startsWith('/api/apuestas/partidos'))!;
		expect(Object.fromEntries(new URL(list.url, 'http://x').searchParams)).toEqual({
			deporteId: '2',
			desde: '2026-10-01T00:00:00-05:00',
			estadoApuesta: 'disponible',
			page: '1',
			pageSize: '20',
		});
		// Sports are a group of choices (names wrap, D-014): the one in the URL is chosen.
		const sports = screen.getByRole('group', { name: 'Deporte' });
		expect(within(sports).getAllByRole('radio').map((r) => [r.getAttribute('value'), (r as HTMLInputElement).checked])).toEqual([
			['', false],
			['1', false],
			['2', true],
		]);
		expect(within(sports).getByRole('radio', { name: 'Vóley' })).toBeTruthy();

		const user = userEvent.setup();
		await user.click(within(sports).getByRole('radio', { name: 'Fútbol' }));
		await user.selectOptions(screen.getByLabelText('Estado'), 'cerrada');
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		await waitFor(() => expect(where(router)).toBe('/apuestas?deporteId=1&desde=2026-10-01&estadoApuesta=cerrada'));
		await waitFor(() => expect(calls.filter((c) => c.url.startsWith('/api/apuestas/partidos'))).toHaveLength(2));

		await user.click(screen.getByRole('link', { name: 'Quitar filtros' }));
		await waitFor(() => expect(where(router)).toBe('/apuestas'));
	});

	it('an invalid filter in the URL is dropped with a notice', async () => {
		bettorApi();
		renderApp('/apuestas?desde=2026-13-40');
		expect(await screen.findByText(/La fecha "desde" no es válida/)).toBeTruthy();
	});

	it('a sport that no longer exists is dropped with a notice, and never sent to the API', async () => {
		const { calls } = bettorApi();
		renderApp('/apuestas?deporteId=99&estadoApuesta=disponible');
		expect(await screen.findByText('El deporte elegido ya no existe: se muestran todos.')).toBeTruthy();
		expect((screen.getByRole('radio', { name: 'Todos' }) as HTMLInputElement).checked).toBe(true);
		const list = calls.find((c) => c.url.startsWith('/api/apuestas/partidos'))!;
		expect(new URL(list.url, 'http://x').searchParams.has('deporteId')).toBe(false);
		expect(new URL(list.url, 'http://x').searchParams.get('estadoApuesta')).toBe('disponible');
	});

	it('builds the ticket: adds, marks repeats, previews, removes and empties, and keeps it in sessionStorage', async () => {
		const { calls } = bettorApi();
		const router = renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });

		await addWin(user);
		await addWin(user);
		const pumas = within(card(/Halcones/)).getByRole('button', { name: 'Sumar un gol a Pumas' });
		await user.click(pumas);
		await user.click(within(card(/Halcones/)).getByRole('button', { name: /Apostar: marcador Halcones 0 - 1 Pumas/ }));

		const ticket = screen.getByRole('complementary', { name: 'Tu ticket' });
		expect(within(ticket).getAllByRole('listitem')).toHaveLength(3);
		expect(within(ticket).getByText('Repetida (igual a la 1)')).toBeTruthy();
		expect(screen.getByText(/Agregado: Halcones vs Pumas, Marcador 0 - 1\. Tu ticket tiene 3 selecciones\./)).toBeTruthy();
		expect(within(card(/Halcones/)).getByText('En tu ticket: 3 selecciones')).toBeTruthy();

		// BR-023: the preview of exactly these selections, with totals and balances.
		await waitFor(() => expect(within(ticket).getByText('3 monedas', { selector: 'dd' })).toBeTruthy());
		const preview = posts(calls, '/api/apuestas/vista-previa').at(-1)!;
		expect(preview.body).toEqual({
			selecciones: [
				{ partidoId: 1, tipo: 'resultado_general', pronostico: 'local_gana' },
				{ partidoId: 1, tipo: 'resultado_general', pronostico: 'local_gana' },
				{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: 0, golesVisitante: 1 },
			],
		});
		expect(within(ticket).getByText('10 monedas')).toBeTruthy();
		expect(within(ticket).getByText('7 monedas')).toBeTruthy();
		// A preview doesn't reload the match list.
		expect(calls.filter((c) => c.url.startsWith('/api/apuestas/partidos'))).toHaveLength(1);

		// D-012: the draft survives leaving and coming back.
		const saved = JSON.parse(sessionStorage.getItem(`la-liga-acp:ticket:${apostador.id}`)!);
		expect(saved.items).toHaveLength(3);
		await act(() => router.navigate('/posiciones'));
		await act(() => router.navigate('/apuestas'));
		const again = await screen.findByRole('complementary', { name: 'Tu ticket' });
		expect(within(again).getAllByRole('listitem')).toHaveLength(3);

		// Modify: remove one. Cancel: empty it.
		await user.click(within(again).getByRole('button', { name: /Quitar la selección 2/ }));
		expect(within(again).getAllByRole('listitem')).toHaveLength(2);
		expect(screen.getByText(/Quitado: Halcones vs Pumas, Gana Halcones\. Quedan 2\./)).toBeTruthy();
		await user.click(within(again).getByRole('button', { name: 'Vaciar ticket' }));
		expect(within(again).queryAllByRole('listitem')).toHaveLength(0);
		expect(screen.getByText('Ticket vaciado.')).toBeTruthy();
		expect(sessionStorage.getItem(`la-liga-acp:ticket:${apostador.id}`)).toBeNull();
	});

	it('confirms with an Idempotency-Key, reuses it after a network error and a double click, then opens the receipt with the new balance', async () => {
		let balance = 10;
		let attempts = 0;
		const { calls } = bettorApi({
			'GET /api/auth/me': () => ok({ user: { ...apostador, saldoMonedas: balance }, csrfToken: 't' }),
			'POST /api/apuestas/tickets': () => {
				attempts++;
				if (attempts === 1) return Promise.reject(new TypeError('Failed to fetch'));
				balance = 9;
				return ok(receipt(55, apostador.id, { cantidadSelecciones: 1, monedasUtilizadas: 1 }), 201);
			},
			'GET /api/apuestas/tickets/55': () => ok(receipt(55, apostador.id, { cantidadSelecciones: 1, monedasUtilizadas: 1 })),
		});
		const router = renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		await addWin(user);
		const confirm = await screen.findByRole('button', { name: 'Confirmar (1 moneda)' });

		await user.click(confirm);
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/No se pudo conectar.*no se cobra dos veces/);
		expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0);

		// Retry with a double click: one request, the same key.
		const retry = screen.getByRole('button', { name: 'Confirmar (1 moneda)' });
		await user.dblClick(retry);
		await waitFor(() => expect(where(router)).toBe('/apuestas/tickets/55'));
		const confirmations = posts(calls, '/api/apuestas/tickets');
		expect(confirmations).toHaveLength(2);
		const [first, second] = confirmations.map((c) => c.headers['idempotency-key']);
		expect(first).toMatch(/^[0-9a-f-]{36}$/);
		expect(second).toBe(first);
		expect(confirmations[1]!.headers['x-csrf-token']).toBe('t');

		// The receipt, the emptied draft and the coin counter at once.
		expect(await screen.findByRole('heading', { name: 'Ticket #55' })).toBeTruthy();
		expect(sessionStorage.getItem(`la-liga-acp:ticket:${apostador.id}`)).toBeNull();
		expect(screen.getByTestId('coin-counter').getAttribute('aria-label')).toBe('Saldo: 9 monedas');
	});

	it('409 TICKET_REJECTED shows each selection problem next to it and keeps the ticket', async () => {
		const { calls } = bettorApi({
			'POST /api/apuestas/tickets': ({ body }) =>
				fail(409, 'TICKET_REJECTED', 'x', evaluationFor((body as { selecciones: unknown[] }).selecciones, 10, { 1: 'Las apuestas para este partido ya cerraron (cierran 24 horas antes del inicio).' }, ALL)),
		});
		renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		await addWin(user);
		await addWin(user, 'Águilas');
		await user.click(await screen.findByRole('button', { name: 'Confirmar (2 monedas)' }));

		expect((await screen.findByRole('alert')).textContent).toMatch(/no se confirmó y no se descontó nada/);
		const items = within(screen.getByRole('complementary', { name: 'Tu ticket' })).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(within(items[0]!).queryByText(/ya cerraron/)).toBeNull();
		expect(within(items[1]!).getByText(/Las apuestas para este partido ya cerraron/)).toBeTruthy();
		expect((screen.getByRole('button', { name: /Confirmar/ }) as HTMLButtonElement).disabled).toBe(true);
		expect(posts(calls, '/api/apuestas/tickets')).toHaveLength(1);
	});

	it('409 IDEMPOTENCY_KEY_REUSED prepares a new key for the next attempt', async () => {
		let n = 0;
		const { calls } = bettorApi({
			'POST /api/apuestas/tickets': () => (++n === 1 ? fail(409, 'IDEMPOTENCY_KEY_REUSED', 'x') : ok(receipt(56, apostador.id), 201)),
			'GET /api/apuestas/tickets/56': () => ok(receipt(56, apostador.id)),
		});
		const router = renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		await addWin(user);
		await user.click(await screen.findByRole('button', { name: 'Confirmar (1 moneda)' }));
		expect((await screen.findByRole('alert')).textContent).toMatch(/Se preparó una nueva/);
		await user.click(await screen.findByRole('button', { name: 'Confirmar (1 moneda)' }));
		await waitFor(() => expect(where(router)).toBe('/apuestas/tickets/56'));
		const keys = posts(calls, '/api/apuestas/tickets').map((c) => c.headers['idempotency-key']);
		expect(keys).toHaveLength(2);
		expect(keys[1]).not.toBe(keys[0]);
	});

	it('429 on confirming says so, with the wait', async () => {
		bettorApi({ 'POST /api/apuestas/tickets': () => fail(429, 'RATE_LIMITED', 'x', { limite: 'general' }, { 'Retry-After': '60' }) });
		renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		await addWin(user);
		await user.click(await screen.findByRole('button', { name: 'Confirmar (1 moneda)' }));
		expect((await screen.findByRole('alert')).textContent).toBe(
			'Demasiadas solicitudes desde esta conexión. Espera 1 minuto y vuelve a confirmar: no se cobrará dos veces.',
		);
	});

	it('a 401 on confirming goes to sign in with ?next=, and the ticket is still there after signing in again', async () => {
		let alive = true;
		bettorApi({
			'GET /api/auth/me': () => (alive ? ok({ user: apostador, csrfToken: 't' }) : fail(401, 'UNAUTHENTICATED')),
			'POST /api/apuestas/tickets': () => {
				alive = false;
				return fail(401, 'UNAUTHENTICATED');
			},
		});
		const router = renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		await addWin(user);
		await user.click(await screen.findByRole('button', { name: 'Confirmar (1 moneda)' }));
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fapuestas'));
		expect(JSON.parse(sessionStorage.getItem(`la-liga-acp:ticket:${apostador.id}`)!).items).toHaveLength(1);
	});

	it('a pending participant sees the matches but cannot bet, and is told why (BR-005)', async () => {
		const { calls } = bettorApi({}, pendiente);
		renderApp('/apuestas');
		expect(await screen.findByText(/Tu cuenta está pendiente de validación\./)).toBeTruthy();
		const article = card(/Halcones/);
		for (const button of within(article).getAllByRole('button')) expect((button as HTMLButtonElement).disabled).toBe(true);
		expect(within(article).getByText(/todavía no puedes apostar/)).toBeTruthy();
		expect(screen.queryByRole('complementary', { name: 'Tu ticket' })).toBeNull();
		expect(posts(calls, '/api/apuestas/vista-previa')).toHaveLength(0);
	});

	it('an admin gets the 403 page that explains admins do not bet (BR-001)', async () => {
		const { calls } = bettorApi({}, admin);
		renderApp('/apuestas');
		expect(await screen.findByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
		expect(screen.getByText(/Los administradores no participan/)).toBeTruthy();
		expect(calls.some((c) => c.url.startsWith('/api/apuestas'))).toBe(false);
	});

	it('the draft belongs to its user and is removed on signing out (D-012)', async () => {
		bettorApi({ 'POST /api/auth/logout': () => ok(null) });
		const router = renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		await addWin(user);
		expect(sessionStorage.getItem(`la-liga-acp:ticket:${apostador.id}`)).not.toBeNull();
		await user.click(screen.getByRole('button', { name: 'Salir' }));
		await waitFor(() => expect(where(router)).toBe('/'));
		expect(sessionStorage.getItem(`la-liga-acp:ticket:${apostador.id}`)).toBeNull();
	});
});

describe('betting screen, T-19 fixes', () => {
	afterEach(() => sessionStorage.clear());

	const KEY = '0b7f3b4e-2c1d-4a5e-9f60-7a8b9c0d1e2f';
	const storedMatch = { id: 1, local: 'Halcones', visita: 'Pumas', competicion: 'Liga', fechaHora: '2026-10-03T01:00:00.000Z' };
	const win = { partidoId: 1, tipo: 'resultado_general', pronostico: 'local_gana' };
	const storeDraft = (items: unknown[], idempotencyKey: unknown = KEY) =>
		sessionStorage.setItem(`la-liga-acp:ticket:${apostador.id}`, JSON.stringify({ userId: apostador.id, idempotencyKey, items }));
	const panel = () => screen.getByRole('complementary', { name: 'Tu ticket' });
	const listCalls = (calls: RecordedCall[]) => calls.filter((c) => c.url.startsWith('/api/apuestas/partidos'));

	it('a corrupt or old-format draft never breaks the page: bad selections are dropped, the rest is sent with only its fields', async () => {
		storeDraft(
			[
				{ id: 'a', match: { ...storedMatch, local: { nombre: 'Halcones' } }, input: win },
				{ id: 'b', match: { ...storedMatch, fechaHora: 'mañana' }, input: win },
				{ id: 'c', match: { ...storedMatch, fechaHora: 1759453200000 }, input: win },
				{ id: 'd', match: 'Halcones vs Pumas', input: win },
				{ id: 'e', match: { id: 1 }, input: win },
				{ id: 'f', match: storedMatch, input: { partidoId: -3.5, tipo: 'resultado_general', pronostico: 'empate' } },
				{ id: 'g', match: storedMatch, input: { partidoId: 1, tipo: 'marcador_exacto', golesLocal: 1e20, golesVisitante: 0 } },
				{ id: 'h', match: storedMatch, input: { partidoId: 1, tipo: 'marcador_exacto', golesLocal: -1, golesVisitante: 0 } },
				{ id: 'ok', match: storedMatch, input: { ...win, golesLocal: 2, usuarioId: 99 } },
				{ id: 'ok', match: storedMatch, input: { partidoId: 1, tipo: 'marcador_exacto', golesLocal: 3, golesVisitante: 1 } },
			],
			`${KEY}\r\n`,
		);
		const { calls } = bettorApi();
		renderApp('/apuestas');
		await screen.findByRole('heading', { name: 'Apuestas' });
		const items = within(panel()).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(screen.queryByRole('heading', { name: /No se pudo|Algo salió mal/ })).toBeNull();
		// The type once, then the forecast alone.
		expect(items[1]!.textContent).toMatch(/Marcador exacto: 3 - 1/);
		expect(items[1]!.textContent).not.toMatch(/Marcador 3 - 1/);

		await waitFor(() => expect(posts(calls, '/api/apuestas/vista-previa')).toHaveLength(1));
		expect(posts(calls, '/api/apuestas/vista-previa')[0]!.body).toEqual({
			selecciones: [win, { partidoId: 1, tipo: 'marcador_exacto', golesLocal: 3, golesVisitante: 1 }],
		});
		// The draft was saved back clean, with a real key and unique ids.
		const saved = JSON.parse(sessionStorage.getItem(`la-liga-acp:ticket:${apostador.id}`)!);
		expect(saved.idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
		expect(new Set(saved.items.map((i: { id: string }) => i.id)).size).toBe(2);

		// Confirming sends the clean selections and the renewed key.
		const user = userEvent.setup();
		await user.click(await screen.findByRole('button', { name: 'Confirmar (2 monedas)' }));
		await waitFor(() => expect(posts(calls, '/api/apuestas/tickets')).toHaveLength(1));
		const sent = posts(calls, '/api/apuestas/tickets')[0]!;
		expect(sent.body).toEqual({ selecciones: [win, { partidoId: 1, tipo: 'marcador_exacto', golesLocal: 3, golesVisitante: 1 }] });
		expect(sent.headers['idempotency-key']).toBe(saved.idempotencyKey);
	});

	it('a draft that is entirely broken just starts empty', async () => {
		for (const raw of ['{', '"x"', JSON.stringify({ userId: apostador.id, items: [{ id: 'a', match: null, input: null }], idempotencyKey: KEY })]) {
			sessionStorage.setItem(`la-liga-acp:ticket:${apostador.id}`, raw);
			bettorApi();
			renderApp('/apuestas');
			await screen.findByRole('heading', { name: 'Apuestas' });
			expect(within(panel()).queryAllByRole('listitem'), raw).toHaveLength(0);
			cleanup();
		}
	});

	it('shows the kick-off the list reports, not the one saved with the selection', async () => {
		storeDraft([{ id: 'a', match: { ...storedMatch, fechaHora: '2026-09-30T01:00:00.000Z' }, input: win }]);
		bettorApi();
		renderApp('/apuestas');
		await screen.findByRole('heading', { name: 'Apuestas' });
		await waitFor(() => expect(within(panel()).getByRole('listitem').textContent).toMatch(/Liga · 02 oct 20:00/));
		const saved = JSON.parse(sessionStorage.getItem(`la-liga-acp:ticket:${apostador.id}`)!);
		expect(saved.items[0].match.fechaHora).toBe(open.fechaHora);
		expect(saved.idempotencyKey).toBe(KEY);
	});

	for (const [label, answer, message] of [
		['a 429 of the general limit', () => fail(429, 'RATE_LIMITED', 'x', { limite: 'general' }, { 'Retry-After': '60' }), /Demasiadas solicitudes desde esta conexión/],
		['no connection', () => Promise.reject(new TypeError('Failed to fetch')), /No se pudo conectar/],
		// Behind Vite's proxy (or a reverse proxy) a stopped backend answers 502 with no envelope.
		['the server down behind the proxy', () => new Response('', { status: 502 }), /El servidor no está disponible.*no se cobra dos veces/],
	] as const) {
		it(`a confirmation that fails with ${label} keeps the page, the ticket and its message, without reloading the list`, async () => {
			let down = false;
			const { calls } = bettorApi({
				'GET /api/apuestas/partidos': () => (down ? fail(429, 'RATE_LIMITED', 'x', { limite: 'general' }) : ok(page(ALL))),
				'POST /api/apuestas/tickets': () => {
					down = true;
					return answer();
				},
			});
			renderApp('/apuestas');
			const user = userEvent.setup();
			await screen.findByRole('heading', { name: 'Apuestas' });
			await addWin(user);
			await user.click(await screen.findByRole('button', { name: 'Confirmar (1 moneda)' }));
			const alert = await screen.findByRole('alert');
			expect(alert.textContent).toMatch(message);
			// Give a reload the chance to happen: it must not.
			await act(() => new Promise((done) => setTimeout(done, 50)));
			expect(listCalls(calls)).toHaveLength(1);
			expect(screen.getByRole('heading', { name: 'Apuestas' })).toBeTruthy();
			expect(within(panel()).getAllByRole('listitem')).toHaveLength(1);
			expect(screen.getByRole('alert').textContent).toMatch(message);
			// "Confirmando…" doesn't stay next to the error.
			expect(screen.queryByText('Confirmando el ticket…')).toBeNull();
			expect(screen.getByRole('button', { name: 'Confirmar (1 moneda)' })).toBeTruthy();
		});
	}

	it('a rejected ticket reloads the list; if that reload fails, the last list and the ticket stay, with a retry', async () => {
		let listFails = false;
		const { calls } = bettorApi({
			'GET /api/apuestas/partidos': () => (listFails ? fail(429, 'RATE_LIMITED', 'x', { limite: 'general' }, { 'Retry-After': '120' }) : ok(page(ALL))),
			'POST /api/apuestas/tickets': ({ body }) => {
				listFails = true;
				return fail(409, 'TICKET_REJECTED', 'x', evaluationFor((body as { selecciones: unknown[] }).selecciones, 10, { 0: 'Las apuestas para este partido ya cerraron (cierran 24 horas antes del inicio).' }, ALL));
			},
		});
		renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		await addWin(user);
		await user.click(await screen.findByRole('button', { name: 'Confirmar (1 moneda)' }));
		await waitFor(() => expect(listCalls(calls)).toHaveLength(2));
		expect(await screen.findByText(/No se pudo actualizar la lista de partidos: demasiadas solicitudes\. Espera 2 minutos/)).toBeTruthy();
		// The page, its last list and the ticket with its problem are all still there.
		expect(screen.getByRole('heading', { name: 'Apuestas' })).toBeTruthy();
		expect(card(/Halcones/)).toBeTruthy();
		expect(within(panel()).getByText(/ya cerraron/)).toBeTruthy();
		expect(screen.getByText(/no se confirmó y no se descontó nada/)).toBeTruthy();

		listFails = false;
		await user.click(screen.getByRole('button', { name: 'Reintentar' }));
		await waitFor(() => expect(screen.queryByText(/No se pudo actualizar la lista/)).toBeNull());
		expect(listCalls(calls)).toHaveLength(3);
		expect(within(panel()).getAllByRole('listitem')).toHaveLength(1);
		// A successful retry also clears the old confirmation error, and the summary is asked again.
		expect(screen.queryByText(/no se confirmó y no se descontó nada/)).toBeNull();
		await waitFor(() => expect(within(panel()).queryByText(/ya cerraron/)).toBeNull());
		expect(posts(calls, '/api/apuestas/vista-previa').length).toBeGreaterThanOrEqual(2);
	});

	/** The open match, postponed two days: 04 oct 20:00 in Lima. */
	const postponed = { ...open, fechaHora: '2026-10-05T01:00:00.000Z' };

	it('a reloaded list brings the new kick-off into the ticket, even with an older preview of the same selections', async () => {
		let moved = false;
		const { calls } = bettorApi({
			'GET /api/apuestas/partidos': () => ok(page(moved ? [postponed, ...ALL.slice(1)] : ALL)),
			// The first preview knows the old date; after the change the next one never answers,
			// so only the reloaded list can bring the new date.
			'POST /api/apuestas/vista-previa': ({ body }) =>
				moved
					? new Promise<Response>(() => undefined)
					: ok({ ...evaluationFor((body as { selecciones: unknown[] }).selecciones, 10), selecciones: [{ ...evaluationFor((body as { selecciones: unknown[] }).selecciones, 10).selecciones[0]!, partido: open }] }),
		});
		const router = renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		await addWin(user);
		await screen.findByRole('button', { name: 'Confirmar (1 moneda)' });
		expect(within(panel()).getByRole('listitem').textContent).toMatch(/02 oct 20:00/);

		// The admin postpones the match; the user changes a filter and the list reloads.
		moved = true;
		await user.selectOptions(screen.getByLabelText('Estado'), 'disponible');
		await user.click(screen.getByRole('button', { name: 'Filtrar' }));
		await waitFor(() => expect(where(router)).toBe('/apuestas?estadoApuesta=disponible'));
		await waitFor(() => expect(listCalls(calls)).toHaveLength(2));
		// The router's state changes before React paints it.
		await waitFor(() => expect(within(card(/Halcones/)).getByText('04 oct · 20:00')).toBeTruthy());
		await waitFor(() => expect(within(panel()).getByRole('listitem').textContent).toMatch(/04 oct 20:00/));
		const saved = JSON.parse(sessionStorage.getItem(`la-liga-acp:ticket:${apostador.id}`)!);
		expect(saved.items[0].match.fechaHora).toBe(postponed.fechaHora);
	});

	it('after a rejected ticket, the reloaded list brings the new kick-off into the ticket', async () => {
		let moved = false;
		const { calls } = bettorApi({
			'GET /api/apuestas/partidos': () => ok(page(moved ? [postponed, ...ALL.slice(1)] : ALL)),
			'POST /api/apuestas/vista-previa': ({ body }) =>
				moved
					? new Promise<Response>(() => undefined)
					: ok({ ...evaluationFor((body as { selecciones: unknown[] }).selecciones, 10), selecciones: [{ ...evaluationFor((body as { selecciones: unknown[] }).selecciones, 10).selecciones[0]!, partido: open }] }),
			'POST /api/apuestas/tickets': ({ body }) => {
				moved = true;
				return fail(409, 'TICKET_REJECTED', 'x', evaluationFor((body as { selecciones: unknown[] }).selecciones, 10, { 0: 'El partido cambió.' }, ALL));
			},
		});
		renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		await addWin(user);
		await user.click(await screen.findByRole('button', { name: 'Confirmar (1 moneda)' }));
		await waitFor(() => expect(listCalls(calls)).toHaveLength(2));
		await waitFor(() => expect(within(panel()).getByRole('listitem').textContent).toMatch(/04 oct 20:00/));
		expect(screen.getByText(/no se confirmó y no se descontó nada/)).toBeTruthy();
	});

	it('tells the user how many stored selections were dropped and why', async () => {
		storeDraft([
			{ id: 'a', match: { ...storedMatch, fechaHora: '2026-02-30T01:00:00Z' }, input: win },
			{ id: 'b', match: storedMatch, input: { partidoId: 1, tipo: 'marcador_exacto', golesLocal: -1, golesVisitante: 0 } },
			{ id: 'c', match: storedMatch, input: win },
		]);
		bettorApi();
		renderApp('/apuestas');
		const user = userEvent.setup();
		const notice = await screen.findByText(
			'Se quitaron 2 selecciones guardadas de tu ticket porque faltaban datos de su partido o su pronóstico no era válido. Revisa el ticket antes de confirmar.',
		);
		expect(notice.closest('[role="status"]')).not.toBeNull();
		expect(within(panel()).getAllByRole('listitem')).toHaveLength(1);
		await user.click(screen.getByRole('button', { name: 'Entendido' }));
		expect(screen.queryByText(/Se quitaron/)).toBeNull();
		cleanup();

		storeDraft([{ id: 'a', match: storedMatch, input: { partidoId: 1, tipo: 'otro' } }, { id: 'c', match: storedMatch, input: win }]);
		bettorApi();
		renderApp('/apuestas');
		expect(await screen.findByText(/^Se quitó 1 selección guardada de tu ticket porque su pronóstico no era válido\./)).toBeTruthy();
		cleanup();

		// A valid draft says nothing.
		storeDraft([{ id: 'c', match: storedMatch, input: win }]);
		bettorApi();
		renderApp('/apuestas');
		await screen.findByRole('heading', { name: 'Apuestas' });
		expect(screen.queryByText(/Se quit/)).toBeNull();
	});

	describe('the page action', () => {
		const post = (body: unknown) =>
			action({
				request: new Request('http://localhost/apuestas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
				params: {},
				context: undefined,
			} as unknown as Parameters<typeof action>[0]);

		it('refuses an unknown intent, or a body that is not an object, without calling the API', async () => {
			const { calls } = bettorApi();
			for (const intent of ['otro', undefined, 'CONFIRM', 1]) {
				const result = (await post({ intent, selecciones: [win], idempotencyKey: KEY })) as ConfirmFailure;
				expect(result, String(intent)).toMatchObject({ code: 'INVALID_INTENT', transient: true });
			}
			// null, a list, a number or broken JSON: no TypeError, the same refusal.
			for (const body of [null, [], 3, 'texto']) {
				await expect(post(body), JSON.stringify(body)).resolves.toMatchObject({ intent: 'confirm', code: 'INVALID_INTENT' });
			}
			const broken = await action({
				request: new Request('http://localhost/apuestas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }),
				params: {},
				context: undefined,
			} as unknown as Parameters<typeof action>[0]);
			expect(broken).toMatchObject({ code: 'INVALID_INTENT' });
			expect(calls).toHaveLength(0);
		});

		it('never sends an empty ticket', async () => {
			const { calls } = bettorApi();
			const result = (await post({ intent: 'confirm', selecciones: [], idempotencyKey: KEY })) as ConfirmFailure;
			expect(result).toMatchObject({ code: 'EMPTY_TICKET', transient: true, invalid: [] });
			expect(result.message).toMatch(/El ticket está vacío.*No se confirmó nada/);
			const preview = (await post({ intent: 'preview', selecciones: [] })) as PreviewResult;
			expect(preview).toMatchObject({ evaluation: null, error: 'El ticket está vacío: agrega al menos una selección.' });
			expect(calls).toHaveLength(0);
		});

		it('never sends a smaller ticket than the one shown: any invalid selection refuses the whole confirmation', async () => {
			const { calls } = bettorApi();
			const bad: Array<[unknown[], number[], string]> = [
				[[win, { ...win, partidoId: -3.5 }], [1], 'Una selección del ticket no es válida (la 2)'],
				[[win, { partidoId: 1, tipo: 'marcador_exacto', golesLocal: 1e20, golesVisitante: 0 }], [1], 'Una selección del ticket no es válida (la 2)'],
				[['x', win, null, { ...win, extra: 1 }], [0, 2], 'Algunas selecciones del ticket no son válidas (las 1 y 3)'],
				[['x', 'y', win, 'z'], [0, 1, 3], 'Algunas selecciones del ticket no son válidas (las 1, 2 y 4)'],
				[Array.from({ length: 51 }, () => win), [50], 'Una selección del ticket no es válida (la 51)'],
			];
			for (const [selecciones, invalid, text] of bad) {
				const result = (await post({ intent: 'confirm', selecciones, idempotencyKey: KEY })) as ConfirmFailure;
				expect(result).toMatchObject({ intent: 'confirm', code: 'INVALID_SELECTIONS', transient: true, signature: JSON.stringify(selecciones), invalid });
				expect(result.message).toBe(`${text}, así que no se confirmó nada ni se descontaron monedas. Quita las marcadas y vuelve a confirmar.`);
				const preview = (await post({ intent: 'preview', selecciones })) as PreviewResult;
				expect(preview).toMatchObject({ intent: 'preview', evaluation: null, invalid });
				expect(preview.error).toBe(`${text}: quita las marcadas para ver el resumen.`);
			}
			const notArray = (await post({ intent: 'confirm', selecciones: { 0: win }, idempotencyKey: KEY })) as ConfirmFailure;
			expect(notArray.code).toBe('INVALID_SELECTIONS');
			expect(calls).toHaveLength(0);
		});

		it('a 5xx also promises no double charge', async () => {
			bettorApi({ 'POST /api/apuestas/tickets': () => new Response('', { status: 502 }) });
			const result = (await post({ intent: 'confirm', selecciones: [win], idempotencyKey: KEY })) as ConfirmFailure;
			expect(result.transient).toBe(true);
			expect(result.message).toMatch(/El servidor no está disponible.*no se cobra dos veces/);
		});
	});

	it('without a ticket in progress, a failed first load is still the error page, with Reintentar', async () => {
		let limited = true;
		bettorApi({ 'GET /api/apuestas/partidos': () => (limited ? fail(429, 'RATE_LIMITED', 'x', { limite: 'general' }) : ok(page(ALL))) });
		renderApp('/apuestas');
		expect(await screen.findByRole('heading', { name: 'Espera un momento' })).toBeTruthy();
		limited = false;
		await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
		expect(await screen.findByRole('heading', { name: 'Apuestas' })).toBeTruthy();
		expect(card(/Halcones/)).toBeTruthy();
	});

	it('without a ticket, a list on screen stays when the session check fails while filtering (T-20 fix)', async () => {
		let down = false;
		const { calls } = bettorApi({ 'GET /api/auth/me': () => (down ? new Response('', { status: 502 }) : ok({ user: apostador, csrfToken: 't' })) });
		const router = renderApp('/apuestas');
		await screen.findByRole('article', { name: /Halcones/ });
		down = true;
		await act(() => router.navigate(`/apuestas?deporteId=${voley.id}`));
		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/No se pudo actualizar la lista de partidos\. El servidor no está disponible en este momento\. Intenta más tarde\. Abajo sigue la lista que se cargó antes\./);
		expect(card(/Halcones/)).toBeTruthy();
		expect(screen.queryByRole('heading', { name: 'No se pudo cargar' })).toBeNull();
		expect(listCalls(calls)).toHaveLength(1);

		// Reintentar keeps the focus while it loads, and the new list takes it after.
		down = false;
		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: 'Reintentar' }));
		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
		await waitFor(() => expect(document.activeElement?.textContent).toMatch(/partidos, del más próximo al más lejano\.$/));
		expect(listCalls(calls)).toHaveLength(2);
	});

	it('after leaving the page, a failed visit with no ticket is the error page again', async () => {
		let down = false;
		bettorApi({ 'GET /api/auth/me': () => (down ? new Response('', { status: 502 }) : ok({ user: apostador, csrfToken: 't' })) });
		const router = renderApp('/apuestas');
		await screen.findByRole('article', { name: /Halcones/ });
		await act(() => router.navigate('/'));
		down = true;
		await act(() => router.navigate('/apuestas'));
		expect(await screen.findByRole('heading', { name: 'No se pudo cargar' })).toBeTruthy();
	});

	it('the goal steppers keep the focus at 0 and at 999, and say the limit aloud', async () => {
		bettorApi();
		renderApp('/apuestas');
		const user = userEvent.setup();
		await screen.findByRole('heading', { name: 'Apuestas' });
		const article = card(/Halcones/);
		const minus = within(article).getByRole('button', { name: 'Restar un gol a Halcones' });
		const plus = within(article).getByRole('button', { name: 'Sumar un gol a Halcones' });
		const goals = within(article).getByLabelText('Halcones') as HTMLInputElement;
		const live = () => article.querySelector('[aria-live="polite"]')!.textContent!.trim();
		expect(minus.getAttribute('aria-disabled')).toBe('true');
		expect(live()).toBe('');
		// Pressed at the limit: said, and said again on a second press.
		await user.click(minus);
		expect(live()).toBe('Halcones: 0 goles, el mínimo.');
		const first = article.querySelector('[aria-live="polite"]')!.textContent;
		await user.click(minus);
		expect(article.querySelector('[aria-live="polite"]')!.textContent).not.toBe(first);

		await user.click(plus);
		expect(goals.value).toBe('1');
		expect(minus.getAttribute('aria-disabled')).toBeNull();
		minus.focus();
		await user.keyboard('{Enter}');
		expect(goals.value).toBe('0');
		expect(document.activeElement).toBe(minus);
		expect(minus.getAttribute('aria-disabled')).toBe('true');
		expect((minus as HTMLButtonElement).disabled).toBe(false);
		expect(live()).toBe('Halcones: 0 goles, el mínimo.');
		await user.keyboard('{Enter}');
		expect(goals.value).toBe('0');

		await user.clear(goals);
		// Typing a value out of range adjusts it, and says so.
		await user.type(goals, '1500');
		expect(goals.value).toBe('999');
		expect(live()).toBe('Halcones: 1500 no se admite, quedó en 999 goles, el máximo.');
		await user.clear(goals);
		expect(live()).toBe('');
		await user.type(goals, '998');
		expect(live()).toBe('');
		plus.focus();
		await user.keyboard('{Enter}');
		expect(goals.value).toBe('999');
		expect(document.activeElement).toBe(plus);
		expect(plus.getAttribute('aria-disabled')).toBe('true');
		expect(live()).toBe('Halcones: 999 goles, el máximo.');
		await user.keyboard('{Enter}');
		expect(goals.value).toBe('999');
	});
});

describe('ticket receipt (BR-025)', () => {
	it('shows the ticket, its selections, their states and the real result', async () => {
		bettorApi({ 'GET /api/apuestas/tickets/55': () => ok(receipt(55, apostador.id, { monedasDevueltas: 1, estado: 'finalizado' })) });
		renderApp('/apuestas/tickets/55');
		expect(await screen.findByRole('heading', { name: 'Ticket #55' })).toBeTruthy();
		expect(screen.getByText('18 sept 10:30').closest('p')!.textContent).toBe('Confirmado el 18 sept 10:30 por Ana.');
		const summary = screen.getByText('Monedas utilizadas').parentElement!;
		expect(summary.textContent).toMatch(/2 monedas/);
		expect(screen.getByText('Monedas devueltas').parentElement!.textContent).toMatch(/1 moneda$/);
		const items = within(screen.getByRole('list', { name: 'Selecciones del ticket' })).getAllByRole('listitem');
		expect(items).toHaveLength(2);
		expect(items[0]!.textContent).toMatch(/Gana Halcones/);
		expect(items[0]!.textContent).toMatch(/Acertada/);
		expect(items[0]!.textContent).toMatch(/2 - 1 \(Gana Halcones\)/);
		// The type once, then the score alone (never "Marcador exacto ... Marcador 1 - 1").
		expect(items[1]!.textContent).toMatch(/TipoMarcador exactoPronóstico1 - 1/);
		expect(items[1]!.textContent).not.toMatch(/Marcador 1 - 1/);
		expect(items[1]!.textContent).toMatch(/No acertada/);
	});

	it("someone else's or a missing ticket is the not-found page; a non-numeric id doesn't even ask", async () => {
		const { calls } = bettorApi({ 'GET /api/apuestas/tickets/77': () => fail(404, 'TICKET_NOT_FOUND') });
		renderApp('/apuestas/tickets/77');
		expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
		expect(calls.some((c) => c.url === '/api/apuestas/tickets/77')).toBe(true);
	});

	it('a non-numeric id is not found without calling the API', async () => {
		const { calls } = bettorApi();
		renderApp('/apuestas/tickets/abc');
		expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
		expect(calls.some((c) => c.url.startsWith('/api/apuestas/tickets'))).toBe(false);
	});
});
