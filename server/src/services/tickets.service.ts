import { createHash } from 'node:crypto';
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { type TransactionConnection, withTransaction } from '../db/transaction.js';
import {
	type EstadoSeleccion,
	type EstadoTicket,
	type ResultadoGeneralCodigo,
	type TicketCounts,
	type TipoApuestaCodigo,
	ticketStateFromCounts,
} from '../lib/betting.js';
import { COSTO_POR_SELECCION, DEVOLUCION_POR_SELECCION } from '../lib/coins.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { type OfficialResult, officialResult } from '../lib/match-result.js';
import type { SelectionInput } from '../schemas/betting.schema.js';
import { evaluateTicketInTransaction } from './betting.service.js';
import { debitSelections } from './coins.service.js';
import { MATCH_COLUMNS, MATCH_FROM, matchFrom, type PublicMatch } from './public.service.js';

/**
 * Módulo Polla, T-10: confirming a ticket (BR-019, BR-022 to BR-025, BR-053,
 * BR-054) and reading one back as a receipt. Everything a ticket shows that
 * can be computed (coins used, state, points) is computed here, never stored
 * (EsquemaBD D13, D14).
 */

/** BR-026/BR-029: the match's actual result, only once it is `finalizado` with both sides loaded (BR-049). */
export type RealResult = OfficialResult;

export interface TicketSelectionView {
	id: number;
	partido: PublicMatch;
	/** `null` until the result is confirmed and complete. */
	resultadoReal: RealResult | null;
	tipo: TipoApuestaCodigo;
	/** `resultado_general` only. */
	pronostico: ResultadoGeneralCodigo | null;
	/** `marcador_exacto` only. */
	golesLocal: number | null;
	golesVisitante: number | null;
	/** BR-027. */
	estado: EstadoSeleccion;
	/** BR-020. */
	costo: number;
	/** `null` until the match's result is confirmed (T-12). */
	puntosObtenidos: number | null;
}

/** What a ticket shows that is computed from its selections (BR-025), shared by the receipt and the history (T-11). */
export interface TicketTotals {
	/** Derived from the selections (`ticketStateFromCounts`). */
	estado: EstadoTicket;
	cantidadSelecciones: number;
	/** BR-020, D14: selections × cost. Refunds don't change it. */
	monedasUtilizadas: number;
	/** BR-046: one coin back per voided selection. */
	monedasDevueltas: number;
	/** BR-040: the sum of the settled selections' points (0 while none is settled). */
	puntosObtenidos: number;
}

/** BR-025: what the receipt shows. */
export interface TicketView extends TicketTotals {
	id: number;
	usuario: { id: number; nombre: string };
	/** UTC. */
	creadoEn: Date;
	selecciones: TicketSelectionView[];
}

export interface ConfirmedTicket {
	ticket: TicketView;
	/** `true` when the key had already created this ticket: nothing was written now. */
	repetido: boolean;
}

type Db = Pool | PoolConnection;

/** The official result of the match card (`officialResult`, lib/match-result.ts), for BR-026. */
export function realResult(match: PublicMatch): RealResult | null {
	return officialResult(match.estado, match.local.goles, match.visita.goles);
}

/** BR-025 totals from counts: the receipt counts its selections, the history (T-11) gets them from SQL. */
export function ticketTotals(counts: TicketCounts & { puntos: number }): TicketTotals {
	return {
		estado: ticketStateFromCounts(counts),
		cantidadSelecciones: counts.total,
		monedasUtilizadas: counts.total * COSTO_POR_SELECCION,
		monedasDevueltas: counts.anuladas * DEVOLUCION_POR_SELECCION,
		puntosObtenidos: counts.puntos,
	};
}

/**
 * One selection with its match, for the receipt and the history: columns
 * (prefixed `s_`, plus the public match columns) and the joins after
 * `seleccion s` and `partido p` (Informativo's `MATCH_FROM`, without its FROM).
 */
