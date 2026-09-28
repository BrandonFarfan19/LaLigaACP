import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import type { TransactionConnection } from '../db/transaction.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { type OfficialResult, type ResultadoGeneralCodigo, resultOfScore } from '../lib/match-result.js';
import { DURACION_PARTIDO_MINUTOS, hasEnded, hasStarted, matchEndTime } from '../lib/match-state.js';
import type { ConfirmResultBody, SetResultBody } from '../schemas/matches.schema.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { attributedGoals, find, findForUpdate, type Match, stateId } from './matches.service.js';

/**
 * Módulo Informativo, T-12: the official result of a match (BR-028 to
 * BR-032). The admin loads (and corrects) the score, previews it, and
 * confirms it once: the match becomes `finalizado` and is locked for good.
 * Settling the bets is Polla's (T-14), injected as `MatchSettler`, so this
 * file imports nothing from Polla.
 */

/** Extension point: how many selections of the match are still pending (Polla, for the preview). */
export type PendingSelectionsProbe = (db: Pool | PoolConnection, matchId: number) => Promise<number>;

/** The confirmed result handed to the settler. */
export interface SettledMatch extends OfficialResult {
	id: number;
	competicionId: number;
}

/**
 * What the settler paid when the result was confirmed (C-09, BR-057), for the
 * answer and the audit record. Informativo only carries it: never a user id or
 * a balance.
 */
export interface SettlementPayout {
	/** Right selections that got a prize. */
	selecciones: number;
	/** The coins paid in total. */
	monedas: number;
	/** How many participants got at least one. */
	participantes: number;
}

/**
 * Extension point: settles the match's bets (T-14) and pays the prizes (C-09).
 * Called exactly once per confirmation, inside its transaction, after the
 * match became `finalizado` and with its row locked, with whatever
 * `prepareSettlement` returned. Anything it throws rolls the confirmation
 * back; `SettlementRestart` starts the confirmation over. It must only write
 * to the database (a deadlock retry runs it again).
 */
export type MatchSettler = (conn: TransactionConnection, match: SettledMatch, prepared?: unknown) => Promise<SettlementPayout | void>;

/**
 * Extension point (C-09): runs inside the confirmation's transaction **before**
 * the match is locked, with the score the admin is confirming. Polla locks
 * there the rows that the app's lock order puts before `partido` (the users
 * it will pay: usuario → partido). What it returns reaches the settler.
 */
export type SettlementPreparer = (conn: TransactionConnection, matchId: number, result: OfficialResult) => Promise<unknown>;

/**
 * Thrown by the settler when the rows `prepareSettlement` locked no longer
 * cover what it has to change (bets from new users came in before the match
 * was locked). The confirmation is rolled back and run again, up to
 * `MAX_INTENTOS_CONFIRMACION` times, then 409 `CONCURRENT_UPDATE`.
 */
export class SettlementRestart extends Error {
	constructor(message = 'Entraron apuestas nuevas mientras se confirmaba el resultado.') {
		super(message);
		this.name = 'SettlementRestart';
	}
}

/** How many times a confirmation starts over (`SettlementRestart`) before answering 409. */
export const MAX_INTENTOS_CONFIRMACION = 3;

/** How often a confirmation started over, for tests and diagnostics. */
export const confirmationStats = { restarts: 0 };

export interface ResultDeps {
	countPendingSelections: PendingSelectionsProbe;
	settle: MatchSettler;
	/** C-09: locks what must come before the match; see `SettlementPreparer`. */
	prepareSettlement?: SettlementPreparer;
	/** The current time; injectable for tests. */
	now?: () => Date;
}

export interface ResultProblem {
	code: ErrorCode;
	message: string;
}

export interface ScoredGoal {
	id: number;
	minuto: number;
	equipoId: number;
	jugador: { id: number; nombre: string };
}

