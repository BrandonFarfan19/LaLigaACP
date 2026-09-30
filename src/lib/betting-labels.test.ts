import { describe, expect, it } from 'vitest';
import { BETTING_STATE_HINT, closeLeadNote, forecastLabel, forecastValue } from './betting-labels';

describe('betting labels', () => {
	it('C-13: no state hint talks about coins', () => {
		for (const hint of Object.values(BETTING_STATE_HINT)) expect(hint).not.toMatch(/moneda/i);
	});

	it('a forecast alone, or with "Marcador" where no bet type is shown', () => {
		const score = { partidoId: 1, tipo: 'marcador_exacto', golesLocal: 3, golesVisitante: 1 } as const;
		const win = { partidoId: 1, tipo: 'resultado_general', pronostico: 'visitante_gana' } as const;
		expect(forecastValue(score, 'A', 'B')).toBe('3 - 1');
		expect(forecastLabel(score, 'A', 'B')).toBe('Marcador 3 - 1');
		expect(forecastValue(win, 'A', 'B')).toBe('Gana B');
		expect(forecastLabel(win, 'A', 'B')).toBe('Gana B');
	});

	it('C-12: the close lead time comes from the API dates, never a fixed number', () => {
		const kickoff = '2026-10-01T20:00:00.000Z';
		expect(closeLeadNote(kickoff, '2026-10-01T19:00:00.000Z')).toBe('1 hora antes del inicio.');
		expect(closeLeadNote(kickoff, '2026-09-30T20:00:00.000Z')).toBe('24 horas antes del inicio.');
		expect(closeLeadNote(kickoff, '2026-10-01T19:30:00.000Z')).toBe('30 minutos antes del inicio.');
		expect(closeLeadNote(kickoff, kickoff)).toBeUndefined();
		expect(closeLeadNote(kickoff, 'x')).toBeUndefined();
	});

	it('C-12: no state hint repeats the close lead time', () => {
		for (const hint of Object.values(BETTING_STATE_HINT)) expect(hint).not.toMatch(/\d+ horas?/);
	});
});
