import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { createTestApp, env } from './helpers/app.js';
import { countSessions, login, PASSWORD, registerUser, signedInUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';

const CSRF_FAILED = { error: { code: 'CSRF_FAILED', message: expect.any(String) } };

describe('CSRF protection (NFR-005)', () => {
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

	describe('state-changing request with a session cookie', () => {
		it('403 without X-CSRF-Token, and nothing changes', async () => {
			const { cookie, user } = await signedInUser(app, pool);
			const res = await request(app).post('/auth/logout').set('Cookie', cookie);

			expect(res.status).toBe(403);
			expect(res.body).toEqual(CSRF_FAILED);
			expect(await countSessions(pool, user.id)).toBe(1);
		});

		it('403 with a wrong token', async () => {
			const { cookie } = await signedInUser(app, pool);
			const res = await request(app).post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', 'x'.repeat(43));

			expect(res.status).toBe(403);
		});

		it("403 with another session's token", async () => {
			const victim = await signedInUser(app, pool);
			const attacker = await signedInUser(app, pool);
			const res = await request(app)
				.post('/auth/logout')
				.set('Cookie', victim.cookie)
				.set('X-CSRF-Token', attacker.csrfToken);

			expect(res.status).toBe(403);
		});

		it('passes with the token of its own session', async () => {
			const { cookie, csrfToken } = await signedInUser(app, pool);

			expect((await request(app).post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrfToken)).status).toBe(
				200,
			);
		});

		it('GET needs no token', async () => {
			const { cookie } = await signedInUser(app, pool);

			expect((await request(app).get('/auth/me').set('Cookie', cookie)).status).toBe(200);
		});
	});

	describe('Origin check', () => {
		it('rejects a login posted from another site (login CSRF)', async () => {
			const { body } = await registerUser(app);
			const res = await request(app)
				.post('/auth/login')
				.set('Origin', 'https://evil.example')
				.send({ email: body.email, password: PASSWORD });

			expect(res.status).toBe(403);
			expect(res.body).toEqual(CSRF_FAILED);
			expect(res.headers['set-cookie']).toBeUndefined();
		});

		it('rejects a registration posted from another site', async () => {
			const res = await request(app)
				.post('/auth/register')
				.set('Origin', 'http://localhost:9999')
				.send({ nombre: 'X', email: 'x@liga.test', password: PASSWORD });

			expect(res.status).toBe(403);
		});

		it('accepts the frontend origin, and clients that send no Origin', async () => {
			const { body } = await registerUser(app);

			const fromFront = await request(app)
				.post('/auth/login')
				.set('Origin', env.corsOrigin)
				.send({ email: body.email, password: PASSWORD });
			expect(fromFront.status).toBe(200);
			expect((await request(app).post('/auth/login').send({ email: body.email, password: PASSWORD })).status).toBe(200);
		});

		it('accepts the site when CORS_ORIGIN was written with a trailing slash or capitals', async () => {
			const { corsOrigin } = parseEnv({ ...process.env, CORS_ORIGIN: 'https://ACPLeague2026.grupoacp.com.pe/' });
			const { app: siteApp, pool: sitePool } = createTestApp({ corsOrigin });
			try {
				const { body } = await registerUser(siteApp);
				const res = await request(siteApp)
					.post('/auth/login')
					.set('Origin', 'https://acpleague2026.grupoacp.com.pe')
					.send({ email: body.email, password: PASSWORD });

				expect(res.status).toBe(200);
				expect(res.headers['access-control-allow-origin']).toBe('https://acpleague2026.grupoacp.com.pe');
			} finally {
				await sitePool.end();
			}
		});
	});

	it('login and register need no token, even with a stale session cookie', async () => {
		const { body } = await registerUser(app);
		const { cookie, csrfToken } = await login(app, body.email);
		await request(app).post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', csrfToken);

		const res = await request(app).post('/auth/login').set('Cookie', cookie).send({ email: body.email, password: PASSWORD });
		expect(res.status).toBe(200);
	});

	/**
	 * D-06. El 403 no dice qué esperaba el servidor —sería contarle la
	 * configuración a cualquiera— pero antes tampoco lo decía en ningún lado,
	 * así que quien desplegaba no tenía cómo ver por qué fallaba el ingreso.
	 * Ahora la diferencia queda en el registro del servidor, y solo ahí.
	 */
	describe('rastro en el servidor de un rechazo (D-06)', () => {
		let warn: ReturnType<typeof vi.spyOn>;

		beforeEach(() => {
			warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		});

		afterEach(() => {
			warn.mockRestore();
		});

		const registrado = () => warn.mock.calls.map((args: unknown[]) => args.join(' ')).join('\n');

		it('el dato del rechazo va al registro, no al cuerpo de la respuesta', async () => {
			const res = await request(app)
				.post('/auth/register')
				.set('Origin', 'https://evil.example')
				.send({ nombre: 'X', email: 'x@liga.test', password: PASSWORD });

			expect(res.status).toBe(403);
			// El cuerpo es el de siempre: un código y un mensaje fijos. No dice qué
			// origen esperaba el servidor, ni lo deja deducir.
			expect(res.body).toEqual(CSRF_FAILED);
			expect(res.body.error.message).toBe('Origen no permitido.');
			const cuerpo = JSON.stringify(res.body);
			expect(cuerpo).not.toContain(env.corsOrigin);
			expect(cuerpo).not.toContain(new URL(env.corsOrigin).host);

			// Y sí está en el registro, que es donde sirve para diagnosticar.
			expect(registrado()).toContain(env.corsOrigin);
		});

		/**
		 * Ojo al alcance de lo anterior: `cors({ origin: env.corsOrigin })`
		 * responde `Access-Control-Allow-Origin` con el valor configurado en
		 * TODAS las respuestas, incluida esta de 403. O sea que el valor ya era
		 * visible desde afuera antes de D-06, y D-06 no lo cambia. Esta prueba lo
		 * deja fijado para que nadie lea la de arriba como una garantía más
		 * fuerte de la que es; si algún día se quiere ocultar, hay que tocar la
		 * configuración de CORS, no el registro.
		 */
		it('la cabecera CORS ya exponía el origen configurado, y sigue igual', async () => {
			const res = await request(app)
				.post('/auth/register')
				.set('Origin', 'https://evil.example')
				.send({ nombre: 'X', email: 'x@liga.test', password: PASSWORD });

			expect(res.headers['access-control-allow-origin']).toBe(env.corsOrigin);
		});

		it('registra el Origin recibido junto al configurado, para poder compararlos', async () => {
			await request(app)
				.post('/auth/register')
				.set('Origin', 'https://otro.example')
				.send({ nombre: 'X', email: 'x@liga.test', password: PASSWORD });

			const linea = registrado();
			expect(linea).toContain('https://otro.example');
			expect(linea).toContain(env.corsOrigin);
			expect(linea).toContain('POST');
			expect(linea).toContain('/auth/register');
		});

		it('recorta un Origin larguísimo en vez de volcarlo entero', async () => {
			await request(app)
				.post('/auth/register')
				.set('Origin', `https://${'a'.repeat(3000)}.example`)
				.send({ nombre: 'X', email: 'x@liga.test', password: PASSWORD });

			const escrito = registrado();
			expect(escrito).toContain('(recortado)');
			expect(escrito.length).toBeLessThan(500);
		});

		it('distingue token ausente de token inválido, sin registrar ninguno de los dos', async () => {
			const { cookie, csrfToken } = await signedInUser(app, pool);

			await request(app).post('/auth/logout').set('Cookie', cookie);
			expect(registrado()).toContain('ausente');

			warn.mockClear();
			const inventado = 'z'.repeat(43);
			await request(app).post('/auth/logout').set('Cookie', cookie).set('X-CSRF-Token', inventado);

			const escrito = registrado();
			expect(escrito).toContain('inválido');
			// El esperado abre la sesión y el recibido puede ser el de otra cuenta:
			// ninguno de los dos va al registro.
			expect(escrito).not.toContain(csrfToken);
			expect(escrito).not.toContain(inventado);
		});

		it('no registra nada cuando la petición es legítima', async () => {
			const { body } = await registerUser(app);
			const res = await request(app)
				.post('/auth/login')
				.set('Origin', env.corsOrigin)
				.send({ email: body.email, password: PASSWORD });

			expect(res.status).toBe(200);
			expect(warn).not.toHaveBeenCalled();
		});
	});
});