export const SELECTION_COLUMNS = `s.id AS s_id, tap.codigo AS s_tipo, rg.codigo AS s_pronostico,
	s.pronostico_goles_local AS s_goles_local, s.pronostico_goles_visitante AS s_goles_visitante,
	es.codigo AS s_estado, s.puntos_obtenidos AS s_puntos,
	${MATCH_COLUMNS}`;
export const SELECTION_JOINS = `${MATCH_FROM.replace('FROM partido p', 'JOIN partido p ON p.id = s.partido_id')}
	JOIN tipo_apuesta tap ON tap.id = s.tipo_apuesta_id
	LEFT JOIN resultado_general rg ON rg.id = s.pronostico_resultado_id
	JOIN estado_seleccion es ON es.id = s.estado_seleccion_id`;

export function selectionFrom(row: RowDataPacket): TicketSelectionView {
	const partido = matchFrom(row);
	return {
		id: Number(row.s_id),
		partido,
		resultadoReal: realResult(partido),
		tipo: row.s_tipo as TipoApuestaCodigo,
		pronostico: (row.s_pronostico ?? null) as ResultadoGeneralCodigo | null,
		golesLocal: row.s_goles_local === null ? null : Number(row.s_goles_local),
		golesVisitante: row.s_goles_visitante === null ? null : Number(row.s_goles_visitante),
		estado: row.s_estado as EstadoSeleccion,
		costo: COSTO_POR_SELECCION,
		puntosObtenidos: row.s_puntos === null ? null : Number(row.s_puntos),
	};
}

async function readTicket(db: Db, userId: number, ticketId: number): Promise<TicketView> {
	const [[ticket]] = await db.query<RowDataPacket[]>(
		`SELECT t.id, t.creado_en, u.id AS usuario_id, u.nombre AS usuario_nombre
		FROM ticket t JOIN usuario u ON u.id = t.usuario_id
		WHERE t.id = ? AND t.usuario_id = ?`,
		[ticketId, userId],
	);
	// Someone else's ticket answers exactly like a missing one (see the route).
	if (!ticket) throw HttpError.notFound('No existe ese ticket.', ErrorCode.TICKET_NOT_FOUND);

	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT ${SELECTION_COLUMNS} FROM seleccion s ${SELECTION_JOINS} WHERE s.ticket_id = ? ORDER BY s.id`,
		[ticketId],
	);
	const selecciones = rows.map(selectionFrom);
	return {
		id: Number(ticket.id),
		usuario: { id: Number(ticket.usuario_id), nombre: String(ticket.usuario_nombre) },
		creadoEn: ticket.creado_en as Date,
		...ticketTotals({
			total: selecciones.length,
			pendientes: selecciones.filter((x) => x.estado === 'pendiente').length,
			anuladas: selecciones.filter((x) => x.estado === 'anulada').length,
			puntos: selecciones.reduce((sum, x) => sum + (x.puntosObtenidos ?? 0), 0),
		}),
		selecciones,
	};
}

/** The receipt of one of the user's own tickets. Someone else's: 404, like a missing one. */
export function getTicket(pool: Pool, userId: number, ticketId: number): Promise<TicketView> {
	return readTicket(pool, userId, ticketId);
}

/**
 * What identifies "the same request" for an idempotency key: the selections,
 * in order, with only the fields that matter. SHA-256, hex.
 */
export function requestFingerprint(selections: readonly SelectionInput[]): string {
	const canonical = selections.map((s) =>
		s.tipo === 'resultado_general'
			? [s.partidoId, s.tipo, s.pronostico]
			: [s.partidoId, s.tipo, s.golesLocal, s.golesVisitante],
	);
	return createHash('sha256').update(`ticket-v1:${JSON.stringify(canonical)}`).digest('hex');
}

async function catalogIds(conn: TransactionConnection, table: 'tipo_apuesta' | 'resultado_general' | 'estado_seleccion') {
	const [rows] = await conn.query<RowDataPacket[]>(`SELECT id, codigo FROM ${table}`);
	return new Map(rows.map((row) => [String(row.codigo), Number(row.id)]));
}

async function insertTicket(
	conn: TransactionConnection,
	userId: number,
	key: string,
	fingerprint: string,
	selections: readonly SelectionInput[],
	now: Date,
): Promise<number> {
	const [ticket] = await conn.query<ResultSetHeader>(
		'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, ?, ?, ?)',
		[userId, new Date(Math.floor(now.getTime() / 1000) * 1000), key, fingerprint],
	);
	const tipos = await catalogIds(conn, 'tipo_apuesta');
	const resultados = await catalogIds(conn, 'resultado_general');
	const pendiente = (await catalogIds(conn, 'estado_seleccion')).get('pendiente');

	// One row at a time: each debit needs its own selection id (D19).
	const seleccionIds: number[] = [];
	for (const s of selections) {
		const [row] = await conn.query<ResultSetHeader>(
			`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id,
				pronostico_goles_local, pronostico_goles_visitante, estado_seleccion_id, puntos_obtenidos)
			VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
			[
				ticket.insertId,
				s.partidoId,
				tipos.get(s.tipo),
				s.tipo === 'resultado_general' ? resultados.get(s.pronostico) : null,
				s.tipo === 'marcador_exacto' ? s.golesLocal : null,
				s.tipo === 'marcador_exacto' ? s.golesVisitante : null,
				pendiente,
			],
		);
		seleccionIds.push(row.insertId);
	}
	// BR-022, BR-053: the debit, one movement per selection, in this same transaction.
	await debitSelections(conn, userId, seleccionIds);
	return ticket.insertId;
}

