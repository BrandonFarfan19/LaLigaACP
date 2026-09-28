import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiRoutes, futbol, voley } from '../test/betting-fixtures';
import { admin, apostador, fail, mockFetch, ok, pendiente, type RecordedCall } from '../test/fetch-mock';
import { renderApp, where } from '../test/render-app';
import type { AuthUser } from '../types/api';
import type { ApiPage, ParticipantBet, ParticipantBetTeam } from '../types/betting';

/**
 * "Apuestas de todos" (C-07, BR-056). The simulated API answers what the
 * backend answers (`services/participant-bets.service.ts`): only the name, the
 * match and the forecast, already in its order (newest match first, then by
 * name), and it applies the filters and the pages it is asked for.
 */

const team = (id: number, nombre: string): ParticipantBetTeam => ({ id, nombre, nombreCorto: nombre.slice(0, 3).toUpperCase(), escudo: `escudos/${id}.webp`, colorAcento: '#3cf281' });
const HALCONES = team(100, 'Halcones');
const PUMAS = team(101, 'Pumas');
const AGUILAS = team(200, 'Águilas');
const DELFINES = team(201, 'Delfines');

const bet = (nombre: string, partido: 'F' | 'V', apuesta: ParticipantBet['apuesta']): ParticipantBet => ({
	participante: { nombre },
	partido:
		partido === 'V'
			? { id: 51, fechaHora: '2026-09-20T20:00:00.000Z', competicion: { id: 11, nombre: 'Copa Vóley' }, deporte: { id: voley.id, nombre: voley.nombre }, local: AGUILAS, visita: DELFINES }
			: { id: 50, fechaHora: '2026-09-10T20:00:00.000Z', competicion: { id: 10, nombre: 'Liga' }, deporte: { id: futbol.id, nombre: futbol.nombre }, local: HALCONES, visita: PUMAS },
	apuesta,
});
const general = (pronostico: 'local_gana' | 'empate' | 'visitante_gana') => ({ tipo: 'resultado_general' as const, pronostico, golesLocal: null, golesVisitante: null });
const exact = (golesLocal: number, golesVisitante: number) => ({ tipo: 'marcador_exacto' as const, pronostico: null, golesLocal, golesVisitante });

/** In the backend's order. */
const BETS: ParticipantBet[] = [
	bet('Álvaro', 'V', general('visitante_gana')),
	bet('Ana', 'F', general('local_gana')),
	bet('Ana', 'F', exact(2, 1)),
	bet('Beto', 'F', general('empate')),
];

const plain = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** `GET /apuestas/participantes` with its filters and pages, like the backend. */
function everyoneRoute(bets: ParticipantBet[] = BETS) {
	return ({ url }: RecordedCall) => {
		const query = new URL(url, 'http://x').searchParams;
		const deporteId = Number(query.get('deporteId') ?? 0);
		const participante = plain(query.get('participante') ?? '');
		const rows = bets.filter((b) => (!deporteId || b.partido.deporte.id === deporteId) && (!participante || plain(b.participante.nombre).includes(participante)));
		const pageSize = Number(query.get('pageSize') ?? 20);
		const page = Number(query.get('page') ?? 1);
		const body: ApiPage<ParticipantBet> = {
			items: rows.slice((page - 1) * pageSize, page * pageSize),
			page,
			pageSize,
			total: rows.length,
			totalPages: Math.ceil(rows.length / pageSize),
		};
		return ok(body);
	};
}

const calls = (list: RecordedCall[]) => list.filter((c) => c.method === 'GET' && c.url.split('?')[0] === '/api/apuestas/participantes');
const params = (call: RecordedCall) => Object.fromEntries(new URL(call.url, 'http://x').searchParams);

function everyoneApi(extra: Record<string, Parameters<typeof apiRoutes>[0][string]> = {}, user: AuthUser = apostador) {
	return mockFetch(
		apiRoutes({
			'GET /api/auth/me': () => ok({ user, csrfToken: 't' }),
			'GET /api/public/deportes': () => ok([futbol, voley]),
			'GET /api/apuestas/participantes': everyoneRoute(),
			...extra,
		}),
	);
}

/** The table's rows as [participante, partido, apuesta] texts. */
const tableRows = () =>
	within(screen.getByRole('table', { name: 'Apuestas de todos' }))
		.getAllByRole('row')
		.slice(1)
		.map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));

