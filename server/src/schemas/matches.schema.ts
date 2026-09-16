import { z } from 'zod';
import { MAX_GOLES } from '../lib/match-result.js';
import { MATCH_STATES } from '../lib/match-state.js';
import { displayName } from './catalog.schema.js';
import { idFromText, paginationFields } from './common.schema.js';

/** Request schemas of `/admin/partidos` (T-07). Strict: unknown keys are a 400, including `goles` (T-12). */

// The states and the effective-state rule live in lib/match-state.ts.
export { MATCH_STATES, type MatchState } from '../lib/match-state.js';

/** Latest accepted date: a sanity bound, far beyond any real fixture. */
const MAX_DATE = Date.UTC(2100, 0, 1);

/**
 * ISO 8601 with an explicit zone (`Z` or `±hh:mm`) and seconds:
 * `2026-10-01T18:00:00-05:00`. Without a zone the moment is ambiguous, so
 * it's rejected. Impossible dates (February 30) are rejected too. Stored in
 * UTC, to the second (a fraction is dropped).
 */
export const isoDateTime = (label: string) =>
	z
		.iso.datetime({
			offset: true,
			error: `${label} tiene que ser una fecha ISO 8601 con segundos y zona horaria, por ejemplo 2026-10-01T18:00:00-05:00.`,
		})
		.transform((value) => new Date(Math.floor(Date.parse(value) / 1000) * 1000))
		.refine((date) => date.getTime() < MAX_DATE, `${label} no puede ser posterior al año 2099.`);

const bodyId = z
	.number({ error: 'Debe ser un número.' })
	.int('Debe ser un número entero.')
	.positive('Debe ser un entero positivo.')
	.max(Number.MAX_SAFE_INTEGER, 'Es demasiado grande.');

const jornada = z
	.number({ error: 'Debe ser un número.' })
	.int('Debe ser un número entero.')
	.min(1, 'Tiene que estar entre 1 y 999.')
	.max(999, 'Tiene que estar entre 1 y 999.');

const notEmpty = (value: object) => Object.values(value).some((v) => v !== undefined);

export const listMatchesQuery = z
	.strictObject({
		...paginationFields,
		deporteId: idFromText('deporteId').optional(),
		competicionId: idFromText('competicionId').optional(),
		/** Matches where this team plays, home or away. */
		equipoId: idFromText('equipoId').optional(),
		estado: z.enum(MATCH_STATES, { error: `Tiene que ser uno de: ${MATCH_STATES.join(', ')}.` }).optional(),
		/** From this moment on, inclusive. */
		desde: isoDateTime('desde').optional(),
		/** Up to this moment, inclusive. */
		hasta: isoDateTime('hasta').optional(),
	})
	.refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, { message: 'desde no puede ser posterior a hasta.', path: ['hasta'] });

export const createMatchBody = z.strictObject({
	competicionId: bodyId,
	localId: bodyId,
	visitaId: bodyId,
	jornada,
	fechaHora: isoDateTime('fechaHora'),
	sede: displayName(150),
});

export const updateMatchBody = z
	.strictObject({
		competicionId: bodyId.optional(),
		localId: bodyId.optional(),
		visitaId: bodyId.optional(),
		jornada: jornada.optional(),
		fechaHora: isoDateTime('fechaHora').optional(),
		sede: displayName(150).optional(),
	})
	.refine(notEmpty, { message: 'No hay campos para modificar.' });

const goles = z
	.number({ error: 'Debe ser un número.' })
	.int('Debe ser un número entero.')
	.min(0, `Tiene que estar entre 0 y ${MAX_GOLES}.`)
	.max(MAX_GOLES, `Tiene que estar entre 0 y ${MAX_GOLES}.`);

/** T-12, BR-028: both sides at once. */
export const setResultBody = z.strictObject({ golesLocal: goles, golesVisitante: goles });

/**
 * T-12, BR-031: an explicit confirmation. `confirmar` must be `true`, and the
 * score must be the one the admin saw in the preview: if it was corrected in
 * between, the confirmation is refused (409 `RESULT_CHANGED`).
 */
export const confirmResultBody = z.strictObject({
	confirmar: z.literal(true, { error: 'Para confirmar el resultado, enviá confirmar: true.' }),
	golesLocal: goles,
	golesVisitante: goles,
});

export type SetResultBody = z.infer<typeof setResultBody>;
export type ConfirmResultBody = z.infer<typeof confirmResultBody>;
export type ListMatchesQuery = z.infer<typeof listMatchesQuery>;
export type CreateMatchBody = z.infer<typeof createMatchBody>;
export type UpdateMatchBody = z.infer<typeof updateMatchBody>;
