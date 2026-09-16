import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import { LEAKS_SECRET, newUserBody, PASSWORD, registerUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';

describe('POST /auth/register (BR-003)', () => {
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

	it('creates a pending apostador with pending payment and 0 coins', async () => {
		const body = newUserBody();
		const res = await request(app).post('/auth/register').send(body);

		expect(res.status).toBe(201);
		expect(res.body).toEqual({
			data: {
				user: {
					id: expect.any(Number),
					nombre: body.nombre,
					email: body.email,
					rol: 'apostador',
					estadoValidacion: 'pendiente',
					estadoPago: 'pendiente',
					saldoMonedas: 0,
					creadoEn: expect.any(String),
				},
			},
		});
		expect(JSON.stringify(res.body)).not.toMatch(LEAKS_SECRET);
		// Registering doesn't log in.
		expect(res.headers['set-cookie']).toBeUndefined();
	});

	it('stores an argon2id hash, never the password', async () => {
		const { user } = await registerUser(app);
		const [rows] = await pool.query<RowDataPacket[]>('SELECT password_hash FROM usuario WHERE id = ?', [user.id]);
		const hash = rows[0]!.password_hash as string;

		expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
		expect(hash).not.toContain(PASSWORD);
	});

	it('normalizes the email (trim + lowercase)', async () => {
		const res = await request(app)
			.post('/auth/register')
			.send(newUserBody({ email: '  Ana.Perez@Liga.TEST ' }));

		expect(res.status).toBe(201);
		expect(res.body.data.user.email).toBe('ana.perez@liga.test');
	});

	it('ignores any attempt to pick the role, state or balance', async () => {
		const res = await request(app)
			.post('/auth/register')
			.send(newUserBody({ rol: 'admin', rol_id: 2, estadoValidacion: 'validado', saldoMonedas: 999 }));

		expect(res.status).toBe(201);
		expect(res.body.data.user).toMatchObject({ rol: 'apostador', estadoValidacion: 'pendiente', saldoMonedas: 0 });
	});

	it('rejects a duplicate email, whatever its case, with 409 EMAIL_TAKEN', async () => {
		const { body } = await registerUser(app);
		const res = await request(app)
			.post('/auth/register')
			.send(newUserBody({ email: body.email.toUpperCase() }));

		expect(res.status).toBe(409);
		expect(res.body).toEqual({ error: { code: 'EMAIL_TAKEN', message: expect.any(String) } });
		const [rows] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM usuario');
		expect(rows[0]!.n).toBe(1);
	});

	it.each([
		['invalid email', { email: 'no-es-un-correo' }, 'email'],
		['missing email', { email: undefined }, 'email'],
		['short password', { password: 'corta' }, 'password'],
		['too long password', { password: 'x'.repeat(129) }, 'password'],
		['blank name', { nombre: '   ' }, 'nombre'],
		['missing name', { nombre: undefined }, 'nombre'],
	])('%s -> 400 VALIDATION_ERROR naming the field', async (_label, overrides, field) => {
		const res = await request(app).post('/auth/register').send(newUserBody(overrides));

		expect(res.status).toBe(400);
		expect(res.body.error).toMatchObject({ code: 'VALIDATION_ERROR' });
		expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
		// The rejected password is never echoed back.
		expect(JSON.stringify(res.body)).not.toContain('corta');
	});

	it('rejects a non-object body', async () => {
		const res = await request(app).post('/auth/register').set('Content-Type', 'application/json').send('[]');

		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe('VALIDATION_ERROR');
	});
});
