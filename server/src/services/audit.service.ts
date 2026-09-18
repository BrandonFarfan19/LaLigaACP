import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { withReadSnapshot } from '../db/transaction.js';
import { MONEDAS_POR_VALIDACION } from '../lib/coins.js';
import { accionAuditada, cambios, type DetalleAuditoria, detalleAcotado } from '../lib/audit.js';
import type { ListAuditQuery } from '../schemas/audit.schema.js';
import { type Page, toPage } from '../schemas/common.schema.js';
import type { AdminActionHooks, AdminActionOutcome } from './admin-action.js';
import { Where } from './catalog-query.js';
import type { ParticipantActionHooks, ParticipantActionOutcome } from './participant-validation.service.js';

/**
 * Módulo Auditoría, T-17 (NFR-006): one `auditoria` row per relevant admin
 * action, with the admin, the action, the UTC date and time, the affected row
 * and a short JSON detail. The rows are only ever inserted: no route updates
 * or deletes them.
 *
 * The insert runs in the action's own transaction, from its
 * `hooks.inTransaction` (`runAdminAction`, the participant actions, the
 * result confirmation, the cancellation). So:
 * - an action that fails or is refused leaves no record, and a failed insert
 *   rolls the action back;
 * - a deadlock retry runs the hook again, but the attempt it replaces was
 *   rolled back with its record: exactly one row remains;
 * - it only touches the database (no logs, no files, no calls out).
 *
 * Locks: two plain reads (no locks) and one INSERT. The INSERT's foreign keys
 * take a shared lock on the admin's `usuario` row and on the catalog row;
 * nothing takes an exclusive lock on an admin's row (the cancellation only
 * locks `apostador` accounts, D-002) nor on the catalog, so it can't close a
 * cycle. It never touches tickets (plan, T-14 note).
 *
 * Integrity (EsquemaBD: `entidad_id` has no FK): the author must be an admin
 * today, the action must map to a catalog code with the expected entity, and
 * the affected row must exist unless the action deleted it. Otherwise it
 * throws `AuditError` (a 500) and the action is rolled back. A deleted row
 * keeps its records (nothing cascades).
 */

export class AuditError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AuditError';
	}
}

export interface AuditEntry {
	actorId: number;
	/** The app action (`crear_partido`, `validar`...). */
	action: string;
	entityId: number;
	detail: DetalleAuditoria;
}

/** UTC, whole seconds (the column is `DATETIME`). */
const nowUtc = () => new Date(Math.floor(Date.now() / 1000) * 1000);

export async function recordAudit(conn: PoolConnection, entry: AuditEntry): Promise<void> {
	const rule = accionAuditada(entry.action);
	if (!rule) throw new AuditError(`La acción ${entry.action} no tiene código de auditoría (lib/audit.ts).`);
	if (!Number.isSafeInteger(entry.entityId) || entry.entityId < 1) throw new AuditError(`entidad_id inválido: ${entry.entityId}.`);

	const [[row]] = await conn.query<RowDataPacket[]>(
		`SELECT a.id, a.entidad,
			(SELECT r.codigo FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.id = ?) AS rol
		FROM accion_auditoria a WHERE a.codigo = ?`,
		[entry.actorId, rule.codigo],
	);
	if (!row) throw new AuditError(`Falta la acción ${rule.codigo} en accion_auditoria (¿se cargó 02-catalogos.sql?).`);
	if (row.entidad !== rule.entidad) {
		throw new AuditError(`La acción ${rule.codigo} afecta a ${String(row.entidad)} en el catálogo, no a ${rule.entidad}.`);
	}
	if (row.rol !== 'admin') throw new AuditError(`Solo un administrador queda como autor de ${rule.codigo} (usuario ${entry.actorId}).`);
	if (!rule.borra) {
		// The table name comes from the fixed list in lib/audit.ts, never from input.
		const [[target]] = await conn.query<RowDataPacket[]>(`SELECT id FROM \`${rule.entidad}\` WHERE id = ?`, [entry.entityId]);
		if (!target) throw new AuditError(`No existe ${rule.entidad} ${entry.entityId} para auditar ${rule.codigo}.`);
	}

	await conn.query('INSERT INTO auditoria (usuario_id, accion_id, entidad_id, creado_en, detalle) VALUES (?, ?, ?, ?, CAST(? AS JSON))', [
		entry.actorId,
		row.id,
		entry.entityId,
		nowUtc(),
		JSON.stringify(detalleAcotado(entry.detail)),
	]);
}

interface ScoreCarrier {
	estado?: unknown;
	local?: { goles?: number | null };
	visita?: { goles?: number | null };
}

