import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { assertInTransaction, type TransactionConnection } from '../db/transaction.js';
import {
	allowedResults,
	bettingCloseTime,
	bettingState,
	type EstadoApuesta,
	MAX_GOLES_PRONOSTICO,
	openKickoffsAfter,
	type ResultadoGeneralCodigo,
	resultOfScore,
	type TipoApuestaCodigo,
} from '../lib/betting.js';
import { COSTO_POR_SELECCION } from '../lib/coins.js';
import { ErrorCode } from '../lib/error-codes.js';
import { proximityOrderBy } from '../lib/match-order.js';
import { effectiveStateCondition } from '../lib/match-state.js';
import type { SelectionInput } from '../schemas/betting.schema.js';
import type { Page } from '../schemas/common.schema.js';
import { pageOf, Where } from './catalog-query.js';
import { MATCH_COLUMNS, MATCH_FROM, matchFrom, type PublicMatch } from './public.service.js';

/**
 * Módulo Polla, T-09: which matches take bets and whether a proposed list of
 * selections is valid (BR-014 to BR-021, BR-051, BR-052). Nothing here
 * writes: T-10 creates the ticket, using `evaluateTicketInTransaction` to
 * check the same rules with the rows locked.
 *
 * It reads Informativo's matches and sports (allowed: Polla depends on
 * Informativo, never the other way around).
 */

/** What a match admits, per bet type (BR-015, BR-016). */
export interface AdmittedForecasts {
	resultadoGeneral: ResultadoGeneralCodigo[];
	marcadorExacto: { golesMinimos: 0; golesMaximos: number; admiteEmpate: boolean };
}

export interface BettingInfo {
	/** BR-052. Only `disponible` takes selections. */
	estado: EstadoApuesta;
	/** BR-014: `fechaHora - 24 h`. */
	cierre: Date;
	/** By the sport's rule; they only apply while `estado` is `disponible`. */
	pronosticosAdmitidos: AdmittedForecasts;
}

export interface BettingMatch extends PublicMatch {
	apuesta: BettingInfo;
}

function admittedForecasts(permiteEmpate: boolean): AdmittedForecasts {
	return {
		resultadoGeneral: allowedResults(permiteEmpate),
		marcadorExacto: { golesMinimos: 0, golesMaximos: MAX_GOLES_PRONOSTICO, admiteEmpate: permiteEmpate },
	};
}

function bettingMatchFrom(row: RowDataPacket, now: Date): BettingMatch {
	const match = matchFrom(row, now);
	return {
		...match,
		apuesta: {
			estado: bettingState(match.estado, match.fechaHora, now),
			cierre: bettingCloseTime(match.fechaHora),
			pronosticosAdmitidos: admittedForecasts(match.deporte.permiteEmpate),
		},
	};
}

export interface ListBettingMatchesFilters {
	page: number;
	pageSize: number;
	deporteId?: number;
	competicionId?: number;
	desde?: Date;
	hasta?: Date;
	estadoApuesta?: EstadoApuesta;
}

/**
 * Every match with its betting state (BR-052), in the BR-013 proximity order.
 * Filters by sport and date (BR-051) and by betting state.
 */
export function listBettingMatches(pool: Pool, query: ListBettingMatchesFilters, now: Date = new Date()): Promise<Page<BettingMatch>> {
	const where = new Where();
	if (query.deporteId) where.add('p.competicion_id IN (SELECT dc.id FROM competicion dc WHERE dc.deporte_id = ?)', query.deporteId);
	if (query.competicionId) where.add('p.competicion_id = ?', query.competicionId);
	if (query.desde) where.add('p.fecha_hora >= ?', query.desde);
	if (query.hasta) where.add('p.fecha_hora <= ?', query.hasta);
	switch (query.estadoApuesta) {
		case undefined:
			break;
		case 'disponible':
			where.add("ep.codigo = 'programado' AND p.fecha_hora > ?", openKickoffsAfter(now));
			break;
		case 'cerrada': {
			// Closed for bets but not started yet: once the kick-off comes it is en_curso.
			const notStarted = effectiveStateCondition('programado', now);
			where.add(`${notStarted.sql} AND p.fecha_hora <= ?`, ...notStarted.params, openKickoffsAfter(now));
			break;
		}
		default: {
			const state = effectiveStateCondition(query.estadoApuesta, now);
			where.add(state.sql, ...state.params);
		}
	}
	const order = proximityOrderBy('p.fecha_hora', 'p.id', now);
	return pageOf(
		pool,
		{ columns: MATCH_COLUMNS, from: MATCH_FROM, where, orderBy: order.sql, orderParams: order.params },
		query,
		(row) => bettingMatchFrom(row, now),
	);
}

