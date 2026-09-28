import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql, { type Connection, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { DB_INIT_DIR } from './helpers/db.js';
import { statements } from './helpers/sql-file.js';
import { resolveTestDatabase } from './helpers/test-database.js';

/**
 * `db/migraciones/C-05-estadisticas.sql` (D-034) run for real, statement by
 * statement as the `mysql` client does (honoring `DELIMITER`), on a database of
 * its own: the schema of `db/init/` taken back to how it was before C-05, with
 * sports already loaded. Never the real database nor the suite's.
 */

const MIGRATION = resolve(DB_INIT_DIR, '../migraciones/C-05-estadisticas.sql');
const INIT = ['01-schema.sql', '02-catalogos.sql'].map((file) => readFileSync(resolve(DB_INIT_DIR, file), 'utf8'));

/** The catalogs as EsquemaBD fixes them: [id, perfil, codigo, orden]. */
const ATTRIBUTES = [
	[1, 'futbol', 'disparo', 1],
	[2, 'futbol', 'pase', 2],
	[3, 'futbol', 'fuerza', 3],
	[4, 'futbol', 'defensa', 4],
	[5, 'futbol', 'velocidad', 5],
	[6, 'futbol', 'dribbling', 6],
	[7, 'voley', 'mate', 1],
	[8, 'voley', 'saque', 2],
	[9, 'voley', 'recepcion', 3],
	[10, 'voley', 'armado', 4],
	[11, 'voley', 'bloqueo', 5],
];

/** Sport name → the profile the migration must give it. */
const SPORTS: Array<[string, string | null]> = [
	['Futbol', 'futbol'],
	['futbol femenino', 'futbol'],
	['Fútbol 7', 'futbol'],
	['Voley mixto', 'voley'],
	['Vóley', 'voley'],
	['Voleibol', 'voley'],
	['Volleyball', 'voley'],
	['Básquet', null],
	['Fútbol y vóley', null],
];

describe('migration C-05 on a database with data (D-034)', () => {
	let root: Connection;
	let conn: Connection;
	let database: string;

	beforeAll(async () => {
		const { db } = loadEnv();
		database = `${resolveTestDatabase()}_c05`;
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

	/** The schema of db/init/ as it was before C-05 (so before C-08 too), with the sports already there. */
	beforeEach(async () => {
		await root.query(`DROP DATABASE \`${database}\`; CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`);
		await root.changeUser({ database });
		for (const sql of INIT) await root.query(sql);
		await root.query(`ALTER TABLE deporte DROP FOREIGN KEY fk_deporte_perfil_estadistico, DROP COLUMN perfil_estadistico_id;
			DROP TABLE plantel_estadistica, estadistica, perfil_estadistico;
			DELETE FROM accion_auditoria WHERE codigo IN ('registro_estadisticas_plantel', 'borrado_estadisticas_plantel', 'restablecimiento_contrasena');`);
		for (const [i, [nombre]] of SPORTS.entries()) {
			await root.query('INSERT INTO deporte (nombre, slug, permite_empate) VALUES (?, ?, ?)', [nombre, `d${i}`, i % 2 === 0]);
		}
		await conn.changeUser({ database });
	});

	/** Runs the file; the error that stopped it (the client stops at the first), or null. */
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

	const rows = async (sql: string) => (await conn.query<RowDataPacket[]>(sql))[0];
	const catalogs = async () => ({
		perfiles: (await rows('SELECT id, codigo FROM perfil_estadistico ORDER BY id')).map((r) => [Number(r.id), r.codigo]),
		atributos: (
			await rows('SELECT e.id, p.codigo AS perfil, e.codigo, e.orden FROM estadistica e JOIN perfil_estadistico p ON p.id = e.perfil_estadistico_id ORDER BY e.id')
		).map((r) => [Number(r.id), r.perfil, r.codigo, Number(r.orden)]),
	});
	const oldSportColumns = async () => rows('SELECT id, nombre, slug, permite_empate FROM deporte ORDER BY id');

	it('creates the catalogs with the ids of db/init/, gives each sport its profile by name and touches nothing else', async () => {
		const before = await oldSportColumns();

		expect(await migrate()).toBeNull();

		expect(await catalogs()).toEqual({ perfiles: [[1, 'futbol'], [2, 'voley']], atributos: ATTRIBUTES });
		const sports = await rows('SELECT d.nombre, p.codigo FROM deporte d LEFT JOIN perfil_estadistico p ON p.id = d.perfil_estadistico_id ORDER BY d.id');
		expect(sports.map((r) => [r.nombre, r.codigo])).toEqual(SPORTS);
		expect(await oldSportColumns()).toEqual(before);
		expect((await rows("SELECT codigo FROM accion_auditoria WHERE codigo LIKE '%estadisticas_plantel' ORDER BY codigo")).map((r) => r.codigo)).toEqual([
			'borrado_estadisticas_plantel',
			'registro_estadisticas_plantel',
		]);
		expect(await rows('SELECT COUNT(*) AS n FROM plantel_estadistica')).toEqual([{ n: 0 }]);
		expect(await rows("SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'c05_migrar'")).toEqual([]);
	});

	it('leaves the same tables db/init/ creates', async () => {
		expect(await migrate()).toBeNull();
		const suiteDatabase = resolveTestDatabase();
		for (const table of ['perfil_estadistico', 'estadistica', 'plantel_estadistica', 'deporte']) {
			const show = async (db: string) =>
				String(((await conn.query<RowDataPacket[]>(`SHOW CREATE TABLE \`${db}\`.\`${table}\``))[0][0] as RowDataPacket)['Create Table']).replace(/ AUTO_INCREMENT=\d+/, '');
			expect(await show(database), table).toBe(await show(suiteDatabase));
		}
	});

	it('refuses a second run, changing nothing', async () => {
		expect(await migrate()).toBeNull();
		const before = await catalogs();

		expect((await migrate())?.message).toMatch(/C-05 ya está aplicada/);
		// Refused, and it still drops its procedure (C-08 fix).
		expect((await conn.query<RowDataPacket[]>("SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'c05_migrar'"))[0]).toEqual([]);
		expect(await catalogs()).toEqual(before);
		expect(await rows('SELECT COUNT(*) AS n FROM accion_auditoria WHERE codigo = \'registro_estadisticas_plantel\'')).toEqual([{ n: 1 }]);
	});

	it('a run that fails inside the transaction rolls it back, and the retry still gets the ids 1-2 and 1-11', async () => {
		// Something that makes the transaction fail after inserting the catalogs.
		await conn.query("INSERT INTO accion_auditoria (codigo, nombre, entidad) VALUES ('borrado_estadisticas_plantel', 'x', 'plantel')");

		const failed = await migrate();
		// The reason travels in the final error, with the driver's errno inside it; the procedure is gone (C-08 fix).
		expect(failed?.message).toMatch(/Error 1062: Duplicate entry/);
		expect((await conn.query<RowDataPacket[]>("SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'c05_migrar'"))[0]).toEqual([]);
		// Rolled back: empty catalogs, no profile, no mark. The DDL stays (it commits by itself).
		expect(await catalogs()).toEqual({ perfiles: [], atributos: [] });
		expect(await rows('SELECT COUNT(*) AS n FROM deporte WHERE perfil_estadistico_id IS NOT NULL')).toEqual([{ n: 0 }]);
		// The attempt spent AUTO_INCREMENT values (a ROLLBACK doesn't return them): without explicit ids the retry would start at 3 and 12.

		await conn.query("DELETE FROM accion_auditoria WHERE codigo = 'borrado_estadisticas_plantel'");
		expect(await migrate()).toBeNull();
		expect(await catalogs()).toEqual({ perfiles: [[1, 'futbol'], [2, 'voley']], atributos: ATTRIBUTES });
		expect((await rows("SELECT COUNT(*) AS n FROM deporte d JOIN perfil_estadistico p ON p.id = d.perfil_estadistico_id WHERE p.codigo = 'futbol'"))[0]!.n).toBe(3);
	});

	it('refuses to reuse new tables that already hold rows, touching nothing', async () => {
		await conn.query('CREATE TABLE perfil_estadistico (id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, codigo VARCHAR(50) NOT NULL, nombre VARCHAR(100) NOT NULL, PRIMARY KEY (id), CONSTRAINT uq_perfil_estadistico_codigo UNIQUE (codigo)) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
		await conn.query("INSERT INTO perfil_estadistico (codigo, nombre) VALUES ('otro', 'Otro')");

		expect((await migrate())?.message).toMatch(/ya tienen filas/);
		expect((await conn.query<RowDataPacket[]>("SHOW PROCEDURE STATUS WHERE Db = DATABASE() AND Name = 'c05_migrar'"))[0]).toEqual([]);
		expect(await rows("SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'deporte' AND column_name = 'perfil_estadistico_id'")).toEqual([{ n: 0 }]);
	});
});
