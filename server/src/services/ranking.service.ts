import type { Pool, RowDataPacket } from 'mysql2/promise';
import type { EstadoSeleccion, EstadoTicket } from '../lib/betting.js';
import { ticketStateCondition } from '../lib/betting.js';
import { MAX_FILAS_TOP, POSICIONES_TOP } from '../lib/ranking.js';
import { type Page, type PaginationQuery, toPage } from '../schemas/common.schema.js';
import { stateId } from './bet-history.service.js';
import { REFUND_TYPE, ticketTotals } from './tickets.service.js';

/**
 * Módulo Polla, T-15: the pool ranking (BR-041 to BR-044) and the pool's
 * figures for the admin (BR-001). Computed on every read from the settled
 * selections, never stored: it is up to date as soon as a result is
 * confirmed (BR-044) or a selection is voided.
 *
 * Who is ranked: validated `apostador` accounts only. Admins never take part
 * (BR-001), whatever the database says; a `pendiente` user can't bet yet
 * (BR-005), so they are not a participant of the ranking. A validated user
 * with no bets, or no points yet, is ranked with 0: they are in the pool.
 */

/**
 * Display order of names inside a tie: Spanish rules (ñ is a letter after n;
 * case and accents don't count), the same as `Intl.Collator('es')` in
 * `lib/ranking.ts`. Explicit because the column's own collation
 * (`utf8mb4_unicode_ci`) sorts ñ as n. A test checks both with such names.
 */
export const NOMBRE_ORDEN = 'nombre COLLATE utf8mb4_es_0900_ai_ci';

/**
 * A participant's totals, position (`RANK()`) and display row number
 * (`fila`), plus how many are ranked and how many sit in the top. The SQL
 * twin of `lib/ranking.ts`.
 */
const RANKED = `WITH totales AS (
		SELECT u.id, u.nombre,
			CAST(COALESCE(SUM(s.puntos_obtenidos), 0) AS UNSIGNED) AS puntos,
			CAST(COALESCE(SUM(s.estado_seleccion_id = ac.id), 0) AS UNSIGNED) AS aciertos
		FROM usuario u
		JOIN (SELECT id FROM rol WHERE codigo = 'apostador') ap ON ap.id = u.rol_id
		JOIN (SELECT id FROM estado_usuario WHERE codigo = 'validado') va ON va.id = u.estado_usuario_id
		JOIN (SELECT id FROM estado_seleccion WHERE codigo = 'acertada') ac
		LEFT JOIN ticket t ON t.usuario_id = u.id
		LEFT JOIN seleccion s ON s.ticket_id = t.id
		GROUP BY u.id, u.nombre
	),
	ranked AS (
		SELECT id, nombre, puntos, aciertos,
			RANK() OVER (ORDER BY puntos DESC, aciertos DESC) AS posicion,
			COUNT(*) OVER (PARTITION BY puntos, aciertos) AS empatados,
			ROW_NUMBER() OVER (ORDER BY puntos DESC, aciertos DESC, ${NOMBRE_ORDEN}, id) AS fila,
			COUNT(*) OVER () AS participantes
		FROM totales
	),
	counted AS (
		SELECT ranked.*, SUM(posicion <= ${POSICIONES_TOP}) OVER () AS en_top FROM ranked
	)`;

/**
 * The top (positions up to `POSICIONES_TOP`, at most `?` rows) plus the row
 * of user `?`, in display order. Exported so a test can check its plan.
 */
export const RANKING_TOP_SQL = `${RANKED}
	SELECT id, nombre, puntos, aciertos, posicion, fila, participantes, en_top FROM counted
	WHERE (posicion <= ${POSICIONES_TOP} AND fila <= ?) OR id = ?
	ORDER BY fila`;

export interface RankingRow {
	posicion: number;
	/** Only the display name: never the email, balance or state (privacy). */
	participante: { nombre: string };
	puntos: number;
	aciertos: number;
	/** The row of the user asking. */
	esPropia: boolean;
}

