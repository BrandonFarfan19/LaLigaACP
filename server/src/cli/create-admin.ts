import { ZodError } from 'zod';
import { ConfigError, loadEnv } from '../config/env.js';
import { createPool } from '../db/pool.js';
import { AdminInputError, ensureAdmin } from '../services/admin-bootstrap.service.js';
import { resolvePasswordSource, UsageError } from './admin-password.js';
import { PromptAborted } from './read-secret.js';

/**
 * Creates the first admin, or promotes an existing account (BR-001: there is
 * no admin registration over HTTP). Name and email come from the
 * environment; the password is typed at the prompt by default, so it never
 * appears in shell history or in a process command line:
 *
 *   ADMIN_EMAIL=ana@liga.test ADMIN_NOMBRE=Ana npm run admin:create
 *
 * Non-interactive alternatives (see admin-password.ts): ADMIN_PASSWORD_FILE,
 * ADMIN_PASSWORD_STDIN=1, or ADMIN_PASSWORD from a CI secret store.
 * Exit code 0 on success, 1 on any error, 130 if cancelled at the prompt.
 */
async function main(): Promise<number> {
	const email = process.env.ADMIN_EMAIL?.trim();
	if (!email) {
		console.error('Falta ADMIN_EMAIL: el correo de la cuenta a crear o promover.');
		return 1;
	}

	let env;
	try {
		env = loadEnv();
	} catch (error) {
		if (error instanceof ConfigError) {
			console.error(error.message);
			return 1;
		}
		throw error;
	}

	const pool = createPool(env);
	try {
		const source = await resolvePasswordSource(process.env);
		const { action, user, passwordIgnored } = await ensureAdmin(pool, {
			email,
			nombre: process.env.ADMIN_NOMBRE || undefined,
			password: source.kind === 'value' ? source.value : source.kind === 'prompt' ? source.ask : undefined,
		});

		const verb = {
			created: 'Administrador creado',
			promoted: 'Usuario promovido a administrador',
			unchanged: 'Ya era administrador',
		}[action];
		console.log(`${verb}: ${user.email} (id ${user.id}, base ${env.db.database}).`);
		if (passwordIgnored) {
			console.warn('Aviso: la cuenta ya existía, así que la contraseña recibida se ignoró (este comando nunca cambia contraseñas).');
		}
		return 0;
	} catch (error) {
		if (error instanceof PromptAborted) {
			console.error('Cancelado. No se creó nada.');
			return 130;
		}
		if (error instanceof ZodError) {
			const label = (path: PropertyKey | undefined) => (path === undefined ? 'contraseña' : `ADMIN_${String(path).toUpperCase()}`);
			const issues = error.issues.map((issue) => `  - ${label(issue.path[0])}: ${issue.message}`);
			console.error(`Datos inválidos:\n${issues.join('\n')}`);
		} else if (error instanceof UsageError || error instanceof AdminInputError) {
			console.error(error.message);
		} else {
			console.error(error instanceof Error ? error.message : error);
		}
		return 1;
	} finally {
		await pool.end();
	}
}

process.exitCode = await main();
