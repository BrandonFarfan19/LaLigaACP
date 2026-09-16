import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import { LEAKS_SECRET, registerUser, setUserState, signedInUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';
import { addSettledSelections, setCreatedAt, setPayment } from './helpers/participants.js';

describe('GET /admin/participantes and /conteos (BR-001, BR-007)', () => {
	let app: Express;
	let pool: Pool;
	let adminCookie: string;
	let adminId: number;

	const get = (path: string) => request(app).get(`/admin/participantes${path}`).set('Cookie', adminCookie);
	const names = (res: request.Response) => res.body.data.items.map((p: { nombre: string }) => p.nombre);

	/** Registers a user and puts it in the given state, with a controlled registration date. */
	async function participant(
		name: string,
		opts: { pago?: 'confirmado'; estado?: 'validado'; rol?: 'admin'; dia?: number } = {},
	) {
		const { user } = await registerUser(app, { nombre: name, email: `${name.toLowerCase().replace(/\W/g, '')}@liga.test` });
		if (opts.pago) await setPayment(pool, user.id, opts.pago);
		await setUserState(pool, user.id, { estado: opts.estado, rol: opts.rol });
		if (opts.dia !== undefined) await setCreatedAt(pool, user.id, new Date(Date.UTC(2026, 8, opts.dia, 12)));
		return user;
	}

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		// The logged-in admin. It must never show up in the table or the counts.
		const admin = await signedInUser(app, pool, { rol: 'admin' });
		adminCookie = admin.cookie;
		adminId = admin.user.id;
	});

	afterAll(async () => {
		await pool.end();
	});

	describe('listing', () => {
		it('shows every column BR-007 asks for, never the hash', async () => {
			const ana = await participant('Ana', { dia: 1 });
			const res = await get('');

			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
			expect(res.body.data.items).toEqual([
				{
					id: ana.id,
					nombre: 'Ana',
					email: 'ana@liga.test',
					rol: 'apostador',
					estadoValidacion: 'pendiente',
					estadoPago: 'pendiente',
					saldoMonedas: 0,
					creadoEn: '2026-09-01T12:00:00.000Z',
					puntos: 0,
				},
			]);
			expect(JSON.stringify(res.body)).not.toMatch(LEAKS_SECRET);
		});

		it('never includes admins, whatever their state: they do not take part in the pool', async () => {
			const other = await participant('Otro Admin', { dia: 1, rol: 'admin', pago: 'confirmado', estado: 'validado' });
			const ana = await participant('Ana', { dia: 2 });

			const res = await get('');

			expect(res.body.data.items.map((p: { id: number }) => p.id)).toEqual([ana.id]);
			expect(res.body.data.total).toBe(1);
			for (const id of [adminId, other.id]) {
				expect(res.body.data.items.some((p: { id: number }) => p.id === id)).toBe(false);
			}
			expect((await get('?q=admin')).body.data.total).toBe(0);
			expect((await get('?estadoValidacion=validado')).body.data.total).toBe(0);
		});

		it('rejects the old rol filter and any unknown parameter', async () => {
			for (const query of ['rol=admin', 'rol=apostador', 'foo=1']) {
				const res = await get(`?${query}`);
				expect(res.status, query).toBe(400);
				expect(res.body.error.code).toBe('VALIDATION_ERROR');
			}
		});

		it('sums the real points of the user’s settled selections', async () => {
			const ana = await participant('Ana', { dia: 1 });
			const beto = await participant('Beto', { dia: 2 });
			await addSettledSelections(pool, ana.id, [3, 1, 0, null]);
			await addSettledSelections(pool, ana.id, [3]);
			await addSettledSelections(pool, beto.id, [0]);

			const items = (await get('')).body.data.items;

			expect(items.map((p: { nombre: string; puntos: number }) => [p.nombre, p.puntos])).toEqual([
				['Ana', 7],
				['Beto', 0],
			]);
		});

		it('orders by registration date, oldest first by default, and pages', async () => {
			await participant('Dia3', { dia: 3 });
			await participant('Dia1', { dia: 1 });
			await participant('Dia5', { dia: 5 });
			await participant('Dia2', { dia: 2 });
			await participant('Dia4', { dia: 4 });

			const page2 = await get('?pageSize=2&page=2');
			expect(names(page2)).toEqual(['Dia3', 'Dia4']);
			expect(page2.body.data).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
			expect(names(await get('?pageSize=2&page=3'))).toEqual(['Dia5']);
			expect(names(await get('?pageSize=2&page=4'))).toEqual([]);
			expect(names(await get('?orden=desc&pageSize=2'))).toEqual(['Dia5', 'Dia4']);
			// The largest page accepted is simply empty.
			expect(names(await get('?page=100000'))).toEqual([]);
		});

		it('filters by payment and validation state', async () => {
			await participant('Pendiente', { dia: 1 });
			await participant('Pagado', { dia: 2, pago: 'confirmado' });
			await participant('Validado', { dia: 3, pago: 'confirmado', estado: 'validado' });
			const filtered = async (query: string) => names(await get(`?${query}`));

			expect(await filtered('estadoPago=pendiente')).toEqual(['Pendiente']);
			expect(await filtered('estadoPago=confirmado')).toEqual(['Pagado', 'Validado']);
			expect(await filtered('estadoValidacion=validado')).toEqual(['Validado']);
			expect(await filtered('estadoValidacion=pendiente')).toEqual(['Pendiente', 'Pagado']);
			expect(await filtered('estadoPago=confirmado&estadoValidacion=pendiente')).toEqual(['Pagado']);
		});

		it('searches name or email, case-insensitive, with % and _ taken literally', async () => {
			await participant('María López', { dia: 1 });
			await participant('Mario Díaz', { dia: 2 });
			await participant('Zoe', { dia: 3 });
			const found = async (q: string) => names(await get(`?q=${encodeURIComponent(q)}`));

			expect(await found('mari')).toEqual(['María López', 'Mario Díaz']);
			expect(await found('LÓPEZ')).toEqual(['María López']);
			expect(await found('zoe@liga')).toEqual(['Zoe']);
			expect(await found('%')).toEqual([]);
			expect(await found('_')).toEqual([]);
			expect(await found('   ')).toHaveLength(3);
		});

		it.each([
			['page=100001', 'page no puede ser mayor que 100000.'],
			['page=0', 'page debe ser 1 o mayor.'],
			['page=abc', 'page debe ser un número.'],
			['page=1.5', 'page debe ser un número entero.'],
			['pageSize=101', 'pageSize no puede ser mayor que 100.'],
		])('%s -> 400 with a message about the actual problem', async (query, message) => {
			const res = await get(`?${query}`);

			expect(res.status).toBe(400);
			expect(res.body.error.details).toEqual([{ path: query.split('=')[0], message }]);
		});

		it.each([
			['page=0', 'page'],
			['page=abc', 'page'],
			['page=100001', 'page'],
			['page=9007199254740991', 'page'],
			['pageSize=101', 'pageSize'],
			['estadoPago=pagado', 'estadoPago'],
			['estadoValidacion=VALIDADO', 'estadoValidacion'],
			['orden=random', 'orden'],
			['page=1&page=2', 'page'],
			[`q=${'x'.repeat(101)}`, 'q'],
		])('rejects %s with 400 naming the field', async (query, field) => {
			const res = await get(`?${query}`);

			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
			expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ path: field })]));
		});
	});

	describe('counts', () => {
		it('counts registered, validated, pending and payments, admins never included', async () => {
			await participant('Admin Validado', { rol: 'admin', pago: 'confirmado', estado: 'validado' });
			await participant('A');
			await participant('B', { pago: 'confirmado' });
			await participant('C', { pago: 'confirmado', estado: 'validado' });
			await participant('D', { pago: 'confirmado', estado: 'validado' });

			const res = await get('/conteos');

			expect(res.status).toBe(200);
			expect(res.body).toEqual({
				data: { inscritos: 4, validados: 2, pendientes: 2, pagosConfirmados: 3, pagosPendientes: 1 },
			});
		});

		it('is all zeros when only admins exist', async () => {
			expect((await get('/conteos')).body.data).toEqual({
				inscritos: 0,
				validados: 0,
				pendientes: 0,
				pagosConfirmados: 0,
				pagosPendientes: 0,
			});
		});
	});

	describe('access', () => {
		it.each(['', '/conteos'])('401 without a session (%s)', async (path) => {
			const res = await request(app).get(`/admin/participantes${path}`);

			expect(res.status).toBe(401);
			expect(res.body.error.code).toBe('UNAUTHENTICATED');
		});

		it.each(['', '/conteos'])('403 for an apostador, even a validated one (%s)', async (path) => {
			const { cookie } = await signedInUser(app, pool, { estado: 'validado' });
			const res = await request(app).get(`/admin/participantes${path}`).set('Cookie', cookie);

			expect(res.status).toBe(403);
			expect(res.body.error.code).toBe('FORBIDDEN');
		});
	});
});
