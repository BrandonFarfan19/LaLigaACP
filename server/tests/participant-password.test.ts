import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { transactionStats } from '../src/db/transaction.js';
import { participantAuditHooks } from '../src/services/audit.service.js';
import { resetParticipantPassword } from '../src/services/participant-validation.service.js';
import { createSession } from '../src/services/session.service.js';
import { createTestApp } from './helpers/app.js';
import { countSessions, LEAKS_SECRET, login, PASSWORD, registerUser, signedInUser } from './helpers/auth.js';
import { resetDatabase } from './helpers/db.js';

/** C-08 (D-037): the admin sets a participant's new password, closing every session of theirs. */
describe('reset a participant password (C-08, D-037)', () => {
	let app: Express;
	let pool: Pool;
	let admin: Awaited<ReturnType<typeof signedInUser>>;

	const NEW_PASSWORD = 'otra-clave-99';

	const reset = (id: number | string, body: unknown = { contrasena: NEW_PASSWORD }, who: { cookie: string; csrfToken: string } = admin) =>
		request(app).put(`/admin/participantes/${id}/contrasena`).set('Cookie', who.cookie).set('X-CSRF-Token', who.csrfToken).send(body as object);

	const me = (cookie: string) => request(app).get('/auth/me').set('Cookie', cookie);
	const tryLogin = (email: string, password: string) => request(app).post('/auth/login').send({ email, password });

	async function storedHash(userId: number): Promise<string> {
		const [[row]] = await pool.query<RowDataPacket[]>('SELECT password_hash AS h FROM usuario WHERE id = ?', [userId]);
		return String(row!.h);
	}

	async function auditRows() {
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT a.codigo, au.usuario_id, au.entidad_id, CAST(au.detalle AS CHAR) AS detalle
			FROM auditoria au JOIN accion_auditoria a ON a.id = au.accion_id ORDER BY au.id`,
		);
		return rows.map((r) => ({ codigo: r.codigo, usuarioId: Number(r.usuario_id), entidadId: Number(r.entidad_id), detalle: String(r.detalle) }));
	}

	/** A participant with two open sessions (two devices). */
	async function participantWithSessions() {
		const { body, user } = await registerUser(app);
		const first = await login(app, body.email);
		const second = await login(app, body.email);
		return { email: body.email, user, sessions: [first, second] };
	}

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		admin = await signedInUser(app, pool, { rol: 'admin' });
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('the change', () => {
		it('the participant signs in with the new password and not with the old one', async () => {
			const target = await participantWithSessions();

			const res = await reset(target.user.id);

			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({ participante: { id: target.user.id, estadoValidacion: 'pendiente' }, sesionesCerradas: 2 });
			const text = JSON.stringify(res.body);
			expect(text).not.toMatch(LEAKS_SECRET);
			expect(text).not.toContain(NEW_PASSWORD);
			expect(text).not.toMatch(/contrasena/);
			expect(res.headers['cache-control']).toBe('no-store');

			expect((await tryLogin(target.email, PASSWORD)).status).toBe(401);
			expect((await tryLogin(target.email, NEW_PASSWORD)).status).toBe(200);
			expect(await storedHash(target.user.id)).toMatch(/^\$argon2id\$v=19\$m=19456,p=1,t=2\$/);
		});

		it('closes every session of the participant, and only theirs', async () => {
			const target = await participantWithSessions();
			const other = await signedInUser(app, pool, { estado: 'validado' });
			expect(await countSessions(pool, target.user.id)).toBe(2);

			expect((await reset(target.user.id)).status).toBe(200);

			expect(await countSessions(pool, target.user.id)).toBe(0);
			for (const session of target.sessions) expect((await me(session.cookie)).status).toBe(401);
			expect((await me(other.cookie)).status).toBe(200);
			expect((await me(admin.cookie)).status).toBe(200);
			expect(await countSessions(pool, other.user.id)).toBe(1);
		});

		it('works on a validated participant with no open session', async () => {
			const who = await signedInUser(app, pool, { estado: 'validado' });
			await pool.query('DELETE FROM sesion WHERE usuario_id = ?', [who.user.id]);
			const res = await reset(who.user.id);
			expect(res.status).toBe(200);
			expect(res.body.data).toMatchObject({ participante: { estadoValidacion: 'validado' }, sesionesCerradas: 0 });
			expect((await tryLogin(who.user.email, NEW_PASSWORD)).status).toBe(200);
		});
	});

	describe('the password rule (C-01: 6 to 20 characters, in code points)', () => {
		const family = '👨‍👩‍👧'; // 5 code points: three people joined by two ZWJ.

		it.each([
			['5 characters', 'abcde'],
			['21 characters', 'a'.repeat(21)],
			['21 emoji (42 UTF-16 units)', '🦅'.repeat(21)],
			['four composed emoji and one letter (21 code points)', `${family.repeat(4)}a`],
			['empty', ''],
		])('%s is a 400 on the field, and nothing changes', async (_label, contrasena) => {
			const target = await participantWithSessions();
			const hash = await storedHash(target.user.id);

			const res = await reset(target.user.id, { contrasena });

			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
			expect(res.body.error.details).toEqual([{ path: 'contrasena', message: expect.stringMatching(/contraseña/) }]);
			if (contrasena) expect(JSON.stringify(res.body)).not.toContain(contrasena);
			expect(await storedHash(target.user.id)).toBe(hash);
			expect(await countSessions(pool, target.user.id)).toBe(2);
			expect(await auditRows()).toEqual([]);
		});

		it.each([
			['6 characters', 'abcdef'],
			['20 characters', 'b'.repeat(20)],
			['6 emoji (12 UTF-16 units)', '🦅'.repeat(6)],
			['one composed emoji and a letter (6 code points)', `${family}a`],
			['four composed emoji (20 code points)', family.repeat(4)],
		])('%s is taken, and the participant signs in with it', async (_label, contrasena) => {
			const target = await participantWithSessions();
			expect((await reset(target.user.id, { contrasena })).status).toBe(200);
			expect((await tryLogin(target.email, contrasena)).status).toBe(200);
		});

		it('the body is strict: another key, a missing field or a number is a 400', async () => {
			const target = await participantWithSessions();
			const hash = await storedHash(target.user.id);
			for (const body of [{ contrasena: NEW_PASSWORD, rol: 'admin' }, {}, { contrasena: 12345678 }, { password: NEW_PASSWORD }]) {
				const res = await reset(target.user.id, body);
				expect(res.status, JSON.stringify(body)).toBe(400);
				expect(JSON.stringify(res.body)).not.toContain(NEW_PASSWORD);
			}
			const query = await request(app)
				.put(`/admin/participantes/${target.user.id}/contrasena?x=1`)
				.set('Cookie', admin.cookie)
				.set('X-CSRF-Token', admin.csrfToken)
				.send({ contrasena: NEW_PASSWORD });
			expect(query.status).toBe(400);
			expect(await storedHash(target.user.id)).toBe(hash);
		});
	});

	describe('who and on whom', () => {
		it('an admin account is 404 NOT_A_PARTICIPANT (the own one too); an unknown id is 404 USER_NOT_FOUND', async () => {
			const other = await signedInUser(app, pool, { rol: 'admin' });
			const hash = await storedHash(other.user.id);

			const onAdmin = await reset(other.user.id);
			expect(onAdmin.status).toBe(404);
			expect(onAdmin.body.error.code).toBe('NOT_A_PARTICIPANT');
			expect((await reset(admin.user.id)).body.error.code).toBe('NOT_A_PARTICIPANT');
			expect(await storedHash(other.user.id)).toBe(hash);
			expect(await countSessions(pool, other.user.id)).toBe(1);

			const unknown = await reset(999_999_999);
			expect(unknown.status).toBe(404);
			expect(unknown.body.error.code).toBe('USER_NOT_FOUND');
			expect((await reset('abc')).status).toBe(400);
			expect(await auditRows()).toEqual([]);
		});

		it('a participant is 403, no session is 401, and without the CSRF token it is 403 and nothing changes', async () => {
			const target = await participantWithSessions();
			const hash = await storedHash(target.user.id);
			const bettor = await signedInUser(app, pool, { estado: 'validado' });

			expect((await reset(target.user.id, undefined, bettor)).status).toBe(403);
			expect((await request(app).put(`/admin/participantes/${target.user.id}/contrasena`).send({ contrasena: NEW_PASSWORD })).status).toBe(401);
			const noCsrf = await request(app)
				.put(`/admin/participantes/${target.user.id}/contrasena`)
				.set('Cookie', admin.cookie)
				.send({ contrasena: NEW_PASSWORD });
			expect(noCsrf.status).toBe(403);

			expect(await storedHash(target.user.id)).toBe(hash);
			expect(await countSessions(pool, target.user.id)).toBe(2);
			expect(await auditRows()).toEqual([]);
		});
	});

	describe('a login racing the reset (C-08 fix)', () => {
		it('a session is never opened with a password verified before a reset that already committed', async () => {
			const target = await participantWithSessions();
			const oldHash = await storedHash(target.user.id);

			expect((await reset(target.user.id)).status).toBe(200);

			// What a login that read and verified the old hash before the reset does next.
			expect(await createSession(pool, target.user.id, oldHash, 60_000, undefined)).toBeNull();
			expect(await countSessions(pool, target.user.id)).toBe(0);
			// With the current hash it opens one as always.
			expect(await createSession(pool, target.user.id, await storedHash(target.user.id), 60_000, undefined)).not.toBeNull();
			expect(await countSessions(pool, target.user.id)).toBe(1);
		});

		it('40 rounds of a login with the old password against the reset: no session survives, no deadlock', { timeout: 120_000 }, async () => {
			const deadlocksBefore = { ...transactionStats };
			const survivors: number[] = [];
			let loggedIn = 0;
			for (let round = 0; round < 40; round++) {
				const { body, user } = await registerUser(app);
				const [attempt, resetRes] = await Promise.all([tryLogin(body.email, PASSWORD), reset(user.id)]);
				expect(resetRes.status).toBe(200);
				expect([200, 401]).toContain(attempt.status);
				if (attempt.status === 200) {
					loggedIn++;
					const cookie = String(attempt.headers['set-cookie']).split(';')[0]!;
					if ((await me(cookie)).status !== 401) survivors.push(round);
				}
				if ((await countSessions(pool, user.id)) !== 0) survivors.push(round);
				// And the old password no longer opens anything.
				expect((await tryLogin(body.email, PASSWORD)).status).toBe(401);
			}
			expect(survivors).toEqual([]);
			expect(transactionStats.deadlocksExhausted).toBe(deadlocksBefore.deadlocksExhausted);
			const retries = transactionStats.deadlockRetries - deadlocksBefore.deadlockRetries;
			console.info(`carrera login/restablecimiento: ${loggedIn} de 40 logins entraron antes del cambio; reintentos por deadlock: ${retries}`);
		});
	});

	describe('audit', () => {
		it('one record with the admin, the participant and how many sessions were closed; never the password or its hash', async () => {
			const target = await participantWithSessions();

			expect((await reset(target.user.id)).status).toBe(200);

			const rows = await auditRows();
			expect(rows).toEqual([{ codigo: 'restablecimiento_contrasena', usuarioId: admin.user.id, entidadId: target.user.id, detalle: expect.any(String) }]);
			expect(JSON.parse(rows[0]!.detalle)).toEqual({ accesosCerrados: 2 });
			const hash = await storedHash(target.user.id);
			for (const secret of [NEW_PASSWORD, PASSWORD, hash, '$argon2', target.email]) expect(rows[0]!.detalle).not.toContain(secret);

			const listed = await request(app).get('/admin/auditoria?accion=restablecimiento_contrasena').set('Cookie', admin.cookie);
			expect(listed.status).toBe(200);
			expect(listed.body.data.items).toHaveLength(1);
			for (const secret of [NEW_PASSWORD, hash, '$argon2']) expect(JSON.stringify(listed.body)).not.toContain(secret);
		});

		it('an audit that fails rolls everything back: same password, same sessions, no record', async () => {
			const target = await participantWithSessions();
			const hash = await storedHash(target.user.id);
			const bettor = await signedInUser(app, pool, { estado: 'validado' });

			// The author is not an admin: the audit refuses it.
			await expect(
				resetParticipantPassword(pool, { actorId: bettor.user.id, userId: target.user.id, password: NEW_PASSWORD }, participantAuditHooks),
			).rejects.toThrow(/administrador/);
			expect(await storedHash(target.user.id)).toBe(hash);
			expect(await countSessions(pool, target.user.id)).toBe(2);

			// The catalog code is missing: the HTTP action answers 500, changes nothing and logs no password.
			const logged: unknown[][] = [];
			const spies = (['error', 'warn', 'log', 'info'] as const).map((level) =>
				vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args)),
			);
			await pool.query("UPDATE accion_auditoria SET codigo = 'restablecimiento_x' WHERE codigo = 'restablecimiento_contrasena'");
			try {
				const res = await reset(target.user.id);
				expect(res.status).toBe(500);
				expect(res.body.error.code).toBe('INTERNAL_ERROR');
				expect(JSON.stringify(res.body)).not.toContain(NEW_PASSWORD);
			} finally {
				await pool.query("UPDATE accion_auditoria SET codigo = 'restablecimiento_contrasena' WHERE codigo = 'restablecimiento_x'");
				for (const spy of spies) spy.mockRestore();
			}
			expect(logged.length).toBeGreaterThan(0);
			const logText = logged.map((args) => args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : JSON.stringify(a))).join(' ')).join('\n');
			expect(logText).not.toContain(NEW_PASSWORD);
			expect(logText).not.toContain('$argon2');

			expect(await storedHash(target.user.id)).toBe(hash);
			expect(await countSessions(pool, target.user.id)).toBe(2);
			for (const session of target.sessions) expect((await me(session.cookie)).status).toBe(200);
			expect((await tryLogin(target.email, PASSWORD)).status).toBe(200);
			expect(await auditRows()).toEqual([]);
		});
	});
});
