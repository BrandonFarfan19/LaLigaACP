import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiRoutes } from '../test/betting-fixtures';
import { fail, mockFetch, ok, type RecordedCall } from '../test/fetch-mock';
import { aguilas, apiMatch, competitionsRoute, copa, futbol, halcones, liga, leagueRoutes, matchesRoute, page, pumas, standingRow } from '../test/league-fixtures';
import { renderLeague, where } from '../test/render-league';

/**
 * The league screens with data from the public API (T-22): the landing, the
 * table and a squad. They are public, so nothing here needs a session.
 */

const params = (call: RecordedCall) => Object.fromEntries(new URL(call.url, 'http://x').searchParams);
const gets = (calls: RecordedCall[], path: string) => calls.filter((c) => c.method === 'GET' && c.url.split('?')[0] === path);

/** Dates around a fixed "now", so the simulated API orders by proximity as each test means. */
const NOW = Date.parse('2026-09-17T12:00:00.000Z');
const hours = (count: number) => new Date(NOW + count * 3_600_000).toISOString();

describe('landing (T-22, BR-013, BR-048, BR-049)', () => {
	it('shows the teams and the fixture of the competition it opens on, grouped by round', async () => {
		const { calls } = mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/partidos': matchesRoute([apiMatch({ id: 1, jornada: 1, estado: 'finalizado', fechaHora: hours(-40), goles: [2, 1] }), apiMatch({ id: 2, jornada: 2, fechaHora: hours(40) })], NOW),
				}),
			),
		);
		renderLeague('/');

		expect(await screen.findByRole('heading', { name: /Conoce a los/ })).toBeTruthy();
		// The competition of the next scheduled match (D-021), named on screen.
		expect(screen.getByText(/Los 2 clubes que disputan la Liga Apertura\./)).toBeTruthy();
		const cards = await waitFor(() => {
			const found = [...document.querySelectorAll('[data-status]')];
			expect(found).toHaveLength(2);
			return found;
		});
		expect(cards[0]!.textContent).toMatch(/Finalizado/);
		expect(cards[0]!.textContent).toMatch(/2-1/);
		expect(cards[1]!.textContent).toMatch(/Programado/);
		// One section per round, in round order.
		expect(screen.getAllByRole('region', { name: /^Jornada / }).map((round) => round.getAttribute('aria-label'))).toEqual(['Jornada 1', 'Jornada 2']);
		// One read, not two: the matches that chose the competition are the fixture (T-22 fix).
		expect(gets(calls, '/api/public/partidos').map(params)).toEqual([{ page: '1', pageSize: '100' }]);
	});

	it('when that one read is not the whole fixture, it asks for the competition (T-22 fix)', async () => {
		// 150 matches: one page can't stand for the fixture, so the landing asks by competition.
		const all = Array.from({ length: 150 }, (_, index) => apiMatch({ id: index + 1, jornada: 1, fechaHora: hours(index + 1) }));
		const { calls } = mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/partidos': matchesRoute(all, NOW) })));
		renderLeague('/');

		await screen.findByRole('heading', { name: /Conoce a los/ });
		await waitFor(() => expect(gets(calls, '/api/public/partidos').length).toBeGreaterThan(1));
		expect(params(gets(calls, '/api/public/partidos').at(-1)!)).toMatchObject({ competicionId: '10', pageSize: '100' });
	});

	it('a competition with more matches than it reads says the list was cut', async () => {
		const all = Array.from({ length: 900 }, (_, index) => apiMatch({ id: index + 1, jornada: 1, fechaHora: hours(index + 1) }));
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/partidos': matchesRoute(all, NOW) })));
		renderLeague('/');

		expect(await screen.findByText(/se muestran los primeros 500/i)).toBeTruthy();
	});

	it('crests come from the API as images, never as inline SVG', async () => {
		mockFetch(apiRoutes(leagueRoutes()));
		renderLeague('/');
		await screen.findByRole('heading', { name: /Conoce a los/ });

		const images = [...document.querySelectorAll('img')].map((img) => img.getAttribute('src'));
		expect(images).toContain('/escudos/halcones.webp');
		expect(images).toContain('https://img.test/pumas.png');
		// The crest markup is an <img>: nothing embeds the file itself.
		expect(document.querySelector('svg image, object, embed, iframe')).toBeNull();
	});

	it('a crest whose file is not there falls back to the initials, never a hole', async () => {
		mockFetch(apiRoutes(leagueRoutes()));
		renderLeague('/');
		await screen.findByRole('heading', { name: /Conoce a los/ });

		const crest = [...document.querySelectorAll('img')].find((img) => img.getAttribute('src') === '/escudos/halcones.webp')!;
		crest.dispatchEvent(new Event('error'));

		await waitFor(() => expect(screen.getAllByText('HAL').length).toBeGreaterThan(0));
	});

	it('the sport and the competition live in the URL, so the view can be shared', async () => {
		const { calls } = mockFetch(apiRoutes(leagueRoutes()));
		const { router } = renderLeague('/');
		await screen.findByRole('heading', { name: /Conoce a los/ });
		const picker = screen.getByRole('navigation', { name: 'Elegir deporte y competición' });

		await userEvent.setup().click(within(picker).getByRole('link', { name: /Copa Vóley/ }));

		await waitFor(() => expect(where(router)).toBe('/?competicionId=11'));
		await waitFor(() => expect(gets(calls, '/api/public/competiciones/11/equipos')).toHaveLength(1));
		// The competition chosen is the one marked, and its team is the one on screen.
		await waitFor(() => expect(screen.getByRole('link', { name: /Copa Vóley/ }).getAttribute('aria-current')).toBe('page'));
		expect(screen.getAllByText('AGU').length).toBeGreaterThan(0);
	});

	it('opening a URL with a competition shows that one, without asking for a default', async () => {
		const { calls } = mockFetch(apiRoutes(leagueRoutes()));
		renderLeague('/?competicionId=11');
		await screen.findByRole('heading', { name: /Conoce a los/ });

		expect(gets(calls, '/api/public/competiciones/11/equipos')).toHaveLength(1);
		// No read of "which competition to open on": the URL already says it.
		expect(gets(calls, '/api/public/partidos').every((call) => params(call).competicionId === '11')).toBe(true);
	});

	it('with no competitions at all it says so instead of showing an empty page', async () => {
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/deportes': () => ok([]),
					'GET /api/public/competiciones': () => ok(page([])),
					'GET /api/public/partidos': () => ok(page([])),
				}),
			),
		);
		renderLeague('/');

		expect(await screen.findByText(/Todavía no hay ninguna competición con partidos/)).toBeTruthy();
	});

	it('a competition with nothing loaded yet says so', async () => {
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/competiciones/10/equipos': () => ok([]),
					'GET /api/public/partidos': matchesRoute([], NOW),
				}),
			),
		);
		renderLeague('/?competicionId=10');

		expect(await screen.findByText(/todavía no tiene equipos ni partidos cargados/)).toBeTruthy();
	});

	it('a competition with no matches still draws the FIXTURE section, but says why it is empty (T-22 fix)', async () => {
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/partidos': matchesRoute([], NOW) })));
		renderLeague('/?competicionId=10');

		// The section stays, so `/#fixture` remains an anchor; it just explains itself.
		const fixture = await screen.findByRole('region', { name: 'Fixture' });
		expect(fixture.getAttribute('id')).toBe('fixture');
		expect(within(fixture).getByText(/todavía no tiene partidos cargados/)).toBeTruthy();
		expect(within(fixture).queryAllByRole('region', { name: /^Jornada / })).toHaveLength(0);
	});

	it('with nothing read, no figure is given: never "los 0 clubes" (T-22 fix)', async () => {
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/competiciones/10/equipos': () => fail(429, 'RATE_LIMITED', 'Demasiadas solicitudes.', { limite: 'publico' }) })));
		renderLeague('/?competicionId=10');

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/demasiadas solicitudes/i);
		expect(screen.queryByText(/clubes que disputan/)).toBeNull();
		expect(screen.queryByText(/\b0 clubes\b/)).toBeNull();
		// No carousel of nothing either.
		expect(screen.queryByRole('region', { name: 'Equipos participantes' })).toBeNull();
		// And the fixture says it could not read, not that there are no matches.
		expect(within(screen.getByRole('region', { name: 'Fixture' })).getByText('No se pudieron cargar los partidos.')).toBeTruthy();
	});

	it('opens on the competition of the next scheduled match of the sport chosen, not the first one by name (T-22 second fix)', async () => {
		// Apertura comes first by name and has nothing; the next scheduled match is Clausura's.
		const apertura = { id: 20, nombre: 'Apertura', slug: 'apertura', deporte: futbol };
		const clausura = { id: 21, nombre: 'Clausura', slug: 'clausura', deporte: futbol };
		const { calls } = mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/competiciones': competitionsRoute([apertura, clausura, copa]),
					'GET /api/public/competiciones/21/equipos': () => ok([halcones, pumas]),
					'GET /api/public/partidos': matchesRoute(
						[
							apiMatch({ id: 1, fechaHora: hours(2), competicion: copa, local: aguilas, visita: aguilas }),
							apiMatch({ id: 2, fechaHora: hours(30), competicion: clausura }),
						],
						NOW,
					),
				}),
			),
		);
		renderLeague('/?deporteId=1');

		await screen.findByRole('heading', { name: /Conoce a los/ });
		// Clausura, not Apertura, and not the volleyball match that comes sooner.
		await waitFor(() => expect(screen.getByRole('link', { name: /Clausura/ }).getAttribute('aria-current')).toBe('page'));
		expect(screen.queryByText(/todavía no tiene equipos ni partidos/)).toBeNull();
		// The sport travels with the read that chooses, so nothing is read and thrown away.
		expect(gets(calls, '/api/public/partidos').map(params)).toEqual([{ deporteId: '1', page: '1', pageSize: '100' }]);
		expect(gets(calls, '/api/public/competiciones').map(params)).toEqual([{ deporteId: '1', pageSize: '100' }]);
	});

	it('with a sport that has no matches at all, it falls back to that sport first competition', async () => {
		const apertura = { id: 20, nombre: 'Apertura', slug: 'apertura', deporte: futbol };
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/competiciones': competitionsRoute([apertura, copa]),
					'GET /api/public/competiciones/20/equipos': () => ok([]),
					'GET /api/public/partidos': matchesRoute([apiMatch({ id: 1, fechaHora: hours(2), competicion: copa, local: aguilas, visita: aguilas })], NOW),
				}),
			),
		);
		renderLeague('/?deporteId=1');

		await waitFor(() => expect(screen.getByRole('link', { name: /Apertura/ }).getAttribute('aria-current')).toBe('page'));
		expect(await screen.findByText(/todavía no tiene equipos ni partidos cargados/)).toBeTruthy();
	});

	it('a 2xx without the envelope is a transient failure on every public route, never an "Error 200" page (T-22 second fix)', async () => {
		const html = () => new Response('<!doctype html><html><body>index.html</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
		const routes = ['GET /api/public/deportes', 'GET /api/public/competiciones', 'GET /api/public/partidos', 'GET /api/public/competiciones/10/equipos'];

		for (const route of routes) {
			mockFetch(apiRoutes(leagueRoutes({ [route]: html })));
			const view = renderLeague('/?competicionId=10');
			const alert = await screen.findByRole('alert');
			expect(alert.textContent, route).toMatch(/respondió algo inesperado/);
			expect(within(alert).getByRole('button', { name: 'Reintentar' }), route).toBeTruthy();
			expect(screen.queryByText(/Error 200/), route).toBeNull();
			view.dispose();
		}

		// The table and the squad, whose own pages read them.
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/competiciones/10/posiciones': html })));
		const table = renderLeague('/posiciones?competicionId=10');
		expect(within(await screen.findByRole('alert')).getByRole('button', { name: 'Reintentar' })).toBeTruthy();
		expect(screen.queryByText(/Error 200/)).toBeNull();
		table.dispose();

		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/equipos/100': html })));
		renderLeague('/plantilla/100');
		// The squad page has no list to keep, so it is the error page — but the one that retries.
		expect(await screen.findByRole('heading', { name: 'No se pudo cargar' })).toBeTruthy();
		expect(screen.getByRole('button', { name: 'Reintentar' })).toBeTruthy();
		expect(screen.queryByText(/Error 200/)).toBeNull();
	});

	it('an answer with another shape keeps the page with its notice, never the error page (T-22 fix)', async () => {
		let broken = true;
		mockFetch(apiRoutes(leagueRoutes({ 'GET /api/public/competiciones': () => (broken ? ok(null) : ok(page([liga, copa]))) })));
		renderLeague('/');

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/respondió algo inesperado/i);
		expect(screen.queryByRole('heading', { name: 'No se pudo cargar' })).toBeNull();
		broken = false;
		await userEvent.setup().click(within(alert).getByRole('button', { name: 'Reintentar' }));

		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
	});

	it('a failed read keeps the page with its notice and "Reintentar", which loads it', async () => {
		let down = true;
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/competiciones/10/equipos': () => (down ? new Response('', { status: 502 }) : ok([halcones, pumas])),
				}),
			),
		);
		renderLeague('/');

		const alert = await screen.findByRole('alert');
		expect(alert.textContent).toMatch(/No se pudo cargar la liga/);
		down = false;
		await userEvent.setup().click(within(alert).getByRole('button', { name: 'Reintentar' }));

		await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
		expect(screen.getByText(/Los 2 clubes que disputan la Liga Apertura\./)).toBeTruthy();
	});
});

