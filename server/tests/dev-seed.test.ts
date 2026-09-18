import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import type { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { HORAS_CIERRE_APUESTAS } from '../src/lib/betting.js';
import { resultOfScore } from '../src/lib/match-result.js';
import { settleSelection } from '../src/lib/points.js';
import { checkCoinConsistency } from '../src/services/coins-consistency.service.js';
import {
	cleanDevData,
	DEMO_ACCOUNTS,
	DEV_SEED_FLAG,
	type DevSeedGuardInput,
	devSeedProblems,
	DevSeedError,
	sampleTicketTimes,
	seedDevData,
} from '../src/services/dev-seed.service.js';
import { createTestApp, env } from './helpers/app.js';
import { login, registerUser, signedInUser } from './helpers/auth.js';
import { adminApi, created, teamBody } from './helpers/catalog.js';
import { CATALOG_TABLES, resetDatabase } from './helpers/db.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOUR = 60 * 60 * 1000;
const iso = (ms: number) => new Date(Math.floor(ms / 1000) * 1000).toISOString().replace('.000Z', 'Z');

const count = async (pool: Pool, sql: string, params: unknown[] = []) =>
	Number(((await pool.query<RowDataPacket[]>(sql, params))[0][0] as RowDataPacket).n);

/** Row counts of every app table (catalogs and the marks table aside). */
async function snapshot(pool: Pool): Promise<Record<string, number>> {
	const [rows] = await pool.query<RowDataPacket[]>(
		"SELECT TABLE_NAME AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' ORDER BY TABLE_NAME",
	);
	const counts: Record<string, number> = {};
	for (const { t } of rows) {
		if (CATALOG_TABLES.has(t) || t === 'dato_demo') continue;
		counts[t] = await count(pool, `SELECT COUNT(*) AS n FROM \`${t}\``);
	}
	return counts;
}

const marks = async (pool: Pool) =>
	(await count(pool, "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'dato_demo'")) === 0
		? 0
		: count(pool, 'SELECT COUNT(*) AS n FROM dato_demo');

function runCli(args: string[], envChanges: Record<string, string | undefined>) {
	const childEnv: NodeJS.ProcessEnv = { ...process.env };
	for (const [key, value] of Object.entries(envChanges)) {
		if (value === undefined) delete childEnv[key];
		else childEnv[key] = value;
	}
	return new Promise<{ code: number | null; stdout: string; stderr: string }>((done, fail) => {
		const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli/seed-dev.ts', ...args], { cwd: serverDir, env: childEnv });
		let out = '';
		let err = '';
		child.stdout.on('data', (chunk) => (out += String(chunk)));
		child.stderr.on('data', (chunk) => (err += String(chunk)));
		child.on('error', fail);
		child.on('close', (exit) => done({ code: exit, stdout: out, stderr: err }));
	});
}

describe('development sample data (D-013, D-016)', () => {
	let app: Express;
	let pool: Pool;

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	/** The in-progress sample football match, its home team and one of that team's players. */
	async function inProgressMatch() {
		const [[row]] = await pool.query<RowDataPacket[]>(
			`SELECT p.id, pe.equipo_id AS equipoId, (SELECT pl.jugador_id FROM plantel pl WHERE pl.equipo_id = pe.equipo_id ORDER BY pl.id LIMIT 1) AS jugadorId,
				c.id AS competicionId, c.deporte_id AS deporteId
			FROM partido p JOIN competicion c ON c.id = p.competicion_id
			JOIN partido_equipo pe ON pe.partido_id = p.id AND pe.es_visita = FALSE
			WHERE c.slug = 'demo-liga' AND p.jornada = 2
				AND p.estado_partido_id = (SELECT id FROM estado_partido WHERE codigo = 'programado')`,
		);
		return row as { id: number; equipoId: number; jugadorId: number; competicionId: number; deporteId: number };
	}

	describe('the CLI barrier', () => {
		const allowed: DevSeedGuardInput = {
			nodeEnv: 'development',
			nodeEnvExplicit: true,
			database: 'la_liga_acp',
			devDatabase: 'la_liga_acp',
			testDatabase: 'la_liga_acp_test',
			argv: [DEV_SEED_FLAG],
		};

		it('needs explicit development, exactly the development database and the flag', () => {
			expect(devSeedProblems(allowed)).toEqual([]);
			expect(devSeedProblems({ ...allowed, argv: ['clean', DEV_SEED_FLAG] })).toEqual([]);
			const refused: Array<[Partial<DevSeedGuardInput>, RegExp]> = [
				[{ nodeEnvExplicit: false }, /NODE_ENV.*sin definir/],
				[{ nodeEnv: 'test' }, /NODE_ENV tiene que ser development.*test/],
				[{ nodeEnv: 'production' }, /NODE_ENV tiene que ser development.*production/],
				[{ devDatabase: null }, /Falta DEV_SEED_DATABASE/],
				[{ database: 'otra_base' }, /no es la de desarrollo/],
				[{ database: 'la_liga_acp_test', devDatabase: 'la_liga_acp_test' }, /es de pruebas/],
				[{ database: 'la_liga_acp_test_2', devDatabase: 'la_liga_acp_test_2' }, /es de pruebas/],
				[{ database: 'dev_x', devDatabase: 'dev_x', testDatabase: 'dev_x' }, /es de pruebas/],
				[{ argv: [] }, /Falta la bandera --yes-dev-data/],
				[{ argv: ['clean'] }, /Falta la bandera/],
				[{ argv: ['--yes-dev-data=1'] }, /Falta la bandera/],
			];
			for (const [change, message] of refused) {
				const problems = devSeedProblems({ ...allowed, ...change });
				expect(problems, JSON.stringify(change)).toHaveLength(1);
				expect(problems[0], JSON.stringify(change)).toMatch(message);
			}
		});

		it('the real CLI refuses every unsafe combination and touches nothing', async () => {
			const testDb = env.devSeed.testDatabase;
			const guardDb = 'la_liga_acp_guard_check';
			const cases: Array<[string, string[], Record<string, string | undefined>, RegExp[]]> = [
				// The tester's case: no NODE_ENV, pointed at a test database.
				['sin NODE_ENV, base de pruebas', [DEV_SEED_FLAG], { NODE_ENV: undefined, MYSQL_DATABASE: testDb, MYSQL_DATABASE_TEST: 'otra_de_pruebas', DEV_SEED_DATABASE: guardDb }, [/sin definir/, /es de pruebas/, /no es la de desarrollo/]],
				['sin NODE_ENV', [DEV_SEED_FLAG], { NODE_ENV: undefined, MYSQL_DATABASE: guardDb, DEV_SEED_DATABASE: guardDb }, [/NODE_ENV.*sin definir/]],
				['sin NODE_ENV, limpieza', ['clean', DEV_SEED_FLAG], { NODE_ENV: undefined, MYSQL_DATABASE: guardDb, DEV_SEED_DATABASE: guardDb }, [/sin definir/]],
				['NODE_ENV=production', [DEV_SEED_FLAG], { NODE_ENV: 'production', MYSQL_DATABASE: guardDb, DEV_SEED_DATABASE: guardDb }, [/tiene que ser development/]],
				['NODE_ENV=test', [DEV_SEED_FLAG], { NODE_ENV: 'test', MYSQL_DATABASE_TEST: testDb, DEV_SEED_DATABASE: guardDb }, [/tiene que ser development/, /es de pruebas/]],
				['otra base', [DEV_SEED_FLAG], { NODE_ENV: 'development', MYSQL_DATABASE: 'otra_base', DEV_SEED_DATABASE: guardDb }, [/no es la de desarrollo/]],
				['base de pruebas declarada como de desarrollo', [DEV_SEED_FLAG], { NODE_ENV: 'development', MYSQL_DATABASE: testDb, MYSQL_DATABASE_TEST: 'otra_de_pruebas', DEV_SEED_DATABASE: testDb }, [/es de pruebas/]],
				['sin bandera', [], { NODE_ENV: 'development', MYSQL_DATABASE: guardDb, DEV_SEED_DATABASE: guardDb }, [/Falta la bandera/]],
				['sin bandera, limpieza', ['clean'], { NODE_ENV: 'development', MYSQL_DATABASE: guardDb, DEV_SEED_DATABASE: guardDb }, [/Falta la bandera/]],
			];
			const results = await Promise.all(cases.map(([, args, changes]) => runCli(args, changes)));
			results.forEach(({ code, stdout, stderr }, i) => {
				const [label, , , messages] = cases[i]!;
				expect(code, label).toBe(1);
				expect(stderr, label).toMatch(/No se cambió nada/);
				for (const message of messages) expect(stderr, label).toMatch(message);
				expect(stdout, label).toBe('');
			});
			expect(await count(pool, 'SELECT COUNT(*) AS n FROM deporte')).toBe(0);
			expect(await count(pool, 'SELECT COUNT(*) AS n FROM usuario')).toBe(0);
			expect(await marks(pool)).toBe(0);
		}, 60_000);
	});

	it('loads sports (one without draws), teams with squads, accounts and matches in every betting state, all marked', async () => {
		const summary = await seedDevData(pool, new Date());
		expect(summary).toMatchObject({ deportes: 3, competiciones: 3, equipos: 8, jugadores: 24, partidos: 14 });
		expect(await snapshot(pool)).toMatchObject({
			deporte: 3,
			competicion: 3,
			equipo: 8,
			jugador: 24,
			plantel: 24,
			partido: 14,
			partido_equipo: 28,
			usuario: 12,
			// 10 validations, 11 debits and 1 refund (T-20 and T-21 tickets).
			movimiento_moneda: 22,
			ticket: 7,
			seleccion: 11,
		});
		// Every created row, and only those: 3 + 3 + 8 + 24 + 24 + 14 + 28 + 12.
		expect(await marks(pool)).toBe(116);

		// The validated sample bettor signs in and sees every state (BR-052), in BR-013 order.
		const ana = DEMO_ACCOUNTS.find((a) => a.key === 'ana')!;
		const session = await login(app, ana.email, ana.password);
		const me = await request(app).get('/auth/me').set('Cookie', session.cookie);
		expect(me.body.data.user).toMatchObject({ rol: 'apostador', estadoValidacion: 'validado', estadoPago: 'confirmado', saldoMonedas: 6 });

				// T-20: tickets in every state, and a ranking with a tie at the top.
				const history = await request(app).get('/apuestas/mis-apuestas/resumen').set('Cookie', session.cookie);
				expect(history.body.data).toEqual({
					tickets: { total: 3, pendiente: 1, finalizado: 1, anulado: 1 },
					selecciones: { total: 5, pendiente: 2, acertada: 2, no_acertada: 0, anulada: 1 },
					monedasUtilizadas: 5,
					monedasDevueltas: 1,
					puntos: 6,
					aciertos: 2,
				});
				const ranking = await request(app).get('/ranking').set('Cookie', session.cookie);
				expect(ranking.body.data.participantes).toBe(10);
				expect(ranking.body.data.top.slice(0, 4).map((r: { posicion: number; participante: { nombre: string }; puntos: number; aciertos: number }) => [r.posicion, r.participante.nombre, r.puntos, r.aciertos])).toEqual([
					[1, 'Ana Demo', 6, 2],
					[1, 'Carla Demo', 6, 2],
					[3, 'Dani Demo', 1, 1],
					[4, 'Eva Demo', 0, 0],
				]);
				expect(ranking.body.data.propia).toMatchObject({ posicion: 1, enTop: true, enLista: true });
		const list = await request(app).get('/apuestas/partidos?pageSize=100').set('Cookie', session.cookie);
		expect(list.status).toBe(200);
		const states = list.body.data.items.map((m: { apuesta: { estado: string } }) => m.apuesta.estado);
		expect(new Set(states)).toEqual(new Set(['disponible', 'cerrada', 'en_curso', 'finalizado', 'cancelado']));
		const finished = list.body.data.items.filter((m: { apuesta: { estado: string } }) => m.apuesta.estado === 'finalizado');
		expect(finished.every((m: { local: { goles: number | null } }) => m.local.goles !== null)).toBe(true);
		const voley = list.body.data.items.find((m: { deporte: { slug: string } }) => m.deporte.slug === 'demo-voley');
		expect(voley.apuesta.pronosticosAdmitidos.resultadoGeneral).toEqual(['local_gana', 'visitante_gana']);

		// The sample bettor can really bet on an open match.
		const open = list.body.data.items.find((m: { apuesta: { estado: string } }) => m.apuesta.estado === 'disponible');
		const ticket = await request(app)
			.post('/apuestas/tickets')
			.set('Cookie', session.cookie)
			.set('X-CSRF-Token', session.csrfToken)
			.set('Idempotency-Key', crypto.randomUUID())
			.send({ selecciones: [{ partidoId: open.id, tipo: 'resultado_general', pronostico: 'local_gana' }] });
		expect(ticket.status).toBe(201);

		// The other accounts.
		const beto = DEMO_ACCOUNTS.find((a) => a.key === 'beto')!;
		const pending = await login(app, beto.email, beto.password);
		expect((await request(app).get('/auth/me').set('Cookie', pending.cookie)).body.data.user).toMatchObject({ estadoValidacion: 'pendiente', saldoMonedas: 0 });
		const adminAccount = DEMO_ACCOUNTS.find((a) => a.key === 'admin')!;
		const adminSession = await login(app, adminAccount.email, adminAccount.password);
		expect((await request(app).get('/admin/sesion').set('Cookie', adminSession.cookie)).status).toBe(200);

		expect((await checkCoinConsistency(pool)).ok).toBe(true);
	});

	it('confirms every sample ticket before the betting close of each of its matches (BR-014), and settles them with the real rules', async () => {
		const now = new Date();
		const times = sampleTicketTimes(now);
		expect(times.length).toBeGreaterThan(0);
		for (const [i, { confirmado, cierres }] of times.entries()) {
			for (const cierre of cierres) expect(confirmado, `ticket ${i}`).toBeLessThan(cierre);
		}

		const summary = await seedDevData(pool, now);
		// The same check on the loaded rows: no selection belongs to a ticket confirmed at or after its match's close.
		expect(
			await count(
				pool,
				`SELECT COUNT(*) AS n FROM seleccion s JOIN ticket t ON t.id = s.ticket_id JOIN partido p ON p.id = s.partido_id
				WHERE t.creado_en >= p.fecha_hora - INTERVAL ${HORAS_CIERRE_APUESTAS} HOUR`,
			),
		).toBe(0);
		// Settled picks got the points of lib/points.ts; pending and voided ones have none.
		const [rows] = await pool.query<RowDataPacket[]>(
			`SELECT e.codigo AS estado, s.puntos_obtenidos AS puntos, ta.codigo AS tipo, rg.codigo AS pronostico,
				s.pronostico_goles_local AS gl, s.pronostico_goles_visitante AS gv, pl.goles AS ml, pv.goles AS mv
			FROM seleccion s JOIN estado_seleccion e ON e.id = s.estado_seleccion_id JOIN tipo_apuesta ta ON ta.id = s.tipo_apuesta_id
			LEFT JOIN resultado_general rg ON rg.id = s.pronostico_resultado_id
			JOIN partido_equipo pl ON pl.partido_id = s.partido_id AND pl.es_visita = FALSE
			JOIN partido_equipo pv ON pv.partido_id = s.partido_id AND pv.es_visita = TRUE`,
		);
		for (const row of rows) {
			if (row.estado === 'acertada' || row.estado === 'no_acertada') {
				const pronostico = row.tipo === 'resultado_general' ? { tipo: row.tipo, pronostico: row.pronostico } : { tipo: row.tipo, golesLocal: row.gl, golesVisitante: row.gv };
				const settled = settleSelection(pronostico, { golesLocal: row.ml, golesVisitante: row.mv, resultado: resultOfScore(row.ml, row.mv) });
				expect({ estado: row.estado, puntos: row.puntos }).toEqual({ estado: settled.estado, puntos: settled.puntos });
			} else {
				expect(row.puntos).toBeNull();
			}
		}
		// The CLI prints the real balance, not the initial 10 coins.
		const balances = Object.fromEntries(summary.cuentas.map((c) => [c.email.split('@')[0], c.saldoMonedas]));
		expect(balances).toMatchObject({ admin: null, ana: 6, carla: 7, dani: 9, eva: 9, beto: 0, fede: 9, gabi: 10 });
	});

	it('is repeatable: seeding again replaces the sample data (and its own tickets) by its marks', async () => {
		await seedDevData(pool);
		const ana = DEMO_ACCOUNTS.find((a) => a.key === 'ana')!;
		const session = await login(app, ana.email, ana.password);
		const list = await request(app).get('/apuestas/partidos?estadoApuesta=disponible').set('Cookie', session.cookie);
		await request(app)
			.post('/apuestas/tickets')
			.set('Cookie', session.cookie)
			.set('X-CSRF-Token', session.csrfToken)
			.set('Idempotency-Key', crypto.randomUUID())
			.send({ selecciones: [{ partidoId: list.body.data.items[0].id, tipo: 'resultado_general', pronostico: 'empate' }] });
		const first = await snapshot(pool);

		await seedDevData(pool);
		// The sample tickets come back as seeded; Ana's extra one is gone.
		expect(await snapshot(pool)).toEqual({ ...first, movimiento_moneda: 22, ticket: 7, seleccion: 11, sesion: 0 });
		expect(await marks(pool)).toBe(116);
		expect((await checkCoinConsistency(pool)).ok).toBe(true);
	});

	it('cleaning removes only marked rows: look-alike real data stays', async () => {
		const api = await adminApi(app, pool);
		// The tester's look-alikes: a sport named like a sample one, a demo- slug with a whole competition, a "(demo)" player, a @demo.liga.test account.
		await created(api.post('/deportes', { nombre: 'Demo Ball', slug: 'demo-ball', permiteEmpate: true }));
		const rugby = await created<{ id: number }>(api.post('/deportes', { nombre: 'Rugby', slug: 'demo-rugby', permiteEmpate: true }));
		const comp = await created<{ id: number }>(api.post('/competiciones', { deporteId: rugby.id, nombre: 'Liga demo', slug: 'demo-liga' }));
		const a = await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'Real A' })));
		const b = await created<{ id: number }>(api.post('/equipos', teamBody(comp.id, { nombre: 'Real B' })));
		await created(api.post('/partidos', { competicionId: comp.id, localId: a.id, visitaId: b.id, jornada: 1, fechaHora: iso(Date.now() + 72 * HOUR), sede: 'Estadio Demo Norte' }));
		const juan = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Juan (demo)' }));
		await created(api.post('/planteles', { jugadorId: juan.id, equipoId: a.id, numeroCamiseta: 7 }));
		await registerUser(app, { email: 'real@demo.liga.test' });
		const before = await snapshot(pool);

		await seedDevData(pool);
		const done = await cleanDevData(pool);
		expect(done).toEqual({ deportes: 3, partidos: 14, jugadores: 24, cuentas: 12 });
		expect(await snapshot(pool)).toEqual(before);
		expect(await count(pool, "SELECT COUNT(*) AS n FROM deporte WHERE slug IN ('demo-ball', 'demo-rugby')")).toBe(2);
		expect(await count(pool, "SELECT COUNT(*) AS n FROM usuario WHERE email = 'real@demo.liga.test'")).toBe(1);
		expect(await marks(pool)).toBe(0);
		// Cleaning twice does nothing.
		expect(await cleanDevData(pool)).toEqual({ deportes: 0, partidos: 0, jugadores: 0, cuentas: 0 });
		expect(await snapshot(pool)).toEqual(before);
	});

	it('cleaning also removes what the sample accounts did: the sample admin’s result, goal and media, and its audit records', async () => {
		await seedDevData(pool);
		const before = await snapshot(pool);
		const account = DEMO_ACCOUNTS.find((x) => x.key === 'admin')!;
		const session = await login(app, account.email, account.password);
		const as = (req: request.Test) => req.set('Cookie', session.cookie).set('X-CSRF-Token', session.csrfToken);
		const match = await inProgressMatch();
		expect((await as(request(app).put(`/admin/partidos/${match.id}/resultado`)).send({ golesLocal: 1, golesVisitante: 0 })).status).toBe(200);
		expect((await as(request(app).post(`/admin/partidos/${match.id}/goles`)).send({ jugadorId: match.jugadorId, equipoId: match.equipoId, minuto: 10 })).status).toBe(201);
		expect((await as(request(app).post(`/admin/partidos/${match.id}/multimedia/videos`)).send({ url: 'https://youtu.be/dQw4w9WgXcQ' })).status).toBe(201);
		expect(await count(pool, 'SELECT COUNT(*) AS n FROM auditoria')).toBe(3);

		await cleanDevData(pool);
		const after = await snapshot(pool);
		expect(after).toEqual(Object.fromEntries(Object.keys(before).map((t) => [t, 0])));
	});

	const refusals: Array<[string, (ctx: { api: Awaited<ReturnType<typeof adminApi>>; match: Awaited<ReturnType<typeof inProgressMatch>> }) => Promise<unknown>, RegExp]> = [
		[
			'a bet of a real account',
			async ({ match }) => {
				const other = await signedInUser(app, pool, { estado: 'validado' });
				const [ticket] = await pool.query<ResultSetHeader>(
					'INSERT INTO ticket (usuario_id, creado_en, clave_idempotencia, huella_solicitud) VALUES (?, UTC_TIMESTAMP(), ?, ?)',
					[other.user.id, crypto.randomUUID(), 'a'.repeat(64)],
				);
				await pool.query(
					`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id)
					VALUES (?, ?, (SELECT id FROM tipo_apuesta WHERE codigo = 'resultado_general'),
						(SELECT id FROM resultado_general WHERE codigo = 'empate'), (SELECT id FROM estado_seleccion WHERE codigo = 'pendiente'))`,
					[ticket.insertId, match.id],
				);
			},
			/apuestas de otras cuentas sobre partidos de ejemplo \(.*@/,
		],
		[
			'a real enrollment in a sample team',
			async ({ api, match }) => {
				const pedro = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Pedro' }));
				await created(api.post('/planteles', { jugadorId: pedro.id, equipoId: match.equipoId, numeroCamiseta: 50 }));
			},
			/1 inscripción real/,
		],
		[
			'a real goal, with its result, on a sample match',
			async ({ api, match }) => {
				expect((await api.put(`/partidos/${match.id}/resultado`, { golesLocal: 1, golesVisitante: 0 })).status).toBe(200);
				await created(api.post(`/partidos/${match.id}/goles`, { jugadorId: match.jugadorId, equipoId: match.equipoId, minuto: 5 }));
			},
			/1 gol real[\s\S]*1 acción de un administrador real/,
		],
		[
			'a result loaded by a real admin',
			async ({ api, match }) => {
				expect((await api.put(`/partidos/${match.id}/resultado`, { golesLocal: 2, golesVisitante: 2 })).status).toBe(200);
			},
			/1 acción de un administrador real/,
		],
		[
			'a real video on a sample match',
			async ({ api, match }) => {
				await created(api.post(`/partidos/${match.id}/multimedia/videos`, { url: 'https://youtu.be/dQw4w9WgXcQ' }));
			},
			/1 imagen o video real/,
		],
		[
			'a real team in a sample competition',
			async ({ api, match }) => {
				await created(api.post('/equipos', teamBody(match.competicionId, { nombre: 'Intruso' })));
			},
			/1 equipo real en una competición de ejemplo/,
		],
		[
			'a real match between sample teams',
			async ({ api, match }) => {
				const [[visita]] = await pool.query<RowDataPacket[]>('SELECT id FROM equipo WHERE competicion_id = ? AND id <> ? LIMIT 1', [match.competicionId, match.equipoId]);
				await created(
					api.post('/partidos', { competicionId: match.competicionId, localId: match.equipoId, visitaId: visita!.id, jornada: 9, fechaHora: iso(Date.now() + 96 * HOUR), sede: 'Otra' }),
				);
			},
			/1 partido real en una competición de ejemplo[\s\S]*2 lados de partidos reales con equipos de ejemplo/,
		],
		[
			'a real competition in a sample sport',
			async ({ api, match }) => {
				await created(api.post('/competiciones', { deporteId: match.deporteId, nombre: 'Copa real' }));
			},
			/1 competición real en un deporte de ejemplo/,
		],
		[
			'a real admin’s edit of a sample sport',
			async ({ api, match }) => {
				expect((await api.patch(`/deportes/${match.deporteId}`, { nombre: 'Fútbol renombrado' })).status).toBe(200);
			},
			/1 acción de un administrador real/,
		],
	];

	it.each(refusals)('refuses to clean or reseed with %s, deleting nothing', async (_label, makeReal, message) => {
		await seedDevData(pool);
		const api = await adminApi(app, pool);
		await makeReal({ api, match: await inProgressMatch() });
		const before = await snapshot(pool);
		const markCount = await marks(pool);

		const error = await cleanDevData(pool).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(DevSeedError);
		expect((error as Error).message).toMatch(/no se borró nada/);
		expect((error as Error).message).toMatch(message);
		expect(await snapshot(pool)).toEqual(before);
		expect(await marks(pool)).toBe(markCount);
		await expect(seedDevData(pool)).rejects.toBeInstanceOf(DevSeedError);
		expect(await snapshot(pool)).toEqual(before);
	});

	it('refuses to seed over real rows that use a sample email or slug, changing nothing', async () => {
		await registerUser(app, { email: 'admin@demo.liga.test' });
		const before = await snapshot(pool);
		await expect(seedDevData(pool)).rejects.toThrow(/cuenta admin@demo\.liga\.test.*No se cambió nada/);
		expect(await snapshot(pool)).toEqual(before);

		const api = await adminApi(app, pool);
		await created(api.post('/deportes', { nombre: 'Fútbol real', slug: 'demo-futbol', permiteEmpate: true }));
		await expect(seedDevData(pool)).rejects.toThrow(/deporte demo-futbol/);
		expect(await marks(pool)).toBe(0);
	});
});
