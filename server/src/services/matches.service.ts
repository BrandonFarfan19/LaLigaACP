import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { TransactionConnection } from '../db/transaction.js';
import { bettingCloseTime } from '../lib/betting.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { proximityOrderBy } from '../lib/match-order.js';
import { effectiveState, effectiveStateCondition } from '../lib/match-state.js';
import type { Page } from '../schemas/common.schema.js';
import type { CreateMatchBody, ListMatchesQuery, MatchState, UpdateMatchBody } from '../schemas/matches.schema.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { type Db, pageOf, Where } from './catalog-query.js';

/**
 * Módulo Informativo: `partido` and its two `partido_equipo` rows (BR-011 to
 * BR-013). Goals and results are not written here (T-12); `finalizado` and
 * `cancelado` are only reached through T-12 and T-16, and `en_curso` comes by
 * itself at the kick-off (lib/match-state.ts): there is no manual state change.
 */

export interface MatchSide {
	equipoId: number;
	nombre: string;
	/** Empty until the result is registered (T-12). */
	goles: number | null;
}

export interface Match {
	id: number;
	competicionId: number;
	deporteId: number;
	estado: MatchState;
	jornada: number;
	/** UTC. */
	fechaHora: Date;
	/** `fechaHora - 24 h` (BR-014): no new bets from this moment on. */
	cierreApuestas: Date;
	sede: string;
	local: MatchSide;
	visita: MatchSide;
}

/**
 * Extension point: how many bets (selections) a match has. Informativo can't
 * read Polla's tables (CLAUDE.md), so the composition root passes in the
 * Polla implementation (`services/bets-match-probe.service.ts`). It runs in
 * the caller's transaction, with the match row locked.
 */
export type MatchBetsProbe = (conn: TransactionConnection, matchId: number) => Promise<number>;

export interface MatchDeps {
	countBets: MatchBetsProbe;
	/** The current time; injectable for tests. */
	now?: () => Date;
}

const COLUMNS = `p.id, p.competicion_id, c.deporte_id, ep.codigo AS estado, p.jornada, p.fecha_hora, p.sede,
	l.equipo_id AS local_id, le.nombre AS local_nombre, l.goles AS local_goles,
	v.equipo_id AS visita_id, ve.nombre AS visita_nombre, v.goles AS visita_goles`;
const FROM = `FROM partido p
	JOIN competicion c ON c.id = p.competicion_id
	JOIN estado_partido ep ON ep.id = p.estado_partido_id
	JOIN partido_equipo l ON l.partido_id = p.id AND l.es_visita = FALSE
	JOIN equipo le ON le.id = l.equipo_id
	JOIN partido_equipo v ON v.partido_id = p.id AND v.es_visita = TRUE
	JOIN equipo ve ON ve.id = v.equipo_id`;

const goles = (value: unknown) => (value === null ? null : Number(value));

/** `estado` is the effective one (lib/match-state.ts): a `programado` match whose kick-off came is `en_curso`. */
function toMatch(row: RowDataPacket, now: Date): Match {
	const fechaHora = row.fecha_hora as Date;
	return {
		id: Number(row.id),
		competicionId: Number(row.competicion_id),
		deporteId: Number(row.deporte_id),
		estado: effectiveState(row.estado as MatchState, fechaHora, now),
		jornada: Number(row.jornada),
		fechaHora,
		cierreApuestas: bettingCloseTime(fechaHora),
		sede: String(row.sede),
		local: { equipoId: Number(row.local_id), nombre: String(row.local_nombre), goles: goles(row.local_goles) },
		visita: { equipoId: Number(row.visita_id), nombre: String(row.visita_nombre), goles: goles(row.visita_goles) },
	};
}

