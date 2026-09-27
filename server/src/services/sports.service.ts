import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { TransactionConnection } from '../db/transaction.js';
import { ErrorCode } from '../lib/error-codes.js';
import { HttpError } from '../lib/http-error.js';
import { effectiveStateCondition } from '../lib/match-state.js';
import { slugify } from '../lib/slug.js';
import type { CreateSportBody, ListSportsQuery, UpdateSportBody } from '../schemas/catalog.schema.js';
import type { Page } from '../schemas/common.schema.js';
import { type AdminActionContext, runAdminAction } from './admin-action.js';
import { type Db, dependents, describeDependents, likePattern, pageOf, Where } from './catalog-query.js';
import { statsProfileId } from './stats-profiles.js';
import { plural } from '../lib/plural.js';

/** Módulo Informativo: `deporte` (BR-001, BR-011, BR-015, BR-048). */

export interface Sport {
	id: number;
	nombre: string;
	slug: string;
	permiteEmpate: boolean;
	/** C-05 (D-034): the `codigo` of its players' statistics profile, or `null` (no statistics). */
	perfilEstadistico: string | null;
	/** Joined, never stored or audited. */
	perfilEstadisticoNombre: string | null;
}

/**
 * Extension point for BR-015. The Informativo module can't look at bets
 * (CLAUDE.md: Informativo never depends on Polla), so whoever composes the
 * app passes in the checks another module needs before a sport's
 * `permite_empate` changes. Each one runs inside the update's transaction,
 * with the sport row locked, and returns why the change is not allowed, or
 * `null`. The Polla module provides one (`services/bets-sport-guard.service.ts`).
 */
export type DrawRuleGuard = (conn: TransactionConnection, sportId: number) => Promise<string | null>;

const COLUMNS = 'd.id, d.nombre, d.slug, d.permite_empate, pe.codigo AS perfil_codigo, pe.nombre AS perfil_nombre';
const FROM = 'FROM deporte d LEFT JOIN perfil_estadistico pe ON pe.id = d.perfil_estadistico_id';

function toSport(row: RowDataPacket): Sport {
	return {
		id: Number(row.id),
		nombre: String(row.nombre),
		slug: String(row.slug),
		permiteEmpate: Boolean(row.permite_empate),
		perfilEstadistico: row.perfil_codigo === null ? null : String(row.perfil_codigo),
		perfilEstadisticoNombre: row.perfil_nombre === null ? null : String(row.perfil_nombre),
	};
}

async function find(db: Db, id: number, lock = false): Promise<Sport> {
	// Locks with its own statement by primary key (server/README.md, "Orden de bloqueo"), then reads.
	if (lock) await db.query('SELECT id FROM deporte FORCE INDEX (PRIMARY) WHERE id = ? FOR UPDATE', [id]);
	const [[row]] = await db.query<RowDataPacket[]>(`SELECT ${COLUMNS} ${FROM} WHERE d.id = ?`, [id]);
	if (!row) throw HttpError.notFound('No existe ese deporte.', ErrorCode.SPORT_NOT_FOUND);
	return toSport(row);
}

export function listSports(pool: Pool, query: ListSportsQuery): Promise<Page<Sport>> {
	const where = new Where();
	if (query.q) where.add('(d.nombre LIKE ? OR d.slug LIKE ?)', likePattern(query.q), likePattern(query.q));
	if (query.permiteEmpate !== undefined) where.add('d.permite_empate = ?', query.permiteEmpate);
	return pageOf(pool, { columns: COLUMNS, from: FROM, where, orderBy: 'd.nombre, d.id' }, query, toSport);
}

export function getSport(pool: Pool, id: number): Promise<Sport> {
	return find(pool, id);
}

/** The slug comes from the name when not sent; a taken one is a 409 `SLUG_TAKEN` (lib/db-errors.ts). */
export async function createSport(pool: Pool, ctx: AdminActionContext, input: CreateSportBody): Promise<Sport> {
	const outcome = await runAdminAction<Sport>(pool, ctx, 'crear', 'deporte', async (conn) => {
		const [result] = await conn.query<ResultSetHeader>(
			'INSERT INTO deporte (nombre, slug, permite_empate, perfil_estadistico_id) VALUES (?, ?, ?, ?)',
			[input.nombre, input.slug ?? requireSlug(input.nombre), input.permiteEmpate, await profileIdOf(conn, input.perfilEstadistico ?? null)],
		);
		return { id: result.insertId, before: null, after: await find(conn, result.insertId) };
	});
	return outcome.after!;
}

/** The id of a profile named by its `codigo` (`null` stays `null`); an unknown one is a 400 on `perfilEstadistico`. */
async function profileIdOf(db: Db, codigo: string | null): Promise<number | null> {
	if (codigo === null) return null;
	const id = await statsProfileId(db, codigo);
	if (id === undefined) {
		throw HttpError.badRequest('Solicitud inválida.', [
			{ path: 'perfilEstadistico', message: 'No existe ese perfil de estadísticas (futbol o voley).' },
		]);
	}
	return id;
}