describe('standings (T-22, BR-050)', () => {
	it('shows the table of the competition in the URL, in the API order', async () => {
		mockFetch(apiRoutes(leagueRoutes()));
		renderLeague('/posiciones?competicionId=10');

		const table = await screen.findByRole('table');
		const rows = within(table).getAllByRole('row').slice(1);
		expect(rows.map((row) => within(row).getAllByRole('cell')[0]!.textContent)).toEqual(['1', '2']);
		expect(rows[0]!.textContent).toMatch(/Halcones/);
		expect(rows[0]!.textContent).toMatch(/9/);
		expect(screen.getByText(/Liga Apertura \(Fútbol\)/)).toBeTruthy();
	});

	it('shows every column of BR-050, each heading named in full for a screen reader (D-023)', async () => {
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/competiciones/10/posiciones': () =>
						ok({
							competicion: liga,
							filas: [
								standingRow(halcones, 1, 10, { jugados: 4, ganados: 3, empatados: 1, perdidos: 0, golesAFavor: 9, golesEnContra: 2, diferencia: 7 }),
								standingRow(pumas, 2, 1, { jugados: 4, ganados: 0, empatados: 1, perdidos: 3, golesAFavor: 2, golesEnContra: 9, diferencia: -7 }),
							],
						}),
				}),
			),
		);
		renderLeague('/posiciones?competicionId=10');

		const table = await screen.findByRole('table');
		expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['#Posición', 'Equipo', 'PJPartidos jugados', 'PGPartidos ganados', 'PEPartidos empatados', 'PPPartidos perdidos', 'GFGoles a favor', 'GCGoles en contra', 'DGDiferencia de goles', 'PtsPuntos']);
		// Every heading is a real `th scope="col"`, and each row names its team with a `th scope="row"`.
		expect(within(table).getAllByRole('columnheader').every((cell) => cell.getAttribute('scope') === 'col')).toBe(true);

		const [first, second] = within(table).getAllByRole('row').slice(1);
		expect(within(first!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['1', '4', '3', '1', '0', '9', '2', '+7', '10']);
		// A negative difference reads as a difference, not as a bare number.
		expect(within(second!).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '4', '0', '1', '3', '2', '9', '-7', '1']);
		expect(within(first!).getByRole('rowheader').textContent).toMatch(/Halcones/);
	});

	it('the table scrolls inside its own labelled region, so a phone never drags the page sideways (D-023)', async () => {
		mockFetch(apiRoutes(leagueRoutes()));
		renderLeague('/posiciones?competicionId=10');

		const table = await screen.findByRole('table');
		const scroller = table.parentElement!;
		// Focusable and named, so it can be reached and read with the keyboard alone.
		expect(scroller.getAttribute('role')).toBe('region');
		expect(scroller.getAttribute('tabindex')).toBe('0');
		// Its own name, told apart from the page's own region (T-22 second fix).
		expect(scroller.getAttribute('aria-label')).toBe('Tabla de posiciones');
		const names = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label') ?? document.getElementById(region.getAttribute('aria-labelledby') ?? '')?.textContent);
		expect(new Set(names).size).toBe(names.length);
	});

	it('with no rows there is no table at all, only the notice (T-22 second fix)', async () => {
		mockFetch(apiRoutes(leagueRoutes()));
		renderLeague('/posiciones?competicionId=11');

		expect(await screen.findByText(/todavía no tiene equipos/)).toBeTruthy();
		expect(screen.queryByRole('table')).toBeNull();
		expect(screen.queryByRole('columnheader')).toBeNull();
	});

	it('a competition with no teams explains it', async () => {
		mockFetch(apiRoutes(leagueRoutes()));
		renderLeague('/posiciones?competicionId=11');

		expect(await screen.findByText(/todavía no tiene equipos/)).toBeTruthy();
	});
});

