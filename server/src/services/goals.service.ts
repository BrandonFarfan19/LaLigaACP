import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { TransactionConnection } from '../db/transaction.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { toSafeWebp } from '../lib/images.js';
import { hasStarted } from '../lib/match-state.js';
import { storedVideo, type VideoLink } from '../lib/video-links.js';
import type { CreateGoalBody, UpdateGoalBody } from '../schemas/goals.schema.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { find, findForUpdate, type Match, type Side } from './matches.service.js';
import type { MediaStore } from './media-storage.js';
import { loadingProblem } from './results.service.js';
import { plural } from '../lib/plural.js';

/**
 * Módulo Informativo, T-13: who scored (BR-033) and each goal's image and
 * video. Goals follow the score's rule (T-12): from the kick-off until the
 * result is confirmed, then locked (BR-032). Their image and video don't
 * change the result, so they can also be added or removed after confirming.
 */

export interface MediaDeps {
	store: MediaStore;
	/** Largest input image, in pixels (UPLOAD_MAX_PIXELS). */
	maxPixels: number;
	/** The current time; injectable for tests. */
	now?: () => Date;
}

export type { Side };

export interface GoalView {
	id: number;
	partidoId: number;
	minuto: number;
	equipoId: number;
	lado: Side;
	plantelId: number;
	jugador: { id: number; nombre: string };
	/** Where the admin reads the image (`GET /admin/archivos/:nombre`), or `null`. */
	imagen: string | null;
	video: VideoLink | null;
}

/** API path of a stored image, for the admin (any match) or the public (only official results). */
export const imagePath = (scope: 'admin' | 'public', name: unknown) =>
	typeof name === 'string' && name ? `/${scope}/archivos/${name}` : null;

const now = (deps: { now?: () => Date }) => (deps.now ?? (() => new Date()))();

const GOAL_SELECT = `SELECT g.id, pe.partido_id, g.minuto, g.equipo_id, pe.es_visita, g.plantel_id, g.imagen, g.video,
		j.id AS jugador_id, j.nombre AS jugador_nombre
	FROM gol g
	JOIN partido_equipo pe ON pe.id = g.partido_equipo_id
	JOIN plantel pl ON pl.id = g.plantel_id
	JOIN jugador j ON j.id = pl.jugador_id`;

function goalFrom(row: RowDataPacket): GoalView {
	return {
		id: Number(row.id),
		partidoId: Number(row.partido_id),
		minuto: Number(row.minuto),
		equipoId: Number(row.equipo_id),
		lado: row.es_visita ? 'visita' : 'local',
		plantelId: Number(row.plantel_id),
		jugador: { id: Number(row.jugador_id), nombre: String(row.jugador_nombre) },
		imagen: imagePath('admin', row.imagen),
		video: storedVideo(row.video),
	};
}

export async function listGoals(pool: Pool, matchId: number): Promise<GoalView[]> {
	await find(pool, matchId);
	const [rows] = await pool.query<RowDataPacket[]>(`${GOAL_SELECT} WHERE pe.partido_id = ? ORDER BY g.minuto, g.id`, [matchId]);
	return rows.map(goalFrom);
}

async function readGoal(conn: TransactionConnection | Pool, matchId: number, goalId: number): Promise<GoalView & { archivo: string | null }> {
	const [[row]] = await conn.query<RowDataPacket[]>(`${GOAL_SELECT} WHERE g.id = ? AND pe.partido_id = ?`, [goalId, matchId]);
	if (!row) throw HttpError.notFound('No existe ese gol en este partido.', ErrorCode.GOAL_NOT_FOUND);
	return { ...goalFrom(row), archivo: row.imagen === null ? null : String(row.imagen) };
}

/** 409 unless the match is between its kick-off and its confirmation (T-12's rule for the score). */
function requireGoalsEditable(match: Match, at: Date): void {
	const problem = loadingProblem(match, at);
	if (problem) throw new HttpError(409, problem.code, problem.message, { estado: match.estado });
}

/**
 * Where a goal's or a match's image and video can change: once the match
 * started (there is something to show), confirmed or not, never in a
 * cancelled one. Media never changes the result or the points (BR-032).
 * The kick-off is checked by itself too, whatever the stored state says.
 */
export function requireMediaEditable(match: Match, at: Date): void {
	if (match.estado === 'programado' || (match.estado === 'en_curso' && !hasStarted(match.fechaHora, at))) {
		throw new HttpError(409, ErrorCode.MATCH_NOT_STARTED, 'El partido todavía no empezó: la multimedia se agrega desde su fecha y hora.', {
			estado: match.estado,
		});
	}
	if (match.estado === 'cancelado') {
		throw new HttpError(409, ErrorCode.MATCH_LOCKED, 'El partido está cancelado: no admite multimedia.', { estado: match.estado });
	}
}