export function requireSlug(nombre: string): string {
	const slug = slugify(nombre);
	if (!slug) {
		throw HttpError.badRequest('Solicitud inválida.', [
			{ path: 'slug', message: 'El nombre no tiene letras ni números: envía un slug.' },
		]);
	}
	return slug;
}

/**
 * Renaming keeps the slug (links stay valid) unless a new one is sent.
 *
 * `permite_empate` (BR-015) can only change while no bet could depend on it:
 * none of the sport's matches may have left `programado` (a running or
 * finished match was bet on, and is settled, under the old rule), and every
 * `DrawRuleGuard` must agree (Polla refuses if any selection exists on the
 * sport's matches). Otherwise 409 `DRAW_RULE_LOCKED`. The sport row is locked
 * for the whole check.
 *
 * The statistics profile (C-05, D-034) only changes while none of the sport's
 * enrollments has statistics: they hold the old profile's attributes.
 * Otherwise 409 `STATS_PROFILE_LOCKED`. Counted after locking the sport's
 * row, which a squad's statistics lock `FOR SHARE` before reading it: either
 * this count sees them, or they see the new profile.
 */
export async function updateSport(
	pool: Pool,
	ctx: AdminActionContext,
	id: number,
	input: UpdateSportBody,
	guards: readonly DrawRuleGuard[] = [],
): Promise<Sport> {
	const outcome = await runAdminAction<Sport>(pool, ctx, 'editar', 'deporte', async (conn) => {
		const before = await find(conn, id, true);

		if (input.permiteEmpate !== undefined && input.permiteEmpate !== before.permiteEmpate) {
			const reasons: string[] = [];
			// "Left programado" with the effective state: a match whose kick-off came counts as started.
			const notStarted = effectiveStateCondition('programado', new Date());
			const [[started]] = await conn.query<RowDataPacket[]>(
				`SELECT COUNT(*) AS n FROM partido p
				JOIN competicion c ON c.id = p.competicion_id
				JOIN estado_partido ep ON ep.id = p.estado_partido_id
				WHERE c.deporte_id = ? AND NOT ${notStarted.sql}`,
				[id, ...notStarted.params],
			);
			if (Number(started?.n) > 0) reasons.push(`tiene ${plural(Number(started!.n), 'partido que ya no está programado', 'partidos que ya no están programados')} (en curso, finalizados o cancelados)`);
			for (const guard of guards) {
				const reason = await guard(conn, id);
				if (reason) reasons.push(reason);
			}
			if (reasons.length > 0) {
				throw new HttpError(
					409,
					ErrorCode.DRAW_RULE_LOCKED,
					`No se puede cambiar si el deporte admite empate: ${reasons.join('; ')}.`,
					{ motivos: reasons },
				);
			}
		}

		let perfilId: number | null | undefined;
		if (input.perfilEstadistico !== undefined && input.perfilEstadistico !== before.perfilEstadistico) {
			perfilId = await profileIdOf(conn, input.perfilEstadistico);
			const [[loaded]] = await conn.query<RowDataPacket[]>(
				`SELECT COUNT(DISTINCT pe.plantel_id) AS n FROM plantel_estadistica pe
				JOIN plantel pl ON pl.id = pe.plantel_id
				JOIN competicion c ON c.id = pl.competicion_id
				WHERE c.deporte_id = ?`,
				[id],
			);
			const n = Number(loaded?.n ?? 0);
			if (n > 0) {
				throw new HttpError(
					409,
					ErrorCode.STATS_PROFILE_LOCKED,
					`No se puede cambiar el perfil de estadísticas: ${plural(n, 'inscripción del deporte tiene', 'inscripciones del deporte tienen')} estadísticas cargadas con el perfil actual.`,
					{ inscripcionesConEstadisticas: n },
				);
			}
		}

		await conn.query('UPDATE deporte SET nombre = ?, slug = ?, permite_empate = ? WHERE id = ?', [
			input.nombre ?? before.nombre,
			input.slug ?? before.slug,
			input.permiteEmpate ?? before.permiteEmpate,
			id,
		]);
		if (perfilId !== undefined) await conn.query('UPDATE deporte SET perfil_estadistico_id = ? WHERE id = ?', [perfilId, id]);
		return { id, before, after: await find(conn, id) };
	});
	return outcome.after!;
}

/** Only a sport with no competitions: 409 `SPORT_IN_USE` otherwise. */
export async function deleteSport(pool: Pool, ctx: AdminActionContext, id: number): Promise<void> {
	await runAdminAction<Sport>(pool, ctx, 'borrar', 'deporte', async (conn) => {
		const before = await find(conn, id, true);
		const found = await dependents(conn, id, {
			competiciones: 'SELECT COUNT(*) FROM competicion WHERE deporte_id = ?',
		});
		if (Object.keys(found).length > 0) {
			throw new HttpError(
				409,
				ErrorCode.SPORT_IN_USE,
				`No se puede borrar el deporte: tiene ${describeDependents(found, { competiciones: ['competición', 'competiciones'] })}.`,
				found,
			);
		}
		await conn.query('DELETE FROM deporte WHERE id = ?', [id]);
		return { id, before, after: null };
	});
}