describe('Apuestas de todos (C-07, BR-056)', () => {
	it('shows who bet what, with only the three columns, in the backend\'s order', async () => {
		const { calls: all } = everyoneApi();
		renderApp('/apuestas-de-todos');
		expect(await screen.findByRole('heading', { name: 'Apuestas de todos', level: 1 })).toBeTruthy();

		const table = await screen.findByRole('table', { name: 'Apuestas de todos' });
		expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Participante', 'Partido', 'Apuesta']);
		const rows = tableRows();
		expect(rows.map((r) => r[0])).toEqual(['Álvaro', 'Ana', 'Ana', 'Beto']);
		expect(rows[0]![1]).toMatch(/Águilas vs Delfines/);
		expect(rows[0]![1]).toMatch(/Vóley · Copa Vóley · 20 sept 15:00/);
		expect(rows.map((r) => r[2])).toEqual(['Resultado general: Gana Delfines', 'Resultado general: Gana Halcones', 'Marcador exacto: 2 - 1', 'Resultado general: Empate']);
		// Crests from the API, only as images.
		expect(table.querySelectorAll('img')).toHaveLength(8);
		expect(screen.getByText('4 apuestas.')).toBeTruthy();
		expect(params(calls(all)[0]!)).toEqual({ page: '1', pageSize: '20' });
	});

	it('filters by sport (chips) and by a part of the name, in the page URL, and the results take the focus', async () => {
		const { calls: all } = everyoneApi();
		const router = renderApp('/apuestas-de-todos');
		const form = await screen.findByRole('form', { name: 'Filtrar apuestas de todos' });
		const user = userEvent.setup();

		await user.click(within(form).getByRole('radio', { name: 'Fútbol' }));
		await user.type(within(form).getByLabelText('Participante'), '  ana ');
		await user.click(within(form).getByRole('button', { name: 'Filtrar' }));
		await waitFor(() => expect(where(router)).toBe('/apuestas-de-todos?deporteId=1&participante=ana'));
		await waitFor(() => expect(tableRows().map((r) => r[0])).toEqual(['Ana', 'Ana']));
		expect(params(calls(all).at(-1)!)).toEqual({ deporteId: '1', participante: 'ana', page: '1', pageSize: '20' });
		const count = screen.getByText('2 apuestas.');
		await waitFor(() => expect(document.activeElement).toBe(count));
		// The form shows the URL's filters.
		expect((within(screen.getByRole('form', { name: 'Filtrar apuestas de todos' })).getByRole('radio', { name: 'Fútbol' }) as HTMLInputElement).checked).toBe(true);
		expect((screen.getByLabelText('Participante') as HTMLInputElement).value).toBe('ana');

		await user.click(screen.getByRole('link', { name: 'Quitar filtros' }));
		await waitFor(() => expect(where(router)).toBe('/apuestas-de-todos'));
		await waitFor(() => expect(tableRows()).toHaveLength(4));
	});

	it('a name from the URL, accents and case aside like the backend', async () => {
		everyoneApi();
		renderApp('/apuestas-de-todos?participante=ALVARO');
		await waitFor(() => expect(tableRows().map((r) => r[0])).toEqual(['Álvaro']));
	});

	it('nothing found says why', async () => {
		everyoneApi();
		renderApp('/apuestas-de-todos?participante=zeta');
		expect(await screen.findByText('No hay apuestas con esos filtros. Solo se ven las de partidos con el resultado confirmado.')).toBeTruthy();
		expect(screen.queryByRole('table', { name: 'Apuestas de todos' })).toBeNull();
	});

	it('with nothing to show yet, it says that only matches with a confirmed result show', async () => {
		everyoneApi({ 'GET /api/apuestas/participantes': everyoneRoute([]) });
		renderApp('/apuestas-de-todos');
		expect(await screen.findByText('Todavía no hay apuestas para mostrar: solo se ven las de partidos con el resultado confirmado.')).toBeTruthy();
	});

	it('pages through the list, and a page past the end shows the last one and says so', async () => {
		const many = Array.from({ length: 25 }, (_, i) => bet(`Jugador ${String(i + 1).padStart(2, '0')}`, 'F', general('empate')));
		const { calls: all } = everyoneApi({ 'GET /api/apuestas/participantes': everyoneRoute(many) });
		const router = renderApp('/apuestas-de-todos');
		await screen.findByText('25 apuestas. Página 1 de 2.');
		const user = userEvent.setup();
		await user.click(within(screen.getByRole('navigation', { name: 'Páginas de apuestas de todos' })).getByRole('link', { name: /Siguiente/ }));
		await waitFor(() => expect(where(router)).toBe('/apuestas-de-todos?page=2'));
		await waitFor(() => expect(tableRows().map((r) => r[0])).toEqual(['Jugador 21', 'Jugador 22', 'Jugador 23', 'Jugador 24', 'Jugador 25']));

		await router.navigate('/apuestas-de-todos?page=9');
		expect(await screen.findByText('La página 9 no existe: se muestra la última (2).')).toBeTruthy();
		await waitFor(() => expect(where(router)).toBe('/apuestas-de-todos?page=2'));
		expect(calls(all).map((c) => params(c).page)).toContain('9');
	});

	it('a failed load stays on the page with "Reintentar"', async () => {
		let down = true;
		everyoneApi({ 'GET /api/apuestas/participantes': (call) => (down ? new Response('', { status: 502 }) : everyoneRoute()(call)) });
		renderApp('/apuestas-de-todos');
		expect(await screen.findByText(/No se pudieron cargar las apuestas de todos\./)).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Apuestas de todos', level: 1 })).toBeTruthy();

		down = false;
		await userEvent.setup().click(screen.getByRole('button', { name: 'Reintentar' }));
		await waitFor(() => expect(tableRows()).toHaveLength(4));
	});

	it('a "Reintentar" that loads takes the focus to the count and announces it, like /mis-apuestas (C-07 fix)', async () => {
		let down = true;
		everyoneApi({ 'GET /api/apuestas/participantes': (call) => (down ? new Response('', { status: 502 }) : everyoneRoute()(call)) });
		renderApp('/apuestas-de-todos');
		const retry = await screen.findByRole('button', { name: 'Reintentar' });
		const user = userEvent.setup();

		// Failing again: the focus stays on the button, inside the notice that is still there.
		retry.focus();
		await user.click(retry);
		await waitFor(() => expect(retry.getAttribute('aria-disabled')).toBeNull());
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reintentar' }));
		expect(screen.getByRole('alert').contains(document.activeElement)).toBe(true);

		down = false;
		await user.click(screen.getByRole('button', { name: 'Reintentar' }));
		const count = await screen.findByText('4 apuestas.');
		await waitFor(() => expect(document.activeElement).toBe(count));
		expect(document.activeElement).not.toBe(document.body);
		expect(screen.queryByRole('alert')).toBeNull();
		// Announced, not only focused.
		expect(screen.getAllByRole('status').some((region) => region.textContent === '4 apuestas.')).toBe(true);
	});

	it('a filter of the URL that is not valid is said in words, never by its parameter name (C-07 fix)', async () => {
		const { calls: all } = everyoneApi();
		renderApp('/apuestas-de-todos?deporteId=abc&participante=a%0Ab');
		expect(await screen.findByText('El deporte elegido no es válido: se muestran todos.')).toBeTruthy();
		expect(screen.getByText('El nombre del participante no es válido: se muestran todos.')).toBeTruthy();
		expect(document.body.textContent).not.toMatch(/deporteId|participante=|filtro/);
		// Neither goes to the API (the name with a line break would be a 400).
		await waitFor(() => expect(tableRows()).toHaveLength(4));
		expect(params(calls(all)[0]!)).toEqual({ page: '1', pageSize: '20' });
	});

	it('a filter that comes twice, or a page that is not one, is said in words too', async () => {
		everyoneApi();
		renderApp('/apuestas-de-todos?deporteId=1&deporteId=2&participante=a&participante=b&page=x');
		expect(await screen.findByText('Se eligió más de un deporte: se muestran todos.')).toBeTruthy();
		expect(screen.getByText('Se escribió más de un nombre de participante: se muestran todos.')).toBeTruthy();
		expect(screen.getByText('La página no es válida: se muestra la primera.')).toBeTruthy();
		expect(document.body.textContent).not.toMatch(/deporteId|filtro/);
	});

	it('a pending participant sees why it is empty, and nothing is asked', async () => {
		const { calls: all } = everyoneApi({}, pendiente);
		renderApp('/apuestas-de-todos');
		expect(await screen.findByText(/Tu cuenta está pendiente de validación\./)).toBeTruthy();
		expect(calls(all)).toHaveLength(0);
		expect(screen.queryByRole('form', { name: 'Filtrar apuestas de todos' })).toBeNull();
	});

	it('an admin gets the 403 page and nothing is asked (they keep the panel\'s query)', async () => {
		const { calls: all } = everyoneApi({}, admin);
		renderApp('/apuestas-de-todos');
		expect(await screen.findByRole('heading', { name: 'Acceso restringido' })).toBeTruthy();
		expect(calls(all)).toHaveLength(0);
	});

	it('without a session it sends to sign in, and back here after', async () => {
		everyoneApi({ 'GET /api/auth/me': () => fail(401, 'UNAUTHENTICATED') });
		const router = renderApp('/apuestas-de-todos?participante=ana');
		await waitFor(() => expect(where(router)).toBe('/ingresar?next=%2Fapuestas-de-todos%3Fparticipante%3Dana'));
	});

	it('the Polla menu links to it, in the pool\'s gold group', async () => {
		everyoneApi();
		renderApp('/apuestas-de-todos');
		await screen.findByRole('heading', { name: 'Apuestas de todos', level: 1 });
		await userEvent.setup().click(screen.getByRole('button', { name: 'Polla' }));
		const link = screen.getByRole('link', { name: 'Apuestas de todos' });
		expect(link.getAttribute('href')).toBe('/apuestas-de-todos');
		expect(link.getAttribute('aria-current')).toBe('page');
	});
});
