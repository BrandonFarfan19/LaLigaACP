import type { BettingState, GeneralResult, SelectionInput, SelectionState, TicketState } from '../types/betting';

/** What the screens say for each code (BR-052, BR-027, BR-025). */

export const BETTING_STATE_LABEL: Record<BettingState, string> = {
	disponible: 'Disponible',
	cerrada: 'Apuestas cerradas',
	en_curso: 'En curso',
	finalizado: 'Finalizado',
	cancelado: 'Cancelado',
};

/** A longer explanation, read with the state. */
export const BETTING_STATE_HINT: Record<BettingState, string> = {
	disponible: 'Puedes apostar hasta el cierre.',
	cerrada: 'Las apuestas cerraron 24 horas antes del inicio.',
	en_curso: 'El partido ya empezó: no recibe apuestas.',
	finalizado: 'El partido terminó.',
	cancelado: 'El partido fue cancelado: sus apuestas se anularon y se devolvieron sus monedas.',
};

export const SELECTION_STATE_LABEL: Record<SelectionState, string> = {
	pendiente: 'Pendiente',
	acertada: 'Acertada',
	no_acertada: 'No acertada',
	anulada: 'Anulada',
};

export const TICKET_STATE_LABEL: Record<TicketState, string> = {
	pendiente: 'Pendiente',
	finalizado: 'Finalizado',
	anulado: 'Anulado',
};

export const BET_TYPE_LABEL = {
	resultado_general: 'Resultado general',
	marcador_exacto: 'Marcador exacto',
} as const;

export function resultLabel(result: GeneralResult, local: string, visita: string): string {
	switch (result) {
		case 'local_gana':
			return `Gana ${local}`;
		case 'visitante_gana':
			return `Gana ${visita}`;
		case 'empate':
			return 'Empate';
	}
}

type Forecast = SelectionInput | { tipo: string; pronostico: GeneralResult | null; golesLocal: number | null; golesVisitante: number | null };

/** The forecast alone, next to its bet type: "Gana Halcones", "Empate", "2 - 1". */
export function forecastValue(input: Forecast, local: string, visita: string): string {
	if (input.tipo === 'resultado_general' && 'pronostico' in input && input.pronostico) return resultLabel(input.pronostico, local, visita);
	if ('golesLocal' in input) return `${input.golesLocal} - ${input.golesVisitante}`;
	return '';
}

/** The forecast on its own, where no bet type is shown: "Gana Halcones", "Marcador 2 - 1". */
export function forecastLabel(input: Forecast, local: string, visita: string): string {
	const value = forecastValue(input, local, visita);
	return input.tipo === 'marcador_exacto' && value ? `Marcador ${value}` : value;
}

export const coinsText = (n: number) => `${n} ${Math.abs(n) === 1 ? 'moneda' : 'monedas'}`;
