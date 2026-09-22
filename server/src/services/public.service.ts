import type { Pool, RowDataPacket } from 'mysql2/promise';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { officialResult, type ResultadoGeneralCodigo } from '../lib/match-result.js';
import { effectiveState, effectiveStateCondition } from '../lib/match-state.js';
import { proximityOrderBy } from '../lib/match-order.js';
import { storedVideo, type VideoLink } from '../lib/video-links.js';
import { PUNTOS_DERROTA, PUNTOS_EMPATE, PUNTOS_VICTORIA } from '../lib/standings.js';
import type { Page } from '../schemas/common.schema.js';
import type { MatchState } from '../schemas/matches.schema.js';
import type { ListFixtureQuery, ListPublicCompetitionsQuery } from '../schemas/public.schema.js';
import { pageOf, Where } from './catalog-query.js';
import { imagePath } from './goals.service.js';
import { type MatchMedia, readMatchMedia } from './match-media.service.js';

/**
 * Módulo Informativo, read-only and public (T-08: BR-013, BR-048 to BR-050).
 * Reads only deporte, competicion, equipo, jugador, plantel, partido,
 * partido_equipo, estado_partido, gol and multimedia_partido. Never users, sessions, coins, bets
 * or audit rows, and it imports nothing from Polla or Auditoría.
 */

export interface PublicSport {
	id: number;
	nombre: string;
	slug: string;
	permiteEmpate: boolean;
}

export interface PublicCompetitionRef {
	id: number;
	nombre: string;
	slug: string;
}

export interface PublicCompetition extends PublicCompetitionRef {
	deporte: PublicSport;
}

export interface PublicTeam {
	id: number;
	competicionId: number;
	nombre: string;
	nombreCorto: string;
	escudo: string;
	colorAcento: string;
}

export interface PublicMatchSide {
	equipo: PublicTeam;
	/** Only once the match is `finalizado` and both sides are loaded; `null` otherwise (T-12 may be loading it). */
	goles: number | null;
}

export interface PublicMatch {
	id: number;
	competicion: PublicCompetitionRef;
	deporte: PublicSport;
	jornada: number;
	/** UTC, ISO 8601. */
	fechaHora: Date;
	estado: MatchState;
	sede: string;
	local: PublicMatchSide;
	visita: PublicMatchSide;
	/** BR-029, only when the score is shown (`officialResult`); `null` otherwise. */
	resultado: ResultadoGeneralCodigo | null;
}

export interface PublicGoal {
	id: number;
	minuto: number;
	equipoId: number;
	jugador: { id: number; nombre: string; foto: string | null };
	/** Path of the uploaded image (`GET /public/archivos/:nombre`), T-13. */
	imagen: string | null;
	/** Link to an allowed platform, with the only URL an embedded player may use (T-13). */
	video: VideoLink | null;
}

export interface PublicMatchDetail extends PublicMatch {
	/** Only once `finalizado` with both scores loaded, in minute order; `null` otherwise. */
	goles: PublicGoal[] | null;
	/** The match's own images and videos (T-13), under the same rule as `goles`. */
	multimedia: MatchMedia | null;
}

export interface StandingRow {
	posicion: number;
	equipo: PublicTeam;
	jugados: number;
	ganados: number;
	empatados: number;
	perdidos: number;
	golesAFavor: number;
	golesEnContra: number;
	diferencia: number;
	puntos: number;
}

export interface PublicSquadMember {
	jugadorId: number;
	nombre: string;
	foto: string | null;
	numeroCamiseta: number;
}

export interface PublicTeamDetail extends PublicTeam {
	competicion: PublicCompetitionRef;
	deporte: PublicSport;
	/** Enrolled players, by shirt number. */
	plantel: PublicSquadMember[];
}

// --- mapping --------------------------------------------------------------

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));

function sportFrom(row: RowDataPacket, prefix = 'd_'): PublicSport {
	return {
		id: Number(row[`${prefix}id`]),
		nombre: String(row[`${prefix}nombre`]),
		slug: String(row[`${prefix}slug`]),
		permiteEmpate: Boolean(row[`${prefix}permite_empate`]),
	};
}

function teamFrom(row: RowDataPacket, prefix: string): PublicTeam {
	return {
		id: Number(row[`${prefix}id`]),
		competicionId: Number(row[`${prefix}competicion_id`]),
		nombre: String(row[`${prefix}nombre`]),
		nombreCorto: String(row[`${prefix}nombre_corto`]),
		escudo: String(row[`${prefix}escudo`]),
		colorAcento: String(row[`${prefix}color_acento`]),
	};
}