/**
 * The side of the match `equipoId` plays on, its score and how many goals it
 * already has attributed. The match row is locked by the caller, so these
 * counts can't change under it (setResult and every goal write lock it too).
 */
async function sideOf(conn: TransactionConnection, match: Match, equipoId: number) {
	if (equipoId !== match.local.equipoId && equipoId !== match.visita.equipoId) {
		throw new HttpError(409, ErrorCode.TEAM_NOT_IN_MATCH, 'Ese equipo no juega este partido.', {
			equipoId,
			equipos: [match.local.equipoId, match.visita.equipoId],
		});
	}
	const [[side]] = await conn.query<RowDataPacket[]>(
		`SELECT pe.id, pe.goles, (SELECT COUNT(*) FROM gol g WHERE g.partido_equipo_id = pe.id) AS atribuidos
		FROM partido_equipo pe WHERE pe.partido_id = ? AND pe.equipo_id = ?`,
		[match.id, equipoId],
	);
	return { id: Number(side!.id), goles: side!.goles === null ? null : Number(side!.goles), atribuidos: Number(side!.atribuidos) };
}

/** The player's enrollment in that team for the match's competition (locked by primary key), or 409. */
async function enrollmentOf(conn: TransactionConnection, match: Match, jugadorId: number, equipoId: number): Promise<number> {
	const [[found]] = await conn.query<RowDataPacket[]>(
		'SELECT id FROM plantel WHERE jugador_id = ? AND equipo_id = ? AND competicion_id = ?',
		[jugadorId, equipoId, match.competicionId],
	);
	let locked: RowDataPacket | undefined;
	if (found) {
		[[locked]] = await conn.query<RowDataPacket[]>('SELECT id FROM plantel FORCE INDEX (PRIMARY) WHERE id = ? AND equipo_id = ? FOR SHARE', [
			found.id,
			equipoId,
		]);
	}
	if (!locked) {
		throw new HttpError(409, ErrorCode.PLAYER_NOT_IN_TEAM, 'Ese jugador no está inscrito en ese equipo en esta competición.', {
			jugadorId,
			equipoId,
		});
	}
	return Number(locked.id);
}

function tooManyGoals(side: { goles: number | null; atribuidos: number }, equipoId: number): HttpError {
	return new HttpError(
		409,
		ErrorCode.GOALS_EXCEED_SCORE,
		side.goles === null
			? 'Carga primero el marcador del partido: no se pueden atribuir más goles que los del marcador.'
			: `Ese equipo tiene ${plural(Number(side.goles), 'gol', 'goles')} en el marcador y ya tiene ${plural(Number(side.atribuidos), 'atribuido', 'atribuidos')}.`,
		{ equipoId, golesMarcador: side.goles, golesAtribuidos: side.atribuidos },
	);
}

/** BR-033: a goal, by an enrolled player of one of the match's teams, never more than that side's score. */
export async function createGoal(pool: Pool, ctx: AdminActionContext, matchId: number, input: CreateGoalBody, deps: MediaDeps): Promise<GoalView> {
	const at = now(deps);
	const outcome = await runAdminAction<GoalView>(pool, ctx, 'crear', 'gol', async (conn) => {
		const match = await findForUpdate(conn, matchId, at);
		requireGoalsEditable(match, at);
		const side = await sideOf(conn, match, input.equipoId);
		const plantelId = await enrollmentOf(conn, match, input.jugadorId, input.equipoId);
		if (side.goles === null || side.atribuidos + 1 > side.goles) throw tooManyGoals(side, input.equipoId);
		const [result] = await conn.query<ResultSetHeader>(
			'INSERT INTO gol (partido_equipo_id, plantel_id, equipo_id, minuto) VALUES (?, ?, ?, ?)',
			[side.id, plantelId, input.equipoId, input.minuto],
		);
		return { id: result.insertId, before: null, after: withoutFile(await readGoal(conn, matchId, result.insertId)) };
	});
	return withoutFile(outcome.after!);
}

/** Changes the scorer, the team or the minute, with the same checks as creating it. */
export async function updateGoal(
	pool: Pool,
	ctx: AdminActionContext,
	matchId: number,
	goalId: number,
	input: UpdateGoalBody,
	deps: MediaDeps,
): Promise<GoalView> {
	const at = now(deps);
	const outcome = await runAdminAction<GoalView>(pool, ctx, 'editar', 'gol', async (conn) => {
		const match = await findForUpdate(conn, matchId, at);
		requireGoalsEditable(match, at);
		const before = await readGoal(conn, matchId, goalId);
		const equipoId = input.equipoId ?? before.equipoId;
		const jugadorId = input.jugadorId ?? before.jugador.id;
		const side = await sideOf(conn, match, equipoId);
		const plantelId = await enrollmentOf(conn, match, jugadorId, equipoId);
		if (equipoId !== before.equipoId && (side.goles === null || side.atribuidos + 1 > side.goles)) {
			throw tooManyGoals(side, equipoId);
		}
		await conn.query('UPDATE gol SET partido_equipo_id = ?, plantel_id = ?, equipo_id = ?, minuto = ? WHERE id = ?', [
			side.id,
			plantelId,
			equipoId,
			input.minuto ?? before.minuto,
			goalId,
		]);
		return { id: goalId, before: withoutFile(before), after: withoutFile(await readGoal(conn, matchId, goalId)) };
	});
	return withoutFile(outcome.after!);
}

