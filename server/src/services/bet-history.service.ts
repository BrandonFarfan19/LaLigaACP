import type { Pool, RowDataPacket } from 'mysql2/promise';
import { withReadSnapshot } from '../db/transaction.js';
import { type EstadoSeleccion, type EstadoTicket, ticketStateCondition } from '../lib/betting.js';
import type { ListMyBetsQuery } from '../schemas/betting.schema.js';
import { type Page, toPage } from '../schemas/common.schema.js';
import { Where } from './catalog-query.js';
import {
	REFUND_TYPE,
	SELECTION_COLUMNS,
	SELECTION_JOINS,
	selectionFrom,
	type TicketSelectionView,
	type TicketTotals,
	ticketTotals,
} from './tickets.service.js';

/**
 * Módulo Polla, T-11: "Mis apuestas" (BR-026, BR-027). Only the caller's own
 * rows: every query is anchored on `ticket.usuario_id`. Everything is
 * computed with the same helpers as the T-10 receipt (`ticketTotals`,
 * `selectionFrom`, `realResult`); nothing is stored.
 */

/** One row of the history: a selection, with the ticket it belongs to. */
export interface MyBet extends TicketSelectionView {
	ticket: { id: number; creadoEn: Date } & TicketTotals;
}

/** A selection state's id, as an uncorrelated SQL subquery (by `codigo`, never a fixed id). */
export const stateId = (codigo: EstadoSeleccion) => `(SELECT id FROM estado_seleccion WHERE codigo = '${codigo}')`;

/**
 * Per ticket, over the tickets `anchor` picks (a condition on `t2`): what its
 * state and totals are computed from. The caller's own history anchors on
 * its user (and, when given, only some of its tickets); the admin query
 * (T-21) on ticket ids or on every participant. Served by
 * `idx_ticket_usuario_fecha` and the covering `idx_seleccion_ticket_estado`;
 * the refunds (D-003) through `uq_movimiento_seleccion_tipo` (at most one per
 * selection, so the join never repeats a row).
 */
export const ticketAggregatesFor = (anchor: string) => `(
	SELECT s2.ticket_id,
		COUNT(*) AS total,
		SUM(s2.estado_seleccion_id = ${stateId('pendiente')}) AS pendientes,
		SUM(s2.estado_seleccion_id = ${stateId('anulada')}) AS anuladas,
		SUM(s2.estado_seleccion_id = ${stateId('acertada')}) AS acertadas,
		SUM(s2.estado_seleccion_id = ${stateId('no_acertada')}) AS no_acertadas,
		COALESCE(SUM(s2.puntos_obtenidos), 0) AS puntos,
		COALESCE(SUM(m2.cantidad), 0) AS devueltas
	FROM ticket t2
	JOIN seleccion s2 ON s2.ticket_id = t2.id
	LEFT JOIN movimiento_moneda m2 ON m2.seleccion_id = s2.id AND m2.tipo_movimiento_id = ${REFUND_TYPE}
	WHERE ${anchor}
	GROUP BY s2.ticket_id
)`;
const ticketAggregates = (onlySomeTickets: boolean) => ticketAggregatesFor(`t2.usuario_id = ?${onlySomeTickets ? ' AND t2.id IN (?)' : ''}`);
const TICKET_AGGREGATES = ticketAggregates(false);

/** Newest ticket first, and inside a ticket in the order it was placed. */
export const HISTORY_ORDER = 't.creado_en DESC, t.id DESC, s.id ASC';
const ORDER = HISTORY_ORDER;

/** A history row: its ticket (with `agg`), then the selection with its match. */
export const HISTORY_COLUMNS = `t.id AS t_id, t.creado_en AS t_creado_en,
	agg.total AS t_total, agg.pendientes AS t_pendientes, agg.anuladas AS t_anuladas, agg.puntos AS t_puntos, agg.devueltas AS t_devueltas,
	${SELECTION_COLUMNS}`;
const COLUMNS = HISTORY_COLUMNS;

const countsFrom = (row: RowDataPacket, prefix: string) => ({
	total: Number(row[`${prefix}total`]),
	pendientes: Number(row[`${prefix}pendientes`]),
	anuladas: Number(row[`${prefix}anuladas`]),
	puntos: Number(row[`${prefix}puntos`]),
	devueltas: Number(row[`${prefix}devueltas`]),
});

export function myBetFrom(row: RowDataPacket): MyBet {
	return {
		ticket: { id: Number(row.t_id), creadoEn: row.t_creado_en as Date, ...ticketTotals(countsFrom(row, 't_')) },
		...selectionFrom(row),
	};
}

/**
 * BR-026: the caller's selections, newest ticket first (`creado_en`, then
 * ticket id), and inside a ticket in the order they were placed. Not the
 * BR-013 proximity order: this is a record of what the user did and when,
 * and a ticket's selections can be on matches far apart in time.
 *
 * Two steps, so a user with thousands of selections doesn't pay for them on
 * every page: the page of ids comes from `ticket` and `seleccion` alone
 * (filters as subqueries, the ticket aggregate only when filtering by its
 * state), and only those rows are then read with their match and totals.
 * All three reads run in one read-only snapshot, so the total, the page and
 * its rows describe the same moment.
 */
