import type { Express } from 'express';
import mysql, { type Pool, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transactionStats, withTransaction } from '../src/db/transaction.js';
import { evaluateTicketInTransaction } from '../src/services/betting.service.js';
import { debitSelections } from '../src/services/coins.service.js';
import { createTestApp, env } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

/**
 * T-09 follow-up: tickets (T-09's locked evaluation plus what T-10 will do:
 * insert the ticket and its selections, debit the coins) running in parallel
 * with the admin writes that lock the same rows: postponing and advancing a
 * match, starting it (en_curso) and back, and flipping permite_empate.
 *
 * Before the fix the ticket locked through a joined query with no fixed plan
 * and deadlocked with changeMatchState (6 deadlocks in 8 rounds). Now every
 * transaction locks in the documented order, so the rounds must finish with
 * no deadlock at all (not even a retried one), no 500 and no
 * CONCURRENT_UPDATE. When root access is configured, InnoDB's own "latest
 * deadlock" is checked too: it must not name this test database.
 */

const ROUNDS = 25;
const TICKETS_PER_ROUND = 3;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const wholeSeconds = (ms: number) => new Date(Math.floor(ms / 1000) * 1000);
const pick = <T>(list: readonly T[], n: number): T[] => [...list].sort(() => Math.random() - 0.5).slice(0, n);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The "LATEST DETECTED DEADLOCK" section of SHOW ENGINE INNODB STATUS, or null (no root access / none yet). */
async function latestDeadlock(): Promise<string | null> {
	const password = process.env.MYSQL_ROOT_PASSWORD;
	if (!password) return null;
	const conn = await mysql.createConnection({ host: env.db.host, port: env.db.port, user: 'root', password });
	try {
		const [[row]] = await conn.query<RowDataPacket[]>('SHOW ENGINE INNODB STATUS');
		const status = String(row?.Status ?? '');
		return /LATEST DETECTED DEADLOCK\n-+\n([\s\S]*?)\n-{5,}\n[A-Z]/.exec(status)?.[1] ?? null;
	} finally {
		await conn.end();
	}
}