const SPORT_COLUMNS = 'd.id AS d_id, d.nombre AS d_nombre, d.slug AS d_slug, d.permite_empate AS d_permite_empate';
const teamColumns = (alias: string, prefix: string) =>
	['id', 'competicion_id', 'nombre', 'nombre_corto', 'escudo', 'color_acento'].map((c) => `${alias}.${c} AS ${prefix}${c}`).join(', ');

// --- deportes y competiciones ---------------------------------------------

/** Every sport, by name. A short list: not paginated. */
export async function listPublicSports(pool: Pool): Promise<PublicSport[]> {
	const [rows] = await pool.query<RowDataPacket[]>(`SELECT ${SPORT_COLUMNS} FROM deporte d ORDER BY d.nombre, d.id`);
	return rows.map((row) => sportFrom(row));
}

function competitionFrom(row: RowDataPacket): PublicCompetition {
	return { id: Number(row.id), nombre: String(row.nombre), slug: String(row.slug), deporte: sportFrom(row) };
}

const COMPETITION_SELECT = `c.id, c.nombre, c.slug, ${SPORT_COLUMNS}`;
const COMPETITION_FROM = 'FROM competicion c JOIN deporte d ON d.id = c.deporte_id';

export function listPublicCompetitions(pool: Pool, query: ListPublicCompetitionsQuery): Promise<Page<PublicCompetition>> {
	const where = new Where();
	if (query.deporteId) where.add('c.deporte_id = ?', query.deporteId);
	return pageOf(pool, { columns: COMPETITION_SELECT, from: COMPETITION_FROM, where, orderBy: 'd.nombre, c.nombre, c.id' }, query, competitionFrom);
}

async function findCompetition(pool: Pool, id: number): Promise<PublicCompetition> {
	const [[row]] = await pool.query<RowDataPacket[]>(`SELECT ${COMPETITION_SELECT} ${COMPETITION_FROM} WHERE c.id = ?`, [id]);
	if (!row) throw HttpError.notFound('No existe esa competición.', ErrorCode.COMPETITION_NOT_FOUND);
	return competitionFrom(row);
}

export const getPublicCompetition = findCompetition;

// --- fixture ----------------------------------------------------------------

/** Match columns and joins, shared with Polla (which may read Informativo, never the reverse). */
export const MATCH_COLUMNS = `p.id, p.jornada, p.fecha_hora, p.sede, ep.codigo AS estado,
	c.id AS c_id, c.nombre AS c_nombre, c.slug AS c_slug, ${SPORT_COLUMNS},
	l.goles AS l_goles, ${teamColumns('le', 'le_')},
	v.goles AS v_goles, ${teamColumns('ve', 've_')}`;
export const MATCH_FROM = `FROM partido p
	JOIN estado_partido ep ON ep.id = p.estado_partido_id
	JOIN competicion c ON c.id = p.competicion_id
	JOIN deporte d ON d.id = c.deporte_id
	JOIN partido_equipo l ON l.partido_id = p.id AND l.es_visita = FALSE
	JOIN equipo le ON le.id = l.equipo_id
	JOIN partido_equipo v ON v.partido_id = p.id AND v.es_visita = TRUE
	JOIN equipo ve ON ve.id = v.equipo_id`;

/** `estado` is the effective one at `now` (lib/match-state.ts): a match whose kick-off came is `en_curso`. */
export function matchFrom(row: RowDataPacket, now: Date = new Date()): PublicMatch {
	const estado = effectiveState(row.estado as MatchState, row.fecha_hora as Date, now);
	// The score is only public once the result is confirmed (T-12 loads it before
	// that), and only whole: with one side still empty, both sides are null.
	const goles = (value: unknown) => (value === null || value === undefined ? null : Number(value));
	const result = officialResult(estado, goles(row.l_goles), goles(row.v_goles));
	return {
		id: Number(row.id),
		competicion: { id: Number(row.c_id), nombre: String(row.c_nombre), slug: String(row.c_slug) },
		deporte: sportFrom(row),
		jornada: Number(row.jornada),
		fechaHora: row.fecha_hora as Date,
		estado,
		sede: String(row.sede),
		local: { equipo: teamFrom(row, 'le_'), goles: result?.golesLocal ?? null },
		visita: { equipo: teamFrom(row, 've_'), goles: result?.golesVisitante ?? null },
		resultado: result?.resultado ?? null,
	};
}

