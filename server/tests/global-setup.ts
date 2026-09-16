import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';
import { loadEnv } from '../src/config/env.js';
import { DB_INIT_DIR } from './helpers/db.js';
import { assertIsTestDatabase, resolveTestDatabase } from './helpers/test-database.js';

/**
 * Runs once before the whole suite (Vitest `globalSetup`): creates the test
 * database fresh and migrates it from the same `db/init/` SQL the real
 * database uses, so it can never drift from the current schema. Connects as
 * root — the app's own `MYSQL_USER` only has grants on `MYSQL_DATABASE` (see
 * the official mysql image's entrypoint behavior), never on a second
 * database — then grants that user access to the test database too, since
 * the actual test requests run as the app normally would.
 *
 * Before the DROP, the target is checked against the test database name (and
 * against `MYSQL_DATABASE`): a misconfigured `.env` aborts the run instead of
 * wiping the real data.
 */
export default async function globalSetup(): Promise<void> {
	// Validates the whole config (including MYSQL_DATABASE_TEST !== MYSQL_DATABASE).
	const { db } = loadEnv();
	const testDatabase = resolveTestDatabase();
	assertIsTestDatabase(testDatabase);

	const rootPassword = process.env.MYSQL_ROOT_PASSWORD;
	if (!rootPassword) {
		throw new Error('No se pudo preparar la base de pruebas: falta MYSQL_ROOT_PASSWORD en .env.');
	}

	const schemaSql = readFileSync(resolve(DB_INIT_DIR, '01-schema.sql'), 'utf8');
	const catalogSql = readFileSync(resolve(DB_INIT_DIR, '02-catalogos.sql'), 'utf8');
	const server = { host: db.host, port: db.port, user: 'root', password: rootPassword, multipleStatements: true };

	const admin = await mysql.createConnection(server);
	try {
		await admin.query(
			`DROP DATABASE IF EXISTS \`${testDatabase}\`; CREATE DATABASE \`${testDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
		);
		await admin.query('GRANT ALL PRIVILEGES ON ??.* TO ?@?; FLUSH PRIVILEGES;', [testDatabase, db.user, '%']);
	} finally {
		await admin.end();
	}

	const conn = await mysql.createConnection({ ...server, database: testDatabase });
	try {
		await conn.query(schemaSql);
		await conn.query(catalogSql);
	} finally {
		await conn.end();
	}
}
