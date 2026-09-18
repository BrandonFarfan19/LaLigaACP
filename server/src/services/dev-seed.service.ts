import { createHash, randomUUID } from 'node:crypto';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { type TransactionConnection, withTransaction } from '../db/transaction.js';
import { HORAS_CIERRE_APUESTAS } from '../lib/betting.js';
import { resultOfScore } from '../lib/match-result.js';
import { hashPassword } from '../lib/password.js';
import { plural } from '../lib/plural.js';
import { settleMatchSelections } from './bets-settlement.service.js';
import { debitSelections, grantValidationCoins, refundSelections } from './coins.service.js';
import { insertUser } from './users.service.js';

/**
 * Development sample data (D-013 and D-016 in `docs/decisiones.md`, T-19):
 * fictitious sports, competitions, teams, players and matches in every
 * betting state, plus sample accounts, so screens can be built and reviewed.
 * Only through `npm run seed:dev` (and removed with `seed:dev:clean`): nothing
 * loads by itself.
 *
 * **Marks, not names (D-016).** Every row the command creates is recorded in
 * `dato_demo` (table name + row id), a development-only table the command
 * creates itself (never part of `db/init`). Cleaning removes only recorded
 * rows, plus what the sample accounts did themselves (their sessions, tickets,
 * movements, audit records, and the goals and media the sample admin added).
 * It refuses, deleting nothing, when real data hangs from a sample row: bets
 * of real accounts, real enrollments, teams, matches or goals, or any audited
 * change by a real admin (a loaded result, for instance).
 *
 * Matches are written directly (not through the admin API), because some of
 * them are in the past: in progress, finished and cancelled. No audit record
 * is written for them.
 */

export const DEMO_EMAIL_DOMAIN = '@demo.liga.test';
export const DEMO_PLAYER_SUFFIX = ' (demo)';
const DEMO_SLUG_PREFIX = 'demo-';

/** The command-line flag the CLI requires (D-016). */
export const DEV_SEED_FLAG = '--yes-dev-data';

/** Development-only credentials, documented in the README. */
export interface DemoAccount {
	key: string;
	nombre: string;
	email: string;
	password: string;
	rol: 'admin' | 'apostador';
	validado: boolean;
}

export const DEMO_ACCOUNTS: readonly DemoAccount[] = [
	{ key: 'admin', nombre: 'Admin Demo', email: `admin${DEMO_EMAIL_DOMAIN}`, password: 'demo-admin-2026', rol: 'admin', validado: false },
	{ key: 'ana', nombre: 'Ana Demo', email: `ana${DEMO_EMAIL_DOMAIN}`, password: 'demo-ana-2026', rol: 'apostador', validado: true },
	{ key: 'carla', nombre: 'Carla Demo', email: `carla${DEMO_EMAIL_DOMAIN}`, password: 'demo-carla-2026', rol: 'apostador', validado: true },
	{ key: 'beto', nombre: 'Beto Demo', email: `beto${DEMO_EMAIL_DOMAIN}`, password: 'demo-beto-2026', rol: 'apostador', validado: false },
	// T-20: more validated bettors, so the ranking has ties (they share the same password pattern).
	...(['dani', 'eva', 'fede', 'gabi', 'hugo', 'ines', 'julio', 'kari'] as const).map((key) => ({
		key,
		nombre: `${key[0]!.toUpperCase()}${key.slice(1)} Demo`,
		email: `${key}${DEMO_EMAIL_DOMAIN}`,
		password: `demo-${key}-2026`,
		rol: 'apostador' as const,
		validado: true,
	})),
];

export class DevSeedError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'DevSeedError';
	}
}

export interface DevSeedGuardInput {
	nodeEnv: string;
	/** NODE_ENV came from the real process environment (not the default, not `.env`). */
	nodeEnvExplicit: boolean;
	/** The database the command would connect to. */
	database: string;
	/** DEV_SEED_DATABASE. */
	devDatabase: string | null;
	testDatabase: string;
	argv: readonly string[];
}

/** A name that looks like a test database (`la_liga_acp_test`, `la_liga_acp_test_2`, `test_db`...). */
const TEST_LIKE = /test/i;