/**
 * BR-049 fixture: every match, cancelled ones included (with their state:
 * hiding them would make a scheduled match silently disappear), in the BR-013
 * proximity order shared with every other match list.
 */
export function listFixture(pool: Pool, query: ListFixtureQuery, now: Date = new Date()): Promise<Page<PublicMatch>> {
	const where = new Where();
	if (query.deporteId) {
		// Through competicion's (deporte_id, slug) index, then partido's by competition; "c.deporte_id = ?" let MySQL scan the matches.
		where.add('p.competicion_id IN (SELECT dc.id FROM competicion dc WHERE dc.deporte_id = ?)', query.deporteId);
	}
	if (query.competicionId) where.add('p.competicion_id = ?', query.competicionId);
	if (query.equipoId) {
		// Through partido_equipo.equipo_id, which is indexed; "l.equipo_id = ? OR v.equipo_id = ?" scanned the table.
		where.add('p.id IN (SELECT pe.partido_id FROM partido_equipo pe WHERE pe.equipo_id = ?)', query.equipoId);
	}
	if (query.estado) {
		const state = effectiveStateCondition(query.estado, now);
		where.add(state.sql, ...state.params);
	}
	if (query.jornada) where.add('p.jornada = ?', query.jornada);
	if (query.desde) where.add('p.fecha_hora >= ?', query.desde);
	if (query.hasta) where.add('p.fecha_hora <= ?', query.hasta);
	const order = proximityOrderBy('p.fecha_hora', 'p.id', now);
	return pageOf(
		pool,
		{ columns: MATCH_COLUMNS, from: MATCH_FROM, where, orderBy: order.sql, orderParams: order.params },
		query,
		(row) => matchFrom(row, now),
	);
}

export async function getPublicMatch(pool: Pool, id: number): Promise<PublicMatchDetail> {
	const [[row]] = await pool.query<RowDataPacket[]>(`SELECT ${MATCH_COLUMNS} ${MATCH_FROM} WHERE p.id = ?`, [id]);
	if (!row) throw HttpError.notFound('No existe ese partido.', ErrorCode.MATCH_NOT_FOUND);
	const match = matchFrom(row);
	// Same rule as the score: goals and media only for a finished match with both sides loaded.
	if (match.resultado === null) return { ...match, goles: null, multimedia: null };

	const [goals] = await pool.query<RowDataPacket[]>(
		`SELECT g.id, g.minuto, g.equipo_id, g.imagen, g.video, j.id AS jugador_id, j.nombre AS jugador_nombre, j.foto AS jugador_foto
		FROM gol g
		JOIN partido_equipo pe ON pe.id = g.partido_equipo_id
		JOIN plantel pl ON pl.id = g.plantel_id
		JOIN jugador j ON j.id = pl.jugador_id
		WHERE pe.partido_id = ?
		ORDER BY g.minuto, g.id`,
		[id],
	);
	return {
		...match,
		goles: goals.map((g) => ({
			id: Number(g.id),
			minuto: Number(g.minuto),
			equipoId: Number(g.equipo_id),
			jugador: { id: Number(g.jugador_id), nombre: String(g.jugador_nombre), foto: text(g.jugador_foto) },
			imagen: imagePath('public', g.imagen),
			video: storedVideo(g.video),
		})),
		multimedia: await readMatchMedia(pool, id, 'public'),
	};
}

// --- tabla de posiciones ----------------------------------------------------

/**
 * BR-050: computed on every call, never stored. Only `finalizado` matches
 * with both scores count. Win 3, draw 1, loss 0. Every team of the
 * competition appears, with zeros if it hasn't played. Order (total, so
 * positions are always distinct and stable): points, goal difference, goals
 * for, name (the column's collation: case- and accent-insensitive), id.
 */