/** Deletes a goal (and, after the commit, its image file). */
export async function deleteGoal(pool: Pool, ctx: AdminActionContext, matchId: number, goalId: number, deps: MediaDeps): Promise<void> {
	const at = now(deps);
	let file: string | null = null;
	await runAdminAction<GoalView>(pool, ctx, 'borrar', 'gol', async (conn) => {
		const match = await findForUpdate(conn, matchId, at);
		requireGoalsEditable(match, at);
		const before = await readGoal(conn, matchId, goalId);
		await conn.query('DELETE FROM gol WHERE id = ?', [goalId]);
		file = before.archivo;
		return { id: goalId, before: withoutFile(before), after: null };
	});
	await deps.store.remove(file);
}

/**
 * Sets (or replaces) a goal's image. The file is processed and written
 * before the transaction; if the transaction fails it is removed, and a
 * replaced file is removed after the commit (media-storage.ts).
 */
export async function setGoalImage(
	pool: Pool,
	ctx: AdminActionContext,
	matchId: number,
	goalId: number,
	upload: Buffer,
	deps: MediaDeps,
): Promise<GoalView> {
	const at = now(deps);
	// Before anything else: a file that isn't an acceptable image never reaches the disk.
	const content = await toSafeWebp(upload, deps.maxPixels);
	const name = await deps.store.save(content);
	let replaced: string | null = null;
	try {
		const outcome = await runAdminAction<GoalView>(pool, ctx, 'editar', 'gol', async (conn) => {
			const match = await findForUpdate(conn, matchId, at);
			requireMediaEditable(match, at);
			const before = await readGoal(conn, matchId, goalId);
			await conn.query('UPDATE gol SET imagen = ? WHERE id = ?', [name, goalId]);
			replaced = before.archivo;
			return { id: goalId, before: withoutFile(before), after: withoutFile(await readGoal(conn, matchId, goalId)) };
		});
		await deps.store.remove(replaced);
		return withoutFile(outcome.after!);
	} catch (error) {
		await deps.store.remove(name);
		throw error;
	}
}

export async function removeGoalImage(pool: Pool, ctx: AdminActionContext, matchId: number, goalId: number, deps: MediaDeps): Promise<GoalView> {
	const at = now(deps);
	let removed: string | null = null;
	const outcome = await runAdminAction<GoalView>(pool, ctx, 'editar', 'gol', async (conn) => {
		const match = await findForUpdate(conn, matchId, at);
		requireMediaEditable(match, at);
		const before = await readGoal(conn, matchId, goalId);
		if (!before.archivo) throw HttpError.notFound('Ese gol no tiene imagen.', ErrorCode.MEDIA_NOT_FOUND);
		await conn.query('UPDATE gol SET imagen = NULL WHERE id = ?', [goalId]);
		removed = before.archivo;
		return { id: goalId, before: withoutFile(before), after: withoutFile(await readGoal(conn, matchId, goalId)) };
	});
	await deps.store.remove(removed);
	return withoutFile(outcome.after!);
}

/** Sets or clears (`null`) a goal's video link, already validated and normalized. */
export async function setGoalVideo(
	pool: Pool,
	ctx: AdminActionContext,
	matchId: number,
	goalId: number,
	video: VideoLink | null,
	deps: MediaDeps,
): Promise<GoalView> {
	const at = now(deps);
	const outcome = await runAdminAction<GoalView>(pool, ctx, 'editar', 'gol', async (conn) => {
		const match = await findForUpdate(conn, matchId, at);
		requireMediaEditable(match, at);
		const before = await readGoal(conn, matchId, goalId);
		if (!video && !before.video) throw HttpError.notFound('Ese gol no tiene video.', ErrorCode.MEDIA_NOT_FOUND);
		await conn.query('UPDATE gol SET video = ? WHERE id = ?', [video?.url ?? null, goalId]);
		return { id: goalId, before: withoutFile(before), after: withoutFile(await readGoal(conn, matchId, goalId)) };
	});
	return withoutFile(outcome.after!);
}

function withoutFile<T extends GoalView>(goal: T): GoalView {
	const { archivo: _archivo, ...view } = goal as T & { archivo?: unknown };
	return view;
}
