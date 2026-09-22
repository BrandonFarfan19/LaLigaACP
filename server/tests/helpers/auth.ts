import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { env } from './app.js';

export const PASSWORD = 'clave-segura-123';

let counter = 0;

/** A fresh, valid registration body. */
export function newUserBody(overrides: Record<string, unknown> = {}) {
	counter += 1;
	return { nombre: `Persona ${counter}`, email: `persona${counter}@liga.test`, password: PASSWORD, ...overrides };
}

export async function registerUser(app: Express, overrides: Record<string, unknown> = {}) {
	const body = newUserBody(overrides);
	const res = await request(app).post('/auth/register').send(body);
	if (res.status !== 201) throw new Error(`registro falló: ${res.status} ${JSON.stringify(res.body)}`);
	return { body, user: res.body.data.user as { id: number; email: string } };
}

/** The `name=value` pair of the session cookie in a response, ready for a `Cookie` header. */
export function sessionCookieFrom(setCookie: string[] | string | undefined): string | undefined {
	const list = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
	const found = list.find((c) => c.startsWith(`${env.session.cookieName}=`));
	const pair = found?.split(';')[0];
	return pair && pair !== `${env.session.cookieName}=` ? pair : undefined;
}

export async function login(app: Express, email: string, password = PASSWORD) {
	const res = await request(app).post('/auth/login').send({ email, password });
	if (res.status !== 200) throw new Error(`login falló: ${res.status} ${JSON.stringify(res.body)}`);
	const cookie = sessionCookieFrom(res.headers['set-cookie']);
	if (!cookie) throw new Error('login no devolvió la cookie de sesión');
	return { cookie, csrfToken: res.body.data.csrfToken as string, res };
}

/** Registers and logs in a new user; optionally sets role/state straight in the database first. */
export async function signedInUser(
	app: Express,
	pool: Pool,
	state: { rol?: 'apostador' | 'admin'; estado?: 'pendiente' | 'validado' } = {},
) {
	const { body, user } = await registerUser(app);
	await setUserState(pool, user.id, state);
	return { user, ...(await login(app, body.email)) };
}

export async function setUserState(
	pool: Pool,
	userId: number,
	{ rol, estado }: { rol?: 'apostador' | 'admin'; estado?: 'pendiente' | 'validado' },
): Promise<void> {
	if (rol) {
		await pool.query('UPDATE usuario SET rol_id = (SELECT id FROM rol WHERE codigo = ?) WHERE id = ?', [rol, userId]);
	}
	if (estado) {
		await pool.query(
			'UPDATE usuario SET estado_usuario_id = (SELECT id FROM estado_usuario WHERE codigo = ?) WHERE id = ?',
			[estado, userId],
		);
	}
}

export async function countSessions(pool: Pool, userId: number): Promise<number> {
	const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM sesion WHERE usuario_id = ?', [userId]);
	return rows[0]!.n as number;
}

/** A password field, a hash field or an argon2 string anywhere in a (successful) response body. */
export const LEAKS_SECRET = /password|\$argon2/i;
