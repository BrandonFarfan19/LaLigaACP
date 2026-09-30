import https from 'node:https';
import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	FACEBOOK_LINK_MESSAGES,
	facebookEmbedUrl,
	MAX_FACEBOOK_URL_LENGTH,
	parseFacebookVideo,
	storedFacebookVideo,
} from '../src/lib/facebook-links.js';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

const PAGE_VIDEO = 'https://www.facebook.com/LigaACP/videos/1234567890123456/';
const embedOf = (url: string) => `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(url)}&show_text=false&width=560`;

describe('Facebook video links (C-14, lib/facebook-links.ts)', () => {
	it.each([
		['a page video', 'https://www.facebook.com/LigaACP/videos/1234567890123456/', PAGE_VIDEO],
		['without the trailing slash', 'https://www.facebook.com/LigaACP/videos/1234567890123456', PAGE_VIDEO],
		['from m.', 'https://m.facebook.com/LigaACP/videos/1234567890123456', PAGE_VIDEO],
		['from web., with tracking parameters and a fragment', 'https://web.facebook.com/LigaACP/videos/1234567890123456/?mibextid=abc&ref=share#x', PAGE_VIDEO],
		['a profile with dots', 'https://www.facebook.com/ana.perez.9/videos/987/', 'https://www.facebook.com/ana.perez.9/videos/987/'],
		['watch', 'https://www.facebook.com/watch/?v=555', 'https://www.facebook.com/watch/?v=555'],
		['watch without the slash, with other parameters', 'https://m.facebook.com/watch?v=555&t=10', 'https://www.facebook.com/watch/?v=555'],
		['watch live', 'https://www.facebook.com/watch/live/?v=777', 'https://www.facebook.com/watch/live/?v=777'],
		['a reel, played through /watch/?v= (C-14 fix, checked in Chrome)', 'https://www.facebook.com/reel/1057292977068142/', 'https://www.facebook.com/watch/?v=1057292977068142'],
		['a reel without the slash, from m., with the tracking parameter of a reels tab', 'https://m.facebook.com/reel/1057292977068142?s=fb_shorts_profile', 'https://www.facebook.com/watch/?v=1057292977068142'],
		['a reel on facebook.com without www', 'https://facebook.com/reel/42', 'https://www.facebook.com/watch/?v=42'],
		['facebook.com without www (C-14 fix)', 'https://facebook.com/LigaACP/videos/1234567890123456', PAGE_VIDEO],
		['facebook.com without www, watch', 'https://facebook.com/watch/?v=555', 'https://www.facebook.com/watch/?v=555'],
		['facebook.com without www, watch live', 'https://FACEBOOK.com/watch/live/?v=777&mibextid=x', 'https://www.facebook.com/watch/live/?v=777'],
		['an uppercase host and spaces around', '  https://WWW.FACEBOOK.COM/watch/live/?v=777  ', 'https://www.facebook.com/watch/live/?v=777'],
	])('accepts %s and normalizes it', (_label, raw, canonical) => {
		const parsed = parseFacebookVideo(raw);
		expect(parsed).toEqual({ ok: true, video: { id: expect.stringMatching(/^\d+$/), url: canonical, embedUrl: embedOf(canonical) } });
		// The canonical form parses to itself, and is what is stored.
		expect(storedFacebookVideo(canonical)).toEqual(parsed.ok ? parsed.video : null);
	});

	it('the embed URL is the video plugin with the canonical link encoded, and nothing else', () => {
		expect(facebookEmbedUrl(PAGE_VIDEO)).toBe(
			'https://www.facebook.com/plugins/video.php?href=https%3A%2F%2Fwww.facebook.com%2FLigaACP%2Fvideos%2F1234567890123456%2F&show_text=false&width=560',
		);
	});

	it.each([
		['fb.watch', 'https://fb.watch/abcDEF123/', 'short_link'],
		['fb.watch over http', 'http://fb.watch/abc/', 'short_link'],
		['http', 'http://www.facebook.com/watch/?v=555', 'not_https'],
		['another host', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'host'],
		['a look-alike host', 'https://www.facebook.com.evil.example/watch/?v=5', 'host'],
		['a facebook subdomain we do not accept', 'https://business.facebook.com/watch/?v=5', 'host'],
		['facebook.com as a prefix of another host', 'https://facebook.com.evil.com/watch/?v=5', 'host'],
		['a host ending in facebook.com', 'https://xfacebook.com/watch/?v=5', 'host'],
		['facebook.com as the user part (credentials: refused before the host)', 'https://facebook.com@evil.com/watch/?v=5', 'shape'],
		['a user on facebook.com', 'https://usuario@facebook.com/watch/?v=5', 'shape'],
		['credentials', 'https://user:pass@www.facebook.com/watch/?v=5', 'shape'],
		['a port', 'https://www.facebook.com:8443/watch/?v=5', 'shape'],
		['watch without v', 'https://www.facebook.com/watch/', 'shape'],
		['watch with two v', 'https://www.facebook.com/watch/?v=5&v=6', 'shape'],
		['watch with a non-numeric v', 'https://www.facebook.com/watch/?v=abc', 'shape'],
		['a page, not a video', 'https://www.facebook.com/LigaACP', 'shape'],
		['a post', 'https://www.facebook.com/LigaACP/posts/123', 'shape'],
		['a reel with a non-numeric id', 'https://www.facebook.com/reel/abc', 'shape'],
		['a reel without its id', 'https://www.facebook.com/reel/', 'shape'],
		['a reel with more path', 'https://www.facebook.com/reel/123/456', 'shape'],
		['a reel over http', 'http://www.facebook.com/reel/123', 'not_https'],
		['a reel on another host', 'https://facebook.com.evil.com/reel/123', 'host'],
		['a share link of a video', 'https://www.facebook.com/share/v/1AbCdEfGh/', 'short_link'],
		['a share link of a reel', 'https://www.facebook.com/share/r/1AbCdEfGh/', 'short_link'],
		['a share link on m.', 'https://m.facebook.com/share/v/1AbC/?mibextid=x', 'short_link'],
		['the plugin itself', 'https://www.facebook.com/plugins/video.php?href=x', 'shape'],
		['a video with a slug between', 'https://www.facebook.com/LigaACP/videos/titulo/123/', 'shape'],
		['a non-numeric video id', 'https://www.facebook.com/LigaACP/videos/abc/', 'shape'],
		['a reserved page name', 'https://www.facebook.com/watch/videos/123/', 'shape'],
		['a page name with odd characters', 'https://www.facebook.com/Liga%20ACP/videos/123/', 'shape'],
		['javascript', 'javascript:alert(1)', 'not_https'],
		['not a URL', 'mi transmisión', 'shape'],
		['empty', '', 'shape'],
	])('refuses %s', (_label, raw, problem) => {
		expect(parseFacebookVideo(raw)).toEqual({ ok: false, problem });
	});

	it('length: a huge input is refused without parsing, and a canonical link over 255 characters too', () => {
		expect(parseFacebookVideo(`https://www.facebook.com/watch/?v=5&x=${'a'.repeat(3000)}`)).toEqual({ ok: false, problem: 'too_long' });
		// The page name is at most 100 characters and the id 25 digits: the canonical link always fits the column.
		const longest = `https://www.facebook.com/${'a'.repeat(100)}/videos/${'9'.repeat(25)}/`;
		expect(longest.length).toBeLessThanOrEqual(MAX_FACEBOOK_URL_LENGTH);
		expect(parseFacebookVideo(longest)).toMatchObject({ ok: true });
		expect(parseFacebookVideo(`https://www.facebook.com/${'a'.repeat(101)}/videos/9/`)).toEqual({ ok: false, problem: 'shape' });
		expect(parseFacebookVideo(`https://www.facebook.com/watch/?v=${'9'.repeat(26)}`)).toEqual({ ok: false, problem: 'shape' });
	});

	it('a stored value that is not canonical is not trusted', () => {
		expect(storedFacebookVideo('https://m.facebook.com/watch/?v=5')).toBeNull();
		expect(storedFacebookVideo(null)).toBeNull();
		expect(storedFacebookVideo('<iframe src="x">')).toBeNull();
	});
});

