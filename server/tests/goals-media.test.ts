import { randomBytes } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transactionStats } from '../src/db/transaction.js';
import type { AdminActionOutcome } from '../src/services/admin-action.js';
import { createGoal, deleteGoal, type MediaDeps, setGoalImage, updateGoal } from '../src/services/goals.service.js';
import { addMatchImage, MAX_IMAGENES_PARTIDO, MAX_VIDEOS_PARTIDO } from '../src/services/match-media.service.js';
import { createMediaStore } from '../src/services/media-storage.js';
import { createTestApp, env, testUploadsDir } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);
const solid = (width: number, height: number, background = '#1a6') => sharp({ create: { width, height, channels: 3, background } });
const YOUTUBE = 'https://youtu.be/dQw4w9WgXcQ';
const YOUTUBE_CANONICAL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

type Session = Awaited<ReturnType<typeof signedInUser>>;

describe('goals and media (T-13: BR-033, BR-001)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	const s = {} as {
		comp: number;
		otherComp: number;
		team: Record<'A' | 'B' | 'X', number>;
		player: Record<'ana' | 'bea' | 'carl' | 'dan' | 'eva', number>;
	};
	const deps = (): MediaDeps => ({ store: createMediaStore(testUploadsDir), maxPixels: env.uploads.maxPixels });
	const files = () => (existsSync(testUploadsDir) ? readdirSync(testUploadsDir).sort() : []);
	const code = (res: { body: { error?: { code: string } } }) => res.body.error?.code;

	/** A match of A vs B that started two hours ago (its time is over), with the score given. */
	async function match(estado: 'programado' | 'en_curso' | 'finalizado' | 'cancelado' = 'en_curso', score?: [number, number], fecha?: Date) {
		const when = fecha ?? new Date(Date.now() + (estado === 'programado' ? 3 * DAY : -2 * HOUR));
		const id = await insertMatch(pool, s.comp, s.team.A, s.team.B, estado, wholeSeconds(when.getTime()));
		if (score) await pool.query('UPDATE partido_equipo SET goles = IF(es_visita, ?, ?) WHERE partido_id = ?', [score[1], score[0], id]);
		return id;
	}
	const goal = (matchId: number, body: unknown) => api.post(`/partidos/${matchId}/goles`, body);
	const upload = (method: 'put' | 'post', path: string, content: Buffer, opts: { field?: string; filename?: string; type?: string; who?: Session } = {}) => {
		const who = opts.who ?? (api.admin as Session);
		return request(app)
			[method](`/admin${path}`)
			.set('Cookie', who.cookie)
			.set('X-CSRF-Token', who.csrfToken)
			.attach(opts.field ?? 'imagen', content, { filename: opts.filename ?? 'foto.jpg', contentType: opts.type ?? 'image/jpeg' });
	};
	const jpeg = () => solid(64, 48).jpeg().toBuffer();
	const confirm = async (matchId: number, score: [number, number]) =>
		api.post(`/partidos/${matchId}/resultado/confirmar`, { confirmar: true, golesLocal: score[0], golesVisitante: score[1] });

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		rmSync(testUploadsDir, { recursive: true, force: true });
		api = await adminApi(app, pool);
		const post = (path: string, body: unknown) => created<{ id: number }>(api.post(path, body));
		const sport = (await post('/deportes', { nombre: 'Fútbol', permiteEmpate: true })).id;
		s.comp = (await post('/competiciones', { deporteId: sport, nombre: 'Liga' })).id;
		s.otherComp = (await post('/competiciones', { deporteId: sport, nombre: 'Copa' })).id;
		s.team = {
			A: (await post('/equipos', teamBody(s.comp, { nombre: 'Alianza' }))).id,
			B: (await post('/equipos', teamBody(s.comp, { nombre: 'Boca' }))).id,
			X: (await post('/equipos', teamBody(s.otherComp, { nombre: 'Xolos' }))).id,
		};
		const player = async (nombre: string, equipoId: number | null, numero: number) => {
			const id = (await post('/jugadores', { nombre })).id;
			if (equipoId) await post('/planteles', { jugadorId: id, equipoId, numeroCamiseta: numero });
			return id;
		};
		s.player = {
			ana: await player('Ana', s.team.A, 9),
			eva: await player('Eva', s.team.A, 10),
			bea: await player('Bea', s.team.B, 9),
			carl: await player('Carl', s.team.X, 9),
			dan: await player('Dan', null, 0),
		};
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
		rmSync(testUploadsDir, { recursive: true, force: true });
	});

	describe('goals (BR-033)', () => {
		it('registers goals with scorer, team and minute; never more than the side has in the score', async () => {
			const id = await match('en_curso');
			// No score yet: nothing can be attributed.
			expect(code(await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 }))).toBe('GOALS_EXCEED_SCORE');

			await api.put(`/partidos/${id}/resultado`, { golesLocal: 2, golesVisitante: 1 });
			const first = await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 });
			expect(first.status).toBe(201);
			expect(first.body.data).toEqual({
				id: expect.any(Number),
				partidoId: id,
				minuto: 5,
				equipoId: s.team.A,
				lado: 'local',
				plantelId: expect.any(Number),
				jugador: { id: s.player.ana, nombre: 'Ana' },
				imagen: null,
				video: null,
			});
			expect((await goal(id, { jugadorId: s.player.eva, equipoId: s.team.A, minuto: 30 })).status).toBe(201);
			const third = await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 50 });
			expect(third.status).toBe(409);
			expect(third.body.error).toMatchObject({ code: 'GOALS_EXCEED_SCORE', details: { equipoId: s.team.A, golesMarcador: 2, golesAtribuidos: 2 } });
			expect((await goal(id, { jugadorId: s.player.bea, equipoId: s.team.B, minuto: 60 })).body.data).toMatchObject({ lado: 'visita' });
			expect(code(await goal(id, { jugadorId: s.player.bea, equipoId: s.team.B, minuto: 61 }))).toBe('GOALS_EXCEED_SCORE');

			const list = await api.get(`/partidos/${id}/goles`);
			expect(list.body.data.map((g: { minuto: number; jugador: { nombre: string } }) => `${g.minuto} ${g.jugador.nombre}`)).toEqual(['5 Ana', '30 Eva', '60 Bea']);
		});

		it.each([
			['a player of the other team, for this team', 'bea', 'A', 'PLAYER_NOT_IN_TEAM'],
			['a player not enrolled anywhere', 'dan', 'A', 'PLAYER_NOT_IN_TEAM'],
			['a player of another competition, for this team', 'carl', 'A', 'PLAYER_NOT_IN_TEAM'],
			['a team that does not play this match', 'carl', 'X', 'TEAM_NOT_IN_MATCH'],
		] as const)('refuses %s', async (_label, player, team, errorCode) => {
			const id = await match('en_curso', [3, 3]);
			const res = await goal(id, { jugadorId: s.player[player], equipoId: s.team[team], minuto: 10 });
			expect(res.status).toBe(409);
			expect(code(res)).toBe(errorCode);
			expect((await api.get(`/partidos/${id}/goles`)).body.data).toEqual([]);
		});

		it.each([
			['minute 0', { minuto: 0 }],
			['minute 121', { minuto: 121 }],
			['a fractional minute', { minuto: 1.5 }],
			['a minute as text', { minuto: '5' }],
			['no minute', { minuto: undefined }],
			['an extra key', { imagen: 'x.webp' }],
			['a text player id', { jugadorId: '1' }],
		])('400 for %s', async (_label, patch) => {
			const id = await match('en_curso', [3, 3]);
			const res = await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5, ...patch });
			expect(res.status).toBe(400);
			expect(code(res)).toBe('VALIDATION_ERROR');
		});

		it('minutes 1 and 120 are the limits', async () => {
			const id = await match('en_curso', [2, 0]);
			expect((await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 1 })).status).toBe(201);
			expect((await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 120 })).status).toBe(201);
		});

		it('edits the minute, the scorer and the team, with the same checks', async () => {
			const id = await match('en_curso', [1, 1]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;
			await goal(id, { jugadorId: s.player.bea, equipoId: s.team.B, minuto: 20 });

			expect((await api.patch(`/partidos/${id}/goles/${g.id}`, { minuto: 44 })).body.data).toMatchObject({ minuto: 44, jugador: { id: s.player.ana } });
			expect((await api.patch(`/partidos/${id}/goles/${g.id}`, { jugadorId: s.player.eva })).body.data).toMatchObject({ jugador: { id: s.player.eva } });
			// The team keeps the player: moving the goal to B without a B player is refused.
			expect(code(await api.patch(`/partidos/${id}/goles/${g.id}`, { equipoId: s.team.B }))).toBe('PLAYER_NOT_IN_TEAM');
			// B already has its only goal.
			expect(code(await api.patch(`/partidos/${id}/goles/${g.id}`, { equipoId: s.team.B, jugadorId: s.player.bea }))).toBe('GOALS_EXCEED_SCORE');
			await api.put(`/partidos/${id}/resultado`, { golesLocal: 1, golesVisitante: 2 });
			const moved = await api.patch(`/partidos/${id}/goles/${g.id}`, { equipoId: s.team.B, jugadorId: s.player.bea });
			expect(moved.status).toBe(200);
			expect(moved.body.data).toMatchObject({ equipoId: s.team.B, lado: 'visita', jugador: { id: s.player.bea } });
			expect((await api.patch(`/partidos/${id}/goles/${g.id}`, {})).status).toBe(400);
		});

		it('deletes a goal; a missing one or another match\'s is 404', async () => {
			const id = await match('en_curso', [1, 0]);
			const other = await match('en_curso', [1, 0]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;

			expect(code(await api.del(`/partidos/${other}/goles/${g.id}`))).toBe('GOAL_NOT_FOUND');
			expect(code(await api.patch(`/partidos/${other}/goles/${g.id}`, { minuto: 2 }))).toBe('GOAL_NOT_FOUND');
			const res = await api.del(`/partidos/${id}/goles/${g.id}`);
			expect(res.status).toBe(200);
			expect(res.body.data).toEqual({ id: g.id });
			expect(code(await api.del(`/partidos/${id}/goles/${g.id}`))).toBe('GOAL_NOT_FOUND');
		});

		it('the score cannot be corrected below the goals already attributed (409 SCORE_BELOW_GOALS)', async () => {
			const id = await match('en_curso', [2, 0]);
			await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 });
			await goal(id, { jugadorId: s.player.eva, equipoId: s.team.A, minuto: 7 });

			const res = await api.put(`/partidos/${id}/resultado`, { golesLocal: 1, golesVisitante: 0 });
			expect(res.status).toBe(409);
			expect(res.body.error).toMatchObject({ code: 'SCORE_BELOW_GOALS', details: { golesAtribuidos: { local: 2, visita: 0 } } });
			expect((await api.put(`/partidos/${id}/resultado`, { golesLocal: 2, golesVisitante: 3 })).status).toBe(200);
		});

		it('the preview warns about goals without a scorer, without blocking', async () => {
			const id = await match('en_curso', [2, 1]);
			await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 });
			const view = (await api.get(`/partidos/${id}/resultado`)).body.data;
			expect(view).toMatchObject({ puedeConfirmar: true, avisos: [{ code: 'GOALS_UNATTRIBUTED', message: expect.stringContaining('2 gol') }] });
			await goal(id, { jugadorId: s.player.eva, equipoId: s.team.A, minuto: 6 });
			await goal(id, { jugadorId: s.player.bea, equipoId: s.team.B, minuto: 7 });
			expect((await api.get(`/partidos/${id}/resultado`)).body.data.avisos).toEqual([]);
		});

		it('only between the kick-off and the confirmation; then locked like the score (BR-032)', async () => {
			const future = await match('programado', [1, 0]);
			expect(code(await goal(future, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 }))).toBe('RESULT_NOT_ALLOWED_YET');
			const cancelled = await match('cancelado', [1, 0]);
			expect(code(await goal(cancelled, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 }))).toBe('MATCH_LOCKED');
			// Old data from the removed state route: stored en_curso, but the kick-off is still ahead.
			const storedStarted = await match('en_curso', [1, 0], new Date(Date.now() + DAY));
			expect(code(await goal(storedStarted, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 }))).toBe('RESULT_NOT_ALLOWED_YET');
			expect(code(await api.post(`/partidos/${storedStarted}/multimedia/videos`, { url: YOUTUBE }))).toBe('MATCH_NOT_STARTED');

			// Kick-off came but the stored state still says programado: goals are allowed.
			const kickedOff = await match('programado', [1, 0], new Date(Date.now() - 1000));
			expect((await goal(kickedOff, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 1 })).status).toBe(201);

			const id = await match('en_curso', [1, 0]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;
			expect((await confirm(id, [1, 0])).status).toBe(200);
			expect(code(await goal(id, { jugadorId: s.player.eva, equipoId: s.team.A, minuto: 6 }))).toBe('RESULT_ALREADY_CONFIRMED');
			expect(code(await api.patch(`/partidos/${id}/goles/${g.id}`, { minuto: 9 }))).toBe('RESULT_ALREADY_CONFIRMED');
			expect(code(await api.del(`/partidos/${id}/goles/${g.id}`))).toBe('RESULT_ALREADY_CONFIRMED');
			expect((await api.get(`/partidos/${id}/goles`)).body.data).toMatchObject([{ id: g.id, minuto: 5 }]);
		});

		it('goals at once: never more than the score', async () => {
			const id = await match('en_curso', [3, 0]);
			const results = await Promise.all(
				Array.from({ length: 8 }, (_, i) => goal(id, { jugadorId: i % 2 ? s.player.ana : s.player.eva, equipoId: s.team.A, minuto: i + 1 })),
			);
			expect(results.filter((r) => r.status === 201)).toHaveLength(3);
			expect(results.filter((r) => r.status === 409).every((r) => code(r) === 'GOALS_EXCEED_SCORE')).toBe(true);
			expect((await api.get(`/partidos/${id}/goles`)).body.data).toHaveLength(3);
		});

		it('every write goes through the audit hook', async () => {
			const id = await match('en_curso', [2, 0]);
			const seen: AdminActionOutcome[] = [];
			const ctx = { actorId: api.admin.user.id, hooks: { inTransaction: async (_c: unknown, o: AdminActionOutcome) => void seen.push(o) } };
			const g = await createGoal(pool, ctx, id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 3 }, deps());
			await updateGoal(pool, ctx, id, g.id, { minuto: 4 }, deps());
			await setGoalImage(pool, ctx, id, g.id, await jpeg(), deps());
			await deleteGoal(pool, ctx, id, g.id, deps());
			expect(seen.map((o) => o.action)).toEqual(['crear_gol', 'editar_gol', 'editar_gol', 'borrar_gol']);
			expect(seen.every((o) => o.id === g.id)).toBe(true);
		});
	});

	describe('images', () => {
		it.each([
			['JPEG', () => solid(300, 200).jpeg().toBuffer(), 'image/jpeg'],
			['PNG', () => solid(300, 200).png().toBuffer(), 'image/png'],
			['WebP', () => solid(300, 200).webp().toBuffer(), 'image/webp'],
			['GIF', () => solid(300, 200).gif().toBuffer(), 'image/gif'],
		])('a goal image in %s is stored as a fresh WebP', async (_label, make, type) => {
			const id = await match('en_curso', [1, 0]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;
			const res = await upload('put', `/partidos/${id}/goles/${g.id}/imagen`, await make(), { type });
			expect(res.status).toBe(200);
			const name = res.body.data.imagen.replace('/admin/archivos/', '');
			expect(name).toMatch(/^[0-9a-f]{32}\.webp$/);
			expect(files()).toContain(name);
			expect(await sharp(readFileSync(join(testUploadsDir, name))).metadata()).toMatchObject({ format: 'webp', width: 300, height: 200 });
		});

		it('drops EXIF and GPS data, and shrinks big photos', async () => {
			const id = await match('en_curso');
			const photo = await solid(2400, 1800).jpeg().withExif({ IFD0: { Copyright: 'Ubicacion secreta -12.0464,-77.0428' } }).toBuffer();
			const res = await upload('post', `/partidos/${id}/multimedia/imagenes`, photo);
			expect(res.status).toBe(201);
			const stored = readFileSync(join(testUploadsDir, res.body.data.url.replace('/admin/archivos/', '')));
			const meta = await sharp(stored).metadata();
			expect(meta).toMatchObject({ format: 'webp', width: 1600, height: 1200 });
			expect(meta.exif).toBeUndefined();
			expect(stored.toString('latin1')).not.toContain('Ubicacion secreta');
		});

		it.each([
			['an empty file', () => Buffer.alloc(0), 'image/jpeg', 'foto.jpg'],
			['text with a .jpg name and an image type', () => Buffer.from('no soy una imagen'), 'image/jpeg', 'foto.jpg'],
			['an SVG', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/svg+xml', 'x.svg'],
			['an SVG disguised as PNG', () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), 'image/png', 'x.png'],
			['HTML', () => Buffer.from('<html><script>alert(1)</script></html>'), 'text/html', 'x.html'],
			['a cut JPEG', async () => (await solid(300, 300).jpeg().toBuffer()).subarray(0, 100), 'image/jpeg', 'x.jpg'],
			['a GIF/HTML polyglot', () => Buffer.from('GIF89a<script>alert(1)</script>'), 'image/gif', 'x.gif'],
			['a BMP', () => Buffer.concat([Buffer.from('BM'), Buffer.alloc(100)]), 'image/bmp', 'x.bmp'],
		])('rejects %s with 400 IMAGE_INVALID and writes no file', async (_label, make, type, filename) => {
			const id = await match('en_curso');
			const before = files();
			const res = await upload('post', `/partidos/${id}/multimedia/imagenes`, await make(), { type, filename });
			expect(res.status).toBe(400);
			expect(code(res)).toBe('IMAGE_INVALID');
			expect(files()).toEqual(before);
		});

		it('size and pixel limits: 413 over UPLOAD_MAX_BYTES, 400 over UPLOAD_MAX_PIXELS', async () => {
			const small = createTestApp({ uploads: { ...env.uploads, dir: testUploadsDir, maxBytes: 20_000, maxPixels: 250_000 } });
			try {
				const admin = await adminApi(small.app, small.pool);
				const id = await match('en_curso');
				const send = (content: Buffer) =>
					request(small.app)
						.post(`/admin/partidos/${id}/multimedia/imagenes`)
						.set('Cookie', admin.admin.cookie)
						.set('X-CSRF-Token', admin.admin.csrfToken)
						.attach('imagen', content, { filename: 'x.png', contentType: 'image/png' });
				const before = files();
				const noisy = await sharp(randomBytes(300 * 300 * 3), {
					raw: { width: 300, height: 300, channels: 3 },
				})
					.png()
					.toBuffer();
				expect(noisy.length).toBeGreaterThan(20_000);
				const big = await send(noisy);
				expect(big.status).toBe(413);
				expect(code(big)).toBe('PAYLOAD_TOO_LARGE');
				const bomb = await send(await solid(2000, 2000).png({ compressionLevel: 9 }).toBuffer());
				expect(bomb.status).toBe(400);
				expect(bomb.body.error).toMatchObject({ code: 'IMAGE_INVALID', message: expect.stringContaining('píxeles') });
				expect((await send(await solid(400, 400).png().toBuffer())).status).toBe(201);
				expect(files().length).toBe(before.length + 1);
			} finally {
				await small.pool.end();
			}
		});

		it.each([
			['another field name', (r: request.Test) => r.attach('foto', Buffer.from('x'), 'x.jpg')],
			['two files', (r: request.Test) => r.attach('imagen', Buffer.from('x'), 'a.jpg').attach('imagen', Buffer.from('y'), 'b.jpg')],
			['a file and a text field', (r: request.Test) => r.field('nombre', 'x').attach('imagen', Buffer.from('x'), 'a.jpg')],
			['only a text field', (r: request.Test) => r.field('imagen', 'x')],
		])('400 UPLOAD_INVALID for %s', async (_label, build) => {
			const id = await match('en_curso');
			const res = await build(
				request(app).post(`/admin/partidos/${id}/multimedia/imagenes`).set('Cookie', api.admin.cookie).set('X-CSRF-Token', api.admin.csrfToken),
			);
			expect(res.status).toBe(400);
			expect(code(res)).toBe('UPLOAD_INVALID');
		});

		it('415 for a JSON or raw body; 400 for a malformed multipart body', async () => {
			const id = await match('en_curso');
			expect((await api.post(`/partidos/${id}/multimedia/imagenes`, { imagen: 'base64' })).status).toBe(415);
			const raw = await request(app)
				.post(`/admin/partidos/${id}/multimedia/imagenes`)
				.set('Cookie', api.admin.cookie)
				.set('X-CSRF-Token', api.admin.csrfToken)
				.set('Content-Type', 'image/jpeg')
				.send(await jpeg());
			expect(raw.status).toBe(415);
			const broken = await request(app)
				.post(`/admin/partidos/${id}/multimedia/imagenes`)
				.set('Cookie', api.admin.cookie)
				.set('X-CSRF-Token', api.admin.csrfToken)
				.set('Content-Type', 'multipart/form-data; boundary=XYZ')
				.send('--XYZ\r\nContent-Disposition: form-data; name="imagen"; filename="a.jpg"\r\n\r\nsin cierre');
			expect(broken.status).toBe(400);
			expect(code(broken)).toBe('UPLOAD_INVALID');
		});

		it('replacing, removing and deleting clean up the old files', async () => {
			const id = await match('en_curso', [1, 0]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;
			const first = (await upload('put', `/partidos/${id}/goles/${g.id}/imagen`, await jpeg())).body.data.imagen.split('/').pop();
			const second = (await upload('put', `/partidos/${id}/goles/${g.id}/imagen`, await solid(10, 10).png().toBuffer(), { type: 'image/png' }))
				.body.data.imagen.split('/').pop();
			expect(files()).not.toContain(first);
			expect(files()).toContain(second);

			const removed = await api.del(`/partidos/${id}/goles/${g.id}/imagen`);
			expect(removed.body.data.imagen).toBeNull();
			expect(files()).not.toContain(second);
			expect(code(await api.del(`/partidos/${id}/goles/${g.id}/imagen`))).toBe('MEDIA_NOT_FOUND');

			const third = (await upload('put', `/partidos/${id}/goles/${g.id}/imagen`, await jpeg())).body.data.imagen.split('/').pop();
			expect((await api.del(`/partidos/${id}/goles/${g.id}`)).status).toBe(200);
			expect(files()).not.toContain(third);

			const item = (await upload('post', `/partidos/${id}/multimedia/imagenes`, await jpeg())).body.data;
			const itemFile = item.url.split('/').pop();
			expect(files()).toContain(itemFile);
			expect((await api.del(`/partidos/${id}/multimedia/${item.id}`)).status).toBe(200);
			expect(files()).not.toContain(itemFile);
			expect(code(await api.del(`/partidos/${id}/multimedia/${item.id}`))).toBe('MEDIA_NOT_FOUND');
		});

		it('a refused write leaves no orphan file (unknown goal, cancelled match, full match, failing transaction)', async () => {
			const cancelled = await match('cancelado');
			const id = await match('en_curso');
			const before = files();

			expect(code(await upload('put', `/partidos/${id}/goles/999999999/imagen`, await jpeg()))).toBe('GOAL_NOT_FOUND');
			expect(code(await upload('post', `/partidos/${cancelled}/multimedia/imagenes`, await jpeg()))).toBe('MATCH_LOCKED');
			for (let i = 0; i < MAX_IMAGENES_PARTIDO; i++) {
				await pool.query('INSERT INTO multimedia_partido (partido_id, imagen, creado_en) VALUES (?, ?, UTC_TIMESTAMP())', [
					id,
					`${String(i).padStart(4, '0')}${'e'.repeat(28)}.webp`,
				]);
			}
			const full = await upload('post', `/partidos/${id}/multimedia/imagenes`, await jpeg());
			expect(full.body.error).toMatchObject({ code: 'MEDIA_LIMIT_REACHED', details: { maximo: MAX_IMAGENES_PARTIDO } });

			// The transaction fails after the file was written (here, in the audit hook).
			const other = await match('en_curso');
			const failing = { actorId: api.admin.user.id, hooks: { inTransaction: async () => Promise.reject(new Error('falla la auditoría')) } };
			await expect(addMatchImage(pool, failing, other, await jpeg(), deps())).rejects.toThrow('falla la auditoría');
			expect(files()).toEqual(before);
		});

		it('a deadlock retry does not write the file twice', async () => {
			const id = await match('en_curso');
			const before = files();
			const retriesBefore = transactionStats.deadlockRetries;
			let calls = 0;
			const flaky = {
				actorId: api.admin.user.id,
				hooks: {
					inTransaction: async () => {
						calls++;
						if (calls === 1) throw Object.assign(new Error('deadlock simulado'), { errno: 1213, sqlState: '40001' });
					},
				},
			};
			const item = await addMatchImage(pool, flaky, id, await jpeg(), deps());
			expect(calls).toBe(2);
			expect(transactionStats.deadlockRetries).toBe(retriesBefore + 1);
			const added = files().filter((f) => !before.includes(f));
			expect(added).toEqual([(item as { url: string }).url.split('/').pop()]);
		});
	});

	describe('serving the files', () => {
		it('admin: any match, with safe headers; public: only once the result is official', async () => {
			const id = await match('en_curso', [1, 0]);
			const item = (await upload('post', `/partidos/${id}/multimedia/imagenes`, await jpeg())).body.data;
			const name = item.url.split('/').pop();

			const admin = await request(app).get(`/admin/archivos/${name}`).set('Cookie', api.admin.cookie);
			expect(admin.status).toBe(200);
			expect(admin.headers).toMatchObject({
				'content-type': 'image/webp',
				'x-content-type-options': 'nosniff',
				'cache-control': 'private, no-store',
				'cross-origin-resource-policy': 'cross-origin',
				'content-disposition': 'inline',
			});
			expect(admin.headers['content-security-policy']).toContain('sandbox');
			expect(Buffer.compare(admin.body as Buffer, readFileSync(join(testUploadsDir, name)))).toBe(0);

			const early = await request(app).get(`/public/archivos/${name}`);
			expect(early.status).toBe(404);
			expect(code(early)).toBe('FILE_NOT_FOUND');
			expect(early.headers['cache-control']).toBe('no-store');

			expect((await confirm(id, [1, 0])).status).toBe(200);
			const pub = await request(app).get(`/public/archivos/${name}`);
			expect(pub.status).toBe(200);
			expect(pub.headers).toMatchObject({ 'content-type': 'image/webp', 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' });
		});

		it.each([
			'../../etc/passwd',
			'..%2F..%2Fetc%2Fpasswd',
			'%2e%2e',
			`${'A'.repeat(32)}.webp`,
			`${'a'.repeat(32)}.png`,
			`${'a'.repeat(31)}.webp`,
			'.env',
			'',
		])('never serves %j', async (name) => {
			for (const scope of ['admin', 'public']) {
				const res = await request(app).get(`/${scope}/archivos/${name}`).set('Cookie', api.admin.cookie);
				expect([400, 404], `${scope}/${name}`).toContain(res.status);
				expect(res.headers['content-type'] ?? '').not.toContain('image');
			}
		});

		it('a valid name that no row points at, or whose file is gone, is 404; a query string is 400', async () => {
			expect((await request(app).get(`/admin/archivos/${'f'.repeat(32)}.webp`).set('Cookie', api.admin.cookie)).status).toBe(404);
			const id = await match('en_curso');
			const lost = `${'d'.repeat(32)}.webp`;
			await pool.query('INSERT INTO multimedia_partido (partido_id, imagen, creado_en) VALUES (?, ?, UTC_TIMESTAMP())', [id, lost]);
			const res = await request(app).get(`/admin/archivos/${lost}`).set('Cookie', api.admin.cookie);
			expect(res.status).toBe(404);
			expect(code(res)).toBe('FILE_NOT_FOUND');
			expect((await request(app).get(`/public/archivos/${lost}?x=1`)).status).toBe(400);
		});
	});

	describe('videos', () => {
		it('a goal video: normalized, replaced, removed', async () => {
			const id = await match('en_curso', [1, 0]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;
			const res = await api.put(`/partidos/${id}/goles/${g.id}/video`, { url: YOUTUBE });
			expect(res.body.data.video).toEqual({
				plataforma: 'youtube',
				id: 'dQw4w9WgXcQ',
				url: YOUTUBE_CANONICAL,
				embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
			});
			const [[row]] = await pool.query<RowDataPacket[]>('SELECT video FROM gol WHERE id = ?', [g.id]);
			expect(row!.video).toBe(YOUTUBE_CANONICAL);
			expect((await api.put(`/partidos/${id}/goles/${g.id}/video`, { url: 'https://vimeo.com/76979871' })).body.data.video.plataforma).toBe('vimeo');
			expect((await api.del(`/partidos/${id}/goles/${g.id}/video`)).body.data.video).toBeNull();
			expect(code(await api.del(`/partidos/${id}/goles/${g.id}/video`))).toBe('MEDIA_NOT_FOUND');
		});

		it.each([
			'http://youtu.be/dQw4w9WgXcQ',
			'https://www.youtube.com.evil.com/watch?v=dQw4w9WgXcQ',
			'https://example.com/gol.mp4',
			'javascript:alert(1)',
			'https://www.youtube.com/playlist?list=PL1',
		])('400 for %s, and nothing is stored', async (url) => {
			const id = await match('en_curso', [1, 0]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;
			for (const res of [await api.put(`/partidos/${id}/goles/${g.id}/video`, { url }), await api.post(`/partidos/${id}/multimedia/videos`, { url })]) {
				expect(res.status).toBe(400);
				expect(res.body.error.details[0].message).toMatch(/YouTube.*Vimeo/);
			}
			expect((await api.get(`/partidos/${id}/multimedia`)).body.data.videos).toEqual([]);
		});

		it('match videos: no duplicates, at most the limit', async () => {
			const id = await match('en_curso');
			const add = (url: string) => api.post(`/partidos/${id}/multimedia/videos`, { url });
			expect((await add(YOUTUBE)).status).toBe(201);
			// The same video in another form is the same video.
			expect(code(await add(YOUTUBE_CANONICAL))).toBe('VIDEO_ALREADY_ADDED');
			for (let i = 1; i < MAX_VIDEOS_PARTIDO; i++) expect((await add(`https://vimeo.com/${1000 + i}`)).status).toBe(201);
			expect(code(await add('https://vimeo.com/999999'))).toBe('MEDIA_LIMIT_REACHED');
			const list = (await api.get(`/partidos/${id}/multimedia`)).body.data;
			expect(list.videos).toHaveLength(MAX_VIDEOS_PARTIDO);
			expect(list.videos[0]).toMatchObject({ tipo: 'video', video: { url: YOUTUBE_CANONICAL } });
		});
	});

	describe('media and the match state (BR-032)', () => {
		it('allowed after confirming the result (it changes neither result nor points); not before the kick-off; not when cancelled', async () => {
			const future = await match('programado');
			expect(code(await api.post(`/partidos/${future}/multimedia/videos`, { url: YOUTUBE }))).toBe('MATCH_NOT_STARTED');
			expect(code(await upload('post', `/partidos/${future}/multimedia/imagenes`, await jpeg()))).toBe('MATCH_NOT_STARTED');
			const cancelled = await match('cancelado');
			expect(code(await api.post(`/partidos/${cancelled}/multimedia/videos`, { url: YOUTUBE }))).toBe('MATCH_LOCKED');

			const id = await match('en_curso', [1, 0]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;
			expect((await confirm(id, [1, 0])).status).toBe(200);
			expect((await upload('put', `/partidos/${id}/goles/${g.id}/imagen`, await jpeg())).status).toBe(200);
			expect((await api.put(`/partidos/${id}/goles/${g.id}/video`, { url: YOUTUBE })).status).toBe(200);
			const image = await upload('post', `/partidos/${id}/multimedia/imagenes`, await jpeg());
			expect(image.status).toBe(201);
			expect((await api.del(`/partidos/${id}/multimedia/${image.body.data.id}`)).status).toBe(200);
			// The result and the goal itself stay locked.
			expect(code(await api.patch(`/partidos/${id}/goles/${g.id}`, { minuto: 7 }))).toBe('RESULT_ALREADY_CONFIRMED');
		});
	});

	describe('public API (BR-049)', () => {
		it('a match in progress shows no goals and no media; once official, both', async () => {
			const id = await match('en_curso', [1, 0]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;
			const goalImage = (await upload('put', `/partidos/${id}/goles/${g.id}/imagen`, await jpeg())).body.data.imagen.split('/').pop();
			await api.put(`/partidos/${id}/goles/${g.id}/video`, { url: YOUTUBE });
			const matchImage = (await upload('post', `/partidos/${id}/multimedia/imagenes`, await jpeg())).body.data.url.split('/').pop();
			await api.post(`/partidos/${id}/multimedia/videos`, { url: 'https://vimeo.com/76979871' });

			const during = await request(app).get(`/public/partidos/${id}`);
			expect(during.body.data).toMatchObject({ estado: 'en_curso', goles: null, multimedia: null });
			const text = JSON.stringify(during.body);
			for (const secret of [goalImage, matchImage, 'dQw4w9WgXcQ', '76979871', 'Ana']) expect(text).not.toContain(secret);
			expect((await request(app).get(`/public/archivos/${goalImage}`)).status).toBe(404);

			await confirm(id, [1, 0]);
			const after = (await request(app).get(`/public/partidos/${id}`)).body.data;
			expect(after.goles).toEqual([
				{
					id: g.id,
					minuto: 5,
					equipoId: s.team.A,
					jugador: { id: s.player.ana, nombre: 'Ana', foto: null },
					imagen: `/public/archivos/${goalImage}`,
					video: expect.objectContaining({ plataforma: 'youtube', url: YOUTUBE_CANONICAL }),
				},
			]);
			expect(after.multimedia).toMatchObject({
				imagenes: [{ url: `/public/archivos/${matchImage}` }],
				videos: [{ video: { plataforma: 'vimeo', id: '76979871' } }],
			});
			expect((await request(app).get(`/public/archivos/${goalImage}`)).status).toBe(200);
			expect((await request(app).get(`/public/archivos/${matchImage}`)).status).toBe(200);
		});
	});

	describe('access (NFR-005)', () => {
		it('401 without a session, 403 for a bettor, CSRF on every write', async () => {
			const id = await match('en_curso', [1, 0]);
			const g = (await goal(id, { jugadorId: s.player.ana, equipoId: s.team.A, minuto: 5 })).body.data;
			const bettor = await signedInUser(app, pool, { estado: 'validado' });
			const image = await jpeg();
			const writes: Array<(r: ReturnType<typeof request>) => request.Test> = [
				(r) => r.post(`/admin/partidos/${id}/goles`).send({ jugadorId: s.player.ana, equipoId: s.team.A, minuto: 1 }),
				(r) => r.patch(`/admin/partidos/${id}/goles/${g.id}`).send({ minuto: 1 }),
				(r) => r.delete(`/admin/partidos/${id}/goles/${g.id}`),
				(r) => r.put(`/admin/partidos/${id}/goles/${g.id}/imagen`).attach('imagen', image, 'a.jpg'),
				(r) => r.put(`/admin/partidos/${id}/goles/${g.id}/video`).send({ url: YOUTUBE }),
				(r) => r.post(`/admin/partidos/${id}/multimedia/imagenes`).attach('imagen', image, 'a.jpg'),
				(r) => r.post(`/admin/partidos/${id}/multimedia/videos`).send({ url: YOUTUBE }),
				(r) => r.delete(`/admin/partidos/${id}/multimedia/1`),
			];
			const before = files();
			for (const write of writes) {
				expect((await write(request(app))).status).toBe(401);
				expect((await write(request(app)).set('Cookie', bettor.cookie).set('X-CSRF-Token', bettor.csrfToken)).status).toBe(403);
				const noCsrf = await write(request(app)).set('Cookie', api.admin.cookie);
				expect(noCsrf.status).toBe(403);
				expect(code(noCsrf)).toBe('CSRF_FAILED');
			}
			for (const path of [`/admin/partidos/${id}/goles`, `/admin/partidos/${id}/multimedia`, `/admin/archivos/${'a'.repeat(32)}.webp`]) {
				expect((await request(app).get(path)).status).toBe(401);
				expect((await request(app).get(path).set('Cookie', bettor.cookie)).status).toBe(403);
			}
			expect(files()).toEqual(before);
			expect((await api.get(`/partidos/${id}/goles`)).body.data).toHaveLength(1);
		});

		it('uploads have their own rate limit (429, not cacheable)', async () => {
			const limited = createTestApp({ uploadRateLimit: { windowMs: 60_000, max: 1 } });
			try {
				const admin = await adminApi(limited.app, limited.pool);
				const id = await match('en_curso');
				const send = async () =>
					request(limited.app)
						.post(`/admin/partidos/${id}/multimedia/imagenes`)
						.set('Cookie', admin.admin.cookie)
						.set('X-CSRF-Token', admin.admin.csrfToken)
						.attach('imagen', await jpeg(), 'a.jpg');
				expect((await send()).status).toBe(201);
				const blocked = await send();
				expect(blocked.status).toBe(429);
				expect(blocked.headers['cache-control']).toBe('no-store');
				// Other admin routes still answer.
				expect((await admin.get(`/partidos/${id}/multimedia`)).status).toBe(200);
			} finally {
				await limited.pool.end();
			}
		});
	});
});