const marcador = (match: unknown) => {
	const m = (match ?? {}) as ScoreCarrier;
	return { golesLocal: m.local?.goles ?? null, golesVisitante: m.visita?.goles ?? null };
};

type Row = Record<string, unknown>;

const side = (value: unknown) => {
	const s = (value ?? {}) as { equipoId?: unknown; goles?: unknown };
	return { equipoId: s.equipoId ?? null, goles: s.goles ?? null };
};

const videoUrl = (value: unknown) => ((value as { url?: unknown } | null)?.url ?? null);

/**
 * Only the fields each row stores (second fix of T-17): no calculated or
 * joined values such as a match's `cierreApuestas` (fechaHora − 24 h), its
 * `deporteId` or team names, a goal's `lado` or player name, or a video's
 * `embedUrl`. A match's `estado` is the effective one (BR-012); in every
 * snapshot that is recorded (created, edited, deleted) it can't differ from
 * the stored one in a way that shows up. Images keep their API path, the
 * stored file name's only form outside the server. A competition, a team and
 * an enrollment carry their joined names since T-21 (the panel's lists show
 * them without a list of options): those go out too. A sport and a player
 * already are their stored columns.
 */
export function soloGuardados(entity: AdminActionOutcome['entity'], row: unknown): unknown {
	if (!row || typeof row !== 'object') return row ?? null;
	const r = row as Row;
	switch (entity) {
		case 'partido':
			return {
				id: r.id,
				competicionId: r.competicionId,
				estado: r.estado,
				jornada: r.jornada,
				fechaHora: r.fechaHora,
				sede: r.sede,
				local: side(r.local),
				visita: side(r.visita),
			};
		case 'gol':
			return {
				id: r.id,
				partidoId: r.partidoId,
				equipoId: r.equipoId,
				plantelId: r.plantelId,
				minuto: r.minuto,
				imagen: r.imagen ?? null,
				video: videoUrl(r.video),
			};
		case 'multimedia':
			return { id: r.id, imagen: r.url ?? null, video: videoUrl(r.video), creadoEn: r.creadoEn };
		// Joined names (T-21): shown in lists, never a stored column of the row.
		case 'plantel':
		case 'competicion':
		case 'equipo': {
			const { jugadorNombre: _jugador, equipoNombre: _equipo, competicionNombre: _competicion, deporteNombre: _deporte, ...stored } = r;
			return stored;
		}
		default:
			return row;
	}
}

/**
 * What each catalog, match, goal or media action records besides its id, or
 * `null` when there is nothing to record: an edit that changed no field, or
 * a score registered again with the same values (D-004 in
 * `docs/decisiones.md`). Nothing calculated: a confirmation records the
 * score, not the derived result (BR-029: never stored).
 */
export function detailOf(outcome: AdminActionOutcome): DetalleAuditoria | null {
	const { action, entity, detail = {} } = outcome;
	const before = soloGuardados(entity, outcome.before);
	const after = soloGuardados(entity, outcome.after);
	const extra = Object.keys(detail).length > 0;
	switch (action) {
		case 'registrar_resultado_partido': {
			const nuevo = marcador(after);
			const anterior = marcador(before);
			if (!extra && nuevo.golesLocal === anterior.golesLocal && nuevo.golesVisitante === anterior.golesVisitante) return null;
			return { marcador: nuevo, anterior, ...detail };
		}
		case 'confirmar_resultado_partido':
			return { marcador: marcador(after), ...detail };
		case 'cancelar_partido':
			return { estadoAnterior: (before as ScoreCarrier | null)?.estado ?? null, ...detail };
	}
	if (action.startsWith('crear_')) return { nuevo: after, ...detail };
	if (action.startsWith('borrar_')) return { anterior: before, ...detail };
	const changed = cambios(before, after);
	if (action.startsWith('editar_') && Object.keys(changed).length === 0 && !extra) return null;
	return { cambios: changed, ...detail };
}

/** The audit hook for every `runAdminAction` write (catalog, matches, results, goals, media, cancellation). */
export const auditHooks: AdminActionHooks = {
	inTransaction: async (conn, outcome) => {
		const detail = detailOf(outcome);
		if (detail) await recordAudit(conn, { actorId: outcome.actorId, action: outcome.action, entityId: outcome.id, detail });
	},
};

/** What each participant action changed (T-04). No personal data: the participant is `entidad_id`. */
function participantDetail(outcome: ParticipantActionOutcome): DetalleAuditoria {
	switch (outcome.action) {
		case 'confirmar_pago':
			return { estadoPago: { antes: 'pendiente', despues: 'confirmado' } };
		case 'revertir_pago':
			return { estadoPago: { antes: 'confirmado', despues: 'pendiente' } };
		case 'validar':
			return {
				estadoValidacion: { antes: 'pendiente', despues: 'validado' },
				monedasAsignadas: MONEDAS_POR_VALIDACION,
				movimientoId: outcome.movimientoId ?? null,
			};
	}
}

