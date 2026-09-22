import { z } from 'zod';
import { SLUG_MAX_LENGTH, slugify } from '../lib/slug.js';
import { idFromText, paginationFields } from './common.schema.js';

/**
 * Request schemas of the sports catalog (T-06): deportes, competiciones,
 * equipos, jugadores and plantel entries. All strict: an unknown key in the
 * body or the query string is a 400.
 */

/** A high surrogate not followed by a low one, or a low one not preceded by a high one (UTF-16 code units, no `u` flag). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * Format characters (Unicode category Cf) are invisible: bidirectional
 * controls (U+202E "RIGHT-TO-LEFT OVERRIDE" makes "Club" look like other
 * text), zero-width spaces, the BOM, the soft hyphen, tag characters...
 * All rejected except U+200C and U+200D (ZWNJ, ZWJ): some scripts and emoji
 * sequences (👨\u200D👩\u200D👧) need them.
 */
const FORMAT_CHARACTER = /(?![\u200C\u200D])\p{Cf}/u;

/** Line and paragraph separators (U+2028, U+2029): a name is one line. */
const LINE_BREAK = /[\p{Zl}\p{Zp}]/u;

/**
 * Characters that are letters or symbols by category but render as blank
 * space: Hangul fillers and the blank Braille pattern.
 */
const BLANK_LOOKING = /[\u115F\u1160\u2800\u3164\uFFA0]/;

/** At least one letter or digit (ignoring the blank-looking ones above) so a name never looks empty. */
const VISIBLE_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * A display name: trimmed, not empty, at most `max` characters, and printable
 * text only. Rejected: control characters (tabs, newlines, NUL, escape
 * codes...), format characters other than ZWJ/ZWNJ, line and paragraph
 * separators, blank-looking fillers, lone UTF-16 surrogates (half of an
 * emoji), and names with no visible letter or digit (only a combining accent,
 * only U+FE0F, only emoji...). They break rendering, logs and exports, can
 * make one name look like another or look empty, and never belong in a name.
 */
export const displayName = (max: number) =>
	z
		.string({ error: 'Debe ser un texto.' })
		.trim()
		.min(1, 'No puede estar vacío.')
		.max(max, `No puede superar los ${max} caracteres.`)
		.refine((value) => !/\p{Cc}/u.test(value), 'No puede tener caracteres de control.')
		.refine(
			(value) => !FORMAT_CHARACTER.test(value) && !BLANK_LOOKING.test(value),
			'No puede tener caracteres invisibles ni de dirección de texto.',
		)
		.refine((value) => !LINE_BREAK.test(value), 'No puede tener separadores de línea ni de párrafo.')
		.refine((value) => !LONE_SURROGATE.test(value), 'Tiene caracteres Unicode inválidos.')
		.refine((value) => VISIBLE_LETTER_OR_DIGIT.test(value), 'Tiene que tener al menos una letra o un número.');

const nombre = displayName;

/**
 * Optional in the body: when missing, the service derives it from `nombre`.
 * When given, it's normalized the same way ("Fútbol 5" → "futbol-5").
 */
const slug = z
	.string({ error: 'Debe ser un texto.' })
	.max(SLUG_MAX_LENGTH, `No puede superar los ${SLUG_MAX_LENGTH} caracteres.`)
	.transform(slugify)
	.refine((value) => value.length > 0, 'Tiene que tener al menos una letra o un número.');

/** A numeric id in a JSON body: a real number, not a string. */
const bodyId = z
	.number({ error: 'Debe ser un número.' })
	.int('Debe ser un número entero.')
	.positive('Debe ser un entero positivo.')
	.max(Number.MAX_SAFE_INTEGER, 'Es demasiado grande.');

/**
 * Blank or invisible characters that aren't format characters: any space
 * (including U+00A0, U+2000 to U+200A, U+202F, U+205F, U+3000), invisible
 * marks (U+034F, U+17B4, U+17B5, U+180B), variation selectors (U+FE0F...)
 * and U+1D159. A crest or photo address never needs them (a real space is
 * written `%20`). Names still accept them next to letters (docs/pendientes.md).
 */
