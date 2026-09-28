import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

/**
 * C-07 (BR-056, D-036): `GET /apuestas/participantes`, every participant's
 * bets for the validated participants, only on matches with the official
 * result, with only the participant's name, the match and the forecast.
 */

const DAY = 24 * 60 * 60 * 1000;
const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);

type Session = Awaited<ReturnType<typeof signedInUser>>;

/** Every key the list may return. Anything else (an id of a user, an email, a balance, a ticket, a state, points...) fails. */
const ALLOWED_KEYS = new Set([
	'data', 'items', 'page', 'pageSize', 'total', 'totalPages',
	'participante', 'nombre',
	'partido', 'id', 'fechaHora', 'competicion', 'deporte', 'local', 'visita', 'nombreCorto', 'escudo', 'colorAcento',
	'apuesta', 'tipo', 'pronostico', 'golesLocal', 'golesVisitante',
]);

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
	if (Array.isArray(value)) value.forEach((v) => keysOf(v, into));
	else if (value && typeof value === 'object') {
		for (const [k, v] of Object.entries(value)) {
			into.add(k);
			keysOf(v, into);
		}
	}
	return into;
}

interface Row {
	participante: { nombre: string };
	partido: { id: number; fechaHora: string; competicion: { id: number; nombre: string }; deporte: { id: number; nombre: string } };
	apuesta: { tipo: string; pronostico: string | null; golesLocal: number | null; golesVisitante: number | null };
}

