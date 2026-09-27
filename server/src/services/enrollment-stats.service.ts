import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import type { EnrollmentStatsBody } from '../schemas/catalog.schema.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import type { Db } from './catalog-query.js';
import { profileOf, readStatsProfiles, type StatsProfile } from './stats-profiles.js';

/**
 * Módulo Informativo, C-05 (D-034): a player's statistics in one enrollment
 * (`plantel_estadistica`). The attributes are those of the profile of the
 * sport of the enrollment's competition, each a whole number from 0 to 99,
 * and they are stored all together or not at all, so the radar is never half
 * drawn. A sport with no profile takes none (409 `SPORT_WITHOUT_STATS`).
 *
 * Locks (server/README.md, "Orden de bloqueo"): the enrollment row first
 * (`FOR UPDATE`, by primary key: the same lock its delete takes, so the two
 * never interleave), then the sport's row `FOR SHARE`, read with that locking
 * read so a profile change that committed meanwhile is seen. The sport's
 * update locks its row `FOR UPDATE` before counting statistics, so either it
 * sees these or this sees its new profile.
 */

export interface EnrollmentStats {
	plantelId: number;
	/** The profile of the enrollment's sport, or `null` when the sport has none. */
	perfil: StatsProfile | null;
	/** `codigo` → value, every attribute of the profile; `null` when none is loaded. */
	valores: Record<string, number> | null;
}

interface Located {
	sportId: number;
	perfil: StatsProfile | null;
}

/** The enrollment's sport and its profile; 404 `ENROLLMENT_NOT_FOUND` if the enrollment doesn't exist. */
async function locate(db: Db, id: number, lock: boolean): Promise<Located> {
	if (lock) await db.query('SELECT id FROM plantel FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE', [id]);
	const [[row]] = await db.query<RowDataPacket[]>(
		'SELECT c.deporte_id FROM plantel pl JOIN competicion c ON c.id = pl.competicion_id WHERE pl.id = ?',
		[id],
	);
	if (!row) throw HttpError.notFound('No existe esa inscripción.', ErrorCode.ENROLLMENT_NOT_FOUND);
	const sportId = Number(row.deporte_id);
	const [[sport]] = await db.query<RowDataPacket[]>(
		`SELECT perfil_estadistico_id FROM deporte FORCE INDEX (PRIMARY) WHERE id = ?${lock ? ' FOR SHARE' : ''}`,
		[sportId],
	);
	return { sportId, perfil: profileOf(await readStatsProfiles(db), sport?.perfil_estadistico_id) };
}

async function readValues(db: Db, id: number): Promise<Record<string, number> | null> {
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT e.codigo, pe.valor FROM plantel_estadistica pe JOIN estadistica e ON e.id = pe.estadistica_id
		WHERE pe.plantel_id = ? ORDER BY e.orden`,
		[id],
	);
	return rows.length === 0 ? null : Object.fromEntries(rows.map((row) => [String(row.codigo), Number(row.valor)]));
}

export async function getEnrollmentStats(pool: Pool, id: number): Promise<EnrollmentStats> {
	const { perfil } = await locate(pool, id, false);
	return { plantelId: id, perfil, valores: await readValues(pool, id) };
}

const sameValues = (a: Record<string, number> | null, b: Record<string, number> | null) =>
	a !== null && b !== null && Object.keys(a).length === Object.keys(b).length && Object.entries(a).every(([k, v]) => b[k] === v);

/**
 * Every attribute of the profile, none missing and none foreign: 400
 * `VALIDATION_ERROR` with one detail per offending `valores.<codigo>`, the
 * shape zod's own problems have. The range and whole numbers are the
 * schema's (`enrollmentStatsBody`).
 */
function checkComplete(perfil: StatsProfile, valores: Record<string, number>): void {
	const expected = new Set(perfil.atributos.map((a) => a.codigo));
	const problems = [
		...perfil.atributos
			.filter((a) => !Object.hasOwn(valores, a.codigo))
			.map((a) => ({ path: `valores.${a.codigo}`, message: `Falta ${a.nombre}: se cargan todos los atributos juntos.` })),
		...Object.keys(valores)
			.filter((codigo) => !expected.has(codigo))
			.map((codigo) => ({ path: `valores.${codigo}`, message: `No es un atributo de ${perfil.nombre}.` })),
	];
	if (problems.length > 0) throw HttpError.badRequest('Solicitud inválida.', problems);
}

/**
 * Loads or replaces the whole set. The same set again changes nothing and
 * leaves no audit record (D-004).
 */
export async function setEnrollmentStats(pool: Pool, ctx: AdminActionContext, id: number, input: EnrollmentStatsBody): Promise<EnrollmentStats> {
	const outcome = await runAdminAction<EnrollmentStats>(pool, ctx, 'registrar_estadisticas', 'plantel', async (conn) => {
		const { perfil } = await locate(conn, id, true);
		if (!perfil) {
			throw new HttpError(
				409,
				ErrorCode.SPORT_WITHOUT_STATS,
				'El deporte de esta inscripción no tiene perfil de estadísticas: elige uno en Deportes para cargarlas.',
			);
		}
		checkComplete(perfil, input.valores);
		const before: EnrollmentStats = { plantelId: id, perfil, valores: await readValues(conn, id) };
		// In the profile's order, whatever order the body had.
		const valores = Object.fromEntries(perfil.atributos.map((a) => [a.codigo, input.valores[a.codigo]!]));
		if (sameValues(before.valores, valores)) return { id, before, after: before };

		await conn.query('DELETE FROM plantel_estadistica WHERE plantel_id = ?', [id]);
		await conn.query(
			`INSERT INTO plantel_estadistica (plantel_id, estadistica_id, valor)
			SELECT ?, e.id, CASE e.codigo ${perfil.atributos.map(() => 'WHEN ? THEN ?').join(' ')} END
			FROM estadistica e JOIN perfil_estadistico p ON p.id = e.perfil_estadistico_id
			WHERE p.codigo = ?`,
			[id, ...perfil.atributos.flatMap((a) => [a.codigo, valores[a.codigo]]), perfil.codigo],
		);
		return { id, before, after: { plantelId: id, perfil, valores: await readValues(conn, id) } };
	});
	return outcome.after!;
}

/** Removes the whole set. With nothing loaded it changes nothing and leaves no audit record. */
export async function deleteEnrollmentStats(pool: Pool, ctx: AdminActionContext, id: number): Promise<EnrollmentStats> {
	const outcome = await runAdminAction<EnrollmentStats>(pool, ctx, 'borrar_estadisticas', 'plantel', async (conn) => {
		const { perfil } = await locate(conn, id, true);
		const before: EnrollmentStats = { plantelId: id, perfil, valores: await readValues(conn, id) };
		if (before.valores) await conn.query('DELETE FROM plantel_estadistica WHERE plantel_id = ?', [id]);
		return { id, before, after: { plantelId: id, perfil, valores: null } };
	});
	return outcome.after!;
}
