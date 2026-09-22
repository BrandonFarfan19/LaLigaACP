import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { TipoMovimientoCodigo } from '../lib/coins.js';
import { type Page, type PaginationQuery, toPage } from '../schemas/common.schema.js';

/**
 * What a participant can read about their own coins (BR-002, BR-010).
 * Read-only: writes only happen in `coins.service.ts`.
 */

export interface CoinMovementView {
	id: number;
	tipo: { codigo: TipoMovimientoCodigo; nombre: string };
	/** Signed: +10 on validation, -1 per selection, +1 per refund. */
	cantidad: number;
	creadoEn: Date;
	/** The selection it belongs to; `null` for a validation (EsquemaBD D19). */
	seleccion: { id: number; ticketId: number; partidoId: number } | null;
}

/** Same column `/auth/me` returns as `saldoMonedas`. */
export async function getBalance(pool: Pool, userId: number): Promise<number> {
	const [[row]] = await pool.query<RowDataPacket[]>('SELECT saldo_monedas FROM usuario WHERE id = ?', [userId]);
	return Number(row?.saldo_monedas ?? 0);
}

/** Newest first (`creado_en DESC, id DESC`), served by `idx_movimiento_usuario_fecha`. */
export async function listMovements(pool: Pool, userId: number, query: PaginationQuery): Promise<Page<CoinMovementView>> {
	const [[counted]] = await pool.query<RowDataPacket[]>(
		'SELECT COUNT(*) AS total FROM movimiento_moneda WHERE usuario_id = ?',
		[userId],
	);
	const [rows] = await pool.query<RowDataPacket[]>(
		`SELECT m.id, tm.codigo, tm.nombre, m.cantidad, m.creado_en,
			s.id AS seleccion_id, s.ticket_id, s.partido_id
		FROM movimiento_moneda m
		JOIN tipo_movimiento tm ON tm.id = m.tipo_movimiento_id
		LEFT JOIN seleccion s ON s.id = m.seleccion_id
		WHERE m.usuario_id = ?
		ORDER BY m.creado_en DESC, m.id DESC
		LIMIT ? OFFSET ?`,
		[userId, query.pageSize, (query.page - 1) * query.pageSize],
	);

	const items = rows.map(
		(row): CoinMovementView => ({
			id: Number(row.id),
			tipo: { codigo: row.codigo as TipoMovimientoCodigo, nombre: String(row.nombre) },
			cantidad: Number(row.cantidad),
			creadoEn: row.creado_en as Date,
			seleccion:
				row.seleccion_id === null
					? null
					: { id: Number(row.seleccion_id), ticketId: Number(row.ticket_id), partidoId: Number(row.partido_id) },
		}),
	);
	return toPage(items, Number(counted?.total ?? 0), query);
}