export async function find(db: Db, id: number, now: Date = new Date()): Promise<Match> {
	const [[row]] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} ${FROM} WHERE p.id = ?`, [id]);
	if (!row) throw HttpError.notFound('No existe ese partido.', ErrorCode.MATCH_NOT_FOUND);
	return toMatch(row, now);
}

/** Locks the match row (only that row) and returns the match, with its effective state at `now`. */
export async function findForUpdate(conn: TransactionConnection, id: number, now: Date = new Date()): Promise<Match> {
	const [[locked]] = await conn.query<RowDataPacket[]>('SELECT id FROM partido FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE', [id]);
	if (!locked) throw HttpError.notFound('No existe ese partido.', ErrorCode.MATCH_NOT_FOUND);
	return find(conn, id, now);
}

export async function stateId(conn: TransactionConnection, codigo: MatchState): Promise<number> {
	const [[row]] = await conn.query<RowDataPacket[]>('SELECT id FROM estado_partido WHERE codigo = ?', [codigo]);
	if (!row) throw new Error(`Falta el estado_partido ${codigo} (¿se cargó 02-catalogos.sql?).`);
	return Number(row.id);
}

export async function countGoals(conn: TransactionConnection, matchId: number): Promise<number> {
	const [[row]] = await conn.query<RowDataPacket[]>(
		'SELECT COUNT(*) AS n FROM gol g JOIN partido_equipo pe ON pe.id = g.partido_equipo_id WHERE pe.partido_id = ?',
		[matchId],
	);
	return Number(row?.n ?? 0);
}

export type Side = 'local' | 'visita';

/** How many goals (T-13) each side has attributed. The caller holds the match row lock. */
export async function attributedGoals(db: Db, matchId: number): Promise<Record<Side, number>> {
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT pe.es_visita, COUNT(g.id) AS n
		FROM partido_equipo pe LEFT JOIN gol g ON g.partido_equipo_id = pe.id
		WHERE pe.partido_id = ? GROUP BY pe.id, pe.es_visita`,
		[matchId],
	);
	const counts: Record<Side, number> = { local: 0, visita: 0 };
	for (const row of rows) counts[row.es_visita ? 'visita' : 'local'] = Number(row.n);
	return counts;
}

/** T-12: a score loaded on either side (`partido_equipo.goles`), confirmed or not. */
export const hasLoadedScore = (match: Match) => match.local.goles !== null || match.visita.goles !== null;

const resultLoaded = (match: Match) =>
	new HttpError(409, ErrorCode.MATCH_HAS_RESULT, 'El partido ya tiene un resultado cargado.', {
		golesLocal: match.local.goles,
		golesVisitante: match.visita.goles,
	});

function requireFuture(fechaHora: Date, now: Date): void {
	if (fechaHora <= now) {
		throw new HttpError(400, ErrorCode.MATCH_DATE_IN_PAST, 'La fecha y hora del partido tiene que ser futura.', {
			fechaHora,
			ahora: now,
		});
	}
}

/**
 * The competition exists, the teams are different, exist, and belong to that
 * competition. The composite FKs enforce the last part too (lib/db-errors.ts);
 * this answers with details first.
 */
async function checkTeams(conn: TransactionConnection, competicionId: number, localId: number, visitaId: number): Promise<void> {
	// Lock order (server/README.md, "Orden de bloqueo"): teams, then the competition, each by primary key.
	const teamIds = [...new Set([localId, visitaId])].sort((x, y) => x - y);
	const [teams] = await conn.query<RowDataPacket[]>(
		'SELECT id, competicion_id FROM equipo FORCE INDEX (PRIMARY) WHERE id IN (?) ORDER BY id FOR SHARE',
		[teamIds],
	);
	const [[competition]] = await conn.query<RowDataPacket[]>(
		'SELECT id FROM competicion FORCE INDEX (PRIMARY) WHERE id = ? FOR SHARE',
		[competicionId],
	);
	if (!competition) throw HttpError.notFound('No existe esa competición.', ErrorCode.COMPETITION_NOT_FOUND);
	if (localId === visitaId) {
		throw new HttpError(400, ErrorCode.SAME_TEAM, 'El equipo local y el visitante tienen que ser distintos.');
	}
	for (const [lado, equipoId] of [['local', localId], ['visita', visitaId]] as const) {
		const team = teams.find((t) => Number(t.id) === equipoId);
		if (!team) throw new HttpError(404, ErrorCode.TEAM_NOT_FOUND, `No existe el equipo ${lado}.`, { lado, equipoId });
		if (Number(team.competicion_id) !== competicionId) {
			throw new HttpError(409, ErrorCode.COMPETITION_MISMATCH, `El equipo ${lado} no pertenece a esa competición.`, {
				lado,
				equipoId,
				competicionDelEquipo: Number(team.competicion_id),
			});
		}
	}
}

async function insertSides(conn: TransactionConnection, matchId: number, competicionId: number, localId: number, visitaId: number) {
	await conn.query(
		`INSERT INTO partido_equipo (partido_id, equipo_id, competicion_id, es_visita, goles)
		VALUES (?, ?, ?, FALSE, NULL), (?, ?, ?, TRUE, NULL)`,
		[matchId, localId, competicionId, matchId, visitaId, competicionId],
	);
}

