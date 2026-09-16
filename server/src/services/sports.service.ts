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

/** Módulo Informativo: `deporte` (BR-001, BR-011, BR-015, BR-048). */

export interface Sport {
	id: number;
	nombre: string;
	slug: string;
	permiteEmpate: boolean;
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

const COLUMNS = 'd.id, d.nombre, d.slug, d.permite_empate';

function toSport(row: RowDataPacket): Sport {
	return { id: Number(row.id), nombre: String(row.nombre), slug: String(row.slug), permiteEmpate: Boolean(row.permite_empate) };
}

async function find(db: Db, id: number, lock = false): Promise<Sport> {
	const [[row]] = await db.query<RowDataPacket[]>(
		`SELECT ${COLUMNS} FROM deporte d WHERE d.id = ?${lock ? ' FOR UPDATE' : ''}`,
		[id],
	);
	if (!row) throw HttpError.notFound('No existe ese deporte.', ErrorCode.SPORT_NOT_FOUND);
	return toSport(row);
}

export function listSports(pool: Pool, query: ListSportsQuery): Promise<Page<Sport>> {
	const where = new Where();
	if (query.q) where.add('(d.nombre LIKE ? OR d.slug LIKE ?)', likePattern(query.q), likePattern(query.q));
	if (query.permiteEmpate !== undefined) where.add('d.permite_empate = ?', query.permiteEmpate);
	return pageOf(pool, { columns: COLUMNS, from: 'FROM deporte d', where, orderBy: 'd.nombre, d.id' }, query, toSport);
}

export function getSport(pool: Pool, id: number): Promise<Sport> {
	return find(pool, id);
}

/** The slug comes from the name when not sent; a taken one is a 409 `SLUG_TAKEN` (lib/db-errors.ts). */
export async function createSport(pool: Pool, ctx: AdminActionContext, input: CreateSportBody): Promise<Sport> {
	const outcome = await runAdminAction<Sport>(pool, ctx, 'crear', 'deporte', async (conn) => {
		const [result] = await conn.query<ResultSetHeader>(
			'INSERT INTO deporte (nombre, slug, permite_empate) VALUES (?, ?, ?)',
			[input.nombre, input.slug ?? requireSlug(input.nombre), input.permiteEmpate],
		);
		return { id: result.insertId, before: null, after: await find(conn, result.insertId) };
	});
	return outcome.after!;
}

export function requireSlug(nombre: string): string {
	const slug = slugify(nombre);
	if (!slug) {
		throw HttpError.badRequest('Solicitud inválida.', [
			{ path: 'slug', message: 'El nombre no tiene letras ni números: enviá un slug.' },
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
			if (Number(started?.n) > 0) reasons.push(`tiene ${started!.n} partido(s) en curso, finalizados o cancelados`);
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

		await conn.query('UPDATE deporte SET nombre = ?, slug = ?, permite_empate = ? WHERE id = ?', [
			input.nombre ?? before.nombre,
			input.slug ?? before.slug,
			input.permiteEmpate ?? before.permiteEmpate,
			id,
		]);
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
