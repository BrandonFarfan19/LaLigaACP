import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

/** State of a user straight from the database, bypassing the API. */
export async function userState(pool: Pool, userId: number) {
	const [rows] = await pool.query<RowDataPacket[]>(
		`SELECT eu.codigo AS estadoValidacion, ep.codigo AS estadoPago, u.saldo_monedas AS saldo,
			(SELECT COUNT(*) FROM movimiento_moneda m WHERE m.usuario_id = u.id) AS movimientos,
			(SELECT CAST(COALESCE(SUM(m.cantidad), 0) AS SIGNED) FROM movimiento_moneda m WHERE m.usuario_id = u.id) AS sumaMovimientos
		FROM usuario u
		JOIN estado_usuario eu ON eu.id = u.estado_usuario_id
		JOIN estado_pago ep ON ep.id = u.estado_pago_id
		WHERE u.id = ?`,
		[userId],
	);
	const row = rows[0]!;
	return {
		estadoValidacion: row.estadoValidacion as string,
		estadoPago: row.estadoPago as string,
		saldo: Number(row.saldo),
		movimientos: Number(row.movimientos),
		sumaMovimientos: Number(row.sumaMovimientos),
	};
}

export async function setPayment(pool: Pool, userId: number, codigo: 'pendiente' | 'confirmado'): Promise<void> {
	await pool.query('UPDATE usuario SET estado_pago_id = (SELECT id FROM estado_pago WHERE codigo = ?) WHERE id = ?', [
		codigo,
		userId,
	]);
}

export async function setCreatedAt(pool: Pool, userId: number, date: Date): Promise<void> {
	await pool.query('UPDATE usuario SET creado_en = ? WHERE id = ?', [date, userId]);
}

/** `count` unsettled selections in one new ticket of the user; their ids, in order. */
export async function pendingSelections(pool: Pool, userId: number, count: number): Promise<number[]> {
	const [[before]] = await pool.query<RowDataPacket[]>('SELECT COALESCE(MAX(id), 0) AS maxId FROM seleccion');
	await addSettledSelections(pool, userId, Array.from({ length: count }, () => null));
	const [rows] = await pool.query<RowDataPacket[]>(
		'SELECT s.id FROM seleccion s JOIN ticket t ON t.id = s.ticket_id WHERE t.usuario_id = ? AND s.id > ? ORDER BY s.id',
		[userId, before!.maxId],
	);
	return rows.map((row) => Number(row.id));
}

/**
 * Settled selections for a user, so the participant table's points come from
 * real `seleccion` rows: one match, one ticket, one selection per value.
 */
export async function addSettledSelections(pool: Pool, userId: number, puntos: Array<0 | 1 | 3 | null>): Promise<void> {
	const insert = async (sql: string, params: unknown[] = []) =>
		(await pool.query<ResultSetHeader>(sql, params))[0].insertId;

	const deporteId = await insert(
		"INSERT INTO deporte (nombre, slug, permite_empate) VALUES ('Fútbol', CONCAT('futbol-', UUID()), TRUE)",
	);
	const competicionId = await insert(
		"INSERT INTO competicion (deporte_id, nombre, slug) VALUES (?, 'Liga', CONCAT('liga-', UUID()))",
		[deporteId],
	);
	const partidoId = await insert(
		"INSERT INTO partido (competicion_id, estado_partido_id, jornada, fecha_hora, sede) SELECT ?, id, 1, UTC_TIMESTAMP(), 'Cancha' FROM estado_partido WHERE codigo = 'finalizado'",
		[competicionId],
	);
	const ticketId = await insert('INSERT INTO ticket (usuario_id, creado_en) VALUES (?, UTC_TIMESTAMP())', [userId]);

	for (const value of puntos) {
		await pool.query(
			`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id, puntos_obtenidos)
			SELECT ?, ?, ta.id, rg.id, es.id, ?
			FROM tipo_apuesta ta, resultado_general rg, estado_seleccion es
			WHERE ta.codigo = 'resultado_general' AND rg.codigo = 'local_gana' AND es.codigo = ?`,
			[ticketId, partidoId, value, value === null ? 'pendiente' : value > 0 ? 'acertada' : 'no_acertada'],
		);
	}
}