/**
 * BR-024/BR-025: confirms a ticket, all or nothing, in one transaction (BR-053).
 *
 * 1. Locks the user (first in the app's lock order), then looks for the key
 *    (BR-054). Two requests of the same user run one after the other, so a
 *    repeated key always sees the ticket the first one committed: the same
 *    selections return that ticket (`repetido`), other selections are 409
 *    `IDEMPOTENCY_KEY_REUSED`.
 * 2. Evaluates the selections with the rows locked (T-09). Any invalid one,
 *    or a short balance, is 409 `TICKET_REJECTED` with the whole evaluation in
 *    `details` (same shape as the preview), and nothing is written.
 * 3. Creates the ticket and its selections (`pendiente`, no points) and debits
 *    one coin per selection.
 *
 * `READ COMMITTED`: every plain read sees the latest commit, and searches take
 * no gap locks. A deadlock retry (withTransaction) runs all of it again,
 * including the key lookup, so it can't create a second ticket either.
 */
export function confirmTicket(
	pool: Pool,
	userId: number,
	key: string,
	selections: readonly SelectionInput[],
	now: Date = new Date(),
): Promise<ConfirmedTicket> {
	const fingerprint = requestFingerprint(selections);
	return withTransaction(
		pool,
		async (conn) => {
			await conn.query('SELECT id FROM usuario FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE', [userId]);
			const [[existing]] = await conn.query<RowDataPacket[]>(
				'SELECT id, huella_solicitud FROM ticket WHERE usuario_id = ? AND clave_idempotencia = ?',
				[userId, key],
			);
			if (existing) {
				if (existing.huella_solicitud !== fingerprint) {
					throw new HttpError(
						409,
						ErrorCode.IDEMPOTENCY_KEY_REUSED,
						'Esa clave de idempotencia ya se usó con otras selecciones. Usá una clave nueva para otro ticket.',
						{ ticketId: Number(existing.id) },
					);
				}
				return { ticket: await readTicket(conn, userId, Number(existing.id)), repetido: true };
			}

			const evaluation = await evaluateTicketInTransaction(conn, userId, selections, now);
			if (!evaluation.valido) {
				throw new HttpError(
					409,
					ErrorCode.TICKET_REJECTED,
					'El ticket no se confirmó: revisá las selecciones marcadas o tu saldo. No se descontó nada.',
					evaluation,
				);
			}
			const ticketId = await insertTicket(conn, userId, key, fingerprint, selections, now);
			return { ticket: await readTicket(conn, userId, ticketId), repetido: false };
		},
		{ isolation: 'READ COMMITTED' },
	);
}