export async function listMyBets(pool: Pool, userId: number, query: ListMyBetsQuery): Promise<Page<MyBet>> {
	const where = new Where().add('t.usuario_id = ?', userId);
	if (query.estado) where.add(`s.estado_seleccion_id = ${stateId(query.estado)}`);
	if (query.ticketId) where.add('t.id = ?', query.ticketId);
	if (query.partidoId) where.add('s.partido_id = ?', query.partidoId);
	if (query.competicionId) where.add('s.partido_id IN (SELECT fp.id FROM partido fp WHERE fp.competicion_id = ?)', query.competicionId);
	if (query.deporteId) {
		where.add(
			`s.partido_id IN (SELECT fp.id FROM partido fp WHERE fp.competicion_id IN (SELECT fc.id FROM competicion fc WHERE fc.deporte_id = ?))`,
			query.deporteId,
		);
	}
	if (query.desde) where.add('t.creado_en >= ?', query.desde);
	if (query.hasta) where.add('t.creado_en <= ?', query.hasta);

	let from = 'FROM ticket t JOIN seleccion s ON s.ticket_id = t.id';
	const fromParams: unknown[] = [];
	if (query.estadoTicket) {
		from += ` JOIN ${TICKET_AGGREGATES} agg ON agg.ticket_id = t.id`;
		fromParams.push(userId);
		where.add(ticketStateCondition(query.estadoTicket, 'agg'));
	}

	const params = [...fromParams, ...where.params];
	return withReadSnapshot(pool, async (db) => {
		const [[counted]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from} ${where.sql}`, params);
		const [page] = await db.query<RowDataPacket[]>(
			`SELECT s.id, t.id AS ticket_id ${from} ${where.sql} ORDER BY ${ORDER} LIMIT ? OFFSET ?`,
			[...params, query.pageSize, (query.page - 1) * query.pageSize],
		);
		const total = Number(counted?.total ?? 0);
		if (page.length === 0) return toPage([], total, query);

		const ticketIds = [...new Set(page.map((row) => Number(row.ticket_id)))];
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT ${COLUMNS}
			FROM ticket t
			JOIN ${ticketAggregates(true)} agg ON agg.ticket_id = t.id
			JOIN seleccion s ON s.ticket_id = t.id
			${SELECTION_JOINS}
			WHERE t.usuario_id = ? AND s.id IN (?)
			ORDER BY ${ORDER}`,
			[userId, ticketIds, userId, page.map((row) => Number(row.id))],
		);
		return toPage(rows.map(myBetFrom), total, query);
	});
}

export interface MyBetsSummary {
	tickets: { total: number } & Record<EstadoTicket, number>;
	selecciones: { total: number } & Record<EstadoSeleccion, number>;
	/** BR-020: every confirmed selection, refunded or not. */
	monedasUtilizadas: number;
	/** BR-046, D-003: the coins actually refunded to the user. */
	monedasDevueltas: number;
	/** BR-039/BR-040: the sum of the settled selections' points. */
	puntos: number;
	/** BR-042/BR-043: selections in state `acertada` (the ranking's "apuestas acertadas"). */
	aciertos: number;
}

/**
 * The numbers for the top of the "Mis apuestas" screen, from the same rules
 * as the list and the receipt. One statement, so every figure describes the
 * same moment (a bet settled between two statements made them disagree).
 */
export async function getMyBetsSummary(pool: Pool, userId: number): Promise<MyBetsSummary> {
	const [[row]] = await pool.query<RowDataPacket[]>(
		`SELECT COUNT(*) AS tickets,
			COALESCE(SUM(${ticketStateCondition('pendiente', 'agg')}), 0) AS t_pendiente,
			COALESCE(SUM(${ticketStateCondition('finalizado', 'agg')}), 0) AS t_finalizado,
			COALESCE(SUM(${ticketStateCondition('anulado', 'agg')}), 0) AS t_anulado,
			COALESCE(SUM(agg.total), 0) AS sel_total,
			COALESCE(SUM(agg.pendientes), 0) AS sel_pendientes,
			COALESCE(SUM(agg.anuladas), 0) AS sel_anuladas,
			COALESCE(SUM(agg.acertadas), 0) AS sel_acertadas,
			COALESCE(SUM(agg.no_acertadas), 0) AS sel_no_acertadas,
			COALESCE(SUM(agg.puntos), 0) AS sel_puntos,
			COALESCE(SUM(agg.devueltas), 0) AS sel_devueltas
		FROM ${TICKET_AGGREGATES} agg`,
		[userId],
	);
	const totals = ticketTotals(countsFrom(row!, 'sel_'));
	const acertada = Number(row!.sel_acertadas);
	return {
		tickets: {
			total: Number(row!.tickets),
			pendiente: Number(row!.t_pendiente),
			finalizado: Number(row!.t_finalizado),
			anulado: Number(row!.t_anulado),
		},
		selecciones: {
			total: totals.cantidadSelecciones,
			pendiente: Number(row!.sel_pendientes),
			acertada,
			no_acertada: Number(row!.sel_no_acertadas),
			anulada: Number(row!.sel_anuladas),
		},
		monedasUtilizadas: totals.monedasUtilizadas,
		monedasDevueltas: totals.monedasDevueltas,
		puntos: totals.puntosObtenidos,
		aciertos: acertada,
	};
}
