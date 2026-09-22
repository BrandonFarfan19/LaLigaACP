import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import type { CreateCompetitionBody, ListCompetitionsQuery, UpdateCompetitionBody } from '../schemas/catalog.schema.js';
import type { Page } from '../schemas/common.schema.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { type Db, dependents, describeDependents, likePattern, pageOf, Where } from './catalog-query.js';
import { requireSlug } from './sports.service.js';

/** Módulo Informativo: `competicion`, "Competición o torneo" de BR-011. */

export interface Competition {
	id: number;
	deporteId: number;
	/** Joined by the API (T-21 fix), so a row shows its sport without another list. */
	deporteNombre: string;
	nombre: string;
	/** Unique within its sport, not globally. */
	slug: string;
}

const COLUMNS = 'c.id, c.deporte_id, d.nombre AS deporte_nombre, c.nombre, c.slug';
const FROM = 'FROM competicion c JOIN deporte d ON d.id = c.deporte_id';

function toCompetition(row: RowDataPacket): Competition {
	return {
		id: Number(row.id),
		deporteId: Number(row.deporte_id),
		deporteNombre: String(row.deporte_nombre),
		nombre: String(row.nombre),
		slug: String(row.slug),
	};
}

async function find(db: Db, id: number, lock = false): Promise<Competition> {
	const [[row]] = await db.query<RowDataPacket[]>(
		`SELECT ${COLUMNS} ${FROM} WHERE c.id = ?${lock ? ' FOR UPDATE OF c' : ''}`,
		[id],
	);
	if (!row) throw HttpError.notFound('No existe esa competición.', ErrorCode.COMPETITION_NOT_FOUND);
	return toCompetition(row);
}

const LABELS: Record<string, [string, string]> = {
	equipos: ['equipo', 'equipos'],
	partidos: ['partido', 'partidos'],
	inscripciones: ['jugador inscrito', 'jugadores inscritos'],
};

export function listCompetitions(pool: Pool, query: ListCompetitionsQuery): Promise<Page<Competition>> {
	const where = new Where();
	if (query.q) where.add('(c.nombre LIKE ? OR c.slug LIKE ?)', likePattern(query.q), likePattern(query.q));
	if (query.deporteId) where.add('c.deporte_id = ?', query.deporteId);
	return pageOf(pool, { columns: COLUMNS, from: FROM, where, orderBy: 'c.nombre, c.id' }, query, toCompetition);
}

export function getCompetition(pool: Pool, id: number): Promise<Competition> {
	return find(pool, id);
}

/** A missing sport is 404 `SPORT_NOT_FOUND`; a taken slug in that sport, 409 `SLUG_TAKEN` (lib/db-errors.ts). */
export async function createCompetition(pool: Pool, ctx: AdminActionContext, input: CreateCompetitionBody): Promise<Competition> {
	const outcome = await runAdminAction<Competition>(pool, ctx, 'crear', 'competicion', async (conn) => {
		const [result] = await conn.query<ResultSetHeader>(
			'INSERT INTO competicion (deporte_id, nombre, slug) VALUES (?, ?, ?)',
			[input.deporteId, input.nombre, input.slug ?? requireSlug(input.nombre)],
		);
		return { id: result.insertId, before: null, after: await find(conn, result.insertId) };
	});
	return outcome.after!;
}

/**
 * Moving a competition to another sport is only a correction for one with no
 * matches yet: its matches (and their bets) follow the sport's draw rule
 * (BR-015). Otherwise 409 `COMPETITION_IN_USE`.
 */
export async function updateCompetition(
	pool: Pool,
	ctx: AdminActionContext,
	id: number,
	input: UpdateCompetitionBody,
): Promise<Competition> {
	const outcome = await runAdminAction<Competition>(pool, ctx, 'editar', 'competicion', async (conn) => {
		const before = await find(conn, id, true);
		if (input.deporteId !== undefined && input.deporteId !== before.deporteId) {
			const found = await dependents(conn, id, { partidos: 'SELECT COUNT(*) FROM partido WHERE competicion_id = ?' });
			if (found.partidos) {
				throw new HttpError(
					409,
					ErrorCode.COMPETITION_IN_USE,
					`No se puede cambiar el deporte de la competición: tiene ${describeDependents(found, LABELS)}.`,
					found,
				);
			}
		}
		await conn.query('UPDATE competicion SET deporte_id = ?, nombre = ?, slug = ? WHERE id = ?', [
			input.deporteId ?? before.deporteId,
			input.nombre ?? before.nombre,
			input.slug ?? before.slug,
			id,
		]);
		return { id, before, after: await find(conn, id) };
	});
	return outcome.after!;
}

/** Only a competition with no teams, matches or enrolled players: 409 `COMPETITION_IN_USE` otherwise. */
export async function deleteCompetition(pool: Pool, ctx: AdminActionContext, id: number): Promise<void> {
	await runAdminAction<Competition>(pool, ctx, 'borrar', 'competicion', async (conn) => {
		const before = await find(conn, id, true);
		const found = await dependents(conn, id, {
			equipos: 'SELECT COUNT(*) FROM equipo WHERE competicion_id = ?',
			partidos: 'SELECT COUNT(*) FROM partido WHERE competicion_id = ?',
			inscripciones: 'SELECT COUNT(*) FROM plantel WHERE competicion_id = ?',
		});
		if (Object.keys(found).length > 0) {
			throw new HttpError(
				409,
				ErrorCode.COMPETITION_IN_USE,
				`No se puede borrar la competición: tiene ${describeDependents(found, LABELS)}.`,
				found,
			);
		}
		await conn.query('DELETE FROM competicion WHERE id = ?', [id]);
		return { id, before, after: null };
	});
}
