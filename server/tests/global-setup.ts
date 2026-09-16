import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { loadRootEnvFile } from '../src/config/load-root-env.js';

/**
 * Runs once before the whole suite (Vitest `globalSetup`): creates the test
 * database fresh and migrates it from the same `db/init/` SQL the real
 * database uses, so it can never drift from the current schema. Connects as
 * root — the app's own `MYSQL_USER` only has grants on `MYSQL_DATABASE` (see
 * the official mysql image's entrypoint behavior), never on a second
 * database — then grants that user access to the test database too, since
 * the actual test requests run as the app normally would.
 */
export default async function globalSetup(): Promise<void> {
	loadRootEnvFile();

	const host = process.env.DB_HOST;
	const port = Number(process.env.DB_PORT);
	const rootPassword = process.env.MYSQL_ROOT_PASSWORD;
	const appUser = process.env.MYSQL_USER;
	const testDatabase = process.env.MYSQL_DATABASE_TEST ?? 'la_liga_acp_test';

	const missing = [
		!host && 'DB_HOST',
		!Number.isFinite(port) && 'DB_PORT',
		!rootPassword && 'MYSQL_ROOT_PASSWORD',
		!appUser && 'MYSQL_USER',
	].filter((name): name is string => Boolean(name));
	if (missing.length > 0) {
		throw new Error(
			`No se pudo preparar la base de pruebas: faltan estas variables en .env: ${missing.join(', ')}.`,
		);
	}

	const here = dirname(fileURLToPath(import.meta.url));
	// server/tests -> server -> repo root -> db/init.
	const dbInitDir = resolve(here, '../../db/init');
	const schemaSql = readFileSync(resolve(dbInitDir, '01-schema.sql'), 'utf8');
	const catalogSql = readFileSync(resolve(dbInitDir, '02-catalogos.sql'), 'utf8');

	const admin = await mysql.createConnection({ host, port, user: 'root', password: rootPassword, multipleStatements: true });
	try {
		await admin.query(
			`DROP DATABASE IF EXISTS \`${testDatabase}\`; CREATE DATABASE \`${testDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
		);
		await admin.query(`GRANT ALL PRIVILEGES ON \`${testDatabase}\`.* TO '${appUser}'@'%'; FLUSH PRIVILEGES;`);
	} finally {
		await admin.end();
	}

	const conn = await mysql.createConnection({
		host,
		port,
		user: 'root',
		password: rootPassword,
		database: testDatabase,
		multipleStatements: true,
	});
	try {
		await conn.query(schemaSql);
		await conn.query(catalogSql);
	} finally {
		await conn.end();
	}
}
