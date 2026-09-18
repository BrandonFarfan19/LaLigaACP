import type { ApiPage, ApiSport, BettingMatch, BettingState, MyBet, MyBetsSummary, RankingData, RankingRow, TicketEvaluation, TicketReceipt } from '../types/betting';
import { fail, type Handler, ok, type RecordedCall } from './fetch-mock';

/** Sample API data for the betting screens' tests. */

export const futbol: ApiSport = { id: 1, nombre: 'Fútbol', slug: 'futbol', permiteEmpate: true };
export const voley: ApiSport = { id: 2, nombre: 'Vóley', slug: 'voley', permiteEmpate: false };

const team = (id: number, nombre: string, competicionId = 10) => ({
	id,
	competicionId,
	nombre,
	nombreCorto: nombre.slice(0, 3).toUpperCase(),
	escudo: 'favicon.png',
	colorAcento: '#3cf281',
});

let nextId = 100;

export function bettingMatch(overrides: { estado?: BettingState; sport?: ApiSport; local?: string; visita?: string; goles?: [number, number]; id?: number } = {}): BettingMatch {
	const estado = overrides.estado ?? 'disponible';
	const sport = overrides.sport ?? futbol;
	const id = overrides.id ?? nextId++;
	const matchState = estado === 'disponible' || estado === 'cerrada' ? 'programado' : estado;
	// A match that started (or finished) always has its kick-off — and its close —
	// in the past: `en_curso` needs `hasStarted` and `finalizado` needs `hasEnded`
	// (`lib/match-state.ts`). Only an open or closed one is still ahead (T-23).
	const started = matchState !== 'programado';
	// A score is public only with the official result: finished and both sides loaded.
	const official = matchState === 'finalizado' && overrides.goles ? overrides.goles : null;
	const fechaHora = started ? '2026-09-16T01:00:00.000Z' : '2026-10-03T01:00:00.000Z';
	const cierre = started ? '2026-09-15T01:00:00.000Z' : '2026-10-02T01:00:00.000Z';
	return {
		id,
		competicion: { id: 10, nombre: sport === voley ? 'Copa Vóley' : 'Liga', slug: 'liga' },
		deporte: sport,
		jornada: 3,
		fechaHora,
		estado: matchState,
		sede: 'Estadio Norte',
		local: { equipo: team(id * 10 + 1, overrides.local ?? 'Halcones'), goles: official ? official[0] : null },
		visita: { equipo: team(id * 10 + 2, overrides.visita ?? 'Pumas'), goles: official ? official[1] : null },
		// The API derives it from the score, and only with the official result
		// (BR-029, BR-049): a finished 2-1 comes as `local_gana`, not `null`.
		resultado: official ? (official[0] > official[1] ? 'local_gana' : official[0] === official[1] ? 'empate' : 'visitante_gana') : null,
		apuesta: {
			estado,
			cierre,
			pronosticosAdmitidos: {
				resultadoGeneral: sport.permiteEmpate ? ['local_gana', 'empate', 'visitante_gana'] : ['local_gana', 'visitante_gana'],
				marcadorExacto: { golesMinimos: 0, golesMaximos: 999, admiteEmpate: sport.permiteEmpate },
			},
		},
	};
}

export const page = <T>(items: T[]): ApiPage<T> => ({ items, page: 1, pageSize: 20, total: items.length, totalPages: items.length ? 1 : 0 });

/** The backend's own `plural` (`server/src/lib/plural.ts`), so its messages come out identical. */
const plural = (n: number, singular: string, many: string) => `${n} ${n === 1 ? singular : many}`;

/**
 * The preview the backend would give for these selections, all valid.
 *
 * Every selection carries **its match**, as the real API does: the panel
 * refreshes each match from the preview (`Apuestas.tsx`), and a preview with
 * `partido: null` left that path untested. `partidos` are the matches the test
 * has on screen; any other id gets a match built from it.
 */
