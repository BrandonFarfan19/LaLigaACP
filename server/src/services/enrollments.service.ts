import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import type { CreateEnrollmentBody, ListEnrollmentsQuery, UpdateEnrollmentBody } from '../schemas/catalog.schema.js';
import type { Page } from '../schemas/common.schema.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { type Db, dependents, pageOf, Where } from './catalog-query.js';
import { findPlayer } from './players.service.js';

/**
 * Módulo Informativo: `plantel`, a player enrolled in a team of a
 * competition, with a shirt number. EsquemaBD D2/D4: one team per player per
 * competition, and no transfers once enrolled. `competicion_id` is always
 * the team's (composite FK); the client never decides it.
 */

export interface Enrollment {
	id: number;
	jugadorId: number;
	jugadorNombre: string;
	equipoId: number;
	competicionId: number;
	numeroCamiseta: number;
}

const COLUMNS = 'p.id, p.jugador_id, j.nombre AS jugador_nombre, p.equipo_id, p.competicion_id, p.numero_camiseta';
const FROM = 'FROM plantel p JOIN jugador j ON j.id = p.jugador_id';

function toEnrollment(row: RowDataPacket): Enrollment {
	return {
		id: Number(row.id),
		jugadorId: Number(row.jugador_id),
		jugadorNombre: String(row.jugador_nombre),
		equipoId: Number(row.equipo_id),
		competicionId: Number(row.competicion_id),
		numeroCamiseta: Number(row.numero_camiseta),
	};
}