/** The audit hook of the participant actions (confirm or revert a payment, validate). */
export const participantAuditHooks: ParticipantActionHooks = {
	inTransaction: (conn, outcome) =>
		recordAudit(conn, {
			actorId: outcome.actorId,
			action: outcome.action,
			entityId: outcome.participant.id,
			detail: participantDetail(outcome),
		}),
};

export interface AuditRecord {
	id: number;
	/** UTC. */
	fecha: Date;
	accion: { codigo: string; nombre: string };
	entidad: string;
	entidadId: number;
	/** Only the id and the display name: the log doesn't need the admin's email. */
	administrador: { id: number; nombre: string };
	detalle: DetalleAuditoria | null;
}

/** The index that serves the newest-first order (`creado_en DESC, id DESC`, read backwards). */
export const AUDIT_ORDER_INDEX = 'idx_auditoria_fecha';

const ORDER = 'au.creado_en DESC, au.id DESC';

/**
 * The page of ids (step 2 of `listAudit`). With no filter, or only dates, the
 * hint keeps it on `idx_auditoria_fecha` read backwards, with no sort.
 * Exported so a test can check its plan.
 */
export function auditPageSql(whereSql: string, byDateOnly: boolean): string {
	const hint = byDateOnly ? `/*+ INDEX(au ${AUDIT_ORDER_INDEX}) */ ` : '';
	return `SELECT ${hint}au.id FROM auditoria au ${whereSql} ORDER BY ${ORDER} LIMIT ? OFFSET ?`;
}

/**
 * `GET /admin/auditoria`: newest first, filtered. In one read-only snapshot:
 * 1. the count;
 * 2. the page of ids, from `auditoria` alone (`auditPageSql`). Joined with
 *    the admin and the action, MySQL scanned the table and sorted it (91 to
 *    190 ms with 60 000 records), and a large OFFSET made it pick another
 *    index and sort;
 * 3. only those rows, with their action and admin, by primary key.
 * With a filter on action, entity or admin, MySQL picks the matching index.
 */
export function listAudit(pool: Pool, query: ListAuditQuery): Promise<Page<AuditRecord>> {
	const where = new Where();
	if (query.accion) where.add('au.accion_id = (SELECT id FROM accion_auditoria WHERE codigo = ?)', query.accion);
	if (query.entidad) where.add('au.accion_id IN (SELECT id FROM accion_auditoria WHERE entidad = ?)', query.entidad);
	if (query.entidadId) where.add('au.entidad_id = ?', query.entidadId);
	if (query.usuarioId) where.add('au.usuario_id = ?', query.usuarioId);
	if (query.desde) where.add('au.creado_en >= ?', query.desde);
	if (query.hasta) where.add('au.creado_en <= ?', query.hasta);
	const byDateOnly = !query.accion && !query.entidad && !query.entidadId && !query.usuarioId;

	return withReadSnapshot(pool, async (db) => {
		const [[counted]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total FROM auditoria au ${where.sql}`, where.params);
		const [page] = await db.query<RowDataPacket[]>(auditPageSql(where.sql, byDateOnly), [
			...where.params,
			query.pageSize,
			(query.page - 1) * query.pageSize,
		]);
		const total = Number(counted?.total ?? 0);
		if (page.length === 0) return toPage([], total, query);

		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT au.id, au.creado_en, au.entidad_id, au.detalle, a.codigo, a.nombre AS accion_nombre, a.entidad,
				u.id AS admin_id, u.nombre AS admin_nombre
			FROM auditoria au
			JOIN accion_auditoria a ON a.id = au.accion_id
			JOIN usuario u ON u.id = au.usuario_id
			WHERE au.id IN (?)
			ORDER BY ${ORDER}`,
			[page.map((row) => Number(row.id))],
		);
		const records = rows.map((row) => ({
			id: Number(row.id),
			fecha: row.creado_en as Date,
			accion: { codigo: String(row.codigo), nombre: String(row.accion_nombre) },
			entidad: String(row.entidad),
			entidadId: Number(row.entidad_id),
			administrador: { id: Number(row.admin_id), nombre: String(row.admin_nombre) },
			detalle: (typeof row.detalle === 'string' ? JSON.parse(row.detalle) : row.detalle) as DetalleAuditoria | null,
		}));
		return toPage(records, total, query);
	});
}
