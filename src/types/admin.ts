/**
 * Contracts of the admin API (`/admin`, server/README.md: T-04 to T-17 and
 * the T-21 bets query) as the panel reads them. Dates are ISO 8601 text in
 * UTC; codes are the backend's catalog codes.
 */
import type { AuthUser } from './api';
import type { GeneralResult, MatchState, MyBet, SelectionState, TicketState } from './betting';

export type { ApiPage } from './betting';

/** A row of `GET /admin/participantes` (BR-007): the account plus its points. */
export interface AdminParticipant extends AuthUser {
	puntos: number;
}

/** `GET /admin/participantes/conteos` (BR-001): participants only. */
export interface ParticipantCounts {
	inscritos: number;
	validados: number;
	pendientes: number;
	pagosConfirmados: number;
	pagosPendientes: number;
}

export type ParticipantAction = 'confirmar_pago' | 'revertir_pago' | 'validar';

export interface AdminSport {
	id: number;
	nombre: string;
	slug: string;
	permiteEmpate: boolean;
}

export interface AdminCompetition {
	id: number;
	deporteId: number;
	/** Joined by the API (T-21 fix), so a row shows its sport without another list. */
	deporteNombre: string;
	nombre: string;
	slug: string;
}

export interface AdminTeam {
	id: number;
	competicionId: number;
	/** Joined by the API (T-21 fix), so a row shows where it plays without another list. */
	competicionNombre: string;
	deporteNombre: string;
	nombre: string;
	nombreCorto: string;
	/** An `https://` URL or a relative image path. Shown only with `<img>`. */
	escudo: string;
	/** `#rrggbb`. */
	colorAcento: string;
}

export interface AdminPlayer {
	id: number;
	nombre: string;
	/** Same format as a crest, or `null`. */
	foto: string | null;
}

export interface AdminEnrollment {
	id: number;
	jugadorId: number;
	jugadorNombre: string;
	equipoId: number;
	/** Joined by the API (T-21 fix), so a row never depends on a list of options. */
	equipoNombre: string;
	competicionId: number;
	competicionNombre: string;
	deporteNombre: string;
	numeroCamiseta: number;
}

export interface AdminMatchSide {
	equipoId: number;
	nombre: string;
	/** The loaded score (private until confirmed), or `null`. */
	goles: number | null;
}

/** A match of `/admin/partidos` (T-07). `estado` is the effective one (BR-012). */
export interface AdminMatch {
	id: number;
	competicionId: number;
	/** Joined by the API (T-21 fix), so a row never depends on a list of options. */
	competicionNombre: string;
	deporteId: number;
	deporteNombre: string;
	estado: MatchState;
	jornada: number;
	fechaHora: string;
	/** `fechaHora − 24 h` (BR-014). */
	cierreApuestas: string;
	sede: string;
	local: AdminMatchSide;
	visita: AdminMatchSide;
}

export interface Problem {
	code: string;
	message: string;
}

export interface ScoredGoal {
	id: number;
	minuto: number;
	equipoId: number;
	jugador: { id: number; nombre: string };
}

/**
 * The official result of a match (BR-029): the confirmed score and the code
 * derived from it. It is what `POST .../resultado/confirmar` answers beside
 * the match (`ConfirmedResult` in the backend).
 */
export interface OfficialResult {
	golesLocal: number;
	golesVisitante: number;
	resultado: GeneralResult;
}

/** `GET /admin/partidos/:id/resultado` (BR-030). */
export interface ResultPreview {
	partido: AdminMatch;
	competicion: { id: number; nombre: string };
	deporte: { id: number; nombre: string; permiteEmpate: boolean };
	marcador: { golesLocal: number; golesVisitante: number } | null;
	resultado: GeneralResult | null;
	ganador: { equipoId: number; nombre: string } | null;
	goles: ScoredGoal[];
	seleccionesPendientes: number;
	confirmableDesde: string;
	puedeConfirmar: boolean;
	problemas: Problem[];
	avisos: Problem[];
	advertencia: string;
}

/** A normalized video link (T-13). Only `embedUrl` may go into a player. */
export interface VideoLink {
	plataforma: 'youtube' | 'vimeo';
	id: string;
	url: string;
	embedUrl: string;
}

/** A goal with its scorer and media (T-13, BR-033). */
export interface AdminGoal {
	id: number;
	partidoId: number;
	minuto: number;
	equipoId: number;
	lado: 'local' | 'visita';
	plantelId: number;
	jugador: { id: number; nombre: string };
	/** `/admin/archivos/...`, or `null`. */
	imagen: string | null;
	video: VideoLink | null;
}

export interface MatchImage {
	id: number;
	tipo: 'imagen';
	/** `/admin/archivos/...`. */
	url: string;
	creadoEn: string;
}

export interface MatchVideo {
	id: number;
	tipo: 'video';
	video: VideoLink;
	creadoEn: string;
}

/** `GET /admin/partidos/:id/multimedia`. */
export interface MatchMedia {
	imagenes: MatchImage[];
	videos: MatchVideo[];
}

export interface CancellationFigures {
	selecciones: number;
	monedasDevueltas: number;
	/** D-002: voided without a refund, and why. */
	seleccionesSinDevolucion: { total: number; sinDebito: number; cuentaAdministrador: number };
	usuarios: number;
	tickets: number;
	ticketsAnulados: number;
}

/** `GET /admin/partidos/:id/cancelacion` (BR-045). */
export interface CancellationPreview extends CancellationFigures {
	partido: AdminMatch;
	puedeCancelar: boolean;
	problemas: Problem[];
	advertencia: string;
}

/** A row of `GET /admin/polla/apuestas` (T-21): a selection, its ticket and who placed it. */
export interface AdminBet extends MyBet {
	usuario: { id: number; nombre: string };
}

/** A row of `GET /admin/polla/ranking` (BR-042): with the participant's id. */
export interface AdminRankingRow {
	posicion: number;
	/** How many share that position in the whole ranking (T-21 fix: a page can't tell). */
	empatados: number;
	participante: { id: number; nombre: string };
	puntos: number;
	aciertos: number;
}

/** `GET /admin/polla/estadisticas` (BR-001): participants only. */
export interface PoolStats {
	participantes: { inscritos: number; validados: number; pendientes: number };
	tickets: { total: number } & Record<TicketState, number>;
	selecciones: { total: number } & Record<SelectionState, number>;
	monedasUtilizadas: number;
	monedasDevueltas: number;
	monedasDisponibles: number;
	puntos: number;
	aciertos: number;
}

/** A row of `GET /admin/auditoria` (NFR-006). */
export interface AuditRecord {
	id: number;
	fecha: string;
	accion: { codigo: string; nombre: string };
	entidad: string;
	entidadId: number;
	administrador: { id: number; nombre: string };
	detalle: Record<string, unknown> | null;
}