/** Every reason the CLI must not run (D-016): empty means it may. */
export function devSeedProblems(input: DevSeedGuardInput): string[] {
	const problems: string[] = [];
	if (!input.nodeEnvExplicit || input.nodeEnv !== 'development') {
		const now = input.nodeEnvExplicit ? input.nodeEnv : 'sin definir';
		problems.push(`NODE_ENV tiene que ser development, definida en el entorno del proceso (ahora: ${now}).`);
	}
	if (!input.devDatabase) {
		problems.push('Falta DEV_SEED_DATABASE, el nombre de la base de desarrollo.');
	} else if (input.database !== input.devDatabase) {
		problems.push(`La base configurada (${input.database}) no es la de desarrollo (DEV_SEED_DATABASE=${input.devDatabase}).`);
	}
	if (input.database === input.testDatabase || TEST_LIKE.test(input.database)) {
		problems.push(`La base ${input.database} es de pruebas.`);
	}
	if (!input.argv.includes(DEV_SEED_FLAG)) {
		problems.push(`Falta la bandera ${DEV_SEED_FLAG} en la línea de comandos.`);
	}
	return problems;
}

/** The CLI's barrier (D-016): throws with every problem found. */
export function assertDevSeedAllowed(input: DevSeedGuardInput): void {
	const problems = devSeedProblems(input);
	if (problems.length > 0) {
		throw new DevSeedError(
			`Los datos de ejemplo solo se cargan o borran en la base de desarrollo. No se cambió nada:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
		);
	}
}

/** Checks the live connection too: the pool must really be on the development database. */
export async function assertConnectedTo(pool: Pool, database: string): Promise<void> {
	const [rows] = await pool.query<RowDataPacket[]>('SELECT DATABASE() AS name');
	const current = rows[0]?.name == null ? null : String(rows[0].name);
	if (current !== database) {
		throw new DevSeedError(`La conexión está en la base ${current ?? '(ninguna)'}, no en ${database}. No se cambió nada.`);
	}
}

/**
 * The marks table (D-016). DDL commits implicitly, so it runs before any
 * transaction. Only the development command creates it.
 */
const MARKS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS dato_demo (
	tabla   VARCHAR(50)     NOT NULL,
	fila_id BIGINT UNSIGNED NOT NULL,
	PRIMARY KEY (tabla, fila_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
COMMENT='Solo desarrollo (D-016): filas creadas por seed:dev'`;

export async function ensureMarksTable(pool: Pool): Promise<void> {
	await pool.query(MARKS_TABLE_SQL);
}

/** The tables whose rows the command creates and marks. */
type MarkedTable = 'deporte' | 'competicion' | 'equipo' | 'jugador' | 'plantel' | 'partido' | 'partido_equipo' | 'usuario';

interface SportSeed {
	slug: string;
	nombre: string;
	permiteEmpate: boolean;
	competicion: { slug: string; nombre: string };
	equipos: Array<{ nombre: string; corto: string; color: string }>;
}

/** Every crest points at the site's own logo (`public/favicon.png`): no external host, no fake file. */
const ESCUDO = 'favicon.png';

const SPORTS: SportSeed[] = [
	{
		slug: `${DEMO_SLUG_PREFIX}futbol`,
		nombre: 'Fútbol (demo)',
		permiteEmpate: true,
		competicion: { slug: `${DEMO_SLUG_PREFIX}liga`, nombre: 'Liga Demo' },
		equipos: [
			{ nombre: 'Halcones', corto: 'HAL', color: '#3cf281' },
			{ nombre: 'Pumas', corto: 'PUM', color: '#ffd23f' },
			{ nombre: 'Cóndores', corto: 'CON', color: '#ff4d6d' },
			{ nombre: 'Lobos', corto: 'LOB', color: '#9aa0d8' },
		],
	},
	{
		slug: `${DEMO_SLUG_PREFIX}voley`,
		nombre: 'Vóley (demo)',
		permiteEmpate: false,
		competicion: { slug: `${DEMO_SLUG_PREFIX}copa-voley`, nombre: 'Copa Vóley Demo' },
		equipos: [
			{ nombre: 'Águilas', corto: 'AGU', color: '#4d53a6' },
			{ nombre: 'Delfines', corto: 'DEL', color: '#3cf281' },
		],
	},
	{
		slug: `${DEMO_SLUG_PREFIX}basquet`,
		nombre: 'Básquet (demo)',
		permiteEmpate: false,
		competicion: { slug: `${DEMO_SLUG_PREFIX}liga-basquet`, nombre: 'Liga Básquet Demo' },
		equipos: [
			{ nombre: 'Toros', corto: 'TOR', color: '#ff4d6d' },
			{ nombre: 'Rayos', corto: 'RAY', color: '#ffd23f' },
		],
	},
];

const PLAYERS = ['Ana Rojas', 'Luis Paredes', 'Sofía Díaz', 'Mateo Quispe', 'Valeria Chávez', 'Diego Salas'];

type MatchState = 'programado' | 'en_curso' | 'finalizado' | 'cancelado';

interface MatchSeed {
	sport: number;
	local: number;
	visita: number;
	jornada: number;
	/** Minutes from now (negative: in the past). */
	minutes: number;
	estado: MatchState;
	goles?: [number, number];
	sede: string;
}

const HOUR = 60;
const DAY = 24 * HOUR;

/** One match per betting state (BR-052) and then some, in the three sports. */
const MATCHES: MatchSeed[] = [
	// Fútbol: finished (a win and a draw), in progress, closed, cancelled, open.
	{ sport: 0, local: 0, visita: 1, jornada: 1, minutes: -3 * DAY, estado: 'finalizado', goles: [2, 1], sede: 'Estadio Demo Norte' },
	{ sport: 0, local: 2, visita: 3, jornada: 1, minutes: -3 * DAY + 2 * HOUR, estado: 'finalizado', goles: [1, 1], sede: 'Estadio Demo Sur' },
	{ sport: 0, local: 1, visita: 2, jornada: 2, minutes: -30, estado: 'programado', sede: 'Estadio Demo Norte' },
	{ sport: 0, local: 3, visita: 0, jornada: 2, minutes: 2 * DAY, estado: 'cancelado', sede: 'Estadio Demo Sur' },
	{ sport: 0, local: 0, visita: 2, jornada: 3, minutes: 6 * HOUR, estado: 'programado', sede: 'Estadio Demo Norte' },
	{ sport: 0, local: 1, visita: 3, jornada: 3, minutes: 2 * DAY + 3 * HOUR, estado: 'programado', sede: 'Estadio Demo Sur' },
	{ sport: 0, local: 2, visita: 0, jornada: 4, minutes: 4 * DAY, estado: 'programado', sede: 'Estadio Demo Norte' },
	{ sport: 0, local: 3, visita: 1, jornada: 4, minutes: 7 * DAY, estado: 'programado', sede: 'Estadio Demo Sur' },
	// Vóley (no draws): finished, closed, open.
	{ sport: 1, local: 0, visita: 1, jornada: 1, minutes: -2 * DAY, estado: 'finalizado', goles: [3, 1], sede: 'Coliseo Demo' },
	{ sport: 1, local: 1, visita: 0, jornada: 2, minutes: 12 * HOUR, estado: 'programado', sede: 'Coliseo Demo' },
	{ sport: 1, local: 0, visita: 1, jornada: 3, minutes: 3 * DAY, estado: 'programado', sede: 'Coliseo Demo' },
	// Básquet (no draws): in progress, open.
	{ sport: 2, local: 0, visita: 1, jornada: 1, minutes: -20, estado: 'programado', sede: 'Arena Demo' },
	{ sport: 2, local: 1, visita: 0, jornada: 2, minutes: 5 * DAY, estado: 'programado', sede: 'Arena Demo' },
	// T-21: football that started 2 hours ago, over and waiting for its result (the admin tour confirms it).
	{ sport: 0, local: 0, visita: 3, jornada: 5, minutes: -2 * HOUR, estado: 'programado', sede: 'Estadio Demo Norte' },
];

export interface SeedSummary {
	deportes: number;
	competiciones: number;
	equipos: number;
	jugadores: number;
	partidos: number;
	/** `saldoMonedas` is the real balance after the sample tickets (null for the admin). */
	cuentas: Array<{ email: string; password: string; rol: string; validado: boolean; saldoMonedas: number | null }>;
}

export interface CleanSummary {
	deportes: number;
	partidos: number;
	jugadores: number;
	cuentas: number;
}

async function ids(conn: TransactionConnection, sql: string, params: unknown[]): Promise<number[]> {
	const [rows] = await conn.query<RowDataPacket[]>(sql, params);
	return rows.map((row) => Number(row.id));
}

/** A list usable in `IN (?)`: ids are never 0, so `[0]` matches nothing. */
const inList = (values: number[]) => (values.length > 0 ? values : [0]);

async function count(conn: TransactionConnection, sql: string, params: unknown[]): Promise<number> {
	const [rows] = await conn.query<RowDataPacket[]>(sql, params);
	return Number(rows[0]?.n ?? 0);
}

/** `DELETE ... WHERE col IN (?)`, skipped for an empty list. Returns the deleted rows. */
async function deleteIn(conn: TransactionConnection, sql: string, values: number[]): Promise<number> {
	if (values.length === 0) return 0;
	const [result] = await conn.query<ResultSetHeader>(sql, [values]);
	return result.affectedRows;
}

const marked = (conn: TransactionConnection, tabla: MarkedTable) =>
	ids(conn, 'SELECT fila_id AS id FROM dato_demo WHERE tabla = ? ORDER BY fila_id', [tabla]);

/** Rows created by a sample account, according to its `alta_*` audit record. */
const createdBySample = (conn: TransactionConnection, tabla: string, codigo: string, candidates: number[], users: number[]) =>
	candidates.length === 0
		? Promise.resolve([])
		: ids(
				conn,
				`SELECT x.id FROM ${tabla} x WHERE x.id IN (?) AND EXISTS (
					SELECT 1 FROM auditoria au JOIN accion_auditoria aa ON aa.id = au.accion_id
					WHERE aa.codigo = ? AND au.entidad_id = x.id AND au.usuario_id IN (?))`,
				[candidates, codigo, inList(users)],
			);

async function cleanIn(conn: TransactionConnection): Promise<CleanSummary> {
	const sports = await marked(conn, 'deporte');
	const competitions = await marked(conn, 'competicion');
	const teams = await marked(conn, 'equipo');
	const players = await marked(conn, 'jugador');
	const enrollments = await marked(conn, 'plantel');
	const matches = await marked(conn, 'partido');
	const sides = await marked(conn, 'partido_equipo');
	const users = await marked(conn, 'usuario');

	// Goals and media on sample matches: the sample admin's are ours, anyone else's are real.
	const goalsThere = await ids(
		conn,
		'SELECT id FROM gol WHERE partido_equipo_id IN (?) OR plantel_id IN (?) OR equipo_id IN (?)',
		[inList(sides), inList(enrollments), inList(teams)],
	);
	const goals = await createdBySample(conn, 'gol', 'alta_gol', goalsThere, users);
	const mediaThere = await ids(conn, 'SELECT id FROM multimedia_partido WHERE partido_id IN (?)', [inList(matches)]);
	const media = await createdBySample(conn, 'multimedia_partido', 'alta_multimedia', mediaThere, users);

	// Real data hanging from sample rows: refuse, deleting nothing.
	const problems: string[] = [];
	const [bettors] = await conn.query<RowDataPacket[]>(
		`SELECT DISTINCT u.email FROM seleccion s JOIN ticket t ON t.id = s.ticket_id JOIN usuario u ON u.id = t.usuario_id
		WHERE s.partido_id IN (?) AND t.usuario_id NOT IN (?) ORDER BY u.email`,
		[inList(matches), inList(users)],
	);
	if (bettors.length > 0) {
		problems.push(`apuestas de otras cuentas sobre partidos de ejemplo (${bettors.map((row) => String(row.email)).join(', ')})`);
	}
	const hanging: Array<[[string, string], string, number[][]]> = [
		[['competición real en un deporte de ejemplo', 'competiciones reales en deportes de ejemplo'], 'SELECT COUNT(*) AS n FROM competicion WHERE deporte_id IN (?) AND id NOT IN (?)', [sports, competitions]],
		[['equipo real en una competición de ejemplo', 'equipos reales en competiciones de ejemplo'], 'SELECT COUNT(*) AS n FROM equipo WHERE competicion_id IN (?) AND id NOT IN (?)', [competitions, teams]],
		[['partido real en una competición de ejemplo', 'partidos reales en competiciones de ejemplo'], 'SELECT COUNT(*) AS n FROM partido WHERE competicion_id IN (?) AND id NOT IN (?)', [competitions, matches]],
		[
			['inscripción real con equipos o jugadores de ejemplo', 'inscripciones reales con equipos o jugadores de ejemplo'],
			'SELECT COUNT(*) AS n FROM plantel WHERE (equipo_id IN (?) OR jugador_id IN (?) OR competicion_id IN (?)) AND id NOT IN (?)',
			[teams, players, competitions, enrollments],
		],
		[
			['lado de partido real con equipos de ejemplo', 'lados de partidos reales con equipos de ejemplo'],
			'SELECT COUNT(*) AS n FROM partido_equipo WHERE (partido_id IN (?) OR equipo_id IN (?)) AND id NOT IN (?)',
			[matches, teams, sides],
		],
	];
	for (const [[one, many], sql, lists] of hanging) {
		const n = await count(conn, sql, lists.map(inList));
		if (n > 0) problems.push(plural(n, one, many));
	}
	if (goals.length < goalsThere.length) problems.push(`${plural(goalsThere.length - goals.length, 'gol real', 'goles reales')} sobre datos de ejemplo`);
	if (media.length < mediaThere.length) problems.push(`${plural(mediaThere.length - media.length, 'imagen o video real', 'imágenes o videos reales')} en partidos de ejemplo`);
	// Any audited action of a real admin on a sample row (a loaded result, an edit, a validation...).
	const realActions = await count(
		conn,
		`SELECT COUNT(*) AS n FROM auditoria au JOIN accion_auditoria aa ON aa.id = au.accion_id
		WHERE au.usuario_id NOT IN (?) AND (
			EXISTS (SELECT 1 FROM dato_demo d WHERE d.tabla = aa.entidad AND d.fila_id = au.entidad_id)
			OR (aa.entidad = 'gol' AND au.entidad_id IN (?))
			OR (aa.entidad = 'multimedia_partido' AND au.entidad_id IN (?)))`,
		[inList(users), inList(goals), inList(media)],
	);
	if (realActions > 0) problems.push(`${plural(realActions, 'acción de un administrador real', 'acciones de administradores reales')} sobre datos de ejemplo (resultados, cambios, validaciones)`);
	if (problems.length > 0) {
		throw new DevSeedError(
			`Hay datos reales colgados de los datos de ejemplo. Este comando solo borra lo suyo, así que no se borró nada:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
		);
	}

	// The sample accounts and everything they own.
	const tickets = await ids(conn, 'SELECT id FROM ticket WHERE usuario_id IN (?)', [inList(users)]);
	await deleteIn(conn, 'DELETE FROM movimiento_moneda WHERE usuario_id IN (?)', users);
	await deleteIn(conn, 'DELETE FROM seleccion WHERE ticket_id IN (?)', tickets);
	await deleteIn(conn, 'DELETE FROM ticket WHERE id IN (?)', tickets);
	await deleteIn(conn, 'DELETE FROM sesion WHERE usuario_id IN (?)', users);
	// Development only (D-015): the sample admin's audit records go with it.
	await deleteIn(conn, 'DELETE FROM auditoria WHERE usuario_id IN (?)', users);
	const cuentas = await deleteIn(conn, 'DELETE FROM usuario WHERE id IN (?)', users);

	// The sample catalog and matches, children first. Image files stay in UPLOADS_DIR.
	await deleteIn(conn, 'DELETE FROM gol WHERE id IN (?)', goals);
	await deleteIn(conn, 'DELETE FROM multimedia_partido WHERE id IN (?)', media);
	await deleteIn(conn, 'DELETE FROM partido_equipo WHERE id IN (?)', sides);
	const partidos = await deleteIn(conn, 'DELETE FROM partido WHERE id IN (?)', matches);
	await deleteIn(conn, 'DELETE FROM plantel WHERE id IN (?)', enrollments);
	await deleteIn(conn, 'DELETE FROM equipo WHERE id IN (?)', teams);
	await deleteIn(conn, 'DELETE FROM competicion WHERE id IN (?)', competitions);
	const deportes = await deleteIn(conn, 'DELETE FROM deporte WHERE id IN (?)', sports);
	const jugadores = await deleteIn(conn, 'DELETE FROM jugador WHERE id IN (?)', players);
	await conn.query('DELETE FROM dato_demo');

	return { deportes, partidos, jugadores, cuentas };
}

/** Removes every marked sample row (see the module comment), in one transaction. */
export async function cleanDevData(pool: Pool): Promise<CleanSummary> {
	await ensureMarksTable(pool);
	return withTransaction(pool, (conn) => cleanIn(conn));
}

const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

/** Real rows that would collide with the sample ones (same sport slug or account email). */
async function collisions(conn: TransactionConnection): Promise<string[]> {
	const [rows] = await conn.query<RowDataPacket[]>(
		`SELECT CONCAT('deporte ', slug) AS what FROM deporte WHERE slug IN (?)
		UNION ALL SELECT CONCAT('cuenta ', email) FROM usuario WHERE email IN (?)`,
		[SPORTS.map((sport) => sport.slug), DEMO_ACCOUNTS.map((account) => account.email)],
	);
	return rows.map((row) => String(row.what));
}

/**
 * Loads the sample data, replacing any earlier sample data (repeatable).
 * `now` anchors the match dates, so every betting state exists right after
 * seeding (open matches start at least 2 days later, closed ones within 24 h).
 */
export async function seedDevData(pool: Pool, now: Date = new Date()): Promise<SeedSummary> {
	// Hashing is slow: done before the transaction.
	const hashes = new Map<string, string>();
	for (const account of DEMO_ACCOUNTS) hashes.set(account.key, await hashPassword(account.password));
	await ensureMarksTable(pool);

	return withTransaction(pool, async (conn) => {
		await cleanIn(conn);
		const taken = await collisions(conn);
		if (taken.length > 0) {
			throw new DevSeedError(`Ya existen datos reales con los nombres de los de ejemplo (${taken.join(', ')}). No se cambió nada.`);
		}
		const marks: Array<[MarkedTable, number]> = [];
		const [[states]] = await conn.query<RowDataPacket[]>(
			`SELECT (SELECT id FROM estado_partido WHERE codigo = 'programado') AS programado,
				(SELECT id FROM estado_partido WHERE codigo = 'en_curso') AS en_curso,
				(SELECT id FROM estado_partido WHERE codigo = 'finalizado') AS finalizado,
				(SELECT id FROM estado_partido WHERE codigo = 'cancelado') AS cancelado`,
		);
		if (!states?.programado) throw new DevSeedError('Faltan los catálogos (¿se cargó 02-catalogos.sql?).');

		const teamIds: number[][] = [];
		const competitionIds: number[] = [];
		let players = 0;
		for (const sport of SPORTS) {
			const [deporte] = await conn.query<ResultSetHeader>('INSERT INTO deporte (nombre, slug, permite_empate) VALUES (?, ?, ?)', [
				sport.nombre,
				sport.slug,
				sport.permiteEmpate,
			]);
			const [competicion] = await conn.query<ResultSetHeader>('INSERT INTO competicion (deporte_id, nombre, slug) VALUES (?, ?, ?)', [
				deporte.insertId,
				sport.competicion.nombre,
				sport.competicion.slug,
			]);
			marks.push(['deporte', deporte.insertId], ['competicion', competicion.insertId]);
			competitionIds.push(competicion.insertId);
			const teams: number[] = [];
			for (const team of sport.equipos) {
				const [equipo] = await conn.query<ResultSetHeader>(
					'INSERT INTO equipo (competicion_id, nombre, nombre_corto, escudo, color_acento) VALUES (?, ?, ?, ?, ?)',
					[competicion.insertId, team.nombre, team.corto, ESCUDO, team.color],
				);
				teams.push(equipo.insertId);
				marks.push(['equipo', equipo.insertId]);
				for (let shirt = 1; shirt <= 3; shirt++) {
					const nombre = `${PLAYERS[(players + shirt) % PLAYERS.length]} ${team.corto}${DEMO_PLAYER_SUFFIX}`;
					const [jugador] = await conn.query<ResultSetHeader>('INSERT INTO jugador (nombre, foto) VALUES (?, NULL)', [nombre]);
					const [plantel] = await conn.query<ResultSetHeader>('INSERT INTO plantel (jugador_id, equipo_id, competicion_id, numero_camiseta) VALUES (?, ?, ?, ?)', [
						jugador.insertId,
						equipo.insertId,
						competicion.insertId,
						shirt * 7,
					]);
					marks.push(['jugador', jugador.insertId], ['plantel', plantel.insertId]);
				}
				players += 3;
			}
			teamIds.push(teams);
		}

		const matchIds: number[] = [];
		for (const match of MATCHES) {
			const competicionId = competitionIds[match.sport]!;
			const [partido] = await conn.query<ResultSetHeader>(
				'INSERT INTO partido (competicion_id, estado_partido_id, jornada, fecha_hora, sede) VALUES (?, ?, ?, ?, ?)',
				[competicionId, states[match.estado], match.jornada, wholeSeconds(now.getTime() + match.minutes * 60_000), match.sede],
			);
			marks.push(['partido', partido.insertId]);
			matchIds.push(partido.insertId);
			const [golesLocal, golesVisita] = match.goles ?? [null, null];
			for (const [equipo, esVisita, goles] of [
				[match.local, false, golesLocal],
				[match.visita, true, golesVisita],
			] as const) {
				const [lado] = await conn.query<ResultSetHeader>(
					'INSERT INTO partido_equipo (partido_id, equipo_id, competicion_id, es_visita, goles) VALUES (?, ?, ?, ?, ?)',
					[partido.insertId, teamIds[match.sport]![equipo], competicionId, esVisita, goles],
				);
				marks.push(['partido_equipo', lado.insertId]);
			}
		}

		const accountIds = new Map<string, number>();
		for (const account of DEMO_ACCOUNTS) {
			const id = await insertUser(conn, { nombre: account.nombre, email: account.email, passwordHash: hashes.get(account.key)!, rol: account.rol }, now);
			marks.push(['usuario', id]);
			accountIds.set(account.key, id);
			if (account.validado) {
				await conn.query(
					`UPDATE usuario SET estado_pago_id = (SELECT id FROM estado_pago WHERE codigo = 'confirmado'),
						estado_usuario_id = (SELECT id FROM estado_usuario WHERE codigo = 'validado') WHERE id = ?`,
					[id],
				);
				await grantValidationCoins(conn, id);
			}
		}

		await seedTickets(conn, now, accountIds, matchIds, competitionIds);

		await conn.query('INSERT INTO dato_demo (tabla, fila_id) VALUES ?', [marks]);
		const [balances] = await conn.query<RowDataPacket[]>('SELECT id, saldo_monedas FROM usuario WHERE id IN (?)', [[...accountIds.values()]]);
		const balanceOf = new Map(balances.map((row) => [Number(row.id), Number(row.saldo_monedas)]));

		return {
			deportes: SPORTS.length,
			competiciones: SPORTS.length,
			equipos: SPORTS.reduce((sum, sport) => sum + sport.equipos.length, 0),
			jugadores: players,
			partidos: MATCHES.length,
			cuentas: DEMO_ACCOUNTS.map(({ key, email, password, rol, validado }) => ({
				email,
				password,
				rol,
				validado,
				saldoMonedas: rol === 'apostador' ? (balanceOf.get(accountIds.get(key)!) ?? 0) : null,
			})),
		};
	});
}

/**
 * `settled` is the state the pick must end in. `acertada`/`no_acertada` are
 * not written here: the real settler (T-14) decides them, and the seed checks
 * they came out as expected. `anulada` only goes on the cancelled match.
 */
type Pick =
	| { match: number; resultado: 'local_gana' | 'empate' | 'visitante_gana'; settled?: 'acertada' | 'no_acertada' | 'anulada' }
	| { match: number; goles: [number, number]; settled?: 'acertada' | 'no_acertada' | 'anulada' };

interface TicketSeed {
	account: string;
	/** Hours before now when it was confirmed: before the betting close of every one of its matches (BR-014). */
	hoursAgo: number;
	picks: Pick[];
}

/**
 * T-20: tickets in every state, so "Mis apuestas" and the ranking have
 * something to show. Indexes point at `MATCHES`: 0 (2-1) and 1 (1-1) are
 * finished football, 3 is cancelled, 5 and 6 are open, 8 is finished volleyball
 * (3-1). Settled picks follow the points table (3 for a winner or an exact
 * score, 1 for a draw); Ana and Carla tie at the top with 6 points and 2 hits.
 */
const TICKETS: TicketSeed[] = [
	{
		account: 'ana',
		hoursAgo: 120,
		picks: [
			{ match: 0, resultado: 'local_gana', settled: 'acertada' },
			{ match: 1, goles: [1, 1], settled: 'acertada' },
		],
	},
	{ account: 'ana', hoursAgo: 96, picks: [{ match: 3, resultado: 'empate', settled: 'anulada' }] },
	{
		account: 'ana',
		hoursAgo: 2,
		picks: [
			{ match: 5, resultado: 'local_gana' },
			{ match: 6, goles: [2, 0] },
		],
	},
	{
		account: 'carla',
		hoursAgo: 110,
		picks: [
			{ match: 0, goles: [2, 1], settled: 'acertada' },
			{ match: 8, resultado: 'local_gana', settled: 'acertada' },
			{ match: 1, resultado: 'local_gana', settled: 'no_acertada' },
		],
	},
	{ account: 'dani', hoursAgo: 100, picks: [{ match: 1, resultado: 'empate', settled: 'acertada' }] },
	{ account: 'eva', hoursAgo: 100, picks: [{ match: 0, resultado: 'visitante_gana', settled: 'no_acertada' }] },
	// T-21: a bet still pending on the match waiting for its result.
	{ account: 'fede', hoursAgo: 30, picks: [{ match: 13, resultado: 'local_gana' }] },
];

/**
 * T-20 fix: when each sample ticket was confirmed and the betting close of
 * each of its matches, in ms. A test requires `confirmado < cierre` for every
 * pair (BR-014), so no sample ticket is one the API would refuse.
 */
export function sampleTicketTimes(now: Date): Array<{ confirmado: number; cierres: number[] }> {
	const confirmedAt = (ticket: TicketSeed) => wholeSeconds(now.getTime() - ticket.hoursAgo * 3_600_000).getTime();
	const closeOf = (match: number) =>
		wholeSeconds(now.getTime() + MATCHES[match]!.minutes * 60_000).getTime() - HORAS_CIERRE_APUESTAS * 3_600_000;
	return TICKETS.map((ticket) => ({ confirmado: confirmedAt(ticket), cierres: ticket.picks.map((pick) => closeOf(pick.match)) }));
}

/**
 * Inserts the sample tickets and debits them like a confirmation (T-10), then:
 *
 * - settles every finished sample match with the real settler (T-14,
 *   `settleMatchSelections`), and checks each pick ended as `settled` says;
 * - voids the picks on the cancelled match and refunds them with the real
 *   coin service (`refundSelections`).
 *
 * The cancellation itself (`cancelMatch`, T-16) is not called: it opens its
 * own transaction and writes an audit record as an admin, so it can't run
 * inside the seed's single transaction (a failure would leave half-loaded
 * data), and the cancelled match is inserted already `cancelado`. The void is
 * the same UPDATE the cancellation runs (pending to anulada, points NULL), and
 * the refund goes through the same coin rules (only debited selections, once).
 */
async function seedTickets(
	conn: TransactionConnection,
	now: Date,
	accounts: ReadonlyMap<string, number>,
	matchIds: readonly number[],
	competitionIds: readonly number[],
): Promise<void> {
	const [[ids]] = await conn.query<RowDataPacket[]>(
		`SELECT (SELECT id FROM tipo_apuesta WHERE codigo = 'resultado_general') AS general,
			(SELECT id FROM tipo_apuesta WHERE codigo = 'marcador_exacto') AS exacto,
			(SELECT id FROM estado_seleccion WHERE codigo = 'pendiente') AS pendiente,
			(SELECT id FROM estado_seleccion WHERE codigo = 'acertada') AS acertada,
			(SELECT id FROM estado_seleccion WHERE codigo = 'no_acertada') AS no_acertada,
			(SELECT id FROM estado_seleccion WHERE codigo = 'anulada') AS anulada,
			(SELECT id FROM resultado_general WHERE codigo = 'local_gana') AS local_gana,
			(SELECT id FROM resultado_general WHERE codigo = 'empate') AS empate,
			(SELECT id FROM resultado_general WHERE codigo = 'visitante_gana') AS visitante_gana`,
	);
	if (!ids?.general) throw new DevSeedError('Faltan los catálogos de apuestas (¿se cargó 02-catalogos.sql?).');

	const expected: Array<[number, string]> = [];
	for (const ticket of TICKETS) {
		const userId = accounts.get(ticket.account)!;
		const [created] = await conn.query<ResultSetHeader>(
			'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, ?, ?, ?)',
			[userId, wholeSeconds(now.getTime() - ticket.hoursAgo * 3_600_000), randomUUID(), createHash('sha256').update(JSON.stringify(ticket.picks)).digest('hex')],
		);
		const selectionIds: number[] = [];
		for (const pick of ticket.picks) {
			const general = 'resultado' in pick;
			const [row] = await conn.query<ResultSetHeader>(
				`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, pronostico_goles_local,
					pronostico_goles_visitante, estado_seleccion_id, puntos_obtenidos) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
				[
					created.insertId,
					matchIds[pick.match],
					general ? ids.general : ids.exacto,
					general ? ids[pick.resultado] : null,
					general ? null : pick.goles[0],
					general ? null : pick.goles[1],
					ids.pendiente,
				],
			);
			selectionIds.push(row.insertId);
		}
		await debitSelections(conn, userId, selectionIds);
		for (const [index, pick] of ticket.picks.entries()) {
			const id = selectionIds[index]!;
			expected.push([id, pick.settled ?? 'pendiente']);
			if (pick.settled !== 'anulada') continue;
			if (MATCHES[pick.match]!.estado !== 'cancelado') {
				throw new DevSeedError(`Selección de ejemplo anulada en un partido que no está cancelado (${pick.match}).`);
			}
			await conn.query('UPDATE seleccion SET estado_seleccion_id = ?, puntos_obtenidos = NULL WHERE id = ? AND estado_seleccion_id = ?', [
				ids.anulada,
				id,
				ids.pendiente,
			]);
			await refundSelections(conn, userId, [id]);
		}
	}

	// The finished matches, settled as a confirmed result would be (match row locked first, like T-12).
	for (const [index, match] of MATCHES.entries()) {
		if (match.estado !== 'finalizado' || !match.goles) continue;
		const id = matchIds[index]!;
		await conn.query('SELECT id FROM partido FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE', [id]);
		const [golesLocal, golesVisitante] = match.goles;
		await settleMatchSelections(conn, {
			id,
			competicionId: competitionIds[match.sport]!,
			golesLocal,
			golesVisitante,
			resultado: resultOfScore(golesLocal, golesVisitante),
		});
	}

	const [rows] = await conn.query<RowDataPacket[]>(
		'SELECT s.id, e.codigo FROM seleccion s JOIN estado_seleccion e ON e.id = s.estado_seleccion_id WHERE s.id IN (?)',
		[expected.map(([id]) => id)],
	);
	const actual = new Map(rows.map((row) => [Number(row.id), String(row.codigo)]));
	const wrong = expected.filter(([id, codigo]) => actual.get(id) !== codigo);
	if (wrong.length > 0) {
		const list = wrong.map(([id, codigo]) => `${id}: ${actual.get(id)} en vez de ${codigo}`).join(', ');
		throw new DevSeedError(`Las apuestas de ejemplo no quedaron como se esperaba (${list}).`);
	}
}
