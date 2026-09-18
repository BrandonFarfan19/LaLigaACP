import type { Express } from 'express';
import type { Pool, RowDataPacket } from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { slugify } from '../src/lib/slug.js';
import { createTestApp } from './helpers/app.js';
import { type AdminApi, adminApi, created, teamBody } from './helpers/catalog.js';
import { resetDatabase } from './helpers/db.js';

/** Names that are not printable text. Written with escapes: none of these characters is visible. */
const BAD_NAMES: Array<[string, string]> = [
	['a tab inside', 'Club\tAtlético'],
	['a newline inside', 'Club\nAtlético'],
	['a NUL', 'Club\u0000'],
	['an escape sequence', 'Club \u001B[31m rojo'],
	['DEL', 'Club\u007F'],
	['a C1 control', 'Club\u0085X'],
	['a lone high surrogate', 'Club \uD83D'],
	['a lone low surrogate', 'Club \uDE00'],
	['reversed surrogates', 'Club \uDE00\uD83D'],
	['a right-to-left override (U+202E)', 'Club \u202Eatciv'],
	['a left-to-right isolate (U+2066)', 'Club \u2066X\u2069'],
	['a zero-width space (U+200B)', 'Cl\u200Bub'],
	['a word joiner (U+2060)', 'Cl\u2060ub'],
	['a BOM (U+FEFF)', 'Cl\uFEFFub'],
	['a soft hyphen (U+00AD)', 'Cl\u00ADub'],
	['a right-to-left mark (U+200F)', 'Club\u200F X'],
	['a Hangul filler (U+3164)', 'Club \u3164'],
];

const cp = (...points: number[]) => String.fromCodePoint(...points);

/** T-08 follow-up: the whole Cf category (except ZWJ/ZWNJ), line/paragraph separators, and names that look empty. */
const BAD_NAMES_T08: Array<[string, string]> = [
	['a function application (U+2061, Cf)', `Club${cp(0x2061)}X`],
	['an Arabic letter mark (U+061C, Cf)', `Club ${cp(0x061c)}X`],
	['a Mongolian vowel separator (U+180E, Cf)', `Club${cp(0x180e)}X`],
	['an interlinear annotation (U+FFF9, Cf)', `Club${cp(0xfff9)}X`],
	['a Kaithi number sign (U+110BD, astral Cf)', `Club${cp(0x110bd)}X`],
	['tag characters (U+E0041, astral Cf)', `Club${cp(0xe0041, 0xe0042)}`],
	['a line separator (U+2028, Zl)', `Club${cp(0x2028)}X`],
	['a paragraph separator (U+2029, Zp)', `Club${cp(0x2029)}X`],
	['a blank Braille pattern inside (U+2800)', `Club ${cp(0x2800)} X`],
	['only a ZWJ', cp(0x200d)],
	['only a ZWNJ', cp(0x200c)],
	['only a combining accent', cp(0x0301)],
	['only a variation selector (U+FE0F)', cp(0xfe0f)],
	['only a blank Braille pattern', cp(0x2800)],
	['only tag characters', cp(0xe0041, 0xe0042, 0xe007f)],
	['only an emoji', '🦅'],
	['only punctuation', '¡¿!?'],
	['only symbols and spaces', '★ ☆ ★'],
];

