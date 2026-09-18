/**
 * Contracts of the betting API (`/apuestas`, server/README.md: T-09 to T-11)
 * and of the public match card it embeds (T-08). Dates are ISO 8601 text in
 * UTC. Codes are the backend's catalog codes.
 */

/** A page of a paginated list. */
export interface ApiPage<T> {
	items: T[];
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
}

export interface ApiSport {
	id: number;
	nombre: string;
	slug: string;
	permiteEmpate: boolean;
}

export interface ApiTeam {
	id: number;
	competicionId: number;
	nombre: string;
	nombreCorto: string;
	/** An `https://` URL or a path relative to the site root. Shown only with `<img>`. */
	escudo: string;
	colorAcento: string;
}

/** BR-012, the effective state: a `programado` match whose kick-off came is `en_curso`. */
export type MatchState = 'programado' | 'en_curso' | 'finalizado' | 'cancelado';

/** BR-029. */
export type GeneralResult = 'local_gana' | 'empate' | 'visitante_gana';

/** BR-015, BR-016. */
export type BetType = 'resultado_general' | 'marcador_exacto';

/** BR-052: only `disponible` takes bets. */
export type BettingState = 'disponible' | 'cerrada' | 'en_curso' | 'finalizado' | 'cancelado';

/** BR-027. */
export type SelectionState = 'pendiente' | 'acertada' | 'no_acertada' | 'anulada';

/** BR-025, derived from the selections. */
export type TicketState = 'pendiente' | 'finalizado' | 'anulado';

export interface ApiMatch {
	id: number;
	competicion: { id: number; nombre: string; slug: string };
	deporte: ApiSport;
	jornada: number;
	/** Kick-off, UTC. */
	fechaHora: string;
	estado: MatchState;
	sede: string;
	/** `goles` only once the result is official (finished, both sides loaded). */
	local: { equipo: ApiTeam; goles: number | null };
	visita: { equipo: ApiTeam; goles: number | null };
	resultado: GeneralResult | null;
}

export interface BettingInfo {
	estado: BettingState;
	/** When bets close (kick-off − 24 h, BR-014), UTC. */
	cierre: string;
	pronosticosAdmitidos: {
		resultadoGeneral: GeneralResult[];
		marcadorExacto: { golesMinimos: number; golesMaximos: number; admiteEmpate: boolean };
	};
}

/** An item of `GET /apuestas/partidos`. */
export interface BettingMatch extends ApiMatch {
	apuesta: BettingInfo;
}

/** One selection as sent to the preview and the confirmation. */
export type SelectionInput =
	| { partidoId: number; tipo: 'resultado_general'; pronostico: GeneralResult }
	| { partidoId: number; tipo: 'marcador_exacto'; golesLocal: number; golesVisitante: number };

export interface SelectionProblem {
	code: string;
	message: string;
	/** `BETTING_CLOSED` only, UTC. */
	cierre?: string;
}

export interface EvaluatedSelection {
	/** Position in the request, from 0. */
	indice: number;
	partidoId: number;
	tipo: BetType;
	pronostico: GeneralResult | null;
	golesLocal: number | null;
	golesVisitante: number | null;
	costo: number;
	valida: boolean;
	errores: SelectionProblem[];
	/** Index of an earlier identical selection, or `null`. */
	repiteA: number | null;
	partido: BettingMatch | null;
}

/** `POST /apuestas/vista-previa` (BR-023), and the `details` of a 409 `TICKET_REJECTED`. */
export interface TicketEvaluation {
	valido: boolean;
	selecciones: EvaluatedSelection[];
	cantidadSelecciones: number;
	costoPorSeleccion: number;
	costoTotal: number;
	saldoActual: number;
	saldoPosterior: number;
	saldoSuficiente: boolean;
	errores: SelectionProblem[];
}

export interface OfficialResult {
	golesLocal: number;
	golesVisitante: number;
	resultado: GeneralResult;
}

export interface TicketSelection {
	id: number;
	partido: ApiMatch;
	resultadoReal: OfficialResult | null;
	tipo: BetType;
	pronostico: GeneralResult | null;
	golesLocal: number | null;
	golesVisitante: number | null;
	estado: SelectionState;
	costo: number;
	puntosObtenidos: number | null;
}

/** `GET /apuestas/tickets/:id` and the confirmation's answer (BR-025). */
export interface TicketReceipt {
	id: number;
	usuario: { id: number; nombre: string };
	creadoEn: string;
	estado: TicketState;
	cantidadSelecciones: number;
	monedasUtilizadas: number;
	monedasDevueltas: number;
	puntosObtenidos: number;
	selecciones: TicketSelection[];
}

/** A competition of the public catalog (T-08), for the "Mis apuestas" filter. */
export interface ApiCompetition {
	id: number;
	nombre: string;
	slug: string;
	deporte: ApiSport;
}

/** A ticket's figures, computed by the backend on every read (BR-025). */
export interface TicketTotals {
	estado: TicketState;
	cantidadSelecciones: number;
	monedasUtilizadas: number;
	/** D-003: the coins really refunded. */
	monedasDevueltas: number;
	puntosObtenidos: number;
}

/** A row of `GET /apuestas/mis-apuestas` (BR-026): a selection with its ticket's totals. */
export interface MyBet extends TicketSelection {
	ticket: { id: number; creadoEn: string } & TicketTotals;
}

/** `GET /apuestas/mis-apuestas/resumen`. */
export interface MyBetsSummary {
	tickets: { total: number } & Record<TicketState, number>;
	selecciones: { total: number } & Record<SelectionState, number>;
	monedasUtilizadas: number;
	monedasDevueltas: number;
	puntos: number;
	/** Selections in state `acertada`, of any type (BR-042). */
	aciertos: number;
}

/** A row of `GET /ranking` (BR-042): only the display name, never an id or an email. */
export interface RankingRow {
	/** Shared by a full tie, and the next one skips (1, 1, 3; BR-043). */
	posicion: number;
	participante: { nombre: string };
	puntos: number;
	aciertos: number;
	esPropia: boolean;
}

/** `GET /ranking` (BR-041 to BR-044). */
export interface RankingData {
	/** Every position from 1 to `posicionesTop`, at most `maxFilasTop` rows. */
	top: RankingRow[];
	/** Tied participants of the top left out by the row cap. */
	topSinMostrar: number;
	/** The caller's row, or `null` for an admin or a pending participant. */
	propia: (RankingRow & { enTop: boolean; enLista: boolean }) | null;
	participantes: number;
	posicionesTop: number;
	maxFilasTop: number;
}