describe('squad (T-22, D-022)', () => {
	it('shows the team read by its numeric id, its squad and the sample notice of the ratings', async () => {
		mockFetch(apiRoutes(leagueRoutes()));
		renderLeague('/plantilla/100');

		expect(await screen.findByRole('heading', { name: 'Halcones', level: 1 })).toBeTruthy();
		expect(screen.getByText('Liga Apertura · Fútbol')).toBeTruthy();
		expect(screen.getByText(/La ubicación en la cancha es de muestra/)).toBeTruthy();

		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: /Ver estadísticas de Luis Paredes, dorsal 9/ }));
		const card = await screen.findByRole('dialog');
		expect(within(card).getByText(/Atributos de muestra/)).toBeTruthy();
		expect(within(card).getByText('Luis Paredes')).toBeTruthy();
	});

	it('an id that is not a team, or one the API refuses, is the not-found page', async () => {
		mockFetch(
			apiRoutes(
				leagueRoutes({
					'GET /api/public/equipos/999': () => fail(404, 'TEAM_NOT_FOUND', 'No existe ese equipo.'),
					'GET /api/public/equipos/abc': () => fail(400, 'VALIDATION_ERROR', 'El id debe ser un entero positivo.'),
				}),
			),
		);

		const first = renderLeague('/plantilla/999');
		expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
		first.dispose();

		renderLeague('/plantilla/abc');
		expect(await screen.findByRole('heading', { name: 'Página no encontrada' })).toBeTruthy();
	});

	it('the same player always gets the same sample ratings', async () => {
		mockFetch(apiRoutes(leagueRoutes()));
		const first = renderLeague('/plantilla/100');
		await screen.findByRole('heading', { name: 'Halcones', level: 1 });
		const user = userEvent.setup();
		await user.click(screen.getByRole('button', { name: /Ver estadísticas de Luis Paredes/ }));
		const values = within(await screen.findByRole('dialog')).getAllByRole('cell').map((cell) => cell.textContent);
		first.dispose();

		renderLeague('/plantilla/100');
		await screen.findByRole('heading', { name: 'Halcones', level: 1 });
		await user.click(screen.getByRole('button', { name: /Ver estadísticas de Luis Paredes/ }));
		expect(within(await screen.findByRole('dialog')).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(values);
	});
});
