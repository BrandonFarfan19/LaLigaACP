import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DraftSelection } from '../lib/ticket-draft';
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
				balance={10}
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
});
