import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cutSearch, MAX_SEARCH, SearchSelect, type SearchSource } from './SearchSelect';

/**
 * The panel's searchable chooser (D-019): it asks the API for the options that
 * match what is typed, page by page, so no list is capped at 100, and it shows
 * the chosen one whole.
 */

/** A source over `total` options named "Jugador 1"… served in pages of 20. */
function manyPlayers(total: number, seen: { queries: string[]; pages: number[] } = { queries: [], pages: [] }): SearchSource {
	return async (text, page) => {
		seen.queries.push(text);
		seen.pages.push(page);
		const all = Array.from({ length: total }, (_, i) => ({ value: String(i + 1), label: `Jugador ${i + 1}` })).filter((option) =>
			option.label.toLowerCase().includes(text.toLowerCase()),
		);
		const size = 20;
		return { options: all.slice((page - 1) * size, page * size), total: all.length, totalPages: Math.ceil(all.length / size) };
	};
}

const open = async (user: ReturnType<typeof userEvent.setup>, name = 'Jugador') => {
	const combo = screen.getByRole('combobox', { name });
	await user.click(combo);
	return combo;
};

describe('SearchSelect (D-019)', () => {
	it('asks the API for what is typed and reaches an option past the first hundred', async () => {
		const seen = { queries: [] as string[], pages: [] as number[] };
		render(<SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(150, seen)} />);
		const user = userEvent.setup();
		const combo = await open(user);

		await user.type(combo, 'jugador 14');
		// The 141st player is unreachable from a single page of 100: here it is one search away.
		expect(await screen.findByRole('option', { name: 'Jugador 141' })).toBeTruthy();
		expect(seen.queries.at(-1)).toBe('jugador 14');
		expect(screen.getByRole('status').textContent).toBe('11 opciones.');

		await user.click(screen.getByRole('option', { name: 'Jugador 141' }));
		expect(screen.getByText('Jugador 141')).toBeTruthy();
		expect(document.querySelector('input[name="jugadorId"]')).toHaveProperty('value', '141');
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('pages through the options it shows, announcing how many there are', async () => {
		render(<SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(150)} />);
		const user = userEvent.setup();
		await open(user);

		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('150 opciones, se muestran 20.'));
		await user.click(screen.getByRole('button', { name: 'Ver más opciones' }));
		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('150 opciones, se muestran 40.'));
		expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(40);
	});

	it('is driven by the keyboard: arrows, Enter and Escape, with the active option announced', async () => {
		render(<SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(3)} />);
		const user = userEvent.setup();
		const combo = await open(user);
		await screen.findByRole('option', { name: 'Jugador 1' });

		expect(combo.getAttribute('aria-expanded')).toBe('true');
		expect(combo.getAttribute('aria-activedescendant')).toBeNull();
		await user.keyboard('{ArrowDown}{ArrowDown}');
		const second = screen.getByRole('option', { name: 'Jugador 2' });
		expect(combo.getAttribute('aria-activedescendant')).toBe(second.getAttribute('id'));
		// Up from the first goes round to the last.
		await user.keyboard('{ArrowUp}{ArrowUp}');
		expect(combo.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Jugador 3' }).getAttribute('id'));

		await user.keyboard('{Enter}');
		expect(document.querySelector('input[name="jugadorId"]')).toHaveProperty('value', '3');
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(document.activeElement).toBe(combo);

		// Escape closes without changing the choice.
		await user.keyboard('{ArrowDown}');
		await screen.findByRole('listbox');
		await user.keyboard('{Escape}');
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(document.querySelector('input[name="jugadorId"]')).toHaveProperty('value', '3');
	});

	it('closes when the focus leaves it (Tab), and stays open while an option is clicked', async () => {
		render(
			<>
				<SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(3)} />
				<button type="button">Después</button>
			</>,
		);
		const user = userEvent.setup();
		const combo = await open(user);
		await screen.findByRole('option', { name: 'Jugador 1' });

		// Leaving the field with Tab closes the list (T-21 second fix).
		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Después' }));
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(combo.getAttribute('aria-expanded')).toBe('false');

		// Clicking an option never takes the focus away, so it can be picked with the pointer.
		await open(user);
		await user.click(await screen.findByRole('option', { name: 'Jugador 2' }));
		expect(document.querySelector('input[name="jugadorId"]')).toHaveProperty('value', '2');
		expect(document.activeElement).toBe(combo);
	});

	it('going past "Ver más opciones" with Tab keeps the list, and leaving the field closes it', async () => {
		render(
			<>
				<SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(150)} />
				<button type="button">Después</button>
			</>,
		);
		const user = userEvent.setup();
		await open(user);
		await screen.findByRole('button', { name: 'Ver más opciones' });

		// That button belongs to the field: reaching it must not close what it pages through.
		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Ver más opciones' }));
		expect(screen.getByRole('listbox')).toBeTruthy();

		await user.tab();
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Después' }));
		expect(screen.queryByRole('listbox')).toBeNull();
	});

	it('after removing the choice the field takes the focus without opening the list by itself', async () => {
		render(<SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(3)} />);
		const user = userEvent.setup();
		await open(user);
		await user.click(await screen.findByRole('option', { name: 'Jugador 1' }));
		expect(screen.queryByRole('listbox')).toBeNull();

		await user.click(screen.getByRole('button', { name: 'Quitar' }));
		expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Jugador' }));
		// The list opens when it is asked for, not merely because the field has the focus (T-21 second fix).
		expect(screen.queryByRole('listbox')).toBeNull();
		expect(document.querySelector('input[name="jugadorId"]')).toHaveProperty('value', '');
	});

	it('the search stops at the longest text the API takes, says so, and never asks for more', async () => {
		const seen = { queries: [] as string[], pages: [] as number[] };
		render(<SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(3, seen)} />);
		const user = userEvent.setup();
		const combo = await open(user);
		await user.type(combo, 'j'.repeat(MAX_SEARCH + 20));

		expect((combo as HTMLInputElement).value).toHaveLength(MAX_SEARCH);
		await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(`La búsqueda llega hasta ${MAX_SEARCH} caracteres.`));
		// Even a longer text (pasted, say) is cut here: the API never gets one it would refuse.
		await waitFor(() => expect(seen.queries.at(-1)).toHaveLength(MAX_SEARCH));
		expect(Math.max(...seen.queries.map((q) => q.length))).toBe(MAX_SEARCH);
	});

	it('a text longer than the limit is cut before asking, whatever put it there', async () => {
		const seen = { queries: [] as string[], pages: [] as number[] };
		function Wrapper() {
			// A value the field itself did not type (a paste, an autofill) still goes cut to the API.
			return <SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(3, seen)} />;
		}
		render(<Wrapper />);
		const user = userEvent.setup();
		const combo = (await open(user)) as HTMLInputElement;
		await user.paste('z'.repeat(MAX_SEARCH + 50));

		await waitFor(() => expect(seen.queries.length).toBeGreaterThan(0));
		expect(seen.queries.every((q) => q.length <= MAX_SEARCH)).toBe(true);
		expect(combo.value.length).toBeLessThanOrEqual(MAX_SEARCH);
	});

	it('cuts the search by code points: never half an emoji (T-22 fix)', async () => {
		const seen = { queries: [] as string[], pages: [] as number[] };
		render(<SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(3, seen)} />);
		const user = userEvent.setup();
		await open(user);
		// Each of these takes two UTF-16 units: cutting by units would leave a lone half.
		await user.paste('🐴'.repeat(MAX_SEARCH + 5));

		await waitFor(() => expect(seen.queries.length).toBeGreaterThan(0));
		const asked = seen.queries.at(-1)!;
		expect([...asked].length).toBeLessThanOrEqual(MAX_SEARCH);
		// No lone half of an emoji survived the cut.
		expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(asked)).toBe(false);

		// The cut itself, on a text the field never limited: 100 code points, not 100 UTF-16 units.
		const cut = cutSearch('🐴'.repeat(MAX_SEARCH + 50));
		expect([...cut]).toHaveLength(MAX_SEARCH);
		expect(cut).toBe('🐴'.repeat(MAX_SEARCH));
	});

	it('says when nothing matches and when the options could not be loaded', async () => {
		const failing = vi.fn<SearchSource>().mockRejectedValue(new Error('caída'));
		const { unmount } = render(<SearchSelect label="Jugador" name="jugadorId" search={failing} />);
		const user = userEvent.setup();
		await open(user);
		await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/No se pudieron cargar las opciones/));
		unmount();

		render(<SearchSelect label="Jugador" name="jugadorId" search={manyPlayers(3)} />);
		await user.type(await open(user), 'zzz');
		await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Ninguna opción coincide.'));
		expect(screen.queryByRole('option')).toBeNull();
	});

	it('shows the value it was given whole, and lets it be removed', async () => {
		render(<SearchSelect label="Competición" name="competicionId" search={manyPlayers(3)} defaultValue="10" defaultLabel="Copa de la Liga Metropolitana de Verano (Vóley)" />);
		expect(screen.getByText('Copa de la Liga Metropolitana de Verano (Vóley)')).toBeTruthy();
		expect(document.querySelector('input[name="competicionId"]')).toHaveProperty('value', '10');

		await userEvent.setup().click(screen.getByRole('button', { name: 'Quitar' }));
		expect(document.querySelector('input[name="competicionId"]')).toHaveProperty('value', '');
		expect(screen.getByText('Sin elegir.')).toBeTruthy();
	});

	it('a new scope (another competition) drops what was chosen under the old one', async () => {
		function Wrapper() {
			const [scope, setScope] = useState('10');
			return (
				<>
					<button type="button" onClick={() => setScope('11')}>
						Otra competición
					</button>
					<SearchSelect label="Equipo" name="equipoId" search={manyPlayers(3)} scope={scope} defaultValue="1" defaultLabel="Halcones" />
				</>
			);
		}
		render(<Wrapper />);
		const user = userEvent.setup();
		expect(document.querySelector('input[name="equipoId"]')).toHaveProperty('value', '1');

		await user.click(screen.getByRole('button', { name: 'Otra competición' }));
		expect(document.querySelector('input[name="equipoId"]')).toHaveProperty('value', '');
		expect(screen.getByText('Sin elegir.')).toBeTruthy();
	});

	it('with nothing to choose from yet, it says so and carries no value', () => {
		render(<SearchSelect label="Equipo local" name="localId" search={manyPlayers(3)} blocked="Elige antes la competición." />);
		expect(screen.queryByRole('combobox')).toBeNull();
		expect(screen.getByText('Elige antes la competición.')).toBeTruthy();
		expect(document.querySelector('input[name="localId"]')).toHaveProperty('value', '');
	});
});
