import { describe, expect, it } from 'vitest';
import { page } from '../test/betting-fixtures';
import { fail, mockFetch, ok } from '../test/fetch-mock';
import { bettingSearch, confirmTicket, getTicket, listBettingMatches, newIdempotencyKey, parseBettingFilters } from './betting';

const parse = (search: string) => parseBettingFilters(new URLSearchParams(search));

describe('betting filters in the page URL (BR-051)', () => {
	it('reads valid filters with the backend rules', () => {
		expect(parse('deporteId=2&desde=2026-10-01&hasta=2026-10-31&estadoApuesta=disponible&page=3')).toEqual({
			filters: { deporteId: 2, desde: '2026-10-01', hasta: '2026-10-31', estadoApuesta: 'disponible', page: 3 },
			problems: [],
		});
		expect(parse('')).toEqual({ filters: { page: 1 }, problems: [] });
	});

	it('drops invalid values with a notice, and ignores unknown parameters', () => {
		const { filters, problems } = parse(
			'deporteId=0&desde=2026-02-30&hasta=ayer&estadoApuesta=abierta&page=-1&next=//evil.test&usuarioId=3',
		);
		expect(filters).toEqual({ page: 1 });
		expect(problems).toHaveLength(5);
		expect(parse('deporteId=1e3').filters.deporteId).toBeUndefined();
		expect(parse('deporteId=1&deporteId=2')).toMatchObject({ filters: { page: 1 }, problems: [expect.stringMatching(/más de una vez/)] });
		expect(parse('page=100001').filters.page).toBe(1);
	});

	it('refuses "desde" after "hasta"', () => {
		expect(parse('desde=2026-10-10&hasta=2026-10-01')).toMatchObject({
			filters: { desde: '2026-10-10', page: 1 },
			problems: [expect.stringMatching(/posterior/)],
		});
	});

	it('writes back only what is set', () => {
		expect(bettingSearch({ page: 1 })).toBe('');
		expect(bettingSearch({ deporteId: 2, desde: '2026-10-01', estadoApuesta: 'cerrada', page: 2 })).toBe(
			'?deporteId=2&desde=2026-10-01&estadoApuesta=cerrada&page=2',
		);
	});

	it('asks the API with the same names, days as ISO dates in Lima time, and nothing else', async () => {
		const { calls } = mockFetch(() => ok(page([])));
		await listBettingMatches({ deporteId: 2, desde: '2026-10-01', hasta: '2026-10-02', estadoApuesta: 'disponible', page: 2 });
		const url = new URL(calls[0]!.url, 'http://x');
		expect(url.pathname).toBe('/api/apuestas/partidos');
		expect(Object.fromEntries(url.searchParams)).toEqual({
			deporteId: '2',
			desde: '2026-10-01T00:00:00-05:00',
			hasta: '2026-10-02T23:59:59-05:00',
			estadoApuesta: 'disponible',
			page: '2',
			pageSize: '20',
		});
	});
});

describe('tickets', () => {
	it('confirms with the Idempotency-Key header', async () => {
		const { calls } = mockFetch(() => ok({ id: 5 }, 201));
		await confirmTicket([{ partidoId: 1, tipo: 'resultado_general', pronostico: 'empate' }], 'key-1');
		expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/apuestas/tickets', headers: { 'idempotency-key': 'key-1' } });
	});

	it('a ticket id that is not one, or a 404, is "not found"; other errors are errors', async () => {
		const { calls } = mockFetch(() => fail(404, 'TICKET_NOT_FOUND'));
		for (const id of ['abc', '0', '-1', '1e3', '../x', '', '99999999999999999999']) expect(await getTicket(id), id).toBeNull();
		expect(calls).toHaveLength(0);
		expect(await getTicket('7')).toBeNull();
		expect(calls[0]!.url).toBe('/api/apuestas/tickets/7');
		mockFetch(() => fail(500, 'INTERNAL_ERROR', 'Error'));
		await expect(getTicket('7')).rejects.toMatchObject({ status: 500 });
	});

	it('idempotency keys are UUIDs, a new one each time', () => {
		const keys = new Set(Array.from({ length: 50 }, newIdempotencyKey));
		expect(keys.size).toBe(50);
		for (const key of keys) expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});
});
