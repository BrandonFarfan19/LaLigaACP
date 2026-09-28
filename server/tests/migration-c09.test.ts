import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { MOVIMIENTOS } from '../src/lib/coins.js';
import { DB_INIT_DIR } from './helpers/db.js';
import { statements } from './helpers/sql-file.js';
import { resolveTestDatabase } from './helpers/test-database.js';

/**
 * `db/migraciones/C-09-premios-por-acierto.sql` (D-038) run for real, as the
 * `mysql` client does, on a database of its own: `db/init/` taken back to how
 * it was before C-09, with movements already there. Never the real database
 * nor the suite's.
 */

const MIGRATION = resolve(DB_INIT_DIR, '../migraciones/C-09-premios-por-acierto.sql');
const INIT = ['01-schema.sql', '02-catalogos.sql'].map((file) => readFileSync(resolve(DB_INIT_DIR, file), 'utf8'));
const CODES = ['premio_resultado_general', 'premio_marcador_exacto'];

describe('migration C-09 on a database with data (D-038)', () => {
	let root: Connection;
	let conn: Connection;
	let database: string;

	beforeAll(async () => {
		const { db } = loadEnv();
		database = `${resolveTestDatabase()}_c09`;
		// Only ever a derivative of the test database's name.
		if (!/test/i.test(database) || database === process.env.MYSQL_DATABASE) throw new Error(`Base inesperada: ${database}`);
		const server = { host: db.host, port: db.port, user: 'root', password: process.env.MYSQL_ROOT_PASSWORD, multipleStatements: true };
		root = await mysql.createConnection(server);
		await root.query(`DROP DATABASE IF EXISTS \`${database}\`; CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
		conn = await mysql.createConnection({ ...server, database, multipleStatements: false });
	});

	afterAll(async () => {
		await conn?.end();
		await root?.query(`DROP DATABASE IF EXISTS \`${database}\``);
		await root?.end();
	});

	/** db/init/ without the C-09 types, and a participant with movements: a database created before C-09. */
	beforeEach(async () => {
		await root.query(`DROP DATABASE \`${database}\`; CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
		await root.changeUser({ database });
		for (const sql of INIT) await root.query(sql);
		await root.query('DELETE FROM tipo_movimiento WHERE codigo IN (?)', [CODES]);
		await root.query(`INSERT INTO usuario (rol_id, estado_usuario_id, estado_pago_id, nombre, email, password_hash, saldo_monedas, creado_en)
			SELECT r.id, eu.id, ep.id, 'Ana', 'ana@liga.test', 'x', 10, UTC_TIMESTAMP() FROM rol r, estado_usuario eu, estado_pago ep
			WHERE r.codigo = 'apostador' AND eu.codigo = 'validado' AND ep.codigo = 'confirmado';
			INSERT INTO movimiento_moneda (usuario_id, tipo_movimiento_id, cantidad, creado_en)
			SELECT u.id, tm.id, 10, UTC_TIMESTAMP() FROM usuario u, tipo_movimiento tm WHERE tm.codigo = 'validacion';`);
		await conn.changeUser({ database });
	});

	async function migrate(): Promise<{ message: string; errno?: number } | null> {
		for (const statement of statements(readFileSync(MIGRATION, 'utf8'))) {
			try {
				await conn.query(statement);
			} catch (error) {
				return error as { message: string; errno?: number };
			}
		}
		return null;
	}

	const types = async (db = database) =>
		(await conn.query<RowDataPacket[]>(`SELECT id, codigo, nombre FROM \`${db}\`.tipo_movimiento ORDER BY id`))[0].map((r) => ({
			id: Number(r.id),
			codigo: String(r.codigo),
			nombre: String(r.nombre),
		}));
	const others = async () =>
		(await conn.query<RowDataPacket[]>('SELECT (SELECT GROUP_CONCAT(CONCAT(id, ":", saldo_monedas)) FROM usuario) AS u, (SELECT GROUP_CONCAT(CONCAT(id, ":", cantidad)) FROM movimiento_moneda) AS m'))[0][0];
	const noProcedure = async () =>
		expect((await conn.query<RowDataPacket[]>("SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'c09_migrar'"))[0]).toEqual([]);

	it('adds the two prize types with the ids of db/init/ (4 and 5), and nothing else changes', async () => {
		const before = await types();
		const rest = await others();

		expect(await migrate()).toBeNull();

		const after = await types();
		expect(after.slice(0, before.length)).toEqual(before);
		expect(after.slice(before.length).map((t) => [t.id, t.codigo])).toEqual([
			[4, 'premio_resultado_general'],
			[5, 'premio_marcador_exacto'],
		]);
		// The whole catalog equals the suite's, created from db/init/, and every code has its amount in lib/coins.ts.
		expect(after).toEqual(await types(resolveTestDatabase()));
		expect(after.map((t) => t.codigo).sort()).toEqual(Object.keys(MOVIMIENTOS).sort());
		expect(await others()).toEqual(rest);
		await noProcedure();
	});

	it('refuses a second run, changing nothing and leaving no procedure', async () => {
		expect(await migrate()).toBeNull();
		const before = await types();
		expect((await migrate())?.message).toMatch(/C-09 ya está aplicada/);
		expect(await types()).toEqual(before);
		await noProcedure();
	});

	it('refuses when one of the codes is already there (half by hand), changing nothing', async () => {
		await conn.query("INSERT INTO tipo_movimiento (codigo, nombre) VALUES ('premio_marcador_exacto', 'a mano')");
		const before = await types();
		expect((await migrate())?.message).toMatch(/C-09 ya está aplicada/);
		expect(await types()).toEqual(before);
		await noProcedure();
	});

	it('when another type holds the id 4, that one takes the next free id and the other keeps 5', async () => {
		await conn.query("INSERT INTO tipo_movimiento (id, codigo, nombre) VALUES (4, 'otro_tipo', 'Otro')");
		expect(await migrate()).toBeNull();
		const added = (await types()).filter((t) => CODES.includes(t.codigo));
		expect(added.find((t) => t.codigo === 'premio_marcador_exacto')!.id).toBe(5);
		expect(added.find((t) => t.codigo === 'premio_resultado_general')!.id).toBeGreaterThan(5);
		await noProcedure();
	});
});
