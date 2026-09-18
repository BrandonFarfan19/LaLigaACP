import { ConfigError, loadEnv } from '../config/env.js';
import { createPool } from '../db/pool.js';
import {
	assertConnectedTo,
	assertDevSeedAllowed,
	cleanDevData,
	DEV_SEED_FLAG,
	DevSeedError,
	seedDevData,
} from '../services/dev-seed.service.js';
import { plural } from '../lib/plural.js';

/**
 * Development sample data (D-013, D-016):
 *
 *   NODE_ENV=development npm run seed:dev -- --yes-dev-data         loads it (replacing earlier sample data)
 *   NODE_ENV=development npm run seed:dev:clean -- --yes-dev-data   removes only the sample data
 *
 * Refuses, touching nothing, unless NODE_ENV=development is set in the real
 * environment, the database is exactly DEV_SEED_DATABASE (never a test one)
 * and the flag is on the command line. Exit code 0 on success, 1 otherwise.
 */
async function main(): Promise<number> {
	const args = process.argv.slice(2);
	const clean = args.includes('clean');
	let env;
	try {
		env = loadEnv();
		assertDevSeedAllowed({
			nodeEnv: env.nodeEnv,
			nodeEnvExplicit: env.devSeed.nodeEnvExplicit,
			database: env.db.database,
			devDatabase: env.devSeed.database,
			testDatabase: env.devSeed.testDatabase,
			argv: args,
		});
	} catch (error) {
		if (error instanceof ConfigError || error instanceof DevSeedError) {
			console.error(error.message);
			if (error instanceof DevSeedError) {
				console.error(`Uso: NODE_ENV=development npm run seed:dev${clean ? ':clean' : ''} -- ${DEV_SEED_FLAG} (con DEV_SEED_DATABASE igual a MYSQL_DATABASE).`);
			}
			return 1;
		}
		throw error;
	}

	const pool = createPool(env);
	try {
		await assertConnectedTo(pool, env.db.database);
		if (clean) {
			const done = await cleanDevData(pool);
			console.log(
				`Datos de ejemplo borrados de ${env.db.database}: ${plural(done.deportes, 'deporte', 'deportes')}, ${plural(done.partidos, 'partido', 'partidos')}, ${plural(done.jugadores, 'jugador', 'jugadores')} y ${plural(done.cuentas, 'cuenta', 'cuentas')}.`,
			);
			return 0;
		}
		const done = await seedDevData(pool);
		console.log(
			`Datos de ejemplo cargados en ${env.db.database}: ${done.deportes} deportes, ${done.equipos} equipos, ${done.jugadores} jugadores y ${done.partidos} partidos.`,
		);
		console.log('Cuentas de ejemplo (solo para desarrollo):');
		for (const cuenta of done.cuentas) {
			const estado = cuenta.rol === 'apostador' ? `, ${cuenta.validado ? 'validado' : 'pendiente'}, ${plural(cuenta.saldoMonedas ?? 0, 'moneda', 'monedas')}` : '';
			console.log(`  ${cuenta.email} / ${cuenta.password}  (${cuenta.rol}${estado})`);
		}
		return 0;
	} catch (error) {
		console.error(error instanceof DevSeedError ? error.message : `No se pudo completar: ${error instanceof Error ? error.message : String(error)}`);
		return 1;
	} finally {
		await pool.end();
	}
}

process.exitCode = await main();
