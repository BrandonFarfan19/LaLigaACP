import type {
	AdminBet,
	AdminParticipant,
	AdminRankingRow,
	ApiPage,
	AuditRecord,
	ParticipantAction,
	ParticipantCounts,
	PoolStats,
} from '../types/admin';
import { api } from './api';
import { ADMIN_PAGE_SIZE, apiQuery, type FilterSpec, type FilterValues } from './admin-core';
import { SELECTION_STATES, TICKET_STATES } from './bet-history';

/**
 * The pool as the admin sees it (T-21): participants and their validation
 * (T-04, BR-006, BR-007), the bets placed, the full ranking and the pool's
 * figures (T-15), and the audit log (T-17). Participants only: the backend
 * never lists admins in any of them (BR-001).
 */

/* ---- Participants ------------------------------------------------------ */

export const PARTICIPANT_FILTERS: FilterSpec = {
	q: { kind: 'text' },
	estadoPago: { kind: 'enum', values: ['pendiente', 'confirmado'] },
	estadoValidacion: { kind: 'enum', values: ['pendiente', 'validado'] },
	orden: { kind: 'enum', values: ['asc', 'desc'] },
};

export const listParticipants = (filters: FilterValues, signal?: AbortSignal) =>
	api.get<ApiPage<AdminParticipant>>('/admin/participantes', { signal, query: apiQuery(filters) });

export const countParticipants = (signal?: AbortSignal) => api.get<ParticipantCounts>('/admin/participantes/conteos', { signal });

const ACTION_PATHS: Record<ParticipantAction, string> = {
	confirmar_pago: 'pago/confirmar',
	revertir_pago: 'pago/revertir',
	validar: 'validar',
};

/** BR-006: confirm the payment, revert it (only while pending) or validate (+10 coins, once). */
export const participantAction = (id: number, action: ParticipantAction) =>
	api.post<{ participante: AdminParticipant }>(`/admin/participantes/${id}/${ACTION_PATHS[action]}`);

/* ---- Bets placed (T-21, BR-001) ---------------------------------------- */

export const BET_FILTERS: FilterSpec = {
	usuarioId: { kind: 'id' },
	partidoId: { kind: 'id' },
	ticketId: { kind: 'id' },
	estado: { kind: 'enum', values: SELECTION_STATES },
	estadoTicket: { kind: 'enum', values: TICKET_STATES },
	deporteId: { kind: 'id' },
	desde: { kind: 'day' },
	hasta: { kind: 'day' },
};

/** Newest ticket first, one row per selection. */
export const listAdminBets = (filters: FilterValues, signal?: AbortSignal) =>
	api.get<ApiPage<AdminBet>>('/admin/polla/apuestas', { signal, query: apiQuery(filters) });

/* ---- Ranking and figures (T-15) ---------------------------------------- */

export const listAdminRanking = (page: number, signal?: AbortSignal) =>
	api.get<ApiPage<AdminRankingRow>>('/admin/polla/ranking', { signal, query: { page, pageSize: ADMIN_PAGE_SIZE } });

export const getPoolStats = (signal?: AbortSignal) => api.get<PoolStats>('/admin/polla/estadisticas', { signal });

/* ---- Audit (T-17, NFR-006) --------------------------------------------- */

/** `accion_auditoria` (02-catalogos.sql): code and visible name, in the catalog's order. */
export const AUDIT_ACTIONS: ReadonlyArray<readonly [string, string]> = [
	['validacion_usuario', 'Validación de usuario'],
	['confirmacion_pago', 'Confirmación de pago'],
	['reversion_pago', 'Reversión de pago'],
	['creacion_administrador', 'Creación de administrador'],
	['promocion_administrador', 'Promoción a administrador'],
	['alta_partido', 'Alta de partido'],
	['modificacion_partido', 'Modificación de partido'],
	['borrado_partido', 'Borrado de partido'],
	['registro_resultado', 'Registro de resultado'],
	['confirmacion_resultado', 'Confirmación definitiva de resultado'],
	['cancelacion_partido', 'Cancelación de partido'],
	['alta_deporte', 'Alta de deporte'],
	['modificacion_deporte', 'Modificación de deporte'],
	['borrado_deporte', 'Borrado de deporte'],
	['alta_competicion', 'Alta de competición'],
	['modificacion_competicion', 'Modificación de competición'],
	['borrado_competicion', 'Borrado de competición'],
	['alta_equipo', 'Alta de equipo'],
	['modificacion_equipo', 'Modificación de equipo'],
	['borrado_equipo', 'Borrado de equipo'],
	['alta_jugador', 'Alta de jugador'],
	['modificacion_jugador', 'Modificación de jugador'],
	['borrado_jugador', 'Borrado de jugador'],
	['alta_plantel', 'Inscripción en plantel'],
	['modificacion_plantel', 'Modificación de inscripción'],
	['borrado_plantel', 'Baja de inscripción'],
	['alta_gol', 'Registro de gol'],
	['modificacion_gol', 'Modificación de gol'],
	['borrado_gol', 'Borrado de gol'],
	['alta_multimedia', 'Alta de multimedia del partido'],
	['borrado_multimedia', 'Borrado de multimedia del partido'],
];

