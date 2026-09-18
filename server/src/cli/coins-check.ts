import { ConfigError, loadEnv } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { checkCoinConsistency } from '../services/coins-consistency.service.js';
import { plural } from '../lib/plural.js';

/**
 * `npm run coins:check`: compares every participant's `saldo_monedas` with
 * the sum of their movements, and checks that no admin has coins. Read-only.
 *
 * Exit codes: 0 all consistent, 1 inconsistencies found (listed), 2 could
 * not run (config or database error).
 */
async function main(): Promise<number> {
	let env;
	try {
		env = loadEnv();
	} catch (error) {
		if (error instanceof ConfigError) {
			console.error(error.message);
			return 2;
		}
		throw error;
	}

	const pool = createPool(env);
	try {
		const report = await checkCoinConsistency(pool);
		console.log(`Base ${env.db.database}: ${plural(report.revisados, 'participante revisado', 'participantes revisados')}.`);
		for (const d of report.descuadres) {
			console.log(
				`  DESCUADRE usuario ${d.usuarioId} (${d.email}): saldo ${d.saldo}, suma de movimientos ${d.sumaMovimientos}, diferencia ${d.diferencia > 0 ? '+' : ''}${d.diferencia}`,
			);
		}
		for (const a of report.adminsConMonedas) {
			console.log(`  ADMIN CON MONEDAS usuario ${a.usuarioId} (${a.email}): saldo ${a.saldo}, ${plural(a.movimientos, 'movimiento', 'movimientos')}`);
		}
		if (report.ok) {
			console.log('Todo cuadra: cada saldo es igual a la suma de sus movimientos y ningún admin tiene monedas.');
			return 0;
		}
		console.log(
			`Encontrados: ${plural(report.descuadres.length, 'descuadre', 'descuadres')}, ${plural(report.adminsConMonedas.length, 'admin', 'admins')} con monedas. No se corrigió nada.`,
		);
		return 1;
	} catch (error) {
		console.error('No se pudo hacer la comprobación:', error instanceof Error ? error.message : error);
		return 2;
	} finally {
		await pool.end();
	}
}

process.exitCode = await main();
