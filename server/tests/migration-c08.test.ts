import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { DB_INIT_DIR } from './helpers/db.js';
import { statements } from './helpers/sql-file.js';
import { resolveTestDatabase } from './helpers/test-database.js';

/**
 * `db/migraciones/C-08-restablecer-contrasena.sql` (D-037) run for real, as the
 * `mysql` client does, on a database of its own: the schema of `db/init/`
 * taken back to how it was before C-08. Never the real database nor the suite's.
 */

const MIGRATION = resolve(DB_INIT_DIR, '../migraciones/C-08-restablecer-contrasena.sql');
const INIT = ['01-schema.sql', '02-catalogos.sql'].map((file) => readFileSync(resolve(DB_INIT_DIR, file), 'utf8'));
const CODE = 'restablecimiento_contrasena';

describe('migration C-08 on a database with data (D-037)', () => {
	let root: Connection;
	let conn: Connection;
	let database: string;

	beforeAll(async () => {
		const { db } = loadEnv();
		database = `${resolveTestDatabase()}_c08`;
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

	/** db/init/ without the C-08 code: a database created before C-08 (C-05 already applied). */
	beforeEach(async () => {
		await root.query(`DROP DATABASE \`${database}\`; CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
		await root.changeUser({ database });
		for (const sql of INIT) await root.query(sql);
		await root.query('DELETE FROM accion_auditoria WHERE codigo = ?', [CODE]);
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

	const actions = async (db = database) =>
		(await conn.query<RowDataPacket[]>(`SELECT id, codigo, nombre, entidad FROM \`${db}\`.accion_auditoria ORDER BY id`))[0].map((r) => ({
			id: Number(r.id),
			codigo: String(r.codigo),
			nombre: String(r.nombre),
			entidad: String(r.entidad),
		}));

	it('adds the code with the id, name and entity db/init/ gives it, touching nothing else', async () => {
		const before = await actions();

		expect(await migrate()).toBeNull();

		const after = await actions();
		expect(after.filter((r) => r.codigo !== CODE)).toEqual(before);
		expect(after.find((r) => r.codigo === CODE)).toEqual({ id: 34, codigo: CODE, nombre: 'Restablecimiento de contraseña', entidad: 'usuario' });
		// The whole catalog equals the suite's, created from db/init/.
		expect(after).toEqual(await actions(resolveTestDatabase()));
		expect((await conn.query<RowDataPacket[]>("SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'c08_migrar'"))[0]).toEqual([]);
	});

	it('refuses a second run, changing nothing', async () => {
		expect(await migrate()).toBeNull();
		const before = await actions();

		expect((await migrate())?.message).toMatch(/C-08 ya está aplicada/);
		// Refused, and it still drops its procedure (C-08 fix).
		expect((await conn.query<RowDataPacket[]>("SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'c08_migrar'"))[0]).toEqual([]);
		expect(await actions()).toEqual(before);
	});

	it('refuses to run before C-05, changing nothing', async () => {
		await conn.query("DELETE FROM accion_auditoria WHERE codigo IN ('registro_estadisticas_plantel', 'borrado_estadisticas_plantel')");
		const before = await actions();

		expect((await migrate())?.message).toMatch(/Falta aplicar C-05/);
		expect((await conn.query<RowDataPacket[]>("SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'c08_migrar'"))[0]).toEqual([]);
		expect(await actions()).toEqual(before);
	});

	it('when another code holds the id 34, it takes the next free one and leaves that row alone', async () => {
		await conn.query("INSERT INTO accion_auditoria (id, codigo, nombre, entidad) VALUES (34, 'otra_accion', 'Otra', 'usuario')");
		const before = await actions();

		expect(await migrate()).toBeNull();

		const after = await actions();
		expect(after.filter((r) => r.codigo !== CODE)).toEqual(before);
		const added = after.find((r) => r.codigo === CODE)!;
		expect(added).toEqual({ id: expect.any(Number), codigo: CODE, nombre: 'Restablecimiento de contraseña', entidad: 'usuario' });
		expect(added.id).toBeGreaterThan(34);
	});
});