describe('live stream routes (C-14, D-043)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;

	const row = async () => {
		const [rows] = await pool.query<RowDataPacket[]>('SELECT id, url, actualizado_en FROM transmision_en_vivo');
		return rows.map((r) => ({ id: Number(r.id), url: r.url, actualizadoEn: r.actualizado_en }));
	};
	const audits = async () => {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT a.codigo, au.entidad_id, au.usuario_id, au.detalle FROM auditoria au JOIN accion_auditoria a ON a.id = au.accion_id
			WHERE a.entidad = 'transmision_en_vivo' ORDER BY au.id`,
		);
		return rows.map((r) => ({ codigo: r.codigo, entidadId: Number(r.entidad_id), usuarioId: Number(r.usuario_id), detalle: r.detalle }));
	};

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		api = await adminApi(app, pool);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	it('without a stream: the public and admin reads say so, even with the row emptied by a reset', async () => {
		const empty = { url: null, embedUrl: null, actualizadoEn: null };
		const pub = await request(app).get('/public/transmision');
		expect(pub.status).toBe(200);
		expect(pub.body).toEqual({ data: empty });
		expect(pub.headers['cache-control']).toBe('public, max-age=30');
		expect((await api.get('/transmision')).body).toEqual({ data: empty });
	});

	it('the admin sets a link: normalized, with its embed URL and time, public at once, audited', async () => {
		const before = Date.now();
		const res = await api.put('/transmision', { url: 'https://m.facebook.com/LigaACP/videos/1234567890123456?mibextid=x' });
		expect(res.status, JSON.stringify(res.body)).toBe(200);
		expect(res.body.data).toEqual({ url: PAGE_VIDEO, embedUrl: embedOf(PAGE_VIDEO), actualizadoEn: expect.any(String) });
		const at = Date.parse(res.body.data.actualizadoEn);
		expect(at).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
		expect(at % 1000).toBe(0);

		const pub = await request(app).get('/public/transmision');
		expect(pub.body.data).toEqual(res.body.data);
		expect(await row()).toEqual([{ id: 1, url: PAGE_VIDEO, actualizadoEn: expect.any(Date) }]);
		expect(await audits()).toEqual([
			{ codigo: 'actualizacion_transmision', entidadId: 1, usuarioId: api.admin.user.id, detalle: { cambios: { url: { antes: null, despues: PAGE_VIDEO } } } },
		]);
	});

	it('C-14 fix: a facebook.com link without www is saved normalized to www, and the same video with www is the same link', async () => {
		const res = await api.put('/transmision', { url: 'https://facebook.com/LigaACP/videos/1234567890123456/' });
		expect(res.status, JSON.stringify(res.body)).toBe(200);
		expect(res.body.data).toMatchObject({ url: PAGE_VIDEO, embedUrl: embedOf(PAGE_VIDEO) });
		expect((await api.put('/transmision', { url: PAGE_VIDEO })).status).toBe(200);
		expect(await audits()).toHaveLength(1);
		expect((await api.put('/transmision', { url: 'https://xfacebook.com/watch/?v=5' })).status).toBe(400);
	});

	it('C-14 fix: a reel is saved as /watch/?v= with the same id; the same video as a watch link is the same link', async () => {
		const watch = 'https://www.facebook.com/watch/?v=1057292977068142';
		const res = await api.put('/transmision', { url: 'https://www.facebook.com/reel/1057292977068142/?s=fb_shorts_profile' });
		expect(res.status, JSON.stringify(res.body)).toBe(200);
		expect(res.body.data).toMatchObject({ url: watch, embedUrl: embedOf(watch) });
		expect((await api.put('/transmision', { url: watch })).status).toBe(200);
		expect(await audits()).toHaveLength(1);
	});

	it('the same link again changes nothing and records nothing (D-004); another link is one more record', async () => {
		const first = await api.put('/transmision', { url: PAGE_VIDEO });
		const again = await api.put('/transmision', { url: 'https://www.facebook.com/LigaACP/videos/1234567890123456' });
		expect(again.status).toBe(200);
		expect(again.body.data).toEqual(first.body.data);
		expect(await audits()).toHaveLength(1);

		const other = await api.put('/transmision', { url: 'https://www.facebook.com/watch/live/?v=42' });
		expect(other.body.data.url).toBe('https://www.facebook.com/watch/live/?v=42');
		const records = await audits();
		expect(records).toHaveLength(2);
		expect(records[1]!.detalle).toEqual({ cambios: { url: { antes: PAGE_VIDEO, despues: 'https://www.facebook.com/watch/live/?v=42' } } });
	});

	it('removing it (DELETE or PUT null) empties it and is audited once; removing nothing records nothing', async () => {
		await api.put('/transmision', { url: PAGE_VIDEO });
		const removed = await api.del('/transmision');
		expect(removed.status).toBe(200);
		expect(removed.body.data).toEqual({ url: null, embedUrl: null, actualizadoEn: null });
		expect((await request(app).get('/public/transmision')).body.data.url).toBeNull();
		expect(await row()).toEqual([{ id: 1, url: null, actualizadoEn: expect.any(Date) }]);

		expect((await api.put('/transmision', { url: null })).status).toBe(200);
		expect((await api.del('/transmision')).status).toBe(200);
		expect((await audits()).map((a) => [a.codigo, a.detalle])).toEqual([
			['actualizacion_transmision', { cambios: { url: { antes: null, despues: PAGE_VIDEO } } }],
			['retiro_transmision', { anterior: PAGE_VIDEO }],
		]);
	});

	it.each([
		['fb.watch', { url: 'https://fb.watch/abc/' }, FACEBOOK_LINK_MESSAGES.short_link],
		['a share link', { url: 'https://www.facebook.com/share/v/1AbCdEfGh/' }, FACEBOOK_LINK_MESSAGES.short_link],
		['http', { url: 'http://www.facebook.com/watch/?v=5' }, FACEBOOK_LINK_MESSAGES.not_https],
		['another host', { url: 'https://vimeo.com/123' }, FACEBOOK_LINK_MESSAGES.host],
		['a page, not a video', { url: 'https://www.facebook.com/LigaACP' }, FACEBOOK_LINK_MESSAGES.shape],
		['too long', { url: `https://www.facebook.com/watch/?v=5&x=${'a'.repeat(3000)}` }, FACEBOOK_LINK_MESSAGES.too_long],
		['a number', { url: 5 }, expect.any(String)],
		['no url', {}, expect.any(String)],
		['an extra key', { url: PAGE_VIDEO, embedUrl: 'https://evil.example' }, expect.any(String)],
	])('400 with the reason on the field for %s, nothing written', async (_label, body, message) => {
		const res = await api.put('/transmision', body);
		expect(res.status).toBe(400);
		expect(res.body.error.code).toBe('VALIDATION_ERROR');
		expect(res.body.error.details).toEqual(expect.arrayContaining([expect.objectContaining({ message })]));
		expect(await row()).toEqual([]);
		expect(await audits()).toEqual([]);
	});

	it('the fb.watch message names the field and asks for the link in the address bar', async () => {
		const res = await api.put('/transmision', { url: 'https://fb.watch/abc/' });
		expect(res.body.error.details).toEqual([expect.objectContaining({ path: 'url', message: expect.stringMatching(/barra de direcciones/) })]);
	});

	it('the server never visits the link: no request goes out while saving or reading', async () => {
		const outgoing = vi.fn(() => {
			throw new Error('el servidor intentó salir a la red');
		});
		// Facebook is https (and fetch uses its own client); supertest reaches the app over plain http, so http is left alone.
		vi.spyOn(globalThis, 'fetch').mockImplementation(outgoing as never);
		vi.spyOn(https, 'request').mockImplementation(outgoing as never);
		vi.spyOn(https, 'get').mockImplementation(outgoing as never);

		expect((await api.put('/transmision', { url: PAGE_VIDEO })).status).toBe(200);
		expect((await request(app).get('/public/transmision')).status).toBe(200);
		expect((await api.put('/transmision', { url: 'https://fb.watch/abc/' })).status).toBe(400);
		expect(outgoing).not.toHaveBeenCalled();
	});

	it('one row only: the database refuses a second one, and the link must be canonical-looking', async () => {
		await api.put('/transmision', { url: PAGE_VIDEO });
		await expect(pool.query('INSERT INTO transmision_en_vivo (id, url) VALUES (2, NULL)')).rejects.toMatchObject({ errno: 3819 });
		await expect(pool.query("UPDATE transmision_en_vivo SET url = 'https://evil.example/x' WHERE id = 1")).rejects.toMatchObject({ errno: 3819 });
		expect(await row()).toHaveLength(1);
	});

	it('the public read needs no session and ignores none: a query string is 400', async () => {
		expect((await request(app).get('/public/transmision?x=1')).status).toBe(400);
	});

	it('admin only, CSRF on writes, no query string', async () => {
		expect((await request(app).get('/admin/transmision')).status).toBe(401);
		const bettor = await signedInUser(app, pool, { estado: 'validado' });
		expect((await request(app).get('/admin/transmision').set('Cookie', bettor.cookie)).status).toBe(403);
		const put = await request(app)
			.put('/admin/transmision')
			.set('Cookie', bettor.cookie)
			.set('X-CSRF-Token', bettor.csrfToken)
			.send({ url: PAGE_VIDEO });
		expect(put.status).toBe(403);
		const noCsrf = await request(app).put('/admin/transmision').set('Cookie', api.admin.cookie).send({ url: PAGE_VIDEO });
		expect(noCsrf.status).toBe(403);
		expect(noCsrf.body.error.code).toBe('CSRF_FAILED');
		expect((await api.get('/transmision?x=1')).status).toBe(400);
		expect((await api.put('/transmision?x=1', { url: PAGE_VIDEO })).status).toBe(400);
		expect((await api.del('/transmision?x=1')).status).toBe(400);
		expect(await row()).toEqual([]);
	});

	it('a failing audit rolls the change back', async () => {
		await pool.query("UPDATE accion_auditoria SET entidad = 'otra' WHERE codigo = 'actualizacion_transmision'");
		try {
			const res = await api.put('/transmision', { url: PAGE_VIDEO });
			expect(res.status).toBe(500);
			expect((await request(app).get('/public/transmision')).body.data.url).toBeNull();
		} finally {
			await pool.query("UPDATE accion_auditoria SET entidad = 'transmision_en_vivo' WHERE codigo = 'actualizacion_transmision'");
		}
	});
});