/** BR-030: what the admin sees before confirming. */
export interface ResultPreview {
	partido: Match;
	competicion: { id: number; nombre: string };
	deporte: { id: number; nombre: string; permiteEmpate: boolean };
	/** Both sides loaded, or `null`. */
	marcador: { golesLocal: number; golesVisitante: number } | null;
	/** BR-029, from the loaded score; `null` while incomplete. */
	resultado: ResultadoGeneralCodigo | null;
	/** The winning team; `null` for a draw or an incomplete score. */
	ganador: { equipoId: number; nombre: string } | null;
	/** Scorers already registered (T-13), by minute. */
	goles: ScoredGoal[];
	/** Selections that confirming will settle (BR-034). */
	seleccionesPendientes: number;
	/** From when the result can be confirmed: the kick-off plus `DURACION_PARTIDO_MINUTOS`. */
	confirmableDesde: Date;
	puedeConfirmar: boolean;
	/** Why it can't be confirmed yet, if so. */
	problemas: ResultProblem[];
	/**
	 * Things worth a look that don't block the confirmation (T-13): goals of
	 * the score without a scorer (`GOALS_UNATTRIBUTED`). Attributing every
	 * goal is not required.
	 */
	avisos: ResultProblem[];
	/** BR-031. */
	advertencia: string;
}

export interface ConfirmedResult {
	partido: Match;
	resultado: OfficialResult;
	/** C-09: what was paid (zero when nothing was right, or with a settler that pays nothing). */
	premios: SettlementPayout;
}

const NO_PAYOUT: SettlementPayout = { selecciones: 0, monedas: 0, participantes: 0 };

const WARNING =
	'Confirmar el resultado es definitivo: el partido pasa a finalizado, el marcador y el ganador ya no se pueden modificar y se liquidan las apuestas.';

const NOT_STARTED = 'El partido todavía no empezó: su resultado se carga desde su fecha y hora.';

const now = (deps: ResultDeps) =>(deps.now ?? (() => new Date()))();

function score(match: Match): { golesLocal: number; golesVisitante: number } | null {
	const { goles: golesLocal } = match.local;
	const { goles: golesVisitante } = match.visita;
	return golesLocal === null || golesVisitante === null ? null : { golesLocal, golesVisitante };
}

/**
 * Where a score (and, T-13, its scorers) can be loaded or corrected: from the
 * kick-off on (the effective state is `en_curso`, lib/match-state.ts), while
 * the result is not confirmed. Never before the kick-off. The user decided a
 * match can get its result long after its date, with no limit.
 * `match.estado` must be the effective state at `at`. The kick-off is
 * checked by itself too, whatever the stored state says: old data from the
 * removed state route may hold an `en_curso` match with a future date.
 */
export function loadingProblem(match: Match, at: Date): ResultProblem | null {
	if (match.estado !== 'finalizado' && match.estado !== 'cancelado' && !hasStarted(match.fechaHora, at)) {
		return { code: ErrorCode.RESULT_NOT_ALLOWED_YET, message: NOT_STARTED };
	}
	switch (match.estado) {
		case 'finalizado':
			return { code: ErrorCode.RESULT_ALREADY_CONFIRMED, message: 'El resultado ya está confirmado: no se puede modificar.' };
		case 'cancelado':
			return { code: ErrorCode.MATCH_LOCKED, message: 'El partido está cancelado: no tiene resultado.' };
		case 'programado':
			return { code: ErrorCode.RESULT_NOT_ALLOWED_YET, message: NOT_STARTED };
		case 'en_curso':
			return null;
	}
}

/** Everything that stops a confirmation, in the order it is reported. */
function confirmationProblems(match: Match, permiteEmpate: boolean, at: Date): ResultProblem[] {
	const blocking = loadingProblem(match, at);
	if (blocking) return [blocking];
	if (!hasEnded(match.fechaHora, at)) {
		return [
			{
				code: ErrorCode.MATCH_NOT_ENDED,
				message: `El partido todavía no terminó: el resultado se confirma desde ${DURACION_PARTIDO_MINUTOS} minutos después de su inicio.`,
			},
		];
	}
	const loaded = score(match);
	if (!loaded) {
		return [{ code: ErrorCode.RESULT_INCOMPLETE, message: 'Faltan los goles de uno o de los dos equipos.' }];
	}
	if (!permiteEmpate && resultOfScore(loaded.golesLocal, loaded.golesVisitante) === 'empate') {
		return [{ code: ErrorCode.DRAW_NOT_ALLOWED, message: 'Este deporte no admite empate: corrige el marcador antes de confirmar.' }];
	}
	return [];
}

/**
 * The match's competition and sport. With `lock`, each is a locking read by
 * primary key (competicion, then deporte, after the match: the lock order in
 * server/README.md), which also sees the latest committed `permite_empate`.
 */
