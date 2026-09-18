import type { Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { paginationQuerySchema } from '../src/schemas/common.schema.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';

/**
 * T-21 fix: `page` and `pageSize` are whole numbers written only with decimal
 * digits in every paginated list (`z.coerce` used to take `1e2`, `0x10`, ` 2`).
 */
describe('page and pageSize: decimal digits only, in every list', () => {
	let app: Express;
	let pool: Pool;
	let admin: Awaited<ReturnType<typeof signedInUser>>;
	let bettor: Awaited<ReturnType<typeof signedInUser>>;

	const ADMIN_LISTS = [
		'/admin/participantes',
		'/admin/deportes',
		'/admin/competiciones',
		'/admin/equipos',
		'/admin/jugadores',
		'/admin/planteles',
		'/admin/partidos',
		'/admin/auditoria',
		'/admin/polla/ranking',
		'/admin/polla/apuestas',
	];
	const BETTOR_LISTS = ['/apuestas/partidos', '/apuestas/mis-apuestas', '/monedas/movimientos'];
	const PUBLIC_LISTS = ['/public/competiciones', '/public/partidos'];

	const get = (path: string) => {
		const req = request(app).get(path);
		if (path.startsWith('/admin')) return req.set('Cookie', admin.cookie);
		if (path.startsWith('/public')) return req;
		return req.set('Cookie', bettor.cookie);
	};

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		admin = await signedInUser(app, pool, { rol: 'admin' });
		bettor = await signedInUser(app, pool, { estado: 'validado' });
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	const ALL = [...ADMIN_LISTS, ...BETTOR_LISTS, ...PUBLIC_LISTS];

	it.each(ALL)('%s takes page=2 and pageSize=5', async (path) => {
		const res = await get(`${path}?page=2&pageSize=5`);

		expect(res.status, JSON.stringify(res.body)).toBe(200);
		expect(res.body.data).toMatchObject({ page: 2, pageSize: 5 });
	});

	it.each(ALL.flatMap((path) => ['page=1e2', 'pageSize=0x10', 'page=2.0', 'pageSize=%2B5', 'page=%202'].map((query) => [path, query] as const)))(
		'%s?%s -> 400 naming the field',
		async (path, query) => {
			const res = await get(`${path}?${query}`);

			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
			expect(res.body.error.details).toEqual([{ path: query.split('=')[0], message: `${query.split('=')[0]} debe ser un número entero, escrito solo con cifras.` }]);
		},
	);

	it('the schema itself: digits only, 1 to the maximum, leading zeros are still decimal', () => {
		expect(paginationQuerySchema.parse({ page: '007', pageSize: '100' })).toEqual({ page: 7, pageSize: 100 });
		expect(paginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 20 });
		for (const bad of ['1e2', '0x10', '0b1', '0o7', '+1', ' 1', '1 ', '1.0', 'Infinity', '', '-0', '0', '100001', ['1', '2']]) {
			expect(paginationQuerySchema.safeParse({ page: bad }).success, String(bad)).toBe(false);
		}
	});
});