describe('concurrency stress: tickets vs match and sport edits (T-09 follow-up)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;
	const s = {
		sports: [] as number[],
		open: [] as number[],
		closed: [] as number[],
		otherSport: [] as number[],
		bettors: [] as number[],
	};

	beforeAll(async () => {
		({ app, pool } = createTestApp());
		await resetDatabase(pool);
		api = await adminApi(app, pool);
		const post = (path: string, body: unknown) => created<{ id: number }>(api.post(path, body));

		for (const [nombre, permiteEmpate] of [['Fútbol', true], ['Handball', true]] as const) {
			const sport = (await post('/deportes', { nombre, permiteEmpate })).id;
			const comp = (await post('/competiciones', { deporteId: sport, nombre: `Liga ${nombre}` })).id;
			const home = (await post('/equipos', teamBody(comp, { nombre: `Local ${nombre}` }))).id;
			const away = (await post('/equipos', teamBody(comp, { nombre: `Visita ${nombre}` }))).id;
			s.sports.push(sport);
			const now = Date.now();
			if (s.sports.length === 1) {
				// About 45 matches, as in the tester's run: open ones and ones whose betting already closed.
				for (let i = 0; i < 30; i++) s.open.push(await insertMatch(pool, comp, home, away, 'programado', wholeSeconds(now + 3 * DAY + i * HOUR)));
				for (let i = 0; i < 15; i++) s.closed.push(await insertMatch(pool, comp, home, away, 'programado', wholeSeconds(now + HOUR + i * MINUTE)));
			} else {
				for (let i = 0; i < 6; i++) s.otherSport.push(await insertMatch(pool, comp, home, away, 'programado', wholeSeconds(now + 4 * DAY + i * HOUR)));
			}
		}
		for (let i = 0; i < TICKETS_PER_ROUND; i++) {
			const bettor = await signedInUser(app, pool, { estado: 'validado' });
			await pool.query('UPDATE usuario SET saldo_monedas = 60000 WHERE id = ?', [bettor.user.id]);
			s.bettors.push(bettor.user.id);
		}
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	const ROLLBACK = Symbol('solo evaluar');

	/** T-09's evaluation plus T-10's writes, in one transaction. `evaluateOnly` rolls back after evaluating. */
	function ticket(userId: number, matchIds: number[], evaluateOnly: boolean) {
		return withTransaction(pool, async (conn) => {
			await sleep(Math.random() * 80); // spread the start, so it overlaps the admin writes at different points
			const selecciones = matchIds.map((partidoId) => ({ partidoId, tipo: 'resultado_general' as const, pronostico: 'local_gana' as const }));
			const evaluation = await evaluateTicketInTransaction(conn, userId, selecciones);
			await sleep(5 + Math.random() * 15); // hold the locks a little, like a real confirmation would
			if (evaluateOnly) throw ROLLBACK;
			if (!evaluation.valido) return 'invalido';
			const [t] = await conn.query<ResultSetHeader>('INSERT INTO ticket (usuario_id, creado_en) VALUES (?, UTC_TIMESTAMP())', [userId]);
			const ids: number[] = [];
			for (const partidoId of matchIds) {
				const [sel] = await conn.query<ResultSetHeader>(
					`INSERT INTO seleccion (ticket_id, partido_id, tipo_apuesta_id, pronostico_resultado_id, estado_seleccion_id)
					SELECT ?, ?, ta.id, rg.id, es.id FROM tipo_apuesta ta, resultado_general rg, estado_seleccion es
					WHERE ta.codigo = 'resultado_general' AND rg.codigo = 'local_gana' AND es.codigo = 'pendiente'`,
					[t.insertId, partidoId],
				);
				ids.push(sel.insertId);
			}
			await debitSelections(conn, userId, ids);
			return 'confirmado';
		}).catch((error) => {
			if (error === ROLLBACK) return 'evaluado';
			throw error;
		});
	}

	async function shift(matchId: number, deltaMs: number) {
		const current = await api.get(`/partidos/${matchId}`);
		const fechaHora = new Date(new Date(current.body.data.fechaHora).getTime() + deltaMs).toISOString();
		return api.patch(`/partidos/${matchId}`, { fechaHora });
	}

	it(`${ROUNDS} rounds: no deadlock, no 500, no CONCURRENT_UPDATE`, { timeout: 120_000 }, async () => {
		const deadlockBefore = await latestDeadlock();
		const statsBefore = { ...transactionStats };
		const outcomes: Record<string, number> = {};
		const count = (key: string) => {
			outcomes[key] = (outcomes[key] ?? 0) + 1;
		};

		for (let round = 0; round < ROUNDS; round++) {
			const flip = round % 2 === 0;
			// The matches the admin touches this round are in the tickets too: that is where locks collide.
			const [postponed, advanced] = pick(s.open, 2) as [number, number];
			const [starting, stopping] = pick(s.closed, 2) as [number, number];
			const other = pick(s.otherSport, 1)[0]!;
			const work: Array<Promise<unknown>> = [
				// Ticket 0 bets; ticket 1 is refused; ticket 2 only evaluates (so the other sport keeps no bets and its draw rule can flip).
				ticket(s.bettors[0]!, [postponed, advanced, ...pick(s.open, 1)], false), // all open: it bets
				ticket(s.bettors[1]!, [starting, stopping, postponed], false), // closed ones: refused, but it locks them
				ticket(s.bettors[2]!, [other, starting, stopping, postponed], true),
				shift(postponed, HOUR),
				shift(advanced, -MINUTE), // 409 once it has bets
				shift(other, HOUR),
				api.post(`/partidos/${starting}/estado`, { estado: 'en_curso' }),
				api.post(`/partidos/${stopping}/estado`, { estado: 'programado' }),
				api.patch(`/deportes/${s.sports[1]}`, { permiteEmpate: !flip }),
				api.patch(`/deportes/${s.sports[0]}`, { permiteEmpate: flip }),
			];
			const settled = await Promise.allSettled(work);

			for (const result of settled) {
				if (result.status === 'rejected') {
					throw new Error(`una transacción falló: ${String((result.reason as Error)?.message ?? result.reason)}`);
				}
				const value = result.value as string | { status: number; body: { error?: { code: string } } };
				if (typeof value === 'string') {
					count(`ticket:${value}`);
					continue;
				}
				const key = `${value.status}${value.body.error ? `:${value.body.error.code}` : ''}`;
				count(key);
				expect(value.status, key).not.toBe(500);
				expect([200, 409], key).toContain(value.status);
				if (value.status === 409) {
					expect(['MATCH_HAS_BETS', 'INVALID_STATE_TRANSITION', 'DRAW_RULE_LOCKED', 'MATCH_NOT_PROGRAMMED'], key).toContain(
						value.body.error!.code,
					);
				}
			}
		}

		// Real contention happened: bets were placed and admin writes went through.
		expect(outcomes['ticket:confirmado'] ?? 0, JSON.stringify(outcomes)).toBeGreaterThan(0);
		expect(outcomes['200'] ?? 0, JSON.stringify(outcomes)).toBeGreaterThan(0);
		// Not a single deadlock, not even one that the retry absorbed.
		expect(transactionStats.deadlockRetries - statsBefore.deadlockRetries, JSON.stringify(outcomes)).toBe(0);
		expect(transactionStats.deadlocksExhausted - statsBefore.deadlocksExhausted).toBe(0);
		const deadlockAfter = await latestDeadlock();
		if (deadlockAfter !== deadlockBefore) {
			expect(deadlockAfter ?? '', 'InnoDB registró un deadlock nuevo en la base de pruebas').not.toContain(`\`${env.db.database}\`.`);
		}

		// Coins stayed consistent with the bets actually placed.
		const [[coins]] = await pool.query<RowDataPacket[]>(
			`SELECT (SELECT SUM(saldo_monedas) FROM usuario WHERE id IN (?)) AS saldo,
				(SELECT COUNT(*) FROM seleccion) AS selecciones`,
			[s.bettors],
		);
		expect(Number(coins!.saldo)).toBe(60000 * TICKETS_PER_ROUND - Number(coins!.selecciones));
	});
});