describe('everyone\'s bets after the result (C-07, BR-056)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	let ana: Session;
	let pending: Session;
	const s = {} as Record<string, number>;

	const get = (who: Session | null, query = '') => {
		const req = request(app).get(`/apuestas/participantes${query}`);
		return who ? req.set('Cookie', who.cookie) : req;
	};
	const list = async (query = '') => {
		const res = await get(ana, query);
		expect(res.status, JSON.stringify(res.body)).toBe(200);
		return res.body.data as { items: Row[]; total: number; totalPages: number; page: number; pageSize: number };
	};
	/** "name@match:forecast" per row, in order. */
	const lines = async (query = '') =>
		(await list(query)).items.map((r) => `${r.participante.nombre}@${r.partido.id === s.mV ? 'V' : r.partido.id === s.mF1 ? 'F1' : r.partido.id}:${r.apuesta.pronostico ?? `${r.apuesta.golesLocal}-${r.apuesta.golesVisitante}`}`);

	async function validatedBettor(nombre: string): Promise<Session> {
		const who = await signedInUser(app, pool);
		await pool.query('UPDATE usuario SET nombre = ? WHERE id = ?', [nombre, who.user.id]);
		await api.post(`/participantes/${who.user.id}/pago/confirmar`, {});
		await api.post(`/participantes/${who.user.id}/validar`, {});
		return who;
	}

	async function confirm(who: Session, selecciones: unknown[]): Promise<{ id: number; selecciones: Array<{ id: number }> }> {
		const res = await request(app)
			.post('/apuestas/tickets')
			.set('Cookie', who.cookie)
			.set('X-CSRF-Token', who.csrfToken)
			.set('Idempotency-Key', randomUUID())
			.send({ selecciones });
		if (res.status !== 201) throw new Error(`ticket: ${res.status} ${JSON.stringify(res.body)}`);
		return res.body.data;
	}

	const general = (partidoId: number, pronostico: string) => ({ partidoId, tipo: 'resultado_general', pronostico });
	const exact = (partidoId: number, golesLocal: number, golesVisitante: number) => ({ partidoId, tipo: 'marcador_exacto', golesLocal, golesVisitante });

	/** A match's state, date and score, straight in the database (T-12 and T-16 do it for real). */
	async function setMatch(id: number, estado: string, fecha: string, goles: [number | null, number | null]) {
		await pool.query('UPDATE partido SET estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = ?), fecha_hora = ? WHERE id = ?', [
			estado,
			new Date(fecha),
			id,
		]);
		await pool.query('UPDATE partido_equipo SET goles = IF(es_visita, ?, ?) WHERE partido_id = ?', [goles[1], goles[0], id]);
	}

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		const post = (path: string, body: unknown) => created<{ id: number }>(api.post(path, body));
		s.futbol = (await post('/deportes', { nombre: 'Fútbol', permiteEmpate: true })).id;
		s.voley = (await post('/deportes', { nombre: 'Vóley', permiteEmpate: false })).id;
		s.liga = (await post('/competiciones', { deporteId: s.futbol, nombre: 'Liga' })).id;
		s.ligaVoley = (await post('/competiciones', { deporteId: s.voley, nombre: 'Liga Vóley' })).id;
		const team = async (comp: number, nombre: string) => (await post('/equipos', teamBody(comp, { nombre, nombreCorto: nombre.slice(0, 3), escudo: `escudos/${nombre}.webp` }))).id;
		s.A = await team(s.liga, 'Alianza');
		s.B = await team(s.liga, 'Boca');
		s.P = await team(s.ligaVoley, 'Pumas');
		s.Q = await team(s.ligaVoley, 'Quilmes');
		const soon = (days: number) => wholeSeconds(Date.now() + days * DAY);
		s.mF1 = await insertMatch(pool, s.liga, s.A, s.B, 'programado', soon(3));
		s.mF2 = await insertMatch(pool, s.liga, s.B, s.A, 'programado', soon(4));
		s.mV = await insertMatch(pool, s.ligaVoley, s.P, s.Q, 'programado', soon(5));
		s.mUnconfirmed = await insertMatch(pool, s.liga, s.A, s.B, 'programado', soon(6));
		s.mCancelled = await insertMatch(pool, s.liga, s.B, s.A, 'programado', soon(7));
		s.mOneSide = await insertMatch(pool, s.liga, s.A, s.B, 'programado', soon(8));

		ana = await validatedBettor('Ana');
		const beto = await validatedBettor('Beto');
		const alvaro = await validatedBettor('Álvaro');
		const carla = await validatedBettor('Carla');
		pending = await signedInUser(app, pool);

		await confirm(ana, [general(s.mF1, 'local_gana'), exact(s.mF1, 2, 1)]);
		await confirm(beto, [general(s.mF1, 'empate')]);
		await confirm(alvaro, [general(s.mV, 'local_gana'), general(s.mF1, 'visitante_gana')]);
		// Carla only bets where nothing may show: not confirmed, cancelled, one side, voided.
		const carlas = await confirm(carla, [general(s.mUnconfirmed, 'local_gana'), general(s.mCancelled, 'empate'), general(s.mOneSide, 'local_gana'), general(s.mF2, 'empate')]);

		// An admin's ticket loaded by hand (only possible that way) on a finished match: never listed.
		const [ticket] = await pool.query<ResultSetHeader>('INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, UTC_TIMESTAMP(), ?, ?)', [
			api.admin.user.id,
			randomUUID(),
			'a'.repeat(64),
		]);
		await pool.query(
			`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id)
			VALUES (?, ?, (SELECT id FROM tipo_apuesta WHERE codigo = 'resultado_general'),
				(SELECT id FROM resultado_general WHERE codigo = 'local_gana'), (SELECT id FROM estado_seleccion WHERE codigo = 'pendiente'))`,
			[ticket.insertId, s.mF1],
		);

		await setMatch(s.mF1, 'finalizado', '2026-01-10T20:00:00Z', [2, 1]);
		await setMatch(s.mV, 'finalizado', '2026-02-10T20:00:00Z', [3, 1]);
		// Finished, but Carla's selection there was voided (hand-loaded, D-001): never shown.
		await setMatch(s.mF2, 'finalizado', '2026-03-10T20:00:00Z', [0, 0]);
		await pool.query("UPDATE seleccion SET estado_seleccion_id = (SELECT id FROM estado_seleccion WHERE codigo = 'anulada') WHERE id = ?", [carlas.selecciones[3]!.id]);
		// A score loaded while in progress, not confirmed (T-12): private.
		await setMatch(s.mUnconfirmed, 'en_curso', '2026-03-11T20:00:00Z', [1, 0]);
		// Cancelled with a score loaded before (T-16): never.
		await setMatch(s.mCancelled, 'cancelado', '2026-03-12T20:00:00Z', [1, 1]);
		// "Finished" with one side only (hand-loaded): not an official result (BR-049).
		await setMatch(s.mOneSide, 'finalizado', '2026-03-13T20:00:00Z', [2, null]);
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	describe('who can read it', () => {
		it('a validated participant: 200; no session: 401; a pending one and an admin: 403', async () => {
			expect((await get(ana)).status).toBe(200);
			expect((await get(null)).status).toBe(401);
			const pendingRes = await get(pending);
			expect(pendingRes.status).toBe(403);
			expect(pendingRes.body.error.code).toBe('USER_NOT_VALIDATED');
			const adminRes = await request(app).get('/apuestas/participantes').set('Cookie', api.admin.cookie);
			expect(adminRes.status).toBe(403);
			expect(adminRes.body.error.code).toBe('ADMIN_CANNOT_BET');
			expect(adminRes.headers['cache-control']).toBe('no-store');
		});
	});

	describe('what shows', () => {
		it('only matches with the official result, newest match first, then by name in Spanish order, then the selection', async () => {
			// Álvaro before Ana: accents aside (utf8mb4_es_0900_ai_ci). Ana's two bets in the order she placed them.
			expect(await lines()).toEqual(['Álvaro@V:local_gana', 'Álvaro@F1:visitante_gana', 'Ana@F1:local_gana', 'Ana@F1:2-1', 'Beto@F1:empate']);
			const all = await list();
			expect(all.total).toBe(5);
			// Not confirmed, cancelled, one side only, voided, an admin's: none of them (Carla has nothing to show).
			expect(all.items.map((r) => r.partido.id)).not.toContain(s.mUnconfirmed);
			expect((await list('?participante=Carla')).total).toBe(0);
		});

		it('each row is the participant\'s name, the match and the forecast, nothing else', async () => {
			const [first] = (await list('?pageSize=1')).items;
			expect(first).toEqual({
				participante: { nombre: 'Álvaro' },
				partido: {
					id: s.mV,
					fechaHora: '2026-02-10T20:00:00.000Z',
					competicion: { id: s.ligaVoley, nombre: 'Liga Vóley' },
					deporte: { id: s.voley, nombre: 'Vóley' },
					local: { id: s.P, nombre: 'Pumas', nombreCorto: 'Pum', escudo: 'escudos/Pumas.webp', colorAcento: '#a50044' },
					visita: { id: s.Q, nombre: 'Quilmes', nombreCorto: 'Qui', escudo: 'escudos/Quilmes.webp', colorAcento: '#a50044' },
				},
				apuesta: { tipo: 'resultado_general', pronostico: 'local_gana', golesLocal: null, golesVisitante: null },
			});
			const exactRow = (await list('?participante=ana')).items.find((r) => r.apuesta.tipo === 'marcador_exacto');
			expect(exactRow?.apuesta).toEqual({ tipo: 'marcador_exacto', pronostico: null, golesLocal: 2, golesVisitante: 1 });
		});

		it('never an id of a user, email, balance, ticket, key, fingerprint, selection state or points', async () => {
			const res = await get(ana, '?pageSize=100');
			const extra = [...keysOf(res.body)].filter((k) => !ALLOWED_KEYS.has(k));
			expect(extra).toEqual([]);
			const text = JSON.stringify(res.body);
			for (const word of ['usuario', 'email', 'correo', 'saldo', 'ticket', 'clave', 'huella', 'estado', 'puntos', '@liga.test']) {
				expect(text, word).not.toContain(word);
			}
			// Ana's own user id is nowhere, not even as a participant id.
			for (const item of res.body.data.items as Row[]) expect(Object.keys(item.participante)).toEqual(['nombre']);
		});

		it('a result confirmed later makes its bets appear', async () => {
			await setMatch(s.mUnconfirmed, 'finalizado', '2026-03-11T20:00:00Z', [1, 0]);
			try {
				expect((await lines())[0]).toBe(`Carla@${s.mUnconfirmed}:local_gana`);
			} finally {
				await setMatch(s.mUnconfirmed, 'en_curso', '2026-03-11T20:00:00Z', [1, 0]);
			}
		});
	});

	describe('filters and pages', () => {
		it('by sport', async () => {
			expect(await lines(`?deporteId=${s.voley}`)).toEqual(['Álvaro@V:local_gana']);
			expect((await list(`?deporteId=${s.futbol}`)).total).toBe(4);
			expect((await list('?deporteId=999999')).total).toBe(0);
		});

		it('by a text inside the name: case and accents aside, % and _ taken literally, blank is no filter', async () => {
			expect(await lines('?participante=alvaro')).toEqual(['Álvaro@V:local_gana', 'Álvaro@F1:visitante_gana']);
			expect(await lines('?participante=%20ET%20')).toEqual(['Beto@F1:empate']);
			expect((await list('?participante=%25')).total).toBe(0);
			expect((await list('?participante=_')).total).toBe(0);
			expect((await list('?participante=%20%20')).total).toBe(5);
			expect(await lines(`?participante=ana&deporteId=${s.futbol}`)).toEqual(['Ana@F1:local_gana', 'Ana@F1:2-1']);
		});

		it('paginated like every list', async () => {
			const second = await list('?pageSize=2&page=2');
			expect(second).toMatchObject({ page: 2, pageSize: 2, total: 5, totalPages: 3 });
			expect(second.items.map((r) => r.participante.nombre)).toEqual(['Ana', 'Ana']);
			expect((await list('?pageSize=2&page=9')).items).toEqual([]);
		});

		it.each([
			['an unknown parameter', '?usuarioId=1'],
			['a sport id that isn\'t one', '?deporteId=abc'],
			['a name over 100 characters', `?participante=${'a'.repeat(101)}`],
			['a control character', '?participante=a%0Ab'],
			['two names', '?participante=a&participante=b'],
			['a page size over 100', '?pageSize=101'],
		])('%s -> 400', async (_label, query) => {
			const res = await get(ana, query);
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('VALIDATION_ERROR');
		});
	});
	describe('volume (no new index: server/README.md)', () => {
		it('300 participants and 24 000 selections on 40 finished matches: a page in well under a second', async () => {
			const USERS = 300;
			const MATCHES = 40;
			const [[ids]] = await pool.query<RowDataPacket[]>(
				`SELECT (SELECT id FROM rol WHERE codigo = 'apostador') AS rol,
					(SELECT id FROM estado_usuario WHERE codigo = 'validado') AS validado,
					(SELECT id FROM estado_pago WHERE codigo = 'confirmado') AS pago,
					(SELECT id FROM tipo_apuesta WHERE codigo = 'resultado_general') AS tipo,
					(SELECT id FROM resultado_general WHERE codigo = 'empate') AS empate,
					(SELECT id FROM estado_seleccion WHERE codigo = 'no_acertada') AS estado`,
			);
			const matches: number[] = [];
			for (let i = 0; i < MATCHES; i++) {
				const id = await insertMatch(pool, i % 4 === 0 ? s.ligaVoley! : s.liga!, i % 4 === 0 ? s.P! : s.A!, i % 4 === 0 ? s.Q! : s.B!, 'finalizado', new Date(Date.UTC(2025, 0, 1 + i)));
				await pool.query('UPDATE partido_equipo SET goles = 1 WHERE partido_id = ?', [id]);
				matches.push(id);
			}
			const [users] = await pool.query<ResultSetHeader>(
				'INSERT INTO usuario (rol_id, estado_usuario_id, estado_pago_id, nombre, email, password_hash, saldo_monedas, creado_en) VALUES ?',
				[Array.from({ length: USERS }, (_, i) => [ids!.rol, ids!.validado, ids!.pago, `Vol ${String(i).padStart(3, '0')}`, `vol${i}@vol.test`, 'x', 0, new Date()])],
			);
			const [tickets] = await pool.query<ResultSetHeader>('INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES ?', [
				Array.from({ length: USERS }, (_, i) => [users.insertId + i, new Date(), randomUUID(), 'b'.repeat(64)]),
			]);
			const rows: unknown[][] = [];
			for (let u = 0; u < USERS; u++) {
				for (const [m, match] of matches.entries()) {
					for (let k = 0; k < ((u + m) % 3) + 1; k++) rows.push([tickets.insertId + u, match, ids!.tipo, ids!.empate, ids!.estado]);
				}
			}
			for (let i = 0; i < rows.length; i += 5000) {
				await pool.query('INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id) VALUES ?', [rows.slice(i, i + 5000)]);
			}
			await pool.query('ANALYZE TABLE seleccion, ticket, usuario, partido, partido_equipo');

			const measure = async (query: string) => {
				const timings: number[] = [];
				for (let i = 0; i < 5; i++) {
					const started = performance.now();
					const res = await get(ana, query);
					timings.push(performance.now() - started);
					expect(res.status).toBe(200);
				}
				return timings.sort((a, b) => a - b)[2]!;
			};
			const all = await measure('');
			const bySport = await measure(`?deporteId=${s.voley}&page=3`);
			const byName = await measure('?participante=vol%2029');
			process.stdout.write(`apuestas de todos con ${USERS} participantes y ${rows.length} selecciones: mediana ${all.toFixed(1)} ms, por deporte ${bySport.toFixed(1)} ms, por nombre ${byName.toFixed(1)} ms (por HTTP)\n`);
			expect(Math.max(all, bySport, byName)).toBeLessThan(1000);
			expect((await list('?pageSize=1')).total).toBe(rows.length + 5);

			// Leave the base data as the other tests found it.
			await pool.query('DELETE FROM seleccion WHERE ticket_id >= ?', [tickets.insertId]);
			await pool.query('DELETE FROM ticket WHERE id >= ?', [tickets.insertId]);
			await pool.query('DELETE FROM usuario WHERE id >= ?', [users.insertId]);
			await pool.query('DELETE FROM partido_equipo WHERE partido_id IN (?)', [matches]);
			await pool.query('DELETE FROM partido WHERE id IN (?)', [matches]);
		});
	});
});