// --- ticket evaluation ------------------------------------------------------

export interface SelectionError {
	code: ErrorCode;
	message: string;
	/** `BETTING_CLOSED` only: when betting closed (UTC), for the UI to format. Kept out of `message`. */
	cierre?: Date;
}

export interface EvaluatedSelection {
	/** Position in the request, from 0. */
	indice: number;
	partidoId: number;
	tipo: TipoApuestaCodigo;
	/** `resultado_general` only. */
	pronostico: ResultadoGeneralCodigo | null;
	/** `marcador_exacto` only. */
	golesLocal: number | null;
	golesVisitante: number | null;
	/** BR-020. */
	costo: number;
	valida: boolean;
	errores: SelectionError[];
	/**
	 * Index of an earlier selection identical to this one, or `null`. Repeating
	 * is allowed (T-09 decision: no rule forbids it, and each one costs its
	 * coin); the frontend can use this to ask "¿seguro?".
	 */
	repiteA: number | null;
	/** The match as the betting list shows it; `null` if it doesn't exist. */
	partido: BettingMatch | null;
}

export interface TicketEvaluation {
	/** Every selection valid and enough balance: T-10 would accept it. */
	valido: boolean;
	selecciones: EvaluatedSelection[];
	cantidadSelecciones: number;
	costoPorSeleccion: number;
	/** BR-020: `cantidadSelecciones × costoPorSeleccion`, valid or not. */
	costoTotal: number;
	saldoActual: number;
	/** `saldoActual - costoTotal`; negative when the balance falls short. */
	saldoPosterior: number;
	/** BR-021. */
	saldoSuficiente: boolean;
	/** Ticket-level problems (today only `INSUFFICIENT_BALANCE`). */
	errores: SelectionError[];
}

const MESSAGES = {
	notFound: 'No existe ese partido.',
	closed: 'Las apuestas para este partido ya cerraron (cierran 24 horas antes del inicio).',
	notProgrammed: (estado: string) => `El partido está ${estado.replace('_', ' ')}: ya no recibe apuestas.`,
	draw: 'Este deporte no admite empate.',
	drawScore: 'Este deporte no admite empate: el marcador exacto no puede ser un empate.',
} as const;

function selectionErrors(selection: SelectionInput, match: BettingMatch | undefined): SelectionError[] {
	if (!match) return [{ code: ErrorCode.MATCH_NOT_FOUND, message: MESSAGES.notFound }];
	const errors: SelectionError[] = [];
	const { estado, cierre } = match.apuesta;
	if (estado === 'cerrada') errors.push({ code: ErrorCode.BETTING_CLOSED, message: MESSAGES.closed, cierre });
	else if (estado !== 'disponible') errors.push({ code: ErrorCode.MATCH_NOT_PROGRAMMED, message: MESSAGES.notProgrammed(estado) });

	if (!match.deporte.permiteEmpate) {
		// BR-015: a draw is neither offered nor accepted. An exact score that is a
		// draw is the same forecast, so it is refused too (T-09 decision).
		if (selection.tipo === 'resultado_general' && selection.pronostico === 'empate') {
			errors.push({ code: ErrorCode.DRAW_NOT_ALLOWED, message: MESSAGES.draw });
		}
		if (selection.tipo === 'marcador_exacto' && resultOfScore(selection.golesLocal, selection.golesVisitante) === 'empate') {
			errors.push({ code: ErrorCode.DRAW_NOT_ALLOWED, message: MESSAGES.drawScore });
		}
	}
	return errors;
}

const selectionKey = (s: SelectionInput) =>
	s.tipo === 'resultado_general' ? `${s.partidoId}:r:${s.pronostico}` : `${s.partidoId}:m:${s.golesLocal}-${s.golesVisitante}`;

interface Loaded {
	matches: RowDataPacket[];
	saldo: number;
}

