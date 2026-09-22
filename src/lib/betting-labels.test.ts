import { describe, expect, it } from 'vitest';
import { coinsText, forecastLabel, forecastValue } from './betting-labels';

describe('betting labels', () => {
	it('coins in singular or plural, negative balances included', () => {
		expect([-2, -1, 0, 1, 2, 10].map(coinsText)).toEqual(['-2 monedas', '-1 moneda', '0 monedas', '1 moneda', '2 monedas', '10 monedas']);
	});

	it('a forecast alone, or with "Marcador" where no bet type is shown', () => {
		const score = { partidoId: 1, tipo: 'marcador_exacto', golesLocal: 3, golesVisitante: 1 } as const;
		const win = { partidoId: 1, tipo: 'resultado_general', pronostico: 'visitante_gana' } as const;
		expect(forecastValue(score, 'A', 'B')).toBe('3 - 1');
		expect(forecastLabel(score, 'A', 'B')).toBe('Marcador 3 - 1');
		expect(forecastValue(win, 'A', 'B')).toBe('Gana B');
		expect(forecastLabel(win, 'A', 'B')).toBe('Gana B');
	});
});