export function listMatches(pool: Pool, query: ListMatchesQuery, now: Date = new Date()): Promise<Page<Match>> {
	const where = new Where();
	if (query.deporteId) {
		// Through competicion's (deporte_id, slug) index, then partido's by competition; "c.deporte_id = ?" let MySQL scan the matches.
		where.add('p.competicion_id IN (SELECT dc.id FROM competicion dc WHERE dc.deporte_id = ?)', query.deporteId);
	}
	if (query.competicionId) where.add('p.competicion_id = ?', query.competicionId);
	if (query.equipoId) {
		// Through partido_equipo.equipo_id, which is indexed; "l.equipo_id = ? OR v.equipo_id = ?" scanned the table.
		where.add('p.id IN (SELECT pe.partido_id FROM partido_equipo pe WHERE pe.equipo_id = ?)', query.equipoId);
	}
	if (query.estado) {
		const state = effectiveStateCondition(query.estado, now);
		where.add(state.sql, ...state.params);
	}
	if (query.desde) where.add('p.fecha_hora >= ?', query.desde);
	if (query.hasta) where.add('p.fecha_hora <= ?', query.hasta);
	const order = proximityOrderBy('p.fecha_hora', 'p.id', now);
	return pageOf(pool, { columns: COLUMNS, from: FROM, where, orderBy: order.sql, orderParams: order.params }, query, (row) =>
		toMatch(row, now),
	);
}

export function getMatch(pool: Pool, id: number): Promise<Match> {
	return find(pool, id);
}

/**
 * Always starts `programado`, with both `partido_equipo` rows (goals empty)
 * in the same transaction. The date must be in the future: a match created
 * in the past could never be bet on (BR-014) and would sit `programado`
 * behind the calendar; loading past results is not part of the rules.
 */
export async function createMatch(pool: Pool, ctx: AdminActionContext, input: CreateMatchBody, deps: MatchDeps): Promise<Match> {
	requireFuture(input.fechaHora, (deps.now ?? (() => new Date()))());
	const outcome = await runAdminAction<Match>(pool, ctx, 'crear', 'partido', async (conn) => {
		await checkTeams(conn, input.competicionId, input.localId, input.visitaId);
		const [result] = await conn.query<ResultSetHeader>(
			'INSERT INTO partido (competicion_id, estado_partido_id, jornada, fecha_hora, sede) VALUES (?, ?, ?, ?, ?)',
			[input.competicionId, await stateId(conn, 'programado'), input.jornada, input.fechaHora, input.sede],
		);
		await insertSides(conn, result.insertId, input.competicionId, input.localId, input.visitaId);
		return { id: result.insertId, before: null, after: await find(conn, result.insertId) };
	});
	return outcome.after!;
}

/**
 * BR-011: editable until the result is confirmed; a `finalizado` or
 * `cancelado` match is locked (409 `MATCH_LOCKED`).
 *
 * - Jornada and venue: any time before that.
 * - Competition, teams or date: only while `programado`, i.e. before its
 *   kick-off (409 `MATCH_NOT_PROGRAMMED`): a started match can't be postponed.
 * - Competition or teams: never once the match has bets (409
 *   `MATCH_HAS_BETS`, the bets are on those teams) or goals.
 * - Date: must stay in the future. With bets it can only move **later**
 *   (a postponement). Moving it earlier would pull the betting close
 *   (BR-014) back past bets placed under the old close. Postponing moves the
 *   close later too, so betting may reopen until the new close; the existing
 *   bets remain valid.
 *
 * The match row stays locked for the whole check, so concurrent edits (and
 * T-10's bets, which lock it too) run one after the other.
 */