async function readMatches(pool: Pool, userId: number, ids: readonly number[]): Promise<Loaded> {
	const [[user]] = await pool.query<RowDataPacket[]>('SELECT saldo_monedas FROM usuario WHERE id = ?', [userId]);
	const [matches] = await pool.query<RowDataPacket[]>(`SELECT ${MATCH_COLUMNS} ${MATCH_FROM} WHERE p.id IN (?)`, [ids]);
	return { matches, saldo: Number(user?.saldo_monedas ?? 0) };
}

/** `SELECT id FROM <table> WHERE id IN (...) ORDER BY id FOR <mode>` by primary key only: the rows, and nothing else, in id order. */
async function lockByPrimaryKey(
	conn: PoolConnection,
	table: 'usuario' | 'partido' | 'competicion' | 'deporte',
	ids: readonly number[],
	mode: 'UPDATE' | 'SHARE',
	columns = 'id',
): Promise<RowDataPacket[]> {
	if (ids.length === 0) return [];
	const [rows] = await conn.query<RowDataPacket[]>(
		`SELECT ${columns} FROM ${table} FORCE INDEX (PRIMARY) WHERE id IN (?) ORDER BY id FOR ${mode}`,
		[ids],
	);
	return rows;
}

/**
 * The match data, for rows already locked. It locks `partido` again (a no-op
 * for the rows, read through the primary key first) so its state and date are
 * the latest committed ones; the other tables are only read. Pinned plan:
 * with small tables MySQL would otherwise scan `competicion` or `deporte`
 * and, if they were in the `OF` list, lock every row and gap.
 */
async function readMatchesLocked(conn: PoolConnection, locked: readonly RowDataPacket[]): Promise<RowDataPacket[]> {
	const [rows] = await conn.query<RowDataPacket[]>(
		`SELECT STRAIGHT_JOIN ${MATCH_COLUMNS} ${MATCH_FROM.replace('FROM partido p', 'FROM partido p FORCE INDEX (PRIMARY)')}
		WHERE p.id IN (?) ORDER BY p.id FOR SHARE OF p`,
		[locked.map((m) => Number(m.id))],
	);
	return rows;
}

/**
 * The lock order every transaction in the app follows (server/README.md,
 * "Orden de bloqueo"): usuario → partido → competicion → deporte, each with
 * its own statement by primary key, in id order. A single locking SELECT
 * over the joined match query has no fixed plan: MySQL sometimes entered
 * through `estado_partido` and took next-key locks on `fk_partido_estado`,
 * which deadlocked with `changeMatchState`'s UPDATE (T-09 stress test).
 *
 * - usuario `FOR UPDATE`: T-10's debit takes that lock next; taking a shared
 *   one first and upgrading later would deadlock two tickets.
 * - partido, competicion, deporte `FOR SHARE`: `updateMatch` /
 *   `changeMatchState` (partido), `updateCompetition` (its sport) and
 *   `updateSport` (`permite_empate`) wait until the ticket commits, and two
 *   tickets on the same match don't block each other.
 *
 * Then the match data is read (`readMatchesLocked`). The facts the rules use
 * come from locking reads, which always see the latest committed rows: a
 * plain read could see the transaction's older snapshot and miss a change
 * that committed while this transaction waited for a lock.
 */
async function lockAndReadMatches(conn: PoolConnection, userId: number, ids: readonly number[]): Promise<Loaded> {
	const [user] = await lockByPrimaryKey(conn, 'usuario', [userId], 'UPDATE', 'id, saldo_monedas');
	const saldo = Number(user?.saldo_monedas ?? 0);
	// Only ids that exist: locking a missing id takes a gap lock on partido's
	// PRIMARY (up to the supremum for an id past the last one), which would
	// block createMatch until this transaction ends. A match deleted between
	// this read and the lock can still leave one; deleteMatch is rare and
	// refuses matches with bets.
	const [existing] = await conn.query<RowDataPacket[]>('SELECT id FROM partido WHERE id IN (?)', [ids]);
	const existingIds = existing.map((row) => Number(row.id)).sort((a, b) => a - b);
	const matches = await lockByPrimaryKey(conn, 'partido', existingIds, 'SHARE', 'id, competicion_id');
	const competitionIds = [...new Set(matches.map((m) => Number(m.competicion_id)))].sort((a, b) => a - b);
	const competitions = await lockByPrimaryKey(conn, 'competicion', competitionIds, 'SHARE', 'id, deporte_id');
	const sportIds = [...new Set(competitions.map((c) => Number(c.deporte_id)))].sort((a, b) => a - b);
	const sports = await lockByPrimaryKey(conn, 'deporte', sportIds, 'SHARE', 'id, permite_empate');
	if (matches.length === 0) return { matches: [], saldo };

	const rows = await readMatchesLocked(conn, matches);
	// What the rules depend on comes from the locked rows above (current by
	// definition), not from the join, which may read an older snapshot.
	const sportOfCompetition = new Map(competitions.map((c) => [Number(c.id), Number(c.deporte_id)]));
	const drawAllowed = new Map(sports.map((d) => [Number(d.id), d.permite_empate]));
	for (const row of rows) {
		const sportId = sportOfCompetition.get(Number(row.c_id))!;
		row.d_id = sportId;
		row.d_permite_empate = drawAllowed.get(sportId);
	}
	return { matches: rows, saldo };
}