async function sportOf(db: Pool | PoolConnection, competicionId: number, lock: boolean) {
	const forShare = lock ? ' FOR SHARE' : '';
	const [[competition]] = await db.query<RowDataPacket[]>(
		`SELECT id, nombre, deporte_id FROM competicion FORCE INDEX (PRIMARY) WHERE id = ?${forShare}`,
		[competicionId],
	);
	const [[sport]] = await db.query<RowDataPacket[]>(
		`SELECT id, nombre, permite_empate FROM deporte FORCE INDEX (PRIMARY) WHERE id = ?${forShare}`,
		[competition!.deporte_id],
	);
	return {
		competicion: { id: Number(competition!.id), nombre: String(competition!.nombre) },
		deporte: { id: Number(sport!.id), nombre: String(sport!.nombre), permiteEmpate: Boolean(sport!.permite_empate) },
	};
}

/**
 * BR-028: loads or corrects both sides of the score, from the kick-off and
 * while the result is not confirmed (see `loadingProblem`). The stored state
 * becomes `en_curso` if it still said `programado` (it already was, in effect).
 * The score stays private (the public API shows it only once confirmed).
 */
export async function setResult(pool: Pool, ctx: AdminActionContext, id: number, input: SetResultBody, deps: ResultDeps): Promise<Match> {
	const at = now(deps);
	const outcome = await runAdminAction<Match>(pool, ctx, 'registrar_resultado', 'partido', async (conn) => {
		const before = await findForUpdate(conn, id, at);
		const problem = loadingProblem(before, at);
		if (problem) throw new HttpError(409, problem.code, problem.message, { estado: before.estado });
		// T-13: never below the goals already attributed to a side (delete or move those first).
		const attributed = await attributedGoals(conn, id);
		if (input.golesLocal < attributed.local || input.golesVisitante < attributed.visita) {
			throw new HttpError(
				409,
				ErrorCode.SCORE_BELOW_GOALS,
				'El marcador no puede tener menos goles que los ya registrados con su autor: borra o corrige esos goles primero.',
				{ golesAtribuidos: attributed },
			);
		}

		await conn.query('UPDATE partido_equipo SET goles = IF(es_visita, ?, ?) WHERE partido_id = ?', [
			input.golesVisitante,
			input.golesLocal,
			id,
		]);
		await conn.query('UPDATE partido SET estado_partido_id = ? WHERE id = ? AND estado_partido_id = ?', [
			await stateId(conn, 'en_curso'),
			id,
			await stateId(conn, 'programado'),
		]);
		return { id, before, after: await find(conn, id, at) };
	});
	return outcome.after!;
}

/** BR-030: the summary before confirming. Writes and locks nothing. */
export async function getResultPreview(pool: Pool, id: number, deps: ResultDeps): Promise<ResultPreview> {
	const at = now(deps);
	const partido = await find(pool, id, at);
	const { competicion, deporte } = await sportOf(pool, partido.competicionId, false);
	const [goals] = await pool.query<RowDataPacket[]>(
		`SELECT g.id, g.minuto, g.equipo_id, j.id AS jugador_id, j.nombre AS jugador_nombre
		FROM gol g
		JOIN partido_equipo pe ON pe.id = g.partido_equipo_id
		JOIN plantel pl ON pl.id = g.plantel_id
		JOIN jugador j ON j.id = pl.jugador_id
		WHERE pe.partido_id = ?
		ORDER BY g.minuto, g.id`,
		[id],
	);
	const marcador = score(partido);
	const resultado = marcador ? resultOfScore(marcador.golesLocal, marcador.golesVisitante) : null;
	const ganador =
		resultado === 'local_gana'
			? { equipoId: partido.local.equipoId, nombre: partido.local.nombre }
			: resultado === 'visitante_gana'
				? { equipoId: partido.visita.equipoId, nombre: partido.visita.nombre }
				: null;
	const problemas = confirmationProblems(partido, deporte.permiteEmpate, at);
	const avisos: ResultProblem[] = [];
	if (marcador) {
		const attributed = await attributedGoals(pool, id);
		const missing = marcador.golesLocal - attributed.local + (marcador.golesVisitante - attributed.visita);
		if (missing > 0) {
			avisos.push({
				code: ErrorCode.GOALS_UNATTRIBUTED,
				message: `${missing === 1 ? '1 gol del marcador no tiene' : `${missing} goles del marcador no tienen`} autor registrado. Se puede confirmar igual.`,
			});
		}
	}
	return {
		partido,
		competicion,
		deporte,
		marcador,
		resultado,
		ganador,
		goles: goals.map((g) => ({
			id: Number(g.id),
			minuto: Number(g.minuto),
			equipoId: Number(g.equipo_id),
			jugador: { id: Number(g.jugador_id), nombre: String(g.jugador_nombre) },
		})),
		seleccionesPendientes: await deps.countPendingSelections(pool, id),
		/** From when the result can be confirmed (BR-031): kick-off + 60 min. */
		confirmableDesde: matchEndTime(partido.fechaHora),
		puedeConfirmar: problemas.length === 0,
		problemas,
		avisos,
		advertencia: WARNING,
	};
}

