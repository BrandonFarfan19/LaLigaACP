import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { DB_INIT_DIR } from './helpers/db.js';
import { statements } from './helpers/sql-file.js';
import { resolveTestDatabase } from './helpers/test-database.js';

/**
 * `db/migraciones/C-14-transmision-en-vivo.sql` (D-043) run for real, as the
 * `mysql` client does, on a database of its own: the schema of `db/init/`
 * taken back to how it was before C-14. Never the real database nor the suite's.
 */

const MIGRATION = resolve(DB_INIT_DIR, '../migraciones/C-14-transmision-en-vivo.sql');
const INIT = ['01-schema.sql', '02-catalogos.sql'].map((file) => readFileSync(resolve(DB_INIT_DIR, file), 'utf8'));
const CODES = ['actualizacion_transmision', 'retiro_transmision'];

describe('migration C-14 on a database with data (D-043)', () => {
	let root: Connection;
	let conn: Connection;
	let database: string;

	beforeAll(async () => {
		const { db } = loadEnv();
		database = `${resolveTestDatabase()}_c14`;
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

	/** db/init/ without C-14: a database created before it (C-05 and C-08 already applied). */
	beforeEach(async () => {
		await root.query(`DROP DATABASE \`${database}\`; CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
		await root.changeUser({ database });
		for (const sql of INIT) await root.query(sql);
		await root.query('DROP TABLE transmision_en_vivo');
		await root.query('DELETE FROM accion_auditoria WHERE codigo IN (?)', [CODES]);
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
	const tableDefinition = async (db = database) => {
		const [[row]] = await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${db}\`.transmision_en_vivo`);
		return String(row!['Create Table']);
	};
	const hasTable = async () =>
		(await conn.query<RowDataPacket[]>("SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'transmision_en_vivo'"))[0]
			.length > 0;
	const noProcedure = async () =>
		expect((await conn.query<RowDataPacket[]>("SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'c14_migrar'"))[0]).toEqual([]);

	it('creates the table as db/init/ does, with its one empty row, and the two codes with their ids; nothing else changes', async () => {
		const before = await actions();

		expect(await migrate()).toBeNull();

		const after = await actions();
		expect(after.filter((r) => !CODES.includes(r.codigo))).toEqual(before);
		expect(after.filter((r) => CODES.includes(r.codigo))).toEqual([
			{ id: 35, codigo: 'actualizacion_transmision', nombre: 'Actualización de la transmisión en vivo', entidad: 'transmision_en_vivo' },
			{ id: 36, codigo: 'retiro_transmision', nombre: 'Retiro de la transmisión en vivo', entidad: 'transmision_en_vivo' },
		]);
		// The whole catalog and the table equal the suite's, created from db/init/.
		expect(after).toEqual(await actions(resolveTestDatabase()));
		expect(await tableDefinition()).toBe(await tableDefinition(resolveTestDatabase()));
		const [rows] = await conn.query<RowDataPacket[]>('SELECT id, url, actualizado_en FROM transmision_en_vivo');
		expect(rows.map((r) => ({ ...r }))).toEqual([{ id: 1, url: null, actualizado_en: null }]);
		await noProcedure();
	});

	it('refuses a second run, changing nothing', async () => {
		expect(await migrate()).toBeNull();
		const before = await actions();

		expect((await migrate())?.message).toMatch(/C-14 ya está aplicada/);
		await noProcedure();
		expect(await actions()).toEqual(before);
	});

	it('refuses to run before C-08, changing nothing (not even the table)', async () => {
		await conn.query("DELETE FROM accion_auditoria WHERE codigo = 'restablecimiento_contrasena'");
		const before = await actions();

		expect((await migrate())?.message).toMatch(/Falta aplicar C-08/);
		await noProcedure();
		expect(await actions()).toEqual(before);
		expect(await hasTable()).toBe(false);
	});

	it('a run cut after the CREATE TABLE is retried: it reuses the table and ends like a clean one', async () => {
		// What a cut leaves: the table (from the migration's own DDL), with or without its row.
		await root.query(INIT[0]!.slice(INIT[0]!.indexOf('CREATE TABLE transmision_en_vivo'), INIT[0]!.indexOf('INSERT INTO transmision_en_vivo')));
		expect(await migrate()).toBeNull();
		const [rows] = await conn.query<RowDataPacket[]>('SELECT id, url FROM transmision_en_vivo');
		expect(rows.map((r) => ({ ...r }))).toEqual([{ id: 1, url: null }]);
		expect((await actions()).filter((r) => CODES.includes(r.codigo))).toHaveLength(2);
	});

	it('a leftover table with a link loaded is refused, and nothing is added', async () => {
		await root.query(INIT[0]!.slice(INIT[0]!.indexOf('CREATE TABLE transmision_en_vivo'), INIT[0]!.indexOf('INSERT INTO transmision_en_vivo')));
		await conn.query("INSERT INTO transmision_en_vivo (id, url, actualizado_en) VALUES (1, 'https://www.facebook.com/watch/?v=5', UTC_TIMESTAMP())");
		const before = await actions();

		expect((await migrate())?.message).toMatch(/ya tiene un enlace cargado/);
		await noProcedure();
		expect(await actions()).toEqual(before);
	});

	it('when other codes hold the ids 35 or 36, it takes the next free ones and leaves those rows alone', async () => {
		await conn.query("INSERT INTO accion_auditoria (id, codigo, nombre, entidad) VALUES (35, 'otra_accion', 'Otra', 'usuario')");
		const before = await actions();

		expect(await migrate()).toBeNull();

		const after = await actions();
		expect(after.filter((r) => !CODES.includes(r.codigo))).toEqual(before);
		const added = after.filter((r) => CODES.includes(r.codigo));
		expect(added).toHaveLength(2);
		for (const code of added) expect(code.id).toBeGreaterThan(35);
	});
});