async function evaluate(
	selections: readonly SelectionInput[],
	now: Date,
	/** Reads the balance and the matches (locking them first, in a transaction). */
	load: (ids: readonly number[]) => Promise<Loaded>,
): Promise<TicketEvaluation> {
	const ids = [...new Set(selections.map((s) => s.partidoId))].sort((a, b) => a - b);
	const { matches: rows, saldo: saldoActual } = await load(ids);

	const matches = new Map(rows.map((row) => [Number(row.id), bettingMatchFrom(row, now)]));

	const firstSeen = new Map<string, number>();
	const evaluated = selections.map((selection, indice): EvaluatedSelection => {
		const match = matches.get(selection.partidoId);
		const errores = selectionErrors(selection, match);
		const key = selectionKey(selection);
		const repiteA = firstSeen.get(key) ?? null;
		if (repiteA === null) firstSeen.set(key, indice);
		return {
			indice,
			partidoId: selection.partidoId,
			tipo: selection.tipo,
			pronostico: selection.tipo === 'resultado_general' ? selection.pronostico : null,
			golesLocal: selection.tipo === 'marcador_exacto' ? selection.golesLocal : null,
			golesVisitante: selection.tipo === 'marcador_exacto' ? selection.golesVisitante : null,
			costo: COSTO_POR_SELECCION,
			valida: errores.length === 0,
			errores,
			repiteA,
			partido: match ?? null,
		};
	});

	const costoTotal = selections.length * COSTO_POR_SELECCION;
	const saldoSuficiente = saldoActual >= costoTotal;
	const errores: SelectionError[] = saldoSuficiente
		? []
		: [
				{
					code: ErrorCode.INSUFFICIENT_BALANCE,
					message: `El ticket cuesta ${costoTotal} moneda(s) y tu saldo es ${saldoActual}.`,
				},
			];
	return {
		valido: saldoSuficiente && evaluated.every((s) => s.valida),
		selecciones: evaluated,
		cantidadSelecciones: selections.length,
		costoPorSeleccion: COSTO_POR_SELECCION,
		costoTotal,
		saldoActual,
		saldoPosterior: saldoActual - costoTotal,
		saldoSuficiente,
		errores,
	};
}

/**
 * BR-023 preview: the ticket as it would be now, without writing or locking
 * anything. The answer can go stale at once (a close passes, a match
 * starts); T-10 checks again inside its transaction.
 */
export function previewTicket(
	pool: Pool,
	userId: number,
	selections: readonly SelectionInput[],
	now: Date = new Date(),
): Promise<TicketEvaluation> {
	return evaluate(selections, now, (ids) => readMatches(pool, userId, ids));
}

/**
 * The same checks for T-10, inside its `withTransaction`: locks the user row
 * (`FOR UPDATE`, like the debit that follows) and every match, competition
 * and sport row involved (`FOR SHARE`), in the app's lock order (see
 * `lockAndReadMatches`), so what was checked still holds at commit. Call it
 * before anything else in the transaction. The caller refuses the ticket
 * unless `valido`.
 */
export async function evaluateTicketInTransaction(
	conn: TransactionConnection,
	userId: number,
	selections: readonly SelectionInput[],
	now: Date = new Date(),
): Promise<TicketEvaluation> {
	// Inside the async function, so a wrong connection rejects the promise (like the coin functions).
	assertInTransaction(conn);
	return evaluate(selections, now, (ids) => lockAndReadMatches(conn, userId, ids));
}
