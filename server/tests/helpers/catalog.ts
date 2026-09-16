import type { Express } from 'express';
import type { Pool, ResultSetHeader } from 'mysql2/promise';
import request from 'supertest';
import { registerUser, signedInUser } from './auth.js';

/** An admin session and request shortcuts with its cookie and CSRF token. */
export async function adminApi(app: Express, pool: Pool) {
	const admin = await signedInUser(app, pool, { rol: 'admin' });
	const withAuth = (req: request.Test) => req.set('Cookie', admin.cookie).set('X-CSRF-Token', admin.csrfToken);
	return {
		admin,
		get: (path: string) => request(app).get(`/admin${path}`).set('Cookie', admin.cookie),
		post: (path: string, body: unknown) => withAuth(request(app).post(`/admin${path}`)).send(body as object),
		patch: (path: string, body: unknown) => withAuth(request(app).patch(`/admin${path}`)).send(body as object),
		del: (path: string) => withAuth(request(app).delete(`/admin${path}`)),
	};
}

export type AdminApi = Awaited<ReturnType<typeof adminApi>>;

/** Creates through the API and returns `data` (fails loudly if not 201). */
export async function created<T = Record<string, unknown>>(res: request.Response | Promise<request.Response>): Promise<T> {
	const r = await res;
	if (r.status !== 201) throw new Error(`se esperaba 201 y llegó ${r.status}: ${JSON.stringify(r.body)}`);
	return r.body.data as T;
}

export const teamBody = (competicionId: number, overrides: Record<string, unknown> = {}) => ({
	competicionId,
	nombre: 'Club Atlético',
	nombreCorto: 'Atlético',
	escudo: 'escudos/atletico.webp',
	colorAcento: '#A50044',
	...overrides,
});

/** Sport → competition → team through the API. */
export async function sportCompetitionTeam(api: AdminApi, suffix = '') {
	const sport = await created<{ id: number }>(api.post('/deportes', { nombre: `Fútbol${suffix}`, permiteEmpate: true }));
	const competition = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: `Apertura${suffix}` }));
	const team = await created<{ id: number }>(api.post('/equipos', teamBody(competition.id, { nombre: `Club${suffix}` })));
	return { sportId: sport.id, competitionId: competition.id, teamId: team.id };
}

/**
 * A match straight in the database (the admin API for matches is T-07), with
 * its two teams, in the given state and at the given date (a week ahead by default).
 */
export async function insertMatch(
	pool: Pool,
	competitionId: number,
	homeId: number,
	awayId: number,
	estado: 'programado' | 'en_curso' | 'finalizado' | 'cancelado' = 'programado',
	fechaHora: Date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
): Promise<number> {
	const [match] = await pool.query<ResultSetHeader>(
		`INSERT INTO partido (competicion_id, estado_partido_id, jornada, fecha_hora, sede)
		SELECT ?, id, 1, ?, 'Estadio' FROM estado_partido WHERE codigo = ?`,
		[competitionId, new Date(Math.floor(fechaHora.getTime() / 1000) * 1000), estado],
	);
	await pool.query(
		'INSERT INTO partido_equipo (partido_id, equipo_id, competicion_id, es_visita) VALUES (?, ?, ?, FALSE), (?, ?, ?, TRUE)',
		[match.insertId, homeId, competitionId, match.insertId, awayId, competitionId],
	);
	return match.insertId;
}

/** A draw bet on a match, from a fresh user (straight in the database; betting is T-09/T-10). */
export async function insertDrawBet(app: Express, pool: Pool, matchId: number): Promise<void> {
	const { user } = await registerUser(app);
	const [ticket] = await pool.query<ResultSetHeader>('INSERT INTO ticket (usuario_id, creado_en) VALUES (?, UTC_TIMESTAMP())', [
		user.id,
	]);
	await pool.query(
		`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id)
		SELECT ?, ?, ta.id, rg.id, es.id FROM tipo_apuesta ta, resultado_general rg, estado_seleccion es
		WHERE ta.codigo = 'resultado_general' AND rg.codigo = 'empate' AND es.codigo = 'pendiente'`,
		[ticket.insertId, matchId],
	);
}

/** A goal straight in the database (goal registration is T-13). */
export async function insertGoal(pool: Pool, matchId: number, teamId: number, enrollmentId: number): Promise<void> {
	await pool.query(
		`INSERT INTO gol (partido_equipo_id, plantel_id, equipo_id, minuto)
		SELECT pe.id, ?, ?, 10 FROM partido_equipo pe WHERE pe.partido_id = ? AND pe.equipo_id = ?`,
		[enrollmentId, teamId, matchId, teamId],
	);
}