/**
 * BR-031, BR-032: confirms the loaded result, once and for good, and only
 * once the match's time is over (kick-off + 60 min, else 409
 * `MATCH_NOT_ENDED`). With the
 * match row locked (then its competition and sport, in the lock order): the
 * score must be complete, the one the admin saw (\`input\`), and not a draw in
 * a sport without draws. The match becomes \`finalizado\`, which every other
 * write refuses from then on (409 \`MATCH_LOCKED\` / \`RESULT_ALREADY_CONFIRMED\`),
 * and the settler runs in the same transaction (BR-034, BR-040) and pays the
 * prizes (C-09, BR-057).
 *
 * Lock order (C-09): paying locks users, and the app locks usuario → partido.
 * So `prepareSettlement` runs first, before the match is locked, and the
 * settler starts over (`SettlementRestart`) if bets from other users came in
 * meanwhile, like the cancellation (T-16). `READ COMMITTED`, so every read
 * after the match lock sees what committed before it.
 */
export async function confirmResult(
	pool: Pool,
	ctx: AdminActionContext,
	id: number,
	input: ConfirmResultBody,
	deps: ResultDeps,
): Promise<ConfirmedResult> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await confirmOnce(pool, ctx, id, input, deps);
		} catch (error) {
			if (!(error instanceof SettlementRestart)) throw error;
			confirmationStats.restarts++;
			if (attempt >= MAX_INTENTOS_CONFIRMACION) {
				throw HttpError.conflict(ErrorCode.CONCURRENT_UPDATE, 'Siguen entrando apuestas a este partido: vuelve a intentar la confirmación.');
			}
		}
	}
}

async function confirmOnce(pool: Pool, ctx: AdminActionContext, id: number, input: ConfirmResultBody, deps: ResultDeps): Promise<ConfirmedResult> {
	const at = now(deps);
	let confirmed: OfficialResult | undefined;
	let payout: SettlementPayout = NO_PAYOUT;
	const outcome = await runAdminAction<Match>(pool, ctx, 'confirmar_resultado', 'partido', async (conn) => {
		// C-09: whatever must be locked before the match (the users to pay), with the score being confirmed.
		const prepared = await deps.prepareSettlement?.(conn, id, {
			golesLocal: input.golesLocal,
			golesVisitante: input.golesVisitante,
			resultado: resultOfScore(input.golesLocal, input.golesVisitante),
		});
		const before = await findForUpdate(conn, id, at);
		const { deporte } = await sportOf(conn, before.competicionId, true);
		const [problem] = confirmationProblems(before, deporte.permiteEmpate, at);
		if (problem) throw new HttpError(409, problem.code, problem.message, { estado: before.estado });

		const loaded = score(before)!;
		if (loaded.golesLocal !== input.golesLocal || loaded.golesVisitante !== input.golesVisitante) {
			throw new HttpError(409, ErrorCode.RESULT_CHANGED, 'El marcador cambió desde la vista previa: revísalo antes de confirmar.', loaded);
		}

		await conn.query('UPDATE partido SET estado_partido_id = ? WHERE id = ?', [await stateId(conn, 'finalizado'), id]);
		const result: OfficialResult = { ...loaded, resultado: resultOfScore(loaded.golesLocal, loaded.golesVisitante) };
		payout = (await deps.settle(conn, { id, competicionId: before.competicionId, ...result }, prepared)) ?? NO_PAYOUT;
		confirmed = result;
		// The audit record carries the counts only (never who got what).
		return { id, before, after: await find(conn, id, at), detail: { premios: { ...payout } } };
	}, { isolation: 'READ COMMITTED' });
	return { partido: outcome.after!, resultado: confirmed!, premios: payout };
}
