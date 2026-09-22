import express, { type Express } from 'express';
import type { Pool } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi, type MockInstance } from 'vitest';
import { errorHandler } from '../src/middleware/error-handler.js';
import { createTestApp } from './helpers/app.js';

/**
 * Bad request bodies are client errors: express.json() rejects them before
 * any route, and they must come back as a 4xx in the standard envelope — not
 * as a logged 500. No route accepts a body yet, so the requests target an
 * unknown URL: the parser runs first either way.
 */
describe('request body errors', () => {
	let app: Express;
	let pool: Pool;
	let consoleError: MockInstance<typeof console.error>;

	const postJson = (body: string, contentType = 'application/json') =>
		request(app).post('/no-existe').set('Content-Type', contentType).send(body);

	beforeAll(() => {
		consoleError = vi.spyOn(console, 'error');
		({ app, pool } = createTestApp());
	});

	afterAll(async () => {
		consoleError.mockRestore();
		await pool.end();
	});

	it('malformed JSON -> 400 INVALID_JSON', async () => {
		const res = await postJson("{'a':");

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: { code: 'INVALID_JSON', message: expect.any(String) } });
	});

	it('body over 100kb -> 413 PAYLOAD_TOO_LARGE', async () => {
		const res = await postJson(JSON.stringify({ a: 'x'.repeat(150_000) }));

		expect(res.status).toBe(413);
		expect(res.body).toEqual({ error: { code: 'PAYLOAD_TOO_LARGE', message: expect.any(String) } });
	});

	it('unsupported charset -> 415 UNSUPPORTED_MEDIA_TYPE', async () => {
		const res = await postJson('{"a":1}', 'application/json; charset=iso-8859-1');

		expect(res.status).toBe(415);
		expect(res.body).toEqual({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: expect.any(String) } });
	});

	it('unsupported Content-Encoding -> 415 UNSUPPORTED_MEDIA_TYPE', async () => {
		const res = await request(app)
			.post('/no-existe')
			.set('Content-Type', 'application/json')
			.set('Content-Encoding', 'rot13')
			.send('{"a":1}');

		expect(res.status).toBe(415);
		expect(res.body).toEqual({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: expect.any(String) } });
	});

	// zlib raises these with status 400 and expose true, but no `type`.
	it.each(['gzip', 'br'])('corrupt %s body -> 400 BAD_REQUEST, not logged', async (encoding) => {
		consoleError.mockClear();
		const res = await request(app)
			.post('/no-existe')
			.set('Content-Type', 'application/json')
			.set('Content-Encoding', encoding)
			.send('{"a":1} esto no está comprimido');

		expect(res.status).toBe(400);
		expect(res.body).toEqual({ error: { code: 'BAD_REQUEST', message: expect.any(String) } });
		expect(JSON.stringify(res.body)).not.toMatch(/header|Decompression|Z_DATA_ERROR|zlib/i);
		expect(consoleError).not.toHaveBeenCalled();
	});

	it('is not logged as an unhandled error and leaks no parser detail', async () => {
		consoleError.mockClear();
		const res = await postJson('{bad');

		expect(consoleError).not.toHaveBeenCalled();
		expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|SyntaxError|stack|position/i);
	});
});

/**
 * Only an exposed 4xx counts as the client's fault. Uses a bare app with just
 * the error handler, so the error reaching it is exactly the one thrown.
 */
describe('errors carrying a status that are not client errors', () => {
	let consoleError: MockInstance<typeof console.error>;

	beforeAll(() => {
		consoleError = vi.spyOn(console, 'error');
	});

	afterAll(() => {
		consoleError.mockRestore();
	});

	it.each([
		{ status: 500, expose: false },
		{ status: 503, expose: true },
		{ status: 400, expose: false },
		{ status: 400 },
	])('%o -> 500 INTERNAL_ERROR, logged', async (props) => {
		consoleError.mockClear().mockImplementation(() => {});
		const app = express();
		app.get('/boom', () => {
			throw Object.assign(new Error('detalle interno secreto'), { type: 'entity.parse.failed' }, props);
		});
		app.use(errorHandler);

		const res = await request(app).get('/boom');

		expect(res.status).toBe(500);
		expect(res.body).toEqual({ error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor.' } });
		expect(JSON.stringify(res.body)).not.toMatch(/secreto/);
		expect(consoleError).toHaveBeenCalledOnce();
	});
});
