import { describe, expect, it } from 'vitest';
import { myBet, rankingRow } from '../test/betting-fixtures';
import { groupByTicket, historySearch, parseHistoryFilters } from './bet-history';
import { sharedPositions } from './ranking';

describe('bet history helpers (T-20)', () => {
	it('groups consecutive rows of the same ticket, in the API order', () => {
		const rows = [myBet(3), myBet(3), myBet(2), myBet(1), myBet(1), myBet(1)];
		expect(groupByTicket(rows).map((g) => [g.ticket.id, g.selections.length])).toEqual([
			[3, 2],
			[2, 1],
			[1, 3],
		]);
		expect(groupByTicket([])).toEqual([]);
	});

	it('writes the filters to the page URL and reads them back the same', () => {
		const filters = { estado: 'no_acertada', estadoTicket: 'anulado', deporteId: 2, competicionId: 7, desde: '2026-09-01', hasta: '2026-09-30', page: 4 } as const;
		const search = historySearch(filters);
		expect(search).toBe('?estado=no_acertada&estadoTicket=anulado&deporteId=2&competicionId=7&desde=2026-09-01&hasta=2026-09-30&page=4');
		expect(parseHistoryFilters(new URLSearchParams(search))).toEqual({ filters, problems: [] });
		expect(historySearch({ page: 1 })).toBe('');
	});

	it('drops repeated, reversed or malformed values with a notice', () => {
		const { filters, problems } = parseHistoryFilters(new URLSearchParams('estado=acertada&estado=anulada&desde=2026-09-30&hasta=2026-09-01&competicionId=-1&page=100001'));
		expect(filters).toEqual({ page: 1, desde: '2026-09-30' });
		expect(problems).toEqual([
			'El filtro estado aparece más de una vez: se ignoró.',
			'La competición elegida no es válida: se muestran todas.',
			'La fecha "desde" es posterior a "hasta": se ignoró "hasta".',
			'La página no es válida: se muestra la primera.',
		]);
	});

	it('finds the positions shared by a full tie', () => {
		expect([...sharedPositions([rankingRow(1, 'A', 3, 1), rankingRow(1, 'B', 3, 1), rankingRow(3, 'C', 1, 0), rankingRow(4, 'D', 0, 0)])]).toEqual([1]);
		expect(sharedPositions([]).size).toBe(0);
	});
});