export function evaluationFor(selecciones: unknown[], saldo: number, errores: Record<number, string> = {}, partidos: BettingMatch[] = []): TicketEvaluation {
	return {
		valido: Object.keys(errores).length === 0 && selecciones.length <= saldo,
		selecciones: selecciones.map((s, indice) => {
			const input = s as { partidoId: number; tipo: 'resultado_general' | 'marcador_exacto'; pronostico?: string; golesLocal?: number; golesVisitante?: number };
			return {
				indice,
				partidoId: input.partidoId,
				tipo: input.tipo,
				pronostico: (input.pronostico ?? null) as never,
				golesLocal: input.golesLocal ?? null,
				golesVisitante: input.golesVisitante ?? null,
				costo: 1,
				valida: !(indice in errores),
				// The backend's own message and its `cierre` (`services/betting.service.ts`).
				errores: indice in errores ? [{ code: 'BETTING_CLOSED', message: errores[indice]!, cierre: partidos.find((m) => m.id === input.partidoId)?.apuesta.cierre ?? '2026-10-02T01:00:00.000Z' }] : [],
				repiteA: null,
				partido: partidos.find((match) => match.id === input.partidoId) ?? bettingMatch({ id: input.partidoId }),
			};
		}),
		cantidadSelecciones: selecciones.length,
		costoPorSeleccion: 1,
		costoTotal: selecciones.length,
		saldoActual: saldo,
		saldoPosterior: saldo - selecciones.length,
		saldoSuficiente: selecciones.length <= saldo,
		// Word for word the backend's message, which the panel shows as it comes.
		errores:
			selecciones.length > saldo
				? [{ code: 'INSUFFICIENT_BALANCE', message: `El ticket cuesta ${plural(selecciones.length, 'moneda', 'monedas')} y tu saldo es de ${plural(saldo, 'moneda', 'monedas')}.` }]
				: [],
	};
}

export function receipt(id: number, userId: number, overrides: Partial<TicketReceipt> = {}): TicketReceipt {
	const match = bettingMatch({ id: 900, estado: 'finalizado', goles: [2, 1] });
	return {
		id,
		usuario: { id: userId, nombre: 'Ana' },
		creadoEn: '2026-09-18T15:30:00.000Z',
		estado: 'finalizado',
		cantidadSelecciones: 2,
		monedasUtilizadas: 2,
		monedasDevueltas: 0,
		puntosObtenidos: 3,
		selecciones: [
			{
				id: 1,
				partido: { ...match, estado: 'finalizado' },
				resultadoReal: { golesLocal: 2, golesVisitante: 1, resultado: 'local_gana' },
				tipo: 'resultado_general',
				pronostico: 'local_gana',
				golesLocal: null,
				golesVisitante: null,
				estado: 'acertada',
				costo: 1,
				puntosObtenidos: 3,
			},
			{
				id: 2,
				partido: { ...match, estado: 'finalizado' },
				resultadoReal: { golesLocal: 2, golesVisitante: 1, resultado: 'local_gana' },
				tipo: 'marcador_exacto',
				pronostico: null,
				golesLocal: 1,
				golesVisitante: 1,
				estado: 'no_acertada',
				costo: 1,
				puntosObtenidos: 0,
			},
		],
		...overrides,
	};
}

/**
 * A fake API by "METHOD /path" (no query). Unlisted requests answer 404, so
 * a test notices an unexpected call.
 */
export function apiRoutes(handlers: Record<string, Handler>): Handler {
	return (call: RecordedCall) => {
		const path = call.url.split('?')[0];
		const handler = handlers[`${call.method} ${path}`];
		return handler ? handler(call) : fail(404, 'NOT_FOUND', `sin simular: ${call.method} ${path}`);
	};
}

export { ok };

let nextSelection = 1000;

/** A row of "Mis apuestas": a selection with its ticket's totals. */
export function myBet(ticketId: number, overrides: Partial<MyBet> = {}, ticket: Partial<MyBet['ticket']> = {}): MyBet {
	const match = bettingMatch({ id: 900 + ticketId, estado: 'finalizado', goles: [2, 1] });
	return {
		id: nextSelection++,
		partido: { ...match, estado: 'finalizado' },
		resultadoReal: { golesLocal: 2, golesVisitante: 1, resultado: 'local_gana' },
		tipo: 'resultado_general',
		pronostico: 'local_gana',
		golesLocal: null,
		golesVisitante: null,
		estado: 'acertada',
		costo: 1,
		puntosObtenidos: 3,
		...overrides,
		ticket: {
			id: ticketId,
			creadoEn: '2026-09-18T15:30:00.000Z',
			estado: 'finalizado',
			cantidadSelecciones: 1,
			monedasUtilizadas: 1,
			monedasDevueltas: 0,
			puntosObtenidos: 3,
			...ticket,
		},
	};
}

export function summaryOf(overrides: Partial<MyBetsSummary> = {}): MyBetsSummary {
	return {
		tickets: { total: 3, pendiente: 1, finalizado: 1, anulado: 1 },
		selecciones: { total: 5, pendiente: 1, acertada: 2, no_acertada: 1, anulada: 1 },
		monedasUtilizadas: 5,
		monedasDevueltas: 1,
		puntos: 4,
		aciertos: 2,
		...overrides,
	};
}

export const rankingRow = (posicion: number, nombre: string, puntos: number, aciertos: number, esPropia = false): RankingRow => ({
	posicion,
	participante: { nombre },
	puntos,
	aciertos,
	esPropia,
});

export function rankingOf(top: RankingRow[], overrides: Partial<RankingData> = {}): RankingData {
	return { top, topSinMostrar: 0, propia: null, participantes: top.length, posicionesTop: 10, maxFilasTop: 50, ...overrides };
}