const URL_BLANK = /[\s\p{Zs}\u034F\u17B4\u17B5\u180B-\u180D\uFE00-\uFE0F\u{1D159}\u{E0100}-\u{E01EF}]/u;

/**
 * Crest or photo, until file uploads exist (T-13): either an `https://` URL
 * or a relative asset path such as `escudos/boca.webp`. No `..`, no leading
 * `/`, no `//`, an image extension, at most 255 characters (the column).
 * Like names (T-17 fix), no lone UTF-16 surrogates, control, format,
 * blank-looking or line-separator characters, and no blanks at all (T-18 fix):
 * `new URL` would accept them (it drops tabs and newlines, and encodes a lone
 * half as U+FFFD), but the raw text is what gets stored.
 */
const ASSET_PATH = /^(?!.*\.\.)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]*\.(?:png|jpe?g|webp|avif|svg|gif)$/i;
const imageRef = z
	.string({ error: 'Debe ser un texto.' })
	.trim()
	.max(255, 'No puede superar los 255 caracteres.')
	.refine((value) => !LONE_SURROGATE.test(value), 'Tiene caracteres Unicode inválidos.')
	.refine(
		(value) =>
			!/\p{Cc}/u.test(value) && !/\p{Cf}/u.test(value) && !LINE_BREAK.test(value) && !BLANK_LOOKING.test(value) && !URL_BLANK.test(value),
		'No puede tener espacios ni caracteres de control, invisibles, rellenos en blanco o separadores de línea.',
	)
	.refine((value) => {
		if (ASSET_PATH.test(value)) return true;
		try {
			const url = new URL(value);
			return url.protocol === 'https:' && !url.username && !url.password;
		} catch {
			return false;
		}
	}, 'Tiene que ser una URL https:// o una ruta relativa a una imagen (png, jpg, webp, avif, svg o gif).');

