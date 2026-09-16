import type { Express } from 'express';
import express from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createTestApp } from './helpers/app.js';
import { type AdminApi, adminApi } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

/**
 * A route parameter that is not valid percent-encoding (`%zz`, a lone `%`, a
 * truncated or overlong UTF-8 sequence) makes the router throw a URIError
 * before any handler runs. That is the client's fault: 400 in the standard
 * envelope, not a logged 500 (T-08 follow-up).
 */
const BAD_IDS = ['%zz', '%', '%E0%A4%A', '%C0%AF', '1%', '%FF'];

const INVALID_URL_ENCODING = { error: { code: 'INVALID_URL_ENCODING', message: expect.any(String) } };

describe('malformed percent-encoding in route parameters', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	let consoleError: MockInstance<typeof console.error>;

	beforeAll(async () => {
		consoleError = vi.spyOn(console, 'error');
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		api = await adminApi(app, pool);
	});

	beforeEach(() => {
		consoleError.mockClear();
	});

	afterAll(async () => {
		consoleError.mockRestore();
		await resetDatabase(pool);
		await pool.end();
	});

	const PUBLIC_PATHS = (id: string) => [
		`/public/partidos/${id}`,
		`/public/equipos/${id}`,
		`/public/competiciones/${id}`,
		`/public/competiciones/${id}/equipos`,
		`/public/competiciones/${id}/posiciones`,
	];

	it.each(BAD_IDS)('public routes: %s -> 400 INVALID_URL_ENCODING, not logged, not cacheable', async (id) => {
		for (const path of PUBLIC_PATHS(id)) {
			const res = await request(app).get(path);
			expect(res.status, path).toBe(400);
			expect(res.body, path).toEqual(INVALID_URL_ENCODING);
			expect(res.headers['cache-control'], path).toBe('no-store');
		}
		expect(consoleError).not.toHaveBeenCalled();
	});

	it.each(BAD_IDS)('admin routes (with a session): %s -> 400 INVALID_URL_ENCODING, not logged', async (id) => {
		const attempts: Array<[string, request.Test]> = [];
		for (const entity of ['deportes', 'competiciones', 'equipos', 'jugadores', 'planteles', 'partidos']) {
			attempts.push([`GET ${entity}`, api.get(`/${entity}/${id}`)]);
			attempts.push([`PATCH ${entity}`, api.patch(`/${entity}/${id}`, { nombre: 'X' })]);
			attempts.push([`DELETE ${entity}`, api.del(`/${entity}/${id}`)]);
		}
		attempts.push(['POST partido estado', api.post(`/partidos/${id}/estado`, { estado: 'cancelado' })]);
		for (const action of ['pago/confirmar', 'pago/revertir', 'validar']) {
			attempts.push([`POST participante ${action}`, api.post(`/participantes/${id}/${action}`, {})]);
		}

		for (const [label, attempt] of attempts) {
			const res = await attempt;
			expect(res.status, label).toBe(400);
			expect(res.body, label).toEqual(INVALID_URL_ENCODING);
			expect(res.headers['cache-control'], label).toBe('no-store');
		}
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('admin routes without a session still answer 401 first', async () => {
		const res = await request(app).get('/admin/deportes/%zz');

		expect(res.status).toBe(401);
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('a well-encoded id keeps its normal answer (400 for text, 404 for a missing number)', async () => {
		expect((await request(app).get('/public/equipos/%41')).body.error.code).toBe('VALIDATION_ERROR');
		expect((await request(app).get('/public/equipos/%39%39%39')).status).toBe(404);
	});
});

/**
 * Only the router's own decoding failure is recognized. Any other URIError
 * (or one that merely resembles it) is still an unexpected 500, logged.
 */
describe('other URIErrors are not client errors', () => {
	let consoleError: MockInstance<typeof console.error>;

	beforeAll(() => {
		consoleError = vi.spyOn(console, 'error');
	});

	afterAll(() => {
		consoleError.mockRestore();
	});

	it.each([
		['a URIError from application code', () => decodeURIComponent('%')],
		['a URIError with status 400 but another message', () => {
			throw Object.assign(new URIError('URI malformed'), { status: 400 });
		}],
		['the router message without status 400', () => {
			throw new URIError("Failed to decode param '%zz'");
		}],
		['the router message on a plain Error', () => {
			throw Object.assign(new Error("Failed to decode param '%zz'"), { status: 400 });
		}],
	])('%s -> 500 INTERNAL_ERROR, logged', async (_label, fail) => {
		consoleError.mockClear().mockImplementation(() => {});
		const app = express();
		app.get('/boom', () => {
			fail();
		});
		app.use(errorHandler);

		const res = await request(app).get('/boom');

		expect(res.status).toBe(500);
		expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' } });
		expect(consoleError).toHaveBeenCalledOnce();
	});
});
