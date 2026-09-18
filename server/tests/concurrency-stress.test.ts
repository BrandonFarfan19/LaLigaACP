import type { Express } from 'express';
import { randomUUID } from 'node:crypto';
import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { transactionStats, withTransaction } from '../src/db/transaction.js';
import { evaluateTicketInTransaction } from '../src/services/betting.service.js';
import { createTestApp, env } from './helpers/app.js';
import { signedInUser } from './helpers/auth.js';
import { type AdminApi, adminApi, created, insertMatch, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

/**
 * T-09 follow-up, extended in T-10: real ticket confirmations
 * (POST /apuestas/tickets, including the same Idempotency-Key sent three
 * times at once) and locked evaluations running in parallel with the admin
 * writes that lock the same rows: postponing and advancing a match, editing
 * matches whose betting closed (T-07 had manual state changes until T-13),
 * flipping permite_empate, (T-12) loading and confirming a result, and (T-16)
 * cancelling a match with bets every other round.
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
		/** Programado with a past date: each round loads and confirms one (T-12). */
		past: [] as number[],
		bettors: [] as number[],
		sessions: [] as Array<Awaited<ReturnType<typeof signedInUser>>>,
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
				for (let i = 0; i < ROUNDS; i++) s.past.push(await insertMatch(pool, comp, home, away, 'programado', wholeSeconds(now - DAY - i * MINUTE)));
			} else {
				for (let i = 0; i < 6; i++) s.otherSport.push(await insertMatch(pool, comp, home, away, 'programado', wholeSeconds(now + 4 * DAY + i * HOUR)));
			}
		}
		for (let i = 0; i < TICKETS_PER_ROUND; i++) {
			const bettor = await signedInUser(app, pool, { estado: 'validado' });
			await pool.query('UPDATE usuario SET saldo_monedas = 60000 WHERE id = ?', [bettor.user.id]);
			s.bettors.push(bettor.user.id);
			s.sessions.push(bettor);
		}
	});

	afterAll(async () => {
		await resetDatabase(pool);
		await pool.end();
	});

	const ROLLBACK = Symbol('solo evaluar');

	/** T-09's locked evaluation alone, rolled back after holding the locks a little. */
	function evaluateOnly(userId: number, matchIds: number[]) {
		return withTransaction(pool, async (conn) => {
			await sleep(Math.random() * 80); // spread the start, so it overlaps the admin writes at different points
			const selecciones = matchIds.map((partidoId) => ({ partidoId, tipo: 'resultado_general' as const, pronostico: 'local_gana' as const }));
			await evaluateTicketInTransaction(conn, userId, selecciones);
			await sleep(5 + Math.random() * 15);
			throw ROLLBACK;
		}).catch((error) => {
			if (error === ROLLBACK) return 'evaluado';
			throw error;
		});
	}

	/** T-10's real confirmation over HTTP, started at a random moment. */
	async function confirm(bettor: number, matchIds: number[], key: string) {
		await sleep(Math.random() * 80);
		const who = s.sessions[bettor]!;
		return request(app)
			.post('/apuestas/tickets')
			.set('Cookie', who.cookie)
			.set('X-CSRF-Token', who.csrfToken)
			.set('Idempotency-Key', key)
			.send({ selecciones: matchIds.map((partidoId) => ({ partidoId, tipo: 'resultado_general', pronostico: 'local_gana' })) });
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

		let lastBetting: number[] = [];
		const cancelled: number[] = [];
		for (let round = 0; round < ROUNDS; round++) {
			const flip = round % 2 === 0;
			// The matches the admin touches this round are in the tickets too: that is where locks collide.
			const [postponed, advanced] = pick(s.open, 2) as [number, number];
			const [starting, stopping] = pick(s.closed, 2) as [number, number];
			const other = pick(s.otherSport, 1)[0]!;
			const finishing = s.past[round]!;
			const betting = [postponed, advanced, ...pick(s.open, 1)]; // all open: it is confirmed
			const key = randomUUID();
			// T-16: every other round, cancel a match bettor 0 bet on last round (not touched this round), while bettor 0
			// confirms again: the cancellation locks that user before the match. It leaves the open list for good.
			const cancelling = round % 2 === 1 ? lastBetting.find((id) => !betting.includes(id) && id !== postponed && id !== advanced) : undefined;
			if (cancelling) {
				s.open.splice(s.open.indexOf(cancelling), 1);
				cancelled.push(cancelling);
			}
			lastBetting = betting;
			const work: Array<Promise<unknown>> = [
				...(cancelling ? [api.post(`/partidos/${cancelling}/cancelacion/confirmar`, { confirmar: true })] : []),
				// Bettor 0 confirms, the same key three times at once (one ticket); bettor 1 is refused
				// (closed matches) but locks them; bettor 2 only evaluates, so the other sport keeps
				// no bets and its draw rule can flip.
				confirm(0, betting, key),
				confirm(0, betting, key),
				confirm(0, betting, key),
				confirm(1, [starting, stopping, postponed, finishing], randomUUID()),
				evaluateOnly(s.bettors[2]!, [other, starting, stopping, postponed]),
				shift(postponed, HOUR),
				shift(advanced, -MINUTE), // 409 once it has bets
				shift(other, HOUR),
				(async () => {
					await sleep(Math.random() * 40);
					const goles = { golesLocal: round % 4, golesVisitante: 1 };
					const loaded = await api.put(`/partidos/${finishing}/resultado`, goles);
					if (loaded.status !== 200) return loaded;
					return api.post(`/partidos/${finishing}/resultado/confirmar`, { confirmar: true, ...goles });
				})(),
				api.patch(`/partidos/${starting}`, { jornada: 1 + (round % 30) }),
				api.patch(`/partidos/${stopping}`, { sede: `Sede ${round}` }),
				api.patch(`/deportes/${s.sports[1]}`, { permiteEmpate: !flip }),
				api.patch(`/deportes/${s.sports[0]}`, { permiteEmpate: flip }),
			];
			const settled = await Promise.allSettled(work);
			const created = settled.filter((r) => r.status === 'fulfilled' && (r.value as { status?: number }).status === 201);
			expect(created, 'la misma clave tres veces crea un solo ticket').toHaveLength(1);

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
				expect([200, 201, 409], key).toContain(value.status);
				if (value.status === 409) {
					expect(['MATCH_HAS_BETS', 'INVALID_STATE_TRANSITION', 'DRAW_RULE_LOCKED', 'MATCH_NOT_PROGRAMMED', 'TICKET_REJECTED', 'MATCH_HAS_RESULT'], key).toContain(
						value.body.error!.code,
					);
				}
			}
		}

		// Real contention happened: bets were placed and admin writes went through.
		expect(outcomes['201'], JSON.stringify(outcomes)).toBe(ROUNDS);
		expect(outcomes['409:TICKET_REJECTED'], JSON.stringify(outcomes)).toBe(ROUNDS);
		const [[mine]] = await pool.query<RowDataPacket[]>('SELECT COUNT(*) AS n FROM ticket WHERE usuario_id = ?', [s.bettors[0]]);
		expect(Number(mine!.n)).toBe(ROUNDS);
		expect(outcomes['200'] ?? 0, JSON.stringify(outcomes)).toBeGreaterThan(0);
		// Every round's result was confirmed.
		const [[finished]] = await pool.query<RowDataPacket[]>(
			"SELECT COUNT(*) AS n FROM partido p JOIN estado_partido ep ON ep.id = p.estado_partido_id WHERE ep.codigo = 'finalizado' AND p.id IN (?)",
			[s.past],
		);
		expect(Number(finished!.n)).toBe(ROUNDS);
		// Every chosen match was cancelled, with its bets voided.
		expect(cancelled.length).toBeGreaterThan(0);
		const [[voided]] = await pool.query<RowDataPacket[]>(
			"SELECT COUNT(*) AS n FROM partido p JOIN estado_partido ep ON ep.id = p.estado_partido_id WHERE ep.codigo = 'cancelado' AND p.id IN (?)",
			[cancelled],
		);
		expect(Number(voided!.n)).toBe(cancelled.length);
		// Not a single deadlock, not even one that the retry absorbed.
		expect(transactionStats.deadlockRetries - statsBefore.deadlockRetries, JSON.stringify(outcomes)).toBe(0);
		expect(transactionStats.deadlocksExhausted - statsBefore.deadlocksExhausted).toBe(0);
		const deadlockAfter = await latestDeadlock();
		if (deadlockAfter !== deadlockBefore) {
			expect(deadlockAfter ?? '', 'InnoDB registró un deadlock nuevo en la base de pruebas').not.toContain(`\`${env.db.database}\`.`);
		}

		// Coins stayed consistent with the bets actually placed, and the ones refunded by the cancellations.
		const [[coins]] = await pool.query<RowDataPacket[]>(
			`SELECT (SELECT SUM(saldo_monedas) FROM usuario WHERE id IN (?)) AS saldo,
				(SELECT COUNT(*) FROM seleccion) AS selecciones,
				(SELECT COUNT(*) FROM seleccion s JOIN estado_seleccion es ON es.id = s.estado_seleccion_id WHERE es.codigo = 'anulada') AS anuladas`,
			[s.bettors],
		);
		expect(Number(coins!.anuladas)).toBeGreaterThan(0);
		expect(Number(coins!.saldo)).toBe(60000 * TICKETS_PER_ROUND - Number(coins!.selecciones) + Number(coins!.anuladas));
	});
});
