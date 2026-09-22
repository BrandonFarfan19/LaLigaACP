import type { Pool, RowDataPacket } from 'mysql2/promise';
import { withReadSnapshot } from '../db/transaction.js';
import { ticketStateCondition } from '../lib/betting.js';
import type { ListAdminBetsQuery } from '../schemas/betting.schema.js';
import { type Page, toPage } from '../schemas/common.schema.js';
import { HISTORY_COLUMNS, HISTORY_ORDER, type MyBet, myBetFrom, stateId, ticketAggregatesFor } from './bet-history.service.js';
import { Where } from './catalog-query.js';
import { SELECTION_JOINS } from './tickets.service.js';

/**
 * Módulo Polla, T-21: the bets placed in the pool, for the admin (BR-001,
 * "consultar apuestas realizadas"). Read only. The same rows and totals as
 * "Mis apuestas" (T-11), with the participant who placed each ticket.
 *
 * - Only `apostador` accounts: an admin's selections (only possible with data
 *   loaded by hand) never show (BR-001, user decision in T-04).
 * - Only the participant's id and display name: never the email, the balance,
 *   the idempotency key or the request fingerprint.
 */

/** One row: a selection, its ticket's totals and who placed it. */
export interface AdminBet extends MyBet {
	usuario: { id: number; nombre: string };
}

/** Tickets of `apostador` accounts only (the role by `codigo`, never a fixed id). */
const BETTOR_TICKET = "t.usuario_id IN (SELECT pu.id FROM usuario pu WHERE pu.rol_id = (SELECT id FROM rol WHERE codigo = 'apostador'))";

/**
 * Newest ticket first, like the history. Two steps, as there: the page of
 * ids from `ticket` and `seleccion` alone, then only those rows with their
 * match, totals and participant, all in one read-only snapshot.
 */
export async function listAdminBets(pool: Pool, query: ListAdminBetsQuery): Promise<Page<AdminBet>> {
	const where = new Where().add(BETTOR_TICKET);
	if (query.usuarioId) where.add('t.usuario_id = ?', query.usuarioId);
	if (query.estado) where.add(`s.estado_seleccion_id = ${stateId(query.estado)}`);
	if (query.ticketId) where.add('t.id = ?', query.ticketId);
	if (query.partidoId) where.add('s.partido_id = ?', query.partidoId);
	if (query.competicionId) where.add('s.partido_id IN (SELECT fp.id FROM partido fp WHERE fp.competicion_id = ?)', query.competicionId);
	if (query.deporteId) {
		where.add(
			's.partido_id IN (SELECT fp.id FROM partido fp WHERE fp.competicion_id IN (SELECT fc.id FROM competicion fc WHERE fc.deporte_id = ?))',
			query.deporteId,
		);
	}
	if (query.desde) where.add('t.creado_en >= ?', query.desde);
	if (query.hasta) where.add('t.creado_en <= ?', query.hasta);

	let from = 'FROM ticket t JOIN seleccion s ON s.ticket_id = t.id';
	if (query.estadoTicket) {
		// The ticket state is computed from all its selections: aggregated over the participants' tickets.
		from += ` JOIN ${ticketAggregatesFor(BETTOR_TICKET.replace('t.usuario_id', 't2.usuario_id'))} agg ON agg.ticket_id = t.id`;
		where.add(ticketStateCondition(query.estadoTicket, 'agg'));
	}

	return withReadSnapshot(pool, async (db) => {
		const [[counted]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from} ${where.sql}`, where.params);
		const [page] = await db.query<RowDataPacket[]>(
			`SELECT s.id, t.id AS ticket_id ${from} ${where.sql} ORDER BY ${HISTORY_ORDER} LIMIT ? OFFSET ?`,
			[...where.params, query.pageSize, (query.page - 1) * query.pageSize],
		);
		const total = Number(counted?.total ?? 0);
		if (page.length === 0) return toPage([], total, query);

		const ticketIds = [...new Set(page.map((row) => Number(row.ticket_id)))];
		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT ${HISTORY_COLUMNS}, u.id AS u_id, u.nombre AS u_nombre
			FROM ticket t
			JOIN usuario u ON u.id = t.usuario_id
			JOIN ${ticketAggregatesFor('t2.id IN (?)')} agg ON agg.ticket_id = t.id
			JOIN seleccion s ON s.ticket_id = t.id
			${SELECTION_JOINS}
			WHERE s.id IN (?)
			ORDER BY ${HISTORY_ORDER}`,
			[ticketIds, page.map((row) => Number(row.id))],
		);
		return toPage(
			rows.map((row) => ({ usuario: { id: Number(row.u_id), nombre: String(row.u_nombre) }, ...myBetFrom(row) })),
			total,
			query,
		);
	});
}