export interface Ranking {
	/**
	 * BR-042: the participants at positions 1 to `POSICIONES_TOP`, ties at the
	 * edge included, but never more than `maxFilasTop` rows.
	 */
	top: RankingRow[];
	/** Participants of the top (tied ones) left out by the `maxFilasTop` cap. */
	topSinMostrar: number;
	/**
	 * The caller's own row, if they are a participant (validated `apostador`):
	 * `enTop` when their position is in the top, `enLista` when their row is in `top`.
	 */
	propia: (RankingRow & { enTop: boolean; enLista: boolean }) | null;
	/** How many are ranked. */
	participantes: number;
	posicionesTop: number;
	maxFilasTop: number;
}

const toRow = (row: RowDataPacket, userId: number): RankingRow => ({
	posicion: Number(row.posicion),
	participante: { nombre: String(row.nombre) },
	puntos: Number(row.puntos),
	aciertos: Number(row.aciertos),
	esPropia: Number(row.id) === userId,
});

const inList = (row: RowDataPacket) => Number(row.posicion) <= POSICIONES_TOP && Number(row.fila) <= MAX_FILAS_TOP;

/**
 * BR-041 to BR-043: the top and the caller's own position, in one statement
 * (one consistent moment). `userId` of an admin or a pending user simply
 * matches no ranked row, so `propia` is `null`.
 */
export async function getRanking(pool: Pool, userId: number): Promise<Ranking> {
	const [rows] = await pool.query<RowDataPacket[]>(RANKING_TOP_SQL, [MAX_FILAS_TOP, userId]);
	const top = rows.filter(inList).map((row) => toRow(row, userId));
	const own = rows.find((row) => Number(row.id) === userId);
	return {
		top,
		topSinMostrar: rows.length > 0 ? Number(rows[0]!.en_top) - top.length : 0,
		propia: own ? { ...toRow(own, userId), enTop: Number(own.posicion) <= POSICIONES_TOP, enLista: inList(own) } : null,
		participantes: rows.length > 0 ? Number(rows[0]!.participantes) : 0,
		posicionesTop: POSICIONES_TOP,
		maxFilasTop: MAX_FILAS_TOP,
	};
}

export interface AdminRankingRow {
	posicion: number;
	/** How many share this position, the whole ranking through: a page can't tell on its own (T-21 fix). */
	empatados: number;
	participante: { id: number; nombre: string };
	puntos: number;
	aciertos: number;
}

/**
 * The whole ranking for the admin, paginated, in the same order. One
 * statement: the page is a LEFT JOIN on a one-row table, so a page past the
 * end still returns one (empty) row carrying the total.
 */
export async function listRanking(pool: Pool, query: PaginationQuery): Promise<Page<AdminRankingRow>> {
	const offset = (query.page - 1) * query.pageSize;
	const [rows] = await pool.query<RowDataPacket[]>(
		`${RANKED}
		SELECT r.id, r.nombre, r.puntos, r.aciertos, r.posicion, r.empatados, (SELECT COUNT(*) FROM ranked) AS total
		FROM (SELECT 1 AS uno) una
		LEFT JOIN ranked r ON r.fila > ? AND r.fila <= ?
		ORDER BY r.fila`,
		[offset, offset + query.pageSize],
	);
	const total = Number(rows[0]?.total ?? 0);
	const items = rows
		.filter((row) => row.id !== null)
		.map((row) => ({
			posicion: Number(row.posicion),
			empatados: Number(row.empatados),
			participante: { id: Number(row.id), nombre: String(row.nombre) },
			puntos: Number(row.puntos),
			aciertos: Number(row.aciertos),
		}));
	return toPage(items, total, query);
}

export interface PoolStats {
	participantes: { inscritos: number; validados: number; pendientes: number };
	tickets: { total: number } & Record<EstadoTicket, number>;
	selecciones: { total: number } & Record<EstadoSeleccion, number>;
	monedasUtilizadas: number;
	monedasDevueltas: number;
	/** `SUM(saldo_monedas)` of the participants: the coins still to spend. */
	monedasDisponibles: number;
	puntos: number;
	aciertos: number;
}

