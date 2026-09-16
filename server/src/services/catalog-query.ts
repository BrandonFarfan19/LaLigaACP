import type { Pool, PoolConnection, RowDataPacket } from 'mysql2/promise';
import { type Page, type PaginationQuery, toPage } from '../schemas/common.schema.js';

/** Helpers shared by the sports catalog services (T-06). */

export type Db = Pool | PoolConnection;

/** `%`, `_` and `\` are literal in a search, not wildcards. */
export function likePattern(text: string): string {
	return `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/** Collects `AND` conditions and their parameters. */
export class Where {
	private readonly conditions: string[] = [];
	readonly params: unknown[] = [];

	add(condition: string, ...params: unknown[]): this {
		this.conditions.push(condition);
		this.params.push(...params);
		return this;
	}

	get sql(): string {
		return this.conditions.length > 0 ? `WHERE ${this.conditions.join(' AND ')}` : '';
	}
}

/**
 * Count + one page of rows for `SELECT <columns> <from> <where> ORDER BY <order>`.
 * `orderParams` fill the placeholders of `orderBy`, if any.
 */
export async function pageOf<T>(
	db: Db,
	parts: { columns: string; from: string; where: Where; orderBy: string; orderParams?: unknown[] },
	query: PaginationQuery,
	map: (row: RowDataPacket) => T,
): Promise<Page<T>> {
	const [[counted]] = await db.query<RowDataPacket[]>(
		`SELECT COUNT(*) AS total ${parts.from} ${parts.where.sql}`,
		parts.where.params,
	);
	const [rows] = await db.query<RowDataPacket[]>(
		`SELECT ${parts.columns} ${parts.from} ${parts.where.sql} ORDER BY ${parts.orderBy} LIMIT ? OFFSET ?`,
		[...parts.where.params, ...(parts.orderParams ?? []), query.pageSize, (query.page - 1) * query.pageSize],
	);
	return toPage(rows.map(map), Number(counted?.total ?? 0), query);
}

/**
 * How many rows of each dependent table point at a row. `checks` maps a name
 * (used in the 409 details) to a `SELECT COUNT(*)` taking the id once.
 * Only the non-zero ones are returned.
 */
export async function dependents(
	db: Db,
	id: number,
	checks: Record<string, string>,
): Promise<Record<string, number>> {
	const names = Object.keys(checks);
	const sql = `SELECT ${names.map((name) => `(${checks[name]}) AS \`${name}\``).join(', ')}`;
	const [[row]] = await db.query<RowDataPacket[]>(sql, names.map(() => id));
	const found: Record<string, number> = {};
	for (const name of names) {
		const n = Number(row?.[name] ?? 0);
		if (n > 0) found[name] = n;
	}
	return found;
}

/** "3 competiciones, 1 partido" for a 409 message. */
export function describeDependents(found: Record<string, number>, labels: Record<string, [string, string]>): string {
	return Object.entries(found)
		.map(([name, n]) => `${n} ${n === 1 ? labels[name]![0] : labels[name]![1]}`)
		.join(', ');
}