export async function updateMatch(
	pool: Pool,
	ctx: AdminActionContext,
	id: number,
	input: UpdateMatchBody,
	deps: MatchDeps,
): Promise<Match> {
	const now = (deps.now ?? (() => new Date()))();
	const outcome = await runAdminAction<Match>(pool, ctx, 'editar', 'partido', async (conn) => {
		const before = await findForUpdate(conn, id, now);
		if (before.estado === 'finalizado' || before.estado === 'cancelado') {
			throw new HttpError(409, ErrorCode.MATCH_LOCKED, `El partido está ${before.estado}: ya no se puede modificar.`, {
				estado: before.estado,
			});
		}

		const target = {
			competicionId: input.competicionId ?? before.competicionId,
			localId: input.localId ?? before.local.equipoId,
			visitaId: input.visitaId ?? before.visita.equipoId,
			jornada: input.jornada ?? before.jornada,
			fechaHora: input.fechaHora ?? before.fechaHora,
			sede: input.sede ?? before.sede,
		};
		const teamsChange =
			target.competicionId !== before.competicionId ||
			target.localId !== before.local.equipoId ||
			target.visitaId !== before.visita.equipoId;
		const dateChange = target.fechaHora.getTime() !== before.fechaHora.getTime();

		if ((teamsChange || dateChange) && before.estado !== 'programado') {
			throw new HttpError(
				409,
				ErrorCode.MATCH_NOT_PROGRAMMED,
				'El partido ya empezó: no se pueden cambiar la competición, los equipos ni la fecha.',
				{ estado: before.estado },
			);
		}
		const bets = teamsChange || dateChange ? await deps.countBets(conn, id) : 0;

		if (teamsChange) {
			if (bets > 0) {
				throw new HttpError(409, ErrorCode.MATCH_HAS_BETS, 'El partido tiene apuestas: no se pueden cambiar los equipos ni la competición.', {
					apuestas: bets,
				});
			}
			const goals = await countGoals(conn, id);
			if (goals > 0) {
				throw new HttpError(409, ErrorCode.MATCH_HAS_GOALS, 'El partido tiene goles registrados: no se pueden cambiar los equipos.', {
					goles: goals,
				});
			}
			await checkTeams(conn, target.competicionId, target.localId, target.visitaId);
		}
		if (dateChange) {
			requireFuture(target.fechaHora, now);
			if (bets > 0 && target.fechaHora < before.fechaHora) {
				throw new HttpError(
					409,
					ErrorCode.MATCH_HAS_BETS,
					'El partido tiene apuestas: solo se puede postergar, no adelantar.',
					{ apuestas: bets, fechaActual: before.fechaHora },
				);
			}
		}

		if (teamsChange) {
			// The sides reference (partido.id, competicion_id): drop them, move the match, add them back.
			await conn.query('DELETE FROM partido_equipo WHERE partido_id = ?', [id]);
		}
		await conn.query('UPDATE partido SET competicion_id = ?, jornada = ?, fecha_hora = ?, sede = ? WHERE id = ?', [
			target.competicionId,
			target.jornada,
			target.fechaHora,
			target.sede,
			id,
		]);
		if (teamsChange) await insertSides(conn, id, target.competicionId, target.localId, target.visitaId);

		return { id, before, after: await find(conn, id, now) };
	});
	return outcome.after!;
}

/**
 * Only a match that hasn't started (`programado`) or was cancelled, with no
 * bets (409 `MATCH_HAS_BETS`), goals (409 `MATCH_HAS_GOALS`) or loaded result
 * (409 `MATCH_HAS_RESULT`). A `finalizado` one is 409 `MATCH_LOCKED`; one in
 * progress (its kick-off came) is 409 `MATCH_NOT_PROGRAMMED`. Its two
 * `partido_equipo` rows go in the same transaction.
 */
export async function deleteMatch(pool: Pool, ctx: AdminActionContext, id: number, deps: MatchDeps): Promise<void> {
	const now = (deps.now ?? (() => new Date()))();
	await runAdminAction<Match>(pool, ctx, 'borrar', 'partido', async (conn) => {
		const before = await findForUpdate(conn, id, now);
		if (before.estado === 'finalizado') {
			throw new HttpError(409, ErrorCode.MATCH_LOCKED, 'El partido está finalizado: no se puede borrar.', { estado: before.estado });
		}
		if (before.estado === 'en_curso') {
			throw new HttpError(409, ErrorCode.MATCH_NOT_PROGRAMMED, 'El partido ya empezó: no se puede borrar.', { estado: before.estado });
		}
		const bets = await deps.countBets(conn, id);
		const goals = await countGoals(conn, id);
		if (bets > 0) {
			throw new HttpError(409, ErrorCode.MATCH_HAS_BETS, `No se puede borrar el partido: tiene ${bets} apuesta(s).`, {
				apuestas: bets,
				goles: goals,
			});
		}
		if (goals > 0) {
			throw new HttpError(409, ErrorCode.MATCH_HAS_GOALS, `No se puede borrar el partido: tiene ${goals} gol(es).`, {
				apuestas: bets,
				goles: goals,
			});
		}
		if (hasLoadedScore(before)) throw resultLoaded(before);
		await conn.query('DELETE FROM partido_equipo WHERE partido_id = ?', [id]);
		await conn.query('DELETE FROM partido WHERE id = ?', [id]);
		return { id, before, after: null };
	});
}