/** The tables an audit record can point at, with their visible names. */
export const AUDIT_ENTITIES: ReadonlyArray<readonly [string, string]> = [
	['usuario', 'Usuario'],
	['partido', 'Partido'],
	['deporte', 'Deporte'],
	['competicion', 'Competición'],
	['equipo', 'Equipo'],
	['jugador', 'Jugador'],
	['plantel', 'Inscripción'],
	['gol', 'Gol'],
	['multimedia_partido', 'Multimedia'],
];

export const AUDIT_FILTERS: FilterSpec = {
	accion: { kind: 'enum', values: AUDIT_ACTIONS.map(([code]) => code) },
	entidad: { kind: 'enum', values: AUDIT_ENTITIES.map(([code]) => code) },
	entidadId: { kind: 'id' },
	usuarioId: { kind: 'id' },
	desde: { kind: 'day' },
	hasta: { kind: 'day' },
};

/** `entidadId` needs `entidad` (the backend refuses it alone): it is dropped with a notice. */
export const listAudit = (filters: FilterValues, signal?: AbortSignal) =>
	api.get<ApiPage<AuditRecord>>('/admin/auditoria', { signal, query: apiQuery(filters) });

/** Visible names of the fields the audit detail carries. */
const FIELD_NAMES: Record<string, string> = {
	nombre: 'Nombre',
	slug: 'Slug',
	permiteEmpate: 'Admite empate',
	deporteId: 'Deporte',
	competicionId: 'Competición',
	nombreCorto: 'Nombre corto',
	escudo: 'Escudo',
	colorAcento: 'Color',
	foto: 'Foto',
	jugadorId: 'Jugador',
	equipoId: 'Equipo',
	plantelId: 'Inscripción',
	numeroCamiseta: 'Camiseta',
	estado: 'Estado',
	jornada: 'Jornada',
	fechaHora: 'Fecha y hora',
	sede: 'Sede',
	local: 'Local',
	visita: 'Visita',
	goles: 'Goles',
	minuto: 'Minuto',
	imagen: 'Imagen',
	video: 'Video',
	estadoPago: 'Pago',
	estadoValidacion: 'Validación',
	monedas: 'Monedas',
	marcador: 'Marcador',
	anterior: 'Antes',
	golesLocal: 'Goles local',
	golesVisitante: 'Goles visita',
	selecciones: 'Selecciones anuladas',
	monedasDevueltas: 'Monedas devueltas',
	usuarios: 'Usuarios',
	tickets: 'Tickets',
	ticketsAnulados: 'Tickets anulados',
	estadoAnterior: 'Estado anterior',
	origen: 'Origen',
	operacion: 'Operación',
	monedasAsignadas: 'Monedas asignadas',
	movimientoId: 'Movimiento',
	seleccionesSinDevolucion: 'Anuladas sin devolución',
	sinDebito: 'Sin descuento',
	cuentaAdministrador: 'De una cuenta admin',
	total: 'Total',
	id: 'Id',
	partidoId: 'Partido',
	creadoEn: 'Fecha',
	cierreApuestas: 'Cierre de apuestas',
};

export const fieldName = (key: string) => FIELD_NAMES[key] ?? key;

/** A detail value as text: dates in league time are left to the screen; objects as `clave: valor`. */
export function detailText(value: unknown): string {
	if (value === null || value === undefined) return '—';
	if (typeof value === 'boolean') return value ? 'sí' : 'no';
	if (typeof value === 'string' || typeof value === 'number') return String(value);
	if (Array.isArray(value)) return value.map(detailText).join(', ');
	if (typeof value === 'object') {
		return Object.entries(value as Record<string, unknown>)
			.map(([key, inner]) => `${fieldName(key)}: ${detailText(inner)}`)
			.join(' · ');
	}
	return String(value);
}
