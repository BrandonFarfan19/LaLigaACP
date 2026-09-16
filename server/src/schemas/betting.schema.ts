import { z } from 'zod';
import {
	ESTADOS_APUESTA,
	ESTADOS_SELECCION,
	ESTADOS_TICKET,
	MAX_GOLES_PRONOSTICO,
	MAX_SELECCIONES_POR_TICKET,
	RESULTADOS_GENERALES,
} from '../lib/betting.js';
import { idFromText, paginationFields } from './common.schema.js';
import { isoDateTime } from './matches.schema.js';

/** Requests of `/apuestas` (T-09). Strict: an unknown key, in the query or the body, is a 400. */

export const listBettingMatchesQuery = z
	.strictObject({
		...paginationFields,
		/** BR-051. */
		deporteId: idFromText('deporteId').optional(),
		competicionId: idFromText('competicionId').optional(),
		/** BR-051, "fecha del encuentro": from this moment on, inclusive. */
		desde: isoDateTime('desde').optional(),
		/** Up to this moment, inclusive. */
		hasta: isoDateTime('hasta').optional(),
		/** BR-052: `disponible` lists only the matches that take bets now. */
		estadoApuesta: z.enum(ESTADOS_APUESTA, { error: `Tiene que ser uno de: ${ESTADOS_APUESTA.join(', ')}.` }).optional(),
	})
	.refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, { message: 'desde no puede ser posterior a hasta.', path: ['hasta'] });

const partidoId = z
	.number({ error: 'Debe ser un número.' })
	.int('Debe ser un número entero.')
	.positive('Debe ser un entero positivo.')
	.max(Number.MAX_SAFE_INTEGER, 'Es demasiado grande.');

const goles = z
	.number({ error: 'Debe ser un número.' })
	.int('Debe ser un número entero.')
	.min(0, `Tiene que estar entre 0 y ${MAX_GOLES_PRONOSTICO}.`)
	.max(MAX_GOLES_PRONOSTICO, `Tiene que estar entre 0 y ${MAX_GOLES_PRONOSTICO}.`);

/**
 * One proposed selection (BR-015, BR-016). The shape is checked here; what
 * depends on the database (the match exists and is open, the sport allows a
 * draw) is checked by `services/betting.service.ts` and reported per selection.
 */
export const selectionInput = z.discriminatedUnion(
	'tipo',
	[
		z.strictObject({
			partidoId,
			tipo: z.literal('resultado_general'),
			pronostico: z.enum(RESULTADOS_GENERALES, { error: `Tiene que ser uno de: ${RESULTADOS_GENERALES.join(', ')}.` }),
		}),
		z.strictObject({
			partidoId,
			tipo: z.literal('marcador_exacto'),
			golesLocal: goles,
			golesVisitante: goles,
		}),
	],
	{ error: 'tipo tiene que ser resultado_general o marcador_exacto.' },
);

export const ticketPreviewBody = z.strictObject({
	selecciones: z
		.array(selectionInput, { error: 'Tiene que ser una lista de selecciones.' })
		.min(1, 'El ticket necesita al menos una selección.')
		.max(MAX_SELECCIONES_POR_TICKET, `Un ticket tiene como máximo ${MAX_SELECCIONES_POR_TICKET} selecciones.`),
});

export type ListBettingMatchesQuery = z.infer<typeof listBettingMatchesQuery>;
export type SelectionInput = z.infer<typeof selectionInput>;
export type TicketPreviewBody = z.infer<typeof ticketPreviewBody>;

/** T-10: confirming takes the same body as the preview. */
export const confirmTicketBody = ticketPreviewBody;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * BR-054: the `Idempotency-Key` header of a confirmation. A UUID (any
 * version, not the nil one), case-insensitive, stored in lowercase.
 * `undefined` or anything else (including two keys joined by a proxy) is
 * `null`.
 */
export function parseIdempotencyKey(header: string | undefined): string | null {
	const key = header?.trim().toLowerCase();
	return key && UUID.test(key) && key !== NIL_UUID ? key : null;
}

/** T-11: `GET /apuestas/mis-apuestas`. Strict: an unknown key is a 400. */
export const listMyBetsQuery = z
	.strictObject({
		...paginationFields,
		/** BR-027: the selection's state. */
		estado: z.enum(ESTADOS_SELECCION, { error: `Tiene que ser uno de: ${ESTADOS_SELECCION.join(', ')}.` }).optional(),
		/** BR-025: the ticket's derived state. */
		estadoTicket: z.enum(ESTADOS_TICKET, { error: `Tiene que ser uno de: ${ESTADOS_TICKET.join(', ')}.` }).optional(),
		ticketId: idFromText('ticketId').optional(),
		partidoId: idFromText('partidoId').optional(),
		deporteId: idFromText('deporteId').optional(),
		competicionId: idFromText('competicionId').optional(),
		/** On the ticket's date (when the bet was placed), inclusive. */
		desde: isoDateTime('desde').optional(),
		hasta: isoDateTime('hasta').optional(),
	})
	.refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, { message: 'desde no puede ser posterior a hasta.', path: ['hasta'] });

export type ListMyBetsQuery = z.infer<typeof listMyBetsQuery>;
