import type { Pool, RowDataPacket } from 'mysql2/promise';
import { withReadSnapshot } from '../db/transaction.js';
import type { ResultadoGeneralCodigo } from '../lib/match-result.js';
import { effectiveStateCondition } from '../lib/match-state.js';
import type { TipoApuestaCodigo } from '../lib/betting.js';
import type { ListParticipantBetsQuery } from '../schemas/betting.schema.js';
import { type Page, toPage } from '../schemas/common.schema.js';
import { BETTOR_TICKET } from './admin-bets.service.js';
import { stateId } from './bet-history.service.js';
import { likePattern, Where } from './catalog-query.js';
import { NOMBRE_ORDEN } from './ranking.service.js';
import { SELECTION_COLUMNS, SELECTION_JOINS, selectionFrom } from './tickets.service.js';

/**
 * Módulo Polla, C-07 (BR-056, D-036): the bets of every participant, for the
 * participants, once the result of their match is official. Read only.
 *
 * - Only selections of matches with the **official result**: `finalizado`
 *   with both sides loaded, the rule of BR-049 and of `resultadoReal`. A score
 *   loaded but not confirmed stays private (T-12); a cancelled match never
 *   shows.
 * - Only tickets of `apostador` accounts (BR-001) and never an `anulada`
 *   selection.
 * - Of the participant, only the display name, as in the ranking: never an
 *   id, email, balance, ticket, key or fingerprint. Of the bet, only what was
 *   forecast: never its state or points (those are the owner's, BR-026).
 */

export interface ParticipantBetTeam {
	id: number;
	nombre: string;
	nombreCorto: string;
	escudo: string;
	/** For the crest's fallback (initials on the team's color), as everywhere else. */
	colorAcento: string;
}

/** One row: who bet, on which match, and what. Nothing else leaves the server. */
export interface ParticipantBet {
	participante: { nombre: string };
	partido: {
		id: number;
		/** UTC, ISO 8601. */
		fechaHora: Date;
		competicion: { id: number; nombre: string };
		deporte: { id: number; nombre: string };
		local: ParticipantBetTeam;
		visita: ParticipantBetTeam;
	};
	apuesta: {
		tipo: TipoApuestaCodigo;
		/** `resultado_general` only. */
		pronostico: ResultadoGeneralCodigo | null;
		/** `marcador_exacto` only. */
		golesLocal: number | null;
		golesVisitante: number | null;
	};
}

/** The most recent match first; inside a match, by name in Spanish order; then the selection. */
const ORDER = `p.fecha_hora DESC, u.${NOMBRE_ORDEN}, s.id`;

const team = ({ id, nombre, nombreCorto, escudo, colorAcento }: ParticipantBetTeam): ParticipantBetTeam => ({ id, nombre, nombreCorto, escudo, colorAcento });

/**
 * Two steps, like the history (T-11): the page of selection ids from
 * `seleccion`, its match, both sides, its ticket and the participant (what the
 * rules, the filters and the order need), then only those rows with their
 * teams and names, in one read-only snapshot so the total and the page agree.
 * The finished matches are few and come through `idx_partido_fecha_hora`; the
 * selections of each through `idx_seleccion_partido_estado` (no new index,
 * see server/README.md).
 */
export async function listParticipantBets(pool: Pool, query: ListParticipantBetsQuery, now: Date = new Date()): Promise<Page<ParticipantBet>> {
	const finished = effectiveStateCondition('finalizado', now);
	const where = new Where()
		.add(BETTOR_TICKET)
		.add(`s.estado_seleccion_id <> ${stateId('anulada')}`)
		.add(finished.sql, ...finished.params)
		.add('l.goles IS NOT NULL AND v.goles IS NOT NULL');
	if (query.deporteId) where.add('p.competicion_id IN (SELECT fc.id FROM competicion fc WHERE fc.deporte_id = ?)', query.deporteId);
	if (query.participante) where.add('u.nombre LIKE ?', likePattern(query.participante));

	const from = `FROM seleccion s
		JOIN ticket t ON t.id = s.ticket_id
		JOIN usuario u ON u.id = t.usuario_id
		JOIN partido p ON p.id = s.partido_id
		JOIN estado_partido ep ON ep.id = p.estado_partido_id
		JOIN partido_equipo l ON l.partido_id = p.id AND l.es_visita = FALSE
		JOIN partido_equipo v ON v.partido_id = p.id AND v.es_visita = TRUE`;

	return withReadSnapshot(pool, async (db) => {
		const [[counted]] = await db.query<RowDataPacket[]>(`SELECT COUNT(*) AS total ${from} ${where.sql}`, where.params);
		const [page] = await db.query<RowDataPacket[]>(`SELECT s.id ${from} ${where.sql} ORDER BY ${ORDER} LIMIT ? OFFSET ?`, [
			...where.params,
			query.pageSize,
			(query.page - 1) * query.pageSize,
		]);
		const total = Number(counted?.total ?? 0);
		if (page.length === 0) return toPage([], total, query);

		const [rows] = await db.query<RowDataPacket[]>(
			`SELECT ${SELECTION_COLUMNS}, u.nombre AS u_nombre
			FROM seleccion s
			JOIN ticket t ON t.id = s.ticket_id
			JOIN usuario u ON u.id = t.usuario_id
			${SELECTION_JOINS}
			WHERE s.id IN (?)
			ORDER BY ${ORDER}`,
			[page.map((row) => Number(row.id))],
		);
		return toPage(
			rows.map((row) => {
				// The same mapping as the history and the receipt, then only what BR-056 lets out.
				const { partido, tipo, pronostico, golesLocal, golesVisitante } = selectionFrom(row);
				return {
					participante: { nombre: String(row.u_nombre) },
					partido: {
						id: partido.id,
						fechaHora: partido.fechaHora,
						competicion: { id: partido.competicion.id, nombre: partido.competicion.nombre },
						deporte: { id: partido.deporte.id, nombre: partido.deporte.nombre },
						local: team(partido.local.equipo),
						visita: team(partido.visita.equipo),
					},
					apuesta: { tipo, pronostico, golesLocal, golesVisitante },
				};
			}),
			total,
			query,
		);
	});
}