/**
 * BR-001 ("consultar resultados y estadísticas de la polla"): the pool's
 * figures, over `apostador` accounts only, with the same definitions as "Mis
 * apuestas" (T-11). One statement, so every figure describes the same moment.
 */
export async function getPoolStats(pool: Pool): Promise<PoolStats> {
	const [[row]] = await pool.query<RowDataPacket[]>(
		`SELECT
			(SELECT COUNT(*) FROM usuario u WHERE u.rol_id = ap.id) AS inscritos,
			(SELECT COUNT(*) FROM usuario u
				WHERE u.rol_id = ap.id AND u.estado_usuario_id = (SELECT id FROM estado_usuario WHERE codigo = 'validado')) AS validados,
			(SELECT COALESCE(SUM(u.saldo_monedas), 0) FROM usuario u WHERE u.rol_id = ap.id) AS disponibles,
			COUNT(agg.ticket_id) AS tickets,
			COALESCE(SUM(${ticketStateCondition('pendiente', 'agg')}), 0) AS t_pendiente,
			COALESCE(SUM(${ticketStateCondition('finalizado', 'agg')}), 0) AS t_finalizado,
			COALESCE(SUM(${ticketStateCondition('anulado', 'agg')}), 0) AS t_anulado,
			COALESCE(SUM(agg.total), 0) AS total,
			COALESCE(SUM(agg.pendientes), 0) AS pendientes,
			COALESCE(SUM(agg.anuladas), 0) AS anuladas,
			COALESCE(SUM(agg.acertadas), 0) AS acertadas,
			COALESCE(SUM(agg.no_acertadas), 0) AS no_acertadas,
			COALESCE(SUM(agg.puntos), 0) AS puntos,
			COALESCE(SUM(agg.devueltas), 0) AS devueltas
		FROM (SELECT id FROM rol WHERE codigo = 'apostador') ap
		LEFT JOIN (
			SELECT s.ticket_id, u.rol_id,
				COUNT(*) AS total,
				SUM(s.estado_seleccion_id = ${stateId('pendiente')}) AS pendientes,
				SUM(s.estado_seleccion_id = ${stateId('anulada')}) AS anuladas,
				SUM(s.estado_seleccion_id = ${stateId('acertada')}) AS acertadas,
				SUM(s.estado_seleccion_id = ${stateId('no_acertada')}) AS no_acertadas,
				COALESCE(SUM(s.puntos_obtenidos), 0) AS puntos,
				COALESCE(SUM(m.cantidad), 0) AS devueltas
			FROM ticket t
			JOIN usuario u ON u.id = t.usuario_id
			JOIN seleccion s ON s.ticket_id = t.id
			LEFT JOIN movimiento_moneda m ON m.seleccion_id = s.id AND m.tipo_movimiento_id = ${REFUND_TYPE}
			GROUP BY s.ticket_id, u.rol_id
		) agg ON agg.rol_id = ap.id
		GROUP BY ap.id`,
	);
	const totals = ticketTotals({
		total: Number(row!.total),
		pendientes: Number(row!.pendientes),
		anuladas: Number(row!.anuladas),
		puntos: Number(row!.puntos),
		devueltas: Number(row!.devueltas),
	});
	const inscritos = Number(row!.inscritos);
	const validados = Number(row!.validados);
	const acertadas = Number(row!.acertadas);
	return {
		participantes: { inscritos, validados, pendientes: inscritos - validados },
		tickets: {
			total: Number(row!.tickets),
			pendiente: Number(row!.t_pendiente),
			finalizado: Number(row!.t_finalizado),
			anulado: Number(row!.t_anulado),
		},
		selecciones: {
			total: totals.cantidadSelecciones,
			pendiente: Number(row!.pendientes),
			acertada: acertadas,
			no_acertada: Number(row!.no_acertadas),
			anulada: Number(row!.anuladas),
		},
		monedasUtilizadas: totals.monedasUtilizadas,
		monedasDevueltas: totals.monedasDevueltas,
		monedasDisponibles: Number(row!.disponibles),
		puntos: totals.puntosObtenidos,
		aciertos: acertadas,
	};
}
