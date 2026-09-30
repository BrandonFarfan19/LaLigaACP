import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DraftSelection } from '../lib/ticket-draft';
import { evaluationFor } from '../test/betting-fixtures';
import TicketPanel from './TicketPanel';

const match = { id: 1, local: 'Halcones', visita: 'Pumas', competicion: 'Liga', fechaHora: '2026-10-03T01:00:00.000Z' };
const items: DraftSelection[] = [
	{ id: 'a', match, input: { partidoId: 1, tipo: 'resultado_general', pronostico: 'local_gana' } },
	{ id: 'b', match, input: { partidoId: 1, tipo: 'marcador_exacto', golesLocal: 2, golesVisitante: 1 } },
	{ id: 'c', match, input: { partidoId: 1, tipo: 'resultado_general', pronostico: 'empate' } },
];
const noop = () => undefined;

describe('TicketPanel (T-19 fix)', () => {
	it('marks each selection that was not sent because it is not valid', () => {
		render(
			<TicketPanel
				items={items}
				evaluation={null}
				previewing={false}
				previewError="Algunas selecciones del ticket no son válidas (las 2 y 3): quita las marcadas para ver el resumen."
				invalidItems={[1, 2]}
				confirming={false}
				confirmError={null}
				announcement=""
				onRemove={noop}
				onClear={noop}
				onConfirm={noop}
			/>,
		);
		const rows = within(screen.getByRole('complementary', { name: 'Tu ticket' })).getAllByRole('listitem');
		expect(rows.map((row) => row.getAttribute('data-invalid'))).toEqual([null, 'true', 'true']);
		expect(within(rows[0]!).queryByText(/no es válida/)).toBeNull();
		for (const row of rows.slice(1)) expect(within(row).getByText(/Esta selección no es válida: quítala del ticket\./)).toBeTruthy();
		expect(screen.getByText(/las 2 y 3/)).toBeTruthy();
		expect((screen.getByRole('button', { name: /^Confirmar/ }) as HTMLButtonElement).disabled).toBe(true);
	});

	it('C-13: shows the backend BET_LIMIT_REACHED on the second selection of a type, with no cost or balance anywhere', () => {
		// Selections 1 and 3 are both a general result on match 1: the preview refuses the third.
		const evaluation = evaluationFor(items.map((item) => item.input));
		expect(evaluation.valido).toBe(false);
		render(
			<TicketPanel
				items={items}
				evaluation={evaluation}
				previewing={false}
				previewError={null}
				confirming={false}
				confirmError={null}
				announcement=""
				onRemove={noop}
				onClear={noop}
				onConfirm={noop}
			/>,
		);
		const panel = screen.getByRole('complementary', { name: 'Tu ticket' });
		const rows = within(panel).getAllByRole('listitem');
		expect(rows.map((row) => row.getAttribute('data-invalid'))).toEqual([null, null, 'true']);
		expect(
			within(rows[2]!).getByText(
				'Este ticket ya tiene una apuesta de resultado general para este partido (la selección 1): se admite una sola de cada tipo por partido.', { exact: false },
			),
		).toBeTruthy();
		// The draft's own hint, before or with the preview.
		expect(within(rows[2]!).getByText('Repetida: resultado general como la 1')).toBeTruthy();
		expect(within(rows[1]!).queryByText(/Repetida/)).toBeNull();
		expect(within(panel).getByText('Corrige las selecciones marcadas antes de confirmar.')).toBeTruthy();
		expect((screen.getByRole('button', { name: 'Confirmar' }) as HTMLButtonElement).disabled).toBe(true);
		expect(panel.textContent).not.toMatch(/moneda|saldo|costo/i);
	});
});
