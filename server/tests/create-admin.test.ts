import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminInputError, ensureAdmin } from '../src/services/admin-bootstrap.service.js';
import { validateParticipant } from '../src/services/participant-validation.service.js';
import { createTestApp, env } from './helpers/app.js';
import { login, PASSWORD, registerUser, setUserState } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';
import { addSettledSelections, setPayment } from './helpers/participants.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function roleOf(pool: Pool, email: string): Promise<string | undefined> {
	const [rows] = await pool.query<RowDataPacket[]>(
		'SELECT r.codigo FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.email = ?',
		[email],
	);
	return rows[0]?.codigo as string | undefined;
}

describe('first admin (BR-001)', () => {
	let app: Express;
	let pool: Pool;

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
	});

	afterAll(async () => {
		await pool.end();
	});

	describe('ensureAdmin', () => {
		it('creates a new admin that can log in and reach /admin', async () => {
			const result = await ensureAdmin(pool, { email: ' Jefa@Liga.test ', nombre: 'Jefa', password: PASSWORD });

			expect(result.action).toBe('created');
			expect(result.user).toMatchObject({
				email: 'jefa@liga.test',
				rol: 'admin',
				estadoValidacion: 'pendiente',
				saldoMonedas: 0,
			});
			const { cookie } = await login(app, 'jefa@liga.test');
			expect((await request(app).get('/admin/sesion').set('Cookie', cookie)).status).toBe(200);
		});

		it('promotes an existing account without touching its password, and says the given one was ignored', async () => {
			const { body } = await registerUser(app);

			const result = await ensureAdmin(pool, { email: body.email, password: 'no-se-usa-123' });

			expect(result).toMatchObject({ action: 'promoted', passwordIgnored: true });
			expect(await roleOf(pool, body.email)).toBe('admin');
			await login(app, body.email, PASSWORD);
		});

		describe('only an account that never took part in the pool can be promoted', () => {
			async function registered() {
				return (await registerUser(app)).user;
			}

			async function expectRefused(email: string, reason: RegExp) {
				const attempt = ensureAdmin(pool, { email });
				await expect(attempt).rejects.toThrow(AdminInputError);
				await expect(ensureAdmin(pool, { email })).rejects.toThrow(reason);
				expect(await roleOf(pool, email)).toBe('apostador');
			}

			it('refuses a validated account with coins and a movement', async () => {
				const user = await registered();
				const actor = await ensureAdmin(pool, { email: 'actor@liga.test', nombre: 'Actor', password: PASSWORD });
				await setPayment(pool, user.id, 'confirmado');
				await validateParticipant(pool, { actorId: actor.user.id, userId: user.id });

				await expectRefused(user.email, /está validada, tiene el pago confirmado, tiene 10 monedas, tiene 1 movimiento/);
			});

			it('refuses an account whose payment is confirmed', async () => {
				const user = await registered();
				await setPayment(pool, user.id, 'confirmado');

				await expectRefused(user.email, /tiene el pago confirmado/);
			});

			it('refuses an account with coins', async () => {
				const user = await registered();
				await pool.query('UPDATE usuario SET saldo_monedas = 3 WHERE id = ?', [user.id]);

				await expectRefused(user.email, /tiene 3 monedas/);
			});

			it('refuses an account with a ticket', async () => {
				const user = await registered();
				await addSettledSelections(pool, user.id, [null]);

				await expectRefused(user.email, /tiene 1 ticket/);
			});

			it('refuses a validated account even without coins', async () => {
				const user = await registered();
				await setUserState(pool, user.id, { estado: 'validado' });

				await expectRefused(user.email, /está validada/);
			});

			it('promotes a clean pending account', async () => {
				const user = await registered();

				expect((await ensureAdmin(pool, { email: user.email })).action).toBe('promoted');
				expect(await roleOf(pool, user.email)).toBe('admin');
			});
		});

		it('never asks for a password when promoting', async () => {
			const { body } = await registerUser(app);
			const ask = vi.fn(async () => 'no-se-usa-123');

			const result = await ensureAdmin(pool, { email: body.email, password: ask });

			expect(result).toMatchObject({ action: 'promoted', passwordIgnored: false });
			expect(ask).not.toHaveBeenCalled();
		});

		it('asks for the password only when creating', async () => {
			const ask = vi.fn(async () => PASSWORD);

			const result = await ensureAdmin(pool, { email: 'nueva@liga.test', nombre: 'Nueva', password: ask });

			expect(result.action).toBe('created');
			expect(ask).toHaveBeenCalledOnce();
			await login(app, 'nueva@liga.test');
		});

		it('is idempotent', async () => {
			await ensureAdmin(pool, { email: 'jefa@liga.test', nombre: 'Jefa', password: PASSWORD });

			expect((await ensureAdmin(pool, { email: 'jefa@liga.test' })).action).toBe('unchanged');
		});

		it('refuses to create an account without name or password', async () => {
			await expect(ensureAdmin(pool, { email: 'nueva@liga.test', password: PASSWORD })).rejects.toThrow(/falta ADMIN_NOMBRE/);
			await expect(ensureAdmin(pool, { email: 'nueva@liga.test', nombre: 'Nueva' })).rejects.toThrow(/falta la contraseña/);
			expect(await roleOf(pool, 'nueva@liga.test')).toBeUndefined();
		});

		it('applies the registration rules to email and password', async () => {
			await expect(ensureAdmin(pool, { email: 'no-es-correo', nombre: 'X', password: PASSWORD })).rejects.toThrow();
			await expect(ensureAdmin(pool, { email: 'x@liga.test', nombre: 'X', password: 'corta' })).rejects.toThrow();
		});
	});

	describe('npm run admin:create', () => {
		let dir: string;

		beforeAll(async () => {
			dir = await mkdtemp(join(tmpdir(), 'liga-cli-'));
		});

		afterAll(async () => {
			await rm(dir, { recursive: true, force: true });
		});

		/**
		 * Runs the real CLI against the test database (NODE_ENV=test selects it).
		 * stdin is a pipe, never a terminal: `stdin` is written and closed.
		 */
		function cli(vars: Record<string, string>, stdin = '') {
			return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, fail) => {
				const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/create-admin.ts'], {
					cwd: serverDir,
					env: {
						...process.env,
						NODE_ENV: 'test',
						ADMIN_EMAIL: '',
						ADMIN_NOMBRE: '',
						ADMIN_PASSWORD: '',
						ADMIN_PASSWORD_FILE: '',
						ADMIN_PASSWORD_STDIN: '',
						...vars,
					},
				});
				let stdout = '';
				let stderr = '';
				child.stdout.on('data', (chunk) => (stdout += String(chunk)));
				child.stderr.on('data', (chunk) => (stderr += String(chunk)));
				child.on('error', fail);
				child.on('close', (code) => done({ code, stdout, stderr }));
				child.stdin.end(stdin);
			});
		}

		it('says the email is missing when ADMIN_EMAIL is not set', async () => {
			const { code, stderr } = await cli({});

			expect(code).toBe(1);
			expect(stderr).toMatch(/Falta ADMIN_EMAIL/);
			expect(stderr).not.toMatch(/no es válido/);
		});

		it('creates the admin with the password piped on stdin (ADMIN_PASSWORD_STDIN=1)', async () => {
			const { code, stdout, stderr } = await cli(
				{ ADMIN_EMAIL: 'stdin@liga.test', ADMIN_NOMBRE: 'Admin Stdin', ADMIN_PASSWORD_STDIN: '1' },
				'clave-por-stdin-123\n',
			);

			expect(code).toBe(0);
			expect(stdout).toMatch(/Administrador creado: stdin@liga\.test/);
			expect(stdout).toContain(`base ${env.db.database}`);
			expect(stdout + stderr).not.toContain('clave-por-stdin-123');
			await login(app, 'stdin@liga.test', 'clave-por-stdin-123');
		});

		it('creates the admin with the password in ADMIN_PASSWORD_FILE', async () => {
			const file = join(dir, 'clave');
			await writeFile(file, 'clave-de-archivo-123\n');

			const { code, stdout, stderr } = await cli({
				ADMIN_EMAIL: 'file@liga.test',
				ADMIN_NOMBRE: 'Admin File',
				ADMIN_PASSWORD_FILE: file,
			});

			expect(code).toBe(0);
			expect(stdout + stderr).not.toContain('clave-de-archivo-123');
			await login(app, 'file@liga.test', 'clave-de-archivo-123');
		});

		it('without a terminal or a password source, explains how to give one and creates nothing', async () => {
			const { code, stderr } = await cli({ ADMIN_EMAIL: 'nadie@liga.test', ADMIN_NOMBRE: 'Nadie' });

			expect(code).toBe(1);
			expect(stderr).toMatch(/ADMIN_PASSWORD_FILE o ADMIN_PASSWORD_STDIN=1/);
			expect(await roleOf(pool, 'nadie@liga.test')).toBeUndefined();
		});

		it('warns that the password is ignored when promoting', async () => {
			const { body } = await registerUser(app);

			const { code, stdout, stderr } = await cli({ ADMIN_EMAIL: body.email, ADMIN_PASSWORD: 'no-se-usa-123' });

			expect(code).toBe(0);
			expect(stdout).toMatch(/promovido/);
			expect(stderr).toMatch(/contraseña recibida se ignoró/);
			expect(stdout + stderr).not.toContain('no-se-usa-123');
			await login(app, body.email, PASSWORD);
		});

		it('refuses to promote an account that took part in the pool, with exit 1', async () => {
			const { user } = await registerUser(app);
			await setPayment(pool, user.id, 'confirmado');

			const { code, stdout, stderr } = await cli({ ADMIN_EMAIL: user.email });

			expect(code).toBe(1);
			expect(stdout).toBe('');
			expect(stderr).toMatch(/No se puede promover .*tiene el pago confirmado/);
			expect(await roleOf(pool, user.email)).toBe('apostador');
		});

		it('promotes without any password source and without waiting for input', async () => {
			const { body } = await registerUser(app);

			const { code, stderr } = await cli({ ADMIN_EMAIL: body.email });

			expect(code).toBe(0);
			expect(stderr).toBe('');
			expect(await roleOf(pool, body.email)).toBe('admin');
		});
	});
});
