import type { RowDataPacket } from 'mysql2/promise';
import type { Db } from './catalog-query.js';

/**
 * Módulo Informativo, C-05 (D-034): the statistics profiles (`futbol`,
 * `voley`) and their attributes, a fixed catalog loaded by `02-catalogos.sql`.
 * A sport points at one profile, or at none (its players have no statistics).
 * Shared by the admin (sports, a squad's statistics) and the public API.
 */

export interface StatAttribute {
	codigo: string;
	nombre: string;
}

export interface StatsProfile {
	codigo: string;
	nombre: string;
	/** In display order (`estadistica.orden`): the radar goes around them clockwise. */
	atributos: StatAttribute[];
}

/**
 * Every profile with its attributes, keyed by `perfil_estadistico.id`, in one
 * statement (a handful of rows: never N+1). Ids stay inside the backend: the
 * API names a profile by its `codigo`.
 */
export async function readStatsProfiles(db: Db): Promise<Map<number, StatsProfile>> {
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT p.id, p.codigo, p.nombre, e.codigo AS e_codigo, e.nombre AS e_nombre
		FROM perfil_estadistico p
		LEFT JOIN estadistica e ON e.perfil_estadistico_id = p.id
		ORDER BY p.id, e.orden`,
	);
	const profiles = new Map<number, StatsProfile>();
	for (const row of rows) {
		const id = Number(row.id);
		let profile = profiles.get(id);
		if (!profile) {
			profile = { codigo: String(row.codigo), nombre: String(row.nombre), atributos: [] };
			profiles.set(id, profile);
		}
		if (row.e_codigo !== null) profile.atributos.push({ codigo: String(row.e_codigo), nombre: String(row.e_nombre) });
	}
	return profiles;
}

/** A sport's profile from its `perfil_estadistico_id`, or `null` when it has none. */
export function profileOf(profiles: Map<number, StatsProfile>, perfilId: unknown): StatsProfile | null {
	return perfilId === null || perfilId === undefined ? null : (profiles.get(Number(perfilId)) ?? null);
}

/** The id of the profile with that `codigo`, or `undefined`. */
export async function statsProfileId(db: Db, codigo: string): Promise<number | undefined> {
	const [[row]] = await db.query<RowDataPacket[]>('SELECT id FROM perfil_estadistico WHERE codigo = ?', [codigo]);
	return row ? Number(row.id) : undefined;
}
