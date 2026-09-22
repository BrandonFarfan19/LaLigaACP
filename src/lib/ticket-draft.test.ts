import { afterEach, describe, expect, it } from 'vitest';
import { bettingMatch } from '../test/betting-fixtures';
import type { SelectionInput } from '../types/betting';
import {
	addSelection,
	clearAllDrafts,
	clearDraft,
	draftMatchOf,
	droppedNotice,
	emptyDraft,
	isIdempotencyKey,
	loadDraft,
	readDraft,
	refreshMatches,
	removeSelection,
	renewKey,
	repeatOf,
	saveDraft,
	selectionInputOf,
} from './ticket-draft';

const match = draftMatchOf(bettingMatch({ id: 1 }));
const win: SelectionInput = { partidoId: 1, tipo: 'resultado_general', pronostico: 'local_gana' };
const score: SelectionInput = { partidoId: 1, tipo: 'marcador_exacto', golesLocal: 2, golesVisitante: 1 };

describe('ticket draft (D-012)', () => {
	afterEach(() => sessionStorage.clear());

	it('adds and removes selections, repeats allowed and marked, a new key on every change', () => {
		let draft = emptyDraft(7);
		const keys = [draft.idempotencyKey];
		for (const input of [win, score, win]) {
			draft = addSelection(draft, input, match);
			keys.push(draft.idempotencyKey);
		}
		expect(draft.items.map((i) => i.input)).toEqual([win, score, win]);
		expect([0, 1, 2].map((i) => repeatOf(draft.items, i))).toEqual([null, null, 0]);
		draft = removeSelection(draft, draft.items[1]!.id);
		keys.push(draft.idempotencyKey);
		expect(draft.items.map((i) => i.input)).toEqual([win, win]);
		expect(new Set(keys).size).toBe(keys.length);
		// A renewed key keeps the selections.
		const renewed = renewKey(draft);
		expect(renewed.items).toBe(draft.items);
		expect(renewed.idempotencyKey).not.toBe(draft.idempotencyKey);
	});

	it('stops at 50 selections', () => {
		let draft = emptyDraft(7);
		for (let i = 0; i < 50; i++) draft = addSelection(draft, win, match);
		expect(draft.items).toHaveLength(50);
		expect(addSelection(draft, win, match)).toBe(draft);
	});

	it('lives in sessionStorage per user, keeps its key, and goes away when emptied or cleared', () => {
		const draft = addSelection(emptyDraft(7), score, match);
		saveDraft(draft);
		expect(loadDraft(7)).toEqual(draft);
		expect(loadDraft(8).items).toEqual([]);
		saveDraft(addSelection(emptyDraft(8), win, match));

		saveDraft({ ...draft, items: [] });
		expect(sessionStorage.getItem('la-liga-acp:ticket:7')).toBeNull();
		saveDraft(draft);
		clearDraft(7);
		expect(loadDraft(7).items).toEqual([]);

		saveDraft(draft);
		sessionStorage.setItem('otra-cosa', 'x');
		clearAllDrafts();
		expect(Object.keys(sessionStorage)).toEqual(['otra-cosa']);
	});

	it('ignores a malformed or foreign stored draft', () => {
		for (const value of ['{', '[]', JSON.stringify({ userId: 9, items: [], idempotencyKey: 'k' }), JSON.stringify({ userId: 7, items: 'x', idempotencyKey: 'k' })]) {
			sessionStorage.setItem('la-liga-acp:ticket:7', value);
			expect(loadDraft(7).items, value).toEqual([]);
		}
		sessionStorage.setItem(
			'la-liga-acp:ticket:7',
			JSON.stringify({ userId: 7, idempotencyKey: 'k', items: [{ id: 'a', match, input: { partidoId: 1, tipo: 'otro' } }, { id: 'b', match, input: win }] }),
		);
		expect(loadDraft(7).items.map((i) => i.id)).toEqual(['b']);
	});

	const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
	const KEY = '0b7f3b4e-2c1d-4a5e-9f60-7a8b9c0d1e2f';
	const store = (items: unknown[], idempotencyKey: unknown = KEY) =>
		sessionStorage.setItem('la-liga-acp:ticket:7', JSON.stringify({ userId: 7, idempotencyKey, items }));

	it('keeps a valid stored draft exactly, key included', () => {
		store([
			{ id: 'a', match, input: win },
			{ id: 'b', match, input: score },
		]);
		expect(loadDraft(7)).toEqual({ userId: 7, idempotencyKey: KEY, items: [{ id: 'a', match, input: win }, { id: 'b', match, input: score }] });
	});

	it('drops every selection whose match data is broken, never throwing (T-19 fix)', () => {
		const broken: unknown[] = [
			{ ...match, local: { nombre: 'Halcones' } },
			{ ...match, fechaHora: 'nope' },
			{ ...match, fechaHora: 1759453200000 },
			{ ...match, fechaHora: '2026-13-45T99:00:00Z' },
			{ ...match, fechaHora: '2026-10-03' },
			{ ...match, competicion: '' },
			{ ...match, visita: 'x'.repeat(201) },
			{ ...match, id: 2 },
			{ id: 1, local: 'Halcones' },
			'Halcones vs Pumas',
			null,
			[match],
		];
		store([...broken.map((m, i) => ({ id: `x${i}`, match: m, input: win })), { id: 'ok', match, input: win }]);
		const draft = loadDraft(7);
		expect(draft.items.map((i) => i.id)).toEqual(['ok']);
		// Something was dropped: the old key named other selections.
		expect(draft.idempotencyKey).not.toBe(KEY);
		expect(draft.idempotencyKey).toMatch(UUID);
	});

	it('checks kick-off dates strictly: no date that Date would quietly move, and reports what was dropped', () => {
		const dates = [
			'2026-02-30T01:00:00Z',
			'2025-02-29T01:00:00Z',
			'2026-04-31T01:00:00.000Z',
			'2026-10-03T24:00:00Z',
			'2026-10-03T23:60:00Z',
			'2026-10-03T23:00:60Z',
			'2026-13-03T01:00:00Z',
			'2026-00-03T01:00:00Z',
			'2026-10-00T01:00:00Z',
			'2026-10-03T01:00:00+15:00',
			'2026-10-03T01:00:00+14:01',
			'2026-10-03T01:00:00+14:59',
			'2026-10-03T01:00:00-12:01',
			'2026-10-03T01:00:00-14:00',
			'2026-10-03T01:00:00-13:00',
			'2026-10-03T01:00:00-05:60',
			'1999-10-03T01:00:00Z',
		];
		// Every real zone offset, the two ends included.
		const offsets = ['+14:00', '-12:00', '+05:45', '-09:30', '+00:00', '-00:00'];
		for (const offset of offsets) {
			store([{ id: 'z', match: { ...match, fechaHora: `2026-10-03T01:00:00${offset}` }, input: win }]);
			expect(readDraft(7).dropped, offset).toBe(0);
		}
		store([
			...dates.map((fechaHora, i) => ({ id: `d${i}`, match: { ...match, fechaHora }, input: win })),
			{ id: 'leap', match: { ...match, fechaHora: '2028-02-29T23:59:59-05:00' }, input: win },
			{ id: 'bad', match, input: { partidoId: 1, tipo: 'otro' } },
		]);
		const { draft, dropped, reasons } = readDraft(7);
		expect(draft.items.map((i) => i.id)).toEqual(['leap']);
		expect(dropped).toBe(dates.length + 1);
		expect(reasons).toEqual(['partido', 'pronostico']);
		expect(droppedNotice(dropped, reasons)).toBe(
			`Se quitaron ${dates.length + 1} selecciones guardadas de tu ticket porque faltaban datos de su partido o su pronóstico no era válido. Revisa el ticket antes de confirmar.`,
		);
		expect(droppedNotice(1, ['maximo'])).toBe('Se quitó 1 selección guardada de tu ticket porque pasaban del máximo de 50. Revisa el ticket antes de confirmar.');
		expect(droppedNotice(0, [])).toBeNull();

		store([{ id: 'a', match, input: win }]);
		expect(readDraft(7)).toMatchObject({ dropped: 0, reasons: [] });
		store(Array.from({ length: 52 }, (_, i) => ({ id: `s${i}`, match, input: win })));
		expect(readDraft(7)).toMatchObject({ dropped: 2, reasons: ['maximo'] });
	});

	it('drops malformed selections and keeps only the fields of each type (T-19 fix)', () => {
		const bad: unknown[] = [
			{ partidoId: -3.5, tipo: 'resultado_general', pronostico: 'empate' },
			{ partidoId: 0, tipo: 'resultado_general', pronostico: 'empate' },
			{ partidoId: '1', tipo: 'resultado_general', pronostico: 'empate' },
			{ partidoId: 1, tipo: 'resultado_general', pronostico: 'gana' },
			{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: 1e20, golesVisitante: 0 },
			{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: -1, golesVisitante: 0 },
			{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: 1000, golesVisitante: 0 },
			{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: 1.5, golesVisitante: 0 },
			{ partidoId: 1, tipo: 'marcador_exacto', golesLocal: '2', golesVisitante: 0 },
			{ partidoId: 1, tipo: 'otro' },
			'x',
		];
		for (const input of bad) expect(selectionInputOf(input), JSON.stringify(input)).toBeNull();
		store([
			...bad.map((input, i) => ({ id: `b${i}`, match, input })),
			{ id: 'extra', match, input: { ...win, golesLocal: 2, usuarioId: 99 } },
			{ id: 'extra2', match, input: { ...score, pronostico: 'empate', ticketId: 1 } },
		]);
		const draft = loadDraft(7);
		expect(draft.items.map((i) => [i.id, i.input])).toEqual([
			['extra', win],
			['extra2', score],
		]);
		expect(Object.keys(draft.items[0]!.input)).toEqual(['partidoId', 'tipo', 'pronostico']);
		expect(Object.keys(draft.items[1]!.input)).toEqual(['partidoId', 'tipo', 'golesLocal', 'golesVisitante']);
		expect(draft.idempotencyKey).not.toBe(KEY);
		expect(selectionInputOf({ partidoId: 1, tipo: 'marcador_exacto', golesLocal: 0, golesVisitante: 999 })).toEqual({
			partidoId: 1,
			tipo: 'marcador_exacto',
			golesLocal: 0,
			golesVisitante: 999,
		});
	});

	it('renews a key that is not exactly a lowercase UUID, and repeated or odd local ids (T-19 fix)', () => {
		for (const key of ['k', `${KEY}\r\n`, ` ${KEY}`, KEY.toUpperCase(), `{${KEY}}`, '00000000-0000-0000-0000-000000000000', 42, null]) {
			store([{ id: 'a', match, input: win }], key);
			const draft = loadDraft(7);
			expect(draft.items).toHaveLength(1);
			expect(draft.idempotencyKey, JSON.stringify(key)).toMatch(UUID);
			expect(isIdempotencyKey(key), JSON.stringify(key)).toBe(false);
		}
		expect(isIdempotencyKey(KEY)).toBe(true);

		store([
			{ id: 'a', match, input: win },
			{ id: 'a', match, input: score },
			{ id: '<img>', match, input: win },
			{ id: 5, match, input: win },
		]);
		const ids = loadDraft(7).items.map((i) => i.id);
		expect(ids).toHaveLength(4);
		expect(new Set(ids).size).toBe(4);
		expect(ids[0]).toBe('a');
		for (const id of ids) expect(id).toMatch(/^[a-z0-9]+$/);
	});

	it('keeps at most 50 stored selections', () => {
		store(Array.from({ length: 60 }, (_, i) => ({ id: `s${i}`, match, input: win })));
		const draft = loadDraft(7);
		expect(draft.items).toHaveLength(50);
		expect(draft.idempotencyKey).not.toBe(KEY);
	});

	it('refreshes the match data of its selections, keeping selections and key', () => {
		const draft = addSelection(addSelection(emptyDraft(7), win, match), { ...win, partidoId: 2 }, { ...match, id: 2 });
		expect(refreshMatches(draft, new Map([[1, match]]))).toBe(draft);
		const moved = { ...match, fechaHora: '2026-10-05T01:00:00.000Z' };
		const next = refreshMatches(draft, new Map([[1, moved]]));
		expect(next.items[0]!.match).toEqual(moved);
		expect(next.items[1]).toBe(draft.items[1]);
		expect(next.idempotencyKey).toBe(draft.idempotencyKey);
		expect(next.items.map((i) => i.input)).toEqual(draft.items.map((i) => i.input));
	});
});
