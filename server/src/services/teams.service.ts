import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import type { CreateTeamBody, ListTeamsQuery, UpdateTeamBody } from '../schemas/catalog.schema.js';
import type { Page } from '../schemas/common.schema.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { type Db, dependents, describeDependents, likePattern, pageOf, Where } from './catalog-query.js';

/** Módulo Informativo: `equipo`. A team belongs to exactly one competition (EsquemaBD D1). */

export interface Team {
	id: number;
	competicionId: number;
	/** Joined by the API (T-21 fix), so a row shows where it plays without another list. */
	competicionNombre: string;
	deporteNombre: string;
	nombre: string;
	nombreCorto: string;
	/** `https://` URL or relative asset path (no uploads until T-13). */
	escudo: string;
	/** `#rrggbb`. */
	colorAcento: string;
}

const COLUMNS = 'e.id, e.competicion_id, c.nombre AS competicion_nombre, d.nombre AS deporte_nombre, e.nombre, e.nombre_corto, e.escudo, e.color_acento';
const FROM = 'FROM equipo e JOIN competicion c ON c.id = e.competicion_id JOIN deporte d ON d.id = c.deporte_id';

function toTeam(row: RowDataPacket): Team {
	return {
		id: Number(row.id),
		competicionId: Number(row.competicion_id),
		competicionNombre: String(row.competicion_nombre),
		deporteNombre: String(row.deporte_nombre),
		nombre: String(row.nombre),
		nombreCorto: String(row.nombre_corto),
		escudo: String(row.escudo),
		colorAcento: String(row.color_acento),
	};
}

async function find(db: Db, id: number, lock = false): Promise<Team> {
	const [[row]] = await db.query<RowDataPacket[]>(
		`SELECT ${COLUMNS} ${FROM} WHERE e.id = ?${lock ? ' FOR UPDATE OF e' : ''}`,
		[id],
	);
	if (!row) throw HttpError.notFound('No existe ese equipo.', ErrorCode.TEAM_NOT_FOUND);
	return toTeam(row);
}

/** Everything that ties a team to its competition. */
const DEPENDENTS = {
	partidos: 'SELECT COUNT(*) FROM partido_equipo WHERE equipo_id = ?',
	inscripciones: 'SELECT COUNT(*) FROM plantel WHERE equipo_id = ?',
	goles: 'SELECT COUNT(*) FROM gol WHERE equipo_id = ?',
};
const LABELS: Record<string, [string, string]> = {
	partidos: ['partido', 'partidos'],
	inscripciones: ['jugador inscrito', 'jugadores inscritos'],
	goles: ['gol', 'goles'],
};

export function listTeams(pool: Pool, query: ListTeamsQuery): Promise<Page<Team>> {
	const where = new Where();
	if (query.q) where.add('(e.nombre LIKE ? OR e.nombre_corto LIKE ?)', likePattern(query.q), likePattern(query.q));
	if (query.competicionId) where.add('e.competicion_id = ?', query.competicionId);
	if (query.deporteId) where.add('c.deporte_id = ?', query.deporteId);
	return pageOf(
		pool,
		{ columns: COLUMNS, from: FROM, where, orderBy: 'e.nombre, e.id' },
		query,
		toTeam,
	);
}

export function getTeam(pool: Pool, id: number): Promise<Team> {
	return find(pool, id);
}

/** A missing competition is 404 `COMPETITION_NOT_FOUND` (lib/db-errors.ts). */
export async function createTeam(pool: Pool, ctx: AdminActionContext, input: CreateTeamBody): Promise<Team> {
	const outcome = await runAdminAction<Team>(pool, ctx, 'crear', 'equipo', async (conn) => {
		const [result] = await conn.query<ResultSetHeader>(
			'INSERT INTO equipo (competicion_id, nombre, nombre_corto, escudo, color_acento) VALUES (?, ?, ?, ?, ?)',
			[input.competicionId, input.nombre, input.nombreCorto, input.escudo, input.colorAcento],
		);
		return { id: result.insertId, before: null, after: await find(conn, result.insertId) };
	});
	return outcome.after!;
}

/**
 * Moving a team to another competition is only a correction for a team that
 * doesn't play, has no players enrolled and no goals: all of those are tied
 * to its current competition (composite FKs). Otherwise 409 `TEAM_IN_USE`.
 */
export async function updateTeam(pool: Pool, ctx: AdminActionContext, id: number, input: UpdateTeamBody): Promise<Team> {
	const outcome = await runAdminAction<Team>(pool, ctx, 'editar', 'equipo', async (conn) => {
		const before = await find(conn, id, true);
		if (input.competicionId !== undefined && input.competicionId !== before.competicionId) {
			const found = await dependents(conn, id, DEPENDENTS);
			if (Object.keys(found).length > 0) {
				throw new HttpError(
					409,
					ErrorCode.TEAM_IN_USE,
					`No se puede cambiar la competición del equipo: tiene ${describeDependents(found, LABELS)}.`,
					found,
				);
			}
		}
		await conn.query(
			'UPDATE equipo SET competicion_id = ?, nombre = ?, nombre_corto = ?, escudo = ?, color_acento = ? WHERE id = ?',
			[
				input.competicionId ?? before.competicionId,
				input.nombre ?? before.nombre,
				input.nombreCorto ?? before.nombreCorto,
				input.escudo ?? before.escudo,
				input.colorAcento ?? before.colorAcento,
				id,
			],
		);
		return { id, before, after: await find(conn, id) };
	});
	return outcome.after!;
}

/** Only a team with no matches, enrolled players or goals: 409 `TEAM_IN_USE` otherwise. */
export async function deleteTeam(pool: Pool, ctx: AdminActionContext, id: number): Promise<void> {
	await runAdminAction<Team>(pool, ctx, 'borrar', 'equipo', async (conn) => {
		const before = await find(conn, id, true);
		const found = await dependents(conn, id, DEPENDENTS);
		if (Object.keys(found).length > 0) {
			throw new HttpError(
				409,
				ErrorCode.TEAM_IN_USE,
				`No se puede borrar el equipo: tiene ${describeDependents(found, LABELS)}.`,
				found,
			);
		}
		await conn.query('DELETE FROM equipo WHERE id = ?', [id]);
		return { id, before, after: null };
	});
}
