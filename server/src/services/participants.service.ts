import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { ListParticipantsQuery } from '../schemas/participants.schema.js';
import { type PublicUser, type RolCodigo, toPublicUser, USER_COLUMNS, USER_JOINS, type UserRow } from './users.service.js';

type Db = Pool | PoolConnection;

/**
 * A row of the admin's participant table (BR-007): the user as `/auth/me`
 * shows it, plus the pool points accumulated so far.
 *
 * Participants are **only `apostador` accounts**. Admins don't take part in
 * the pool (BR-001): they never show up here, in the counts, or as the
 * target of a participant action.
 */
export interface Participant extends PublicUser {
	puntos: number;
}

interface ParticipantRow extends UserRow {
	puntos: number;
}

/**
 * BR-007/BR-039: points are never stored on the user; they are the sum of
 * `seleccion.puntos_obtenidos` over all of the user's tickets. Unsettled
 * selections (NULL) count as 0. CAST keeps mysql2 from returning a DECIMAL
 * string.
 */
const PUNTOS_COLUMN = `(SELECT CAST(COALESCE(SUM(s.puntos_obtenidos), 0) AS SIGNED)
		FROM ticket t JOIN seleccion s ON s.ticket_id = t.id
		WHERE t.usuario_id = u.id) AS puntos`;

function toParticipant(row: ParticipantRow): Participant {
	return { ...toPublicUser(row), puntos: row.puntos };
}

/** `%`, `_` and `\` are literal in a search, not wildcards. */
function escapeLike(text: string): string {
	return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

type Filters = Partial<Pick<ListParticipantsQuery, 'estadoPago' | 'estadoValidacion' | 'q'>>;

/** Always restricted to `apostador`; the filters narrow it further. */
function buildWhere(filters: Filters): { sql: string; params: unknown[] } {
	const conditions: string[] = ["r.codigo = 'apostador'"];
	const params: unknown[] = [];
	if (filters.estadoPago) {
		conditions.push('ep.codigo = ?');
		params.push(filters.estadoPago);
	}
	if (filters.estadoValidacion) {
		conditions.push('eu.codigo = ?');
		params.push(filters.estadoValidacion);
	}
	if (filters.q) {
		const pattern = `%${escapeLike(filters.q)}%`;
		conditions.push('(u.nombre LIKE ? OR u.email LIKE ?)');
		params.push(pattern, pattern);
	}
	return { sql: `WHERE ${conditions.join(' AND ')}`, params };
}

export interface ParticipantPage {
	items: Participant[];
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
}

export async function listParticipants(db: Db, query: ListParticipantsQuery): Promise<ParticipantPage> {
	const where = buildWhere(query);
	const [[countRow]] = await db.query<RowDataPacket[]>(
		`SELECT COUNT(*) AS total FROM usuario u ${USER_JOINS} ${where.sql}`,
		where.params,
	);
	const total = Number(countRow?.total ?? 0);

	const direction = query.orden === 'desc' ? 'DESC' : 'ASC';
	const [rows] = await db.query<ParticipantRow[]>(
		`SELECT ${USER_COLUMNS}, ${PUNTOS_COLUMN}
		FROM usuario u ${USER_JOINS}
		${where.sql}
		ORDER BY u.creado_en ${direction}, u.id ${direction}
		LIMIT ? OFFSET ?`,
		[...where.params, query.pageSize, (query.page - 1) * query.pageSize],
	);

	return {
		items: rows.map(toParticipant),
		page: query.page,
		pageSize: query.pageSize,
		total,
		totalPages: Math.ceil(total / query.pageSize),
	};
}

/** The participant with that id; `null` if there is no such account or it is an admin. */
export async function findParticipant(db: Db, id: number): Promise<Participant | null> {
	const where = buildWhere({});
	const [rows] = await db.query<ParticipantRow[]>(
		`SELECT ${USER_COLUMNS}, ${PUNTOS_COLUMN} FROM usuario u ${USER_JOINS} ${where.sql} AND u.id = ?`,
		[...where.params, id],
	);
	return rows[0] ? toParticipant(rows[0]) : null;
}

/** The role of any account, admins included; `null` if it doesn't exist. */
export async function findAccountRole(db: Db, id: number): Promise<RolCodigo | null> {
	const [rows] = await db.query<RowDataPacket[]>(
		'SELECT r.codigo FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.id = ?',
		[id],
	);
	return (rows[0]?.codigo as RolCodigo | undefined) ?? null;
}

export interface ParticipantCounts {
	inscritos: number;
	validados: number;
	pendientes: number;
	pagosConfirmados: number;
	pagosPendientes: number;
}

/** BR-001's counts, over the same accounts as the table: participants only. */
export async function countParticipants(db: Db): Promise<ParticipantCounts> {
	const where = buildWhere({});
	const [[row]] = await db.query<RowDataPacket[]>(
		`SELECT
			COUNT(*) AS inscritos,
			CAST(COALESCE(SUM(eu.codigo = 'validado'), 0) AS SIGNED) AS validados,
			CAST(COALESCE(SUM(eu.codigo = 'pendiente'), 0) AS SIGNED) AS pendientes,
			CAST(COALESCE(SUM(ep.codigo = 'confirmado'), 0) AS SIGNED) AS pagosConfirmados,
			CAST(COALESCE(SUM(ep.codigo = 'pendiente'), 0) AS SIGNED) AS pagosPendientes
		FROM usuario u ${USER_JOINS} ${where.sql}`,
		where.params,
	);
	return {
		inscritos: Number(row?.inscritos ?? 0),
		validados: Number(row?.validados ?? 0),
		pendientes: Number(row?.pendientes ?? 0),
		pagosConfirmados: Number(row?.pagosConfirmados ?? 0),
		pagosPendientes: Number(row?.pagosPendientes ?? 0),
	};
}