/** `#rrggbb`, stored lowercase. */
const color = z
	.string({ error: 'Debe ser un texto.' })
	.trim()
	.regex(/^#[0-9a-fA-F]{6}$/, 'Tiene que ser un color hexadecimal #rrggbb.')
	.transform((value) => value.toLowerCase());

/** Football-style numbering; the database keeps it unique per team. */
const numeroCamiseta = z
	.number({ error: 'Debe ser un número.' })
	.int('Debe ser un número entero.')
	.min(1, 'Tiene que estar entre 1 y 99.')
	.max(99, 'Tiene que estar entre 1 y 99.');

const booleanQuery = z.enum(['true', 'false'], { error: 'Tiene que ser true o false.' }).transform((value) => value === 'true');

const search = z
	.string()
	.trim()
	.max(100)
	.optional()
	.transform((value) => (value ? value : undefined));

/** A PATCH must change something. */
const notEmpty = (value: object) => Object.values(value).some((v) => v !== undefined);
const NOTHING_TO_CHANGE = { message: 'No hay campos para modificar.' };

// --- deporte ---------------------------------------------------------------

export const listSportsQuery = z.strictObject({
	...paginationFields,
	q: search,
	permiteEmpate: booleanQuery.optional(),
});
export const createSportBody = z.strictObject({
	nombre: nombre(100),
	slug: slug.optional(),
	permiteEmpate: z.boolean({ error: 'Debe ser true o false.' }),
});
export const updateSportBody = z
	.strictObject({
		nombre: nombre(100).optional(),
		slug: slug.optional(),
		permiteEmpate: z.boolean({ error: 'Debe ser true o false.' }).optional(),
	})
	.refine(notEmpty, NOTHING_TO_CHANGE);

// --- competicion ------------------------------------------------------------

export const listCompetitionsQuery = z.strictObject({
	...paginationFields,
	q: search,
	deporteId: idFromText('deporteId').optional(),
});
export const createCompetitionBody = z.strictObject({
	deporteId: bodyId,
	nombre: nombre(100),
	slug: slug.optional(),
});
export const updateCompetitionBody = z
	.strictObject({
		deporteId: bodyId.optional(),
		nombre: nombre(100).optional(),
		slug: slug.optional(),
	})
	.refine(notEmpty, NOTHING_TO_CHANGE);

// --- equipo -----------------------------------------------------------------

export const listTeamsQuery = z.strictObject({
	...paginationFields,
	q: search,
	competicionId: idFromText('competicionId').optional(),
	deporteId: idFromText('deporteId').optional(),
});
export const createTeamBody = z.strictObject({
	competicionId: bodyId,
	nombre: nombre(100),
	nombreCorto: nombre(50),
	escudo: imageRef,
	colorAcento: color,
});
export const updateTeamBody = z
	.strictObject({
		competicionId: bodyId.optional(),
		nombre: nombre(100).optional(),
		nombreCorto: nombre(50).optional(),
		escudo: imageRef.optional(),
		colorAcento: color.optional(),
	})
	.refine(notEmpty, NOTHING_TO_CHANGE);

// --- jugador ----------------------------------------------------------------

export const listPlayersQuery = z.strictObject({
	...paginationFields,
	q: search,
	equipoId: idFromText('equipoId').optional(),
	competicionId: idFromText('competicionId').optional(),
});
export const createPlayerBody = z.strictObject({
	nombre: nombre(100),
	foto: imageRef.nullable().optional(),
});
export const updatePlayerBody = z
	.strictObject({
		nombre: nombre(100).optional(),
		/** `null` removes the photo. */
		foto: imageRef.nullable().optional(),
	})
	.refine(notEmpty, NOTHING_TO_CHANGE);

// --- plantel ----------------------------------------------------------------

export const listEnrollmentsQuery = z.strictObject({
	...paginationFields,
	/** T-21: player or team name. */
	q: search,
	equipoId: idFromText('equipoId').optional(),
	competicionId: idFromText('competicionId').optional(),
	jugadorId: idFromText('jugadorId').optional(),
});
export const createEnrollmentBody = z.strictObject({
	jugadorId: bodyId,
	equipoId: bodyId,
	numeroCamiseta,
	/** Optional check: when sent, it must be the team's competition. */
	competicionId: bodyId.optional(),
});
export const updateEnrollmentBody = z
	.strictObject({
		numeroCamiseta: numeroCamiseta.optional(),
		/** Accepted only to reject a change clearly (409 TRANSFER_NOT_ALLOWED, D4). */
		equipoId: bodyId.optional(),
		jugadorId: bodyId.optional(),
	})
	.refine(notEmpty, NOTHING_TO_CHANGE);

export type ListSportsQuery = z.infer<typeof listSportsQuery>;
export type CreateSportBody = z.infer<typeof createSportBody>;
export type UpdateSportBody = z.infer<typeof updateSportBody>;
export type ListCompetitionsQuery = z.infer<typeof listCompetitionsQuery>;
export type CreateCompetitionBody = z.infer<typeof createCompetitionBody>;
export type UpdateCompetitionBody = z.infer<typeof updateCompetitionBody>;
export type ListTeamsQuery = z.infer<typeof listTeamsQuery>;
export type CreateTeamBody = z.infer<typeof createTeamBody>;
export type UpdateTeamBody = z.infer<typeof updateTeamBody>;
export type ListPlayersQuery = z.infer<typeof listPlayersQuery>;
export type CreatePlayerBody = z.infer<typeof createPlayerBody>;
export type UpdatePlayerBody = z.infer<typeof updatePlayerBody>;
export type ListEnrollmentsQuery = z.infer<typeof listEnrollmentsQuery>;
export type CreateEnrollmentBody = z.infer<typeof createEnrollmentBody>;
export type UpdateEnrollmentBody = z.infer<typeof updateEnrollmentBody>;