describe('names and slugs of the sports catalog (T-06 follow-up)', () => {
	let app: Express;
	let pool: Pool;
	let api: AdminApi;

	beforeAll(() => {
		({ app, pool } = createTestApp());
	});

	beforeEach(async () => {
		await resetDatabase(pool);
		api = await adminApi(app, pool);
	});

	afterAll(async () => {
		await pool.end();
	});

	it.each([...BAD_NAMES, ...BAD_NAMES_T08])('rejects %s in every name field', async (_label, bad) => {
		const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
		const competition = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Liga' }));
		const team = await created<{ id: number }>(api.post('/equipos', teamBody(competition.id)));
		const player = await created<{ id: number }>(api.post('/jugadores', { nombre: 'Ana' }));

		const attempts: Array<[string, Promise<{ status: number; body: { error: { details: Array<{ path: string }> } } }>, string]> = [
			['POST deporte', api.post('/deportes', { nombre: bad, slug: 'x', permiteEmpate: true }), 'nombre'],
			['PATCH deporte', api.patch(`/deportes/${sport.id}`, { nombre: bad }), 'nombre'],
			['POST competicion', api.post('/competiciones', { deporteId: sport.id, nombre: bad, slug: 'y' }), 'nombre'],
			['PATCH competicion', api.patch(`/competiciones/${competition.id}`, { nombre: bad }), 'nombre'],
			['POST equipo nombre', api.post('/equipos', teamBody(competition.id, { nombre: bad })), 'nombre'],
			['POST equipo nombreCorto', api.post('/equipos', teamBody(competition.id, { nombreCorto: bad })), 'nombreCorto'],
			['PATCH equipo', api.patch(`/equipos/${team.id}`, { nombreCorto: bad }), 'nombreCorto'],
			['POST jugador', api.post('/jugadores', { nombre: bad }), 'nombre'],
			['PATCH jugador', api.patch(`/jugadores/${player.id}`, { nombre: bad }), 'nombre'],
		];
		for (const [label, attempt, path] of attempts) {
			const res = await attempt;
			expect(res.status, label).toBe(400);
			expect(res.body.error.details, label).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
		}
	});

	it.each([
		['a lone high surrogate', 'https://x.test/a\uD83D.png'],
		['a lone low surrogate', 'https://x.test/a\uDE00.png'],
		['reversed surrogates', 'https://x.test/\uDE00\uD83D.png'],
		['a lone surrogate at the end', 'https://x.test/a.png\uD83D'],
		['a lone surrogate in a relative path', 'escudos/a\uD83D.png'],
		['a tab (new URL drops it)', 'https://x.test/a\t.png'],
		['a newline (new URL drops it)', 'https://x.test/a\n.png'],
		['a right-to-left override', 'https://x.test/\u202Egnp.png'],
		['a zero-width space', 'https://x.test/a\u200B.png'],
		['a line separator', 'https://x.test/a\u2028.png'],
		['a Hangul filler (U+3164)', 'https://x.test/a\u3164.png'],
		['a Hangul choseong filler (U+115F)', 'https://x.test/a\u115F.png'],
		['a Hangul filler in a relative path', 'escudos/a\u3164.png'],
		['a blank Braille pattern', 'https://x.test/a\u2800.png'],
		// T-18 fix: other blanks inside an https URL.
		...['\u17B4', '\u17B5', '\u180B', '\u034F', '\u00A0', '\u2000', '\u2005', '\u200A', '\u202F', '\u205F', '\u3000', '\uFE0F', cp(0x1d159), ' '].map(
			(blank): [string, string] => [`U+${blank.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} inside an https URL`, `https://x.test/a${blank}b.png`],
		),
	])('rejects %s in escudo and foto (second fix of T-17)', async (_label, bad) => {
		const sport = await created<{ id: number }>(api.post('/deportes', { nombre: 'Fútbol', permiteEmpate: true }));
		const competition = await created<{ id: number }>(api.post('/competiciones', { deporteId: sport.id, nombre: 'Liga' }));
		const team = await created<{ id: number; escudo: string }>(api.post('/equipos', teamBody(competition.id)));
		const player = await created<{ id: number; foto: string | null }>(api.post('/jugadores', { nombre: 'Ana', foto: 'fotos/ana.png' }));

		const attempts: Array<[string, Promise<{ status: number; body: { error: { details: Array<{ path: string }> } } }>, string]> = [
			['POST equipo', api.post('/equipos', teamBody(competition.id, { nombre: 'Otro', escudo: bad })), 'escudo'],
			['PATCH equipo', api.patch(`/equipos/${team.id}`, { escudo: bad }), 'escudo'],
			['POST jugador', api.post('/jugadores', { nombre: 'Bea', foto: bad }), 'foto'],
			['PATCH jugador', api.patch(`/jugadores/${player.id}`, { foto: bad }), 'foto'],
		];
		for (const [label, attempt, path] of attempts) {
			const res = await attempt;
			expect(res.status, label).toBe(400);
			expect(res.body.error.details, label).toEqual(expect.arrayContaining([expect.objectContaining({ path })]));
		}
		const [[row]] = await pool.query<RowDataPacket[]>(
			'SELECT (SELECT COUNT(*) FROM equipo) AS equipos, (SELECT COUNT(*) FROM jugador) AS jugadores, (SELECT escudo FROM equipo WHERE id = ?) AS escudo, (SELECT foto FROM jugador WHERE id = ?) AS foto',
			[team.id, player.id],
		);
		expect([Number(row!.equipos), Number(row!.jugadores), row!.escudo, row!.foto]).toEqual([1, 1, team.escudo, 'fotos/ana.png']);
	});

	it('still accepts escudo and foto with a well-formed emoji or accents', async () => {
		const res = await api.post('/jugadores', { nombre: 'Ana', foto: 'https://x.test/fotos/ñandú-🦅.png' });
		expect(res.status, JSON.stringify(res.body)).toBe(201);
		expect(res.body.data.foto).toBe('https://x.test/fotos/ñandú-🦅.png');
	});

	it('accepts normal names with accents, emoji and surrounding spaces', async () => {
		const res = await api.post('/jugadores', { nombre: '  José Núñez 🦅 Ñandú  ' });

		expect(res.status).toBe(201);
		expect(res.body.data.nombre).toBe('José Núñez 🦅 Ñandú');
	});

	it('keeps ZWJ emoji sequences, ZWNJ and right-to-left scripts', async () => {
		for (const nombre of ['Familia 👨\u200D👩\u200D👧', 'می\u200Cخواهم', 'نادي الأهلي', 'מכבי תל אביב']) {
			const res = await api.post('/jugadores', { nombre });
			expect(res.status, nombre).toBe(201);
			expect(res.body.data.nombre).toBe(nombre);
		}
	});

	it('keeps names that mix emoji or symbols with at least one letter or digit, and digit-only names', async () => {
		for (const nombre of ['Club 🦅', '★ Estrellas ★', `Cafe${cp(0x0301)}`, '1860', 'Ⅻ Legión', `Ñu ${cp(0x2764, 0xfe0f)}`]) {
			const res = await api.post('/jugadores', { nombre });
			expect(res.status, nombre).toBe(201);
		}
	});

	it.each([
		['Straße', 'strasse'],
		['STRAẞE', 'strasse'],
		['Æsir Ørsted', 'aesir-orsted'],
		['Œuvre', 'oeuvre'],
		['Łódź', 'lodz'],
		['Đorđević', 'dordevic'],
		['Þór', 'thor'],
		['Iğdır ılık', 'igdir-ilik'],
		['Fútbol 5 – Salón', 'futbol-5-salon'],
		['Ñandú', 'nandu'],
		['  --Hola__Mundo--  ', 'hola-mundo'],
		['漢字', ''],
	])('slugify(%j) = %j', (input, expected) => {
		expect(slugify(input)).toBe(expected);
	});

	it('the generated slug uses the transliteration', async () => {
		expect((await created(api.post('/deportes', { nombre: 'Straße-Fußball', permiteEmpate: true }))).slug).toBe('strasse-fussball');
	});
});
