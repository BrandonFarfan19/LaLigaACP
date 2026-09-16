import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';

type Db = Pool | PoolConnection;

/**
 * Read-only consistency check for EsquemaBD D12: `usuario.saldo_monedas` is
 * stored for speed and for BR-009, but `movimiento_moneda` is the source of
 * truth. Every write goes through `coins.service.ts`, which keeps both in
 * the same transaction; this only *reports* rows where that failed (a manual
 * edit, a bug, a restored backup). It never fixes anything.
 */

export interface BalanceMismatch {
	usuarioId: number;
	nombre: string;
	email: string;
	saldo: number;
	sumaMovimientos: number;
	/** `saldo - sumaMovimientos`. */
	diferencia: number;
}

/** BR-001: an admin must have neither coins nor movements. */
export interface AdminWithCoins {
	usuarioId: number;
	nombre: string;
	email: string;
	saldo: number;
	movimientos: number;
}

export interface ConsistencyReport {
	ok: boolean;
	/** Participants (apostadores) checked. */
	revisados: number;
	descuadres: BalanceMismatch[];
	adminsConMonedas: AdminWithCoins[];
}

export async function checkCoinConsistency(db: Db): Promise<ConsistencyReport> {
	const [[counted]] = await db.query<RowDataPacket[]>(
		"SELECT COUNT(*) AS n FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE r.codigo = 'apostador'",
	);

	const [mismatches] = await db.query<RowDataPacket[]>(
		`SELECT u.id, u.nombre, u.email, u.saldo_monedas AS saldo,
			CAST(COALESCE(SUM(m.cantidad), 0) AS SIGNED) AS suma
		FROM usuario u
		JOIN rol r ON r.id = u.rol_id
		LEFT JOIN movimiento_moneda m ON m.usuario_id = u.id
		WHERE r.codigo = 'apostador'
		GROUP BY u.id
		HAVING saldo <> suma
		ORDER BY u.id`,
	);

	const [admins] = await db.query<RowDataPacket[]>(
		`SELECT u.id, u.nombre, u.email, u.saldo_monedas AS saldo,
			(SELECT COUNT(*) FROM movimiento_moneda m WHERE m.usuario_id = u.id) AS movimientos
		FROM usuario u
		JOIN rol r ON r.id = u.rol_id
		WHERE r.codigo = 'admin'
		HAVING saldo <> 0 OR movimientos > 0
		ORDER BY u.id`,
	);

	const descuadres = mismatches.map((row) => ({
		usuarioId: Number(row.id),
		nombre: String(row.nombre),
		email: String(row.email),
		saldo: Number(row.saldo),
		sumaMovimientos: Number(row.suma),
		diferencia: Number(row.saldo) - Number(row.suma),
	}));
	const adminsConMonedas = admins.map((row) => ({
		usuarioId: Number(row.id),
		nombre: String(row.nombre),
		email: String(row.email),
		saldo: Number(row.saldo),
		movimientos: Number(row.movimientos),
	}));

	return {
		ok: descuadres.length === 0 && adminsConMonedas.length === 0,
		revisados: Number(counted?.n ?? 0),
		descuadres,
		adminsConMonedas,
	};
}
