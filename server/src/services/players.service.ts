import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import type { CreatePlayerBody, ListPlayersQuery, UpdatePlayerBody } from '../schemas/catalog.schema.js';
import type { Page } from '../schemas/common.schema.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { type Db, dependents, describeDependents, likePattern, pageOf, Where } from './catalog-query.js';

/** Módulo Informativo: `jugador`, the person (enrolled in teams through `plantel`). */

export interface Player {
	id: number;
	nombre: string;
	foto: string | null;
}

const COLUMNS = 'j.id, j.nombre, j.foto';

function toPlayer(row: RowDataPacket): Player {
	return { id: Number(row.id), nombre: String(row.nombre), foto: row.foto === null ? null : String(row.foto) };
}

export async function findPlayer(db: Db, id: number, lock = false): Promise<Player> {
	const [[row]] = await db.query<RowDataPacket[]>(
		`SELECT ${COLUMNS} FROM jugador j WHERE j.id = ?${lock ? ' FOR UPDATE' : ''}`,
		[id],
	);
	if (!row) throw HttpError.notFound('No existe ese jugador.', ErrorCode.PLAYER_NOT_FOUND);
	return toPlayer(row);
}

/** `equipoId` / `competicionId` filter the players enrolled there. */
export function listPlayers(pool: Pool, query: ListPlayersQuery): Promise<Page<Player>> {
	const where = new Where();
	if (query.q) where.add('j.nombre LIKE ?', likePattern(query.q));
	if (query.equipoId) where.add('EXISTS (SELECT 1 FROM plantel p WHERE p.jugador_id = j.id AND p.equipo_id = ?)', query.equipoId);
	if (query.competicionId) {
		where.add('EXISTS (SELECT 1 FROM plantel p WHERE p.jugador_id = j.id AND p.competicion_id = ?)', query.competicionId);
	}
	return pageOf(pool, { columns: COLUMNS, from: 'FROM jugador j', where, orderBy: 'j.nombre, j.id' }, query, toPlayer);
}

export function getPlayer(pool: Pool, id: number): Promise<Player> {
	return findPlayer(pool, id);
}

export async function createPlayer(pool: Pool, ctx: AdminActionContext, input: CreatePlayerBody): Promise<Player> {
	const outcome = await runAdminAction<Player>(pool, ctx, 'crear', 'jugador', async (conn) => {
		const [result] = await conn.query<ResultSetHeader>('INSERT INTO jugador (nombre, foto) VALUES (?, ?)', [
			input.nombre,
			input.foto ?? null,
		]);
		return { id: result.insertId, before: null, after: await findPlayer(conn, result.insertId) };
	});
	return outcome.after!;
}

/** `foto: null` removes the photo; leaving it out keeps it. */
export async function updatePlayer(pool: Pool, ctx: AdminActionContext, id: number, input: UpdatePlayerBody): Promise<Player> {
	const outcome = await runAdminAction<Player>(pool, ctx, 'editar', 'jugador', async (conn) => {
		const before = await findPlayer(conn, id, true);
		await conn.query('UPDATE jugador SET nombre = ?, foto = ? WHERE id = ?', [
			input.nombre ?? before.nombre,
			input.foto === undefined ? before.foto : input.foto,
			id,
		]);
		return { id, before, after: await findPlayer(conn, id) };
	});
	return outcome.after!;
}

/** Only a player enrolled nowhere (goals hang from an enrollment): 409 `PLAYER_IN_USE` otherwise. */
export async function deletePlayer(pool: Pool, ctx: AdminActionContext, id: number): Promise<void> {
	await runAdminAction<Player>(pool, ctx, 'borrar', 'jugador', async (conn) => {
		const before = await findPlayer(conn, id, true);
		const found = await dependents(conn, id, {
			inscripciones: 'SELECT COUNT(*) FROM plantel WHERE jugador_id = ?',
			goles: 'SELECT COUNT(*) FROM gol g JOIN plantel p ON p.id = g.plantel_id WHERE p.jugador_id = ?',
		});
		if (Object.keys(found).length > 0) {
			throw new HttpError(
				409,
				ErrorCode.PLAYER_IN_USE,
				`No se puede borrar el jugador: tiene ${describeDependents(found, {
					inscripciones: ['inscripción en un plantel', 'inscripciones en planteles'],
					goles: ['gol', 'goles'],
				})}.`,
				found,
			);
		}
		await conn.query('DELETE FROM jugador WHERE id = ?', [id]);
		return { id, before, after: null };
	});
}
