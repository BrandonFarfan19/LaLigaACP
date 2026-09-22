import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPool } from '../src/db/pool.js';
import { env } from './helpers/app.js';
import { CATALOG_TABLES, resetDatabase } from './helpers/db.js';

interface CountRow extends RowDataPacket {
	n: number;
}

async function count(pool: Pool, table: string): Promise<number> {
	const [rows] = await pool.query<CountRow[]>('SELECT COUNT(*) AS n FROM ??', [table]);
	return rows[0]!.n;
}

/**
 * Proves the between-tests cleanup helper actually works: insert a row
 * directly, reset, and confirm it's gone while the catalogs stay. T-02 has no
 * data-writing endpoints yet, so this is the one place that exercises it
 * before later tasks rely on it in a `beforeEach`.
 */
describe('resetDatabase', () => {
	let pool: Pool;

	beforeAll(() => {
		pool = createPool(env);
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	it('truncates non-catalog tables, including one just written to', async () => {
		await resetDatabase(pool);
		await pool.query("INSERT INTO deporte (nombre, slug, permite_empate) VALUES ('Futbol', 'futbol-reset-test', TRUE)");
		expect(await count(pool, 'deporte')).toBe(1);

		await resetDatabase(pool);

		expect(await count(pool, 'deporte')).toBe(0);
	});

	it('keeps every catalog loaded from 02-catalogos.sql', async () => {
		expect([...CATALOG_TABLES].sort()).toEqual([
			'accion_auditoria',
			'estado_pago',
			'estado_partido',
			'estado_seleccion',
			'estado_usuario',
			'resultado_general',
			'rol',
			'tipo_apuesta',
			'tipo_movimiento',
		]);

		await resetDatabase(pool);

		for (const table of CATALOG_TABLES) {
			expect(await count(pool, table), table).toBeGreaterThan(0);
		}
		const [roles] = await pool.query<RowDataPacket[]>('SELECT codigo FROM rol ORDER BY codigo');
		expect(roles.map((row) => row.codigo)).toEqual(['admin', 'apostador']);
	});
});
