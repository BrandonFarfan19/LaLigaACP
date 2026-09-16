import type { Pool } from 'mysql2/promise';
import { type TransactionConnection, withTransaction } from '../db/transaction.js';

/**
 * Shared shape of the admin write actions of the sports catalog (T-06), so
 * T-17 (audit) can wrap every one of them the same way T-04's actions are
 * wrapped: `hooks.inTransaction(conn, outcome)` runs inside the action's
 * transaction, after the change and before the commit. A failing hook rolls
 * the action back.
 */

/** `gol` and `multimedia` (a match's image or video) since T-13. */
export type CatalogEntity = 'deporte' | 'competicion' | 'equipo' | 'jugador' | 'plantel' | 'partido' | 'gol' | 'multimedia';
/** `registrar_resultado` and `confirmar_resultado` (T-12) only apply to `partido`. */
export type CatalogVerb = 'crear' | 'editar' | 'borrar' | 'registrar_resultado' | 'confirmar_resultado';

export interface AdminActionOutcome<T = unknown> {
	/** e.g. `crear_deporte`, `editar_equipo`, `borrar_plantel`. */
	action: `${CatalogVerb}_${CatalogEntity}`;
	entity: CatalogEntity;
	actorId: number;
	/** The affected row (`auditoria.entidad_id`). */
	id: number;
	/** The row before the change; `null` on create. */
	before: T | null;
	/** The row after the change; `null` on delete. */
	after: T | null;
}

export interface AdminActionHooks {
	inTransaction?: (conn: TransactionConnection, outcome: AdminActionOutcome) => Promise<void>;
}

/** Who is acting, and the optional audit hook. Every catalog write receives one. */
export interface AdminActionContext {
	actorId: number;
	hooks?: AdminActionHooks;
}

/**
 * Runs `work` in a transaction and then the audit hook, in that same
 * transaction. `work` returns the affected id and the before/after rows.
 */
export async function runAdminAction<T>(
	pool: Pool,
	ctx: AdminActionContext,
	verb: CatalogVerb,
	entity: CatalogEntity,
	work: (conn: TransactionConnection) => Promise<{ id: number; before: T | null; after: T | null }>,
): Promise<AdminActionOutcome<T>> {
	return withTransaction(pool, async (conn) => {
		const change = await work(conn);
		const outcome: AdminActionOutcome<T> = { action: `${verb}_${entity}`, entity, actorId: ctx.actorId, ...change };
		await ctx.hooks?.inTransaction?.(conn, outcome);
		return outcome;
	});
}