async function find(db: Db, id: number, lock = false): Promise<Enrollment> {
	// Locks with its own statement by primary key (server/README.md, "Orden de bloqueo"), then reads.
	if (lock) await db.query('SELECT id FROM plantel FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE', [id]);
	const [[row]] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} ${FROM} WHERE p.id = ?`, [id]);
	if (!row) throw HttpError.notFound('No existe esa inscripción.', ErrorCode.ENROLLMENT_NOT_FOUND);
	return toEnrollment(row);
}

/** 409 `SHIRT_NUMBER_TAKEN` if another enrollment of the team wears it. */
async function checkShirtFree(db: Db, equipoId: number, numero: number, exceptId?: number): Promise<void> {
	const [[holder]] = await db.query<RowDataPacket[]>(
		'SELECT id, jugador_id FROM plantel WHERE equipo_id = ? AND numero_camiseta = ? AND id <> ?',
		[equipoId, numero, exceptId ?? 0],
	);
	if (holder) {
		throw new HttpError(409, ErrorCode.SHIRT_NUMBER_TAKEN, `El número ${numero} ya lo usa otro jugador del equipo.`, {
			jugadorId: Number(holder.jugador_id),
		});
	}
}

export function listEnrollments(pool: Pool, query: ListEnrollmentsQuery): Promise<Page<Enrollment>> {
	const where = new Where();
	if (query.equipoId) where.add('p.equipo_id = ?', query.equipoId);
	if (query.competicionId) where.add('p.competicion_id = ?', query.competicionId);
	if (query.jugadorId) where.add('p.jugador_id = ?', query.jugadorId);
	return pageOf(
		pool,
		{ columns: COLUMNS, from: FROM, where, orderBy: 'p.equipo_id, p.numero_camiseta, p.id' },
		query,
		toEnrollment,
	);
}

export function getEnrollment(pool: Pool, id: number): Promise<Enrollment> {
	return find(pool, id);
}

/**
 * Checks, in order: the team exists (404 `TEAM_NOT_FOUND`); if the body names
 * a competition, it is the team's (409 `COMPETITION_MISMATCH`); the player
 * exists (404 `PLAYER_NOT_FOUND`); the player isn't in another team of that
 * competition (409 `PLAYER_ALREADY_ENROLLED`); the shirt is free (409
 * `SHIRT_NUMBER_TAKEN`). The UNIQUE indexes catch the same conflicts under a
 * race (lib/db-errors.ts).
 */
export async function createEnrollment(pool: Pool, ctx: AdminActionContext, input: CreateEnrollmentBody): Promise<Enrollment> {
	const outcome = await runAdminAction<Enrollment>(pool, ctx, 'crear', 'plantel', async (conn) => {
		const [[team]] = await conn.query<RowDataPacket[]>('SELECT competicion_id FROM equipo WHERE id = ? FOR SHARE', [
			input.equipoId,
		]);
		if (!team) throw HttpError.notFound('No existe ese equipo.', ErrorCode.TEAM_NOT_FOUND);
		const competicionId = Number(team.competicion_id);
		if (input.competicionId !== undefined && input.competicionId !== competicionId) {
			throw new HttpError(409, ErrorCode.COMPETITION_MISMATCH, 'El equipo no pertenece a esa competición.', {
				competicionDelEquipo: competicionId,
			});
		}
		await findPlayer(conn, input.jugadorId);

		const [[enrolled]] = await conn.query<RowDataPacket[]>(
			'SELECT equipo_id FROM plantel WHERE jugador_id = ? AND competicion_id = ?',
			[input.jugadorId, competicionId],
		);
		if (enrolled) {
			throw new HttpError(
				409,
				ErrorCode.PLAYER_ALREADY_ENROLLED,
				'Ese jugador ya está inscrito en un equipo de esta competición.',
				{ equipoId: Number(enrolled.equipo_id) },
			);
		}
		await checkShirtFree(conn, input.equipoId, input.numeroCamiseta);

		const [result] = await conn.query<ResultSetHeader>(
			'INSERT INTO plantel (jugador_id, equipo_id, competicion_id, numero_camiseta) VALUES (?, ?, ?, ?)',
			[input.jugadorId, input.equipoId, competicionId, input.numeroCamiseta],
		);
		return { id: result.insertId, before: null, after: await find(conn, result.insertId) };
	});
	return outcome.after!;
}

/**
 * Only the shirt number changes. A different team or player is a transfer,
 * which D4 forbids within a competition: 409 `TRANSFER_NOT_ALLOWED` (delete
 * the enrollment and create another only if it was a data-entry mistake and
 * it has no goals).
 */
export async function updateEnrollment(
	pool: Pool,
	ctx: AdminActionContext,
	id: number,
	input: UpdateEnrollmentBody,
): Promise<Enrollment> {
	const outcome = await runAdminAction<Enrollment>(pool, ctx, 'editar', 'plantel', async (conn) => {
		const before = await find(conn, id, true);
		if (
			(input.equipoId !== undefined && input.equipoId !== before.equipoId) ||
			(input.jugadorId !== undefined && input.jugadorId !== before.jugadorId)
		) {
			throw new HttpError(
				409,
				ErrorCode.TRANSFER_NOT_ALLOWED,
				'Una inscripción no cambia de equipo ni de jugador: dentro de una competición no hay transferencias.',
			);
		}
		if (input.numeroCamiseta !== undefined && input.numeroCamiseta !== before.numeroCamiseta) {
			await checkShirtFree(conn, before.equipoId, input.numeroCamiseta, id);
			await conn.query('UPDATE plantel SET numero_camiseta = ? WHERE id = ?', [input.numeroCamiseta, id]);
		}
		return { id, before, after: await find(conn, id) };
	});
	return outcome.after!;
}

/** Only an enrollment without goals: 409 `ENROLLMENT_IN_USE` otherwise. */
export async function deleteEnrollment(pool: Pool, ctx: AdminActionContext, id: number): Promise<void> {
	await runAdminAction<Enrollment>(pool, ctx, 'borrar', 'plantel', async (conn) => {
		const before = await find(conn, id, true);
		const found = await dependents(conn, id, { goles: 'SELECT COUNT(*) FROM gol WHERE plantel_id = ?' });
		if (found.goles) {
			throw new HttpError(
				409,
				ErrorCode.ENROLLMENT_IN_USE,
				`No se puede borrar la inscripción: tiene ${found.goles} gol(es) registrado(s).`,
				found,
			);
		}
		await conn.query('DELETE FROM plantel WHERE id = ?', [id]);
		return { id, before, after: null };
	});
}