export async function getStandings(pool: Pool, competitionId: number): Promise<{ competicion: PublicCompetition; filas: StandingRow[] }> {
	const competicion = await findCompetition(pool, competitionId);
	const [rows] = await pool.query<RowDataPacket[]>(
		`SELECT ${teamColumns('e', 'e_')},
			COUNT(r.partido_id) AS jugados,
			CAST(COALESCE(SUM(r.gf > r.gc), 0) AS SIGNED) AS ganados,
			CAST(COALESCE(SUM(r.gf = r.gc), 0) AS SIGNED) AS empatados,
			CAST(COALESCE(SUM(r.gf < r.gc), 0) AS SIGNED) AS perdidos,
			CAST(COALESCE(SUM(r.gf), 0) AS SIGNED) AS goles_favor,
			CAST(COALESCE(SUM(r.gc), 0) AS SIGNED) AS goles_contra,
			CAST(COALESCE(SUM(r.gf - r.gc), 0) AS SIGNED) AS diferencia,
			CAST(COALESCE(SUM(CASE WHEN r.gf > r.gc THEN ? WHEN r.gf = r.gc THEN ? ELSE ? END), 0) AS SIGNED) AS puntos
		FROM equipo e
		LEFT JOIN (
			-- goles is UNSIGNED: cast before subtracting, or 1 - 3 overflows.
			SELECT mine.equipo_id, mine.partido_id, CAST(mine.goles AS SIGNED) AS gf, CAST(rival.goles AS SIGNED) AS gc
			FROM partido p
			JOIN estado_partido ep ON ep.id = p.estado_partido_id AND ep.codigo = 'finalizado'
			JOIN partido_equipo mine ON mine.partido_id = p.id
			JOIN partido_equipo rival ON rival.partido_id = p.id AND rival.es_visita <> mine.es_visita
			WHERE p.competicion_id = ? AND mine.goles IS NOT NULL AND rival.goles IS NOT NULL
		) r ON r.equipo_id = e.id
		WHERE e.competicion_id = ?
		GROUP BY e.id
		ORDER BY puntos DESC, diferencia DESC, goles_favor DESC, e.nombre ASC, e.id ASC`,
		[PUNTOS_VICTORIA, PUNTOS_EMPATE, PUNTOS_DERROTA, competitionId, competitionId],
	);
	return {
		competicion,
		filas: rows.map((row, i) => {
			const golesAFavor = Number(row.goles_favor);
			const golesEnContra = Number(row.goles_contra);
			return {
				posicion: i + 1,
				equipo: teamFrom(row, 'e_'),
				jugados: Number(row.jugados),
				ganados: Number(row.ganados),
				empatados: Number(row.empatados),
				perdidos: Number(row.perdidos),
				golesAFavor,
				golesEnContra,
				diferencia: Number(row.diferencia),
				puntos: Number(row.puntos),
			};
		}),
	};
}

// --- equipos ----------------------------------------------------------------

/** Every team of a competition, by name. Bounded by the competition: not paginated. */
export async function listCompetitionTeams(pool: Pool, competitionId: number): Promise<PublicTeam[]> {
	await findCompetition(pool, competitionId);
	const [rows] = await pool.query<RowDataPacket[]>(
		`SELECT ${teamColumns('e', 'e_')} FROM equipo e WHERE e.competicion_id = ? ORDER BY e.nombre, e.id`,
		[competitionId],
	);
	return rows.map((row) => teamFrom(row, 'e_'));
}

export async function getPublicTeam(pool: Pool, id: number): Promise<PublicTeamDetail> {
	const [[row]] = await pool.query<RowDataPacket[]>(
		`SELECT ${teamColumns('e', 'e_')}, c.id AS c_id, c.nombre AS c_nombre, c.slug AS c_slug, ${SPORT_COLUMNS}
		FROM equipo e JOIN competicion c ON c.id = e.competicion_id JOIN deporte d ON d.id = c.deporte_id
		WHERE e.id = ?`,
		[id],
	);
	if (!row) throw HttpError.notFound('No existe ese equipo.', ErrorCode.TEAM_NOT_FOUND);
	const [squad] = await pool.query<RowDataPacket[]>(
		`SELECT j.id, j.nombre, j.foto, pl.numero_camiseta
		FROM plantel pl JOIN jugador j ON j.id = pl.jugador_id
		WHERE pl.equipo_id = ?
		ORDER BY pl.numero_camiseta, pl.id`,
		[id],
	);
	return {
		...teamFrom(row, 'e_'),
		competicion: { id: Number(row.c_id), nombre: String(row.c_nombre), slug: String(row.c_slug) },
		deporte: sportFrom(row),
		plantel: squad.map((s) => ({
			jugadorId: Number(s.id),
			nombre: String(s.nombre),
			foto: text(s.foto),
			numeroCamiseta: Number(s.numero_camiseta),
		})),
	};
}
