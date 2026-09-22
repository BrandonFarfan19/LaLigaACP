import { z } from 'zod';
import { ACCIONES_AUDITADAS, type EntidadAuditada } from '../lib/audit.js';
import { idFromText, paginationFields } from './common.schema.js';
import { isoDateTime } from './matches.schema.js';

const CODIGOS = [...new Set(Object.values(ACCIONES_AUDITADAS).map((a) => a.codigo))] as [string, ...string[]];
const ENTIDADES = [...new Set(Object.values(ACCIONES_AUDITADAS).map((a) => a.entidad))] as [EntidadAuditada, ...EntidadAuditada[]];

/**
 * `GET /admin/auditoria` (T-17). Strict: an unknown or repeated key is a 400.
 * `entidadId` only makes sense with `entidad` (an id alone could be of any table).
 */
export const listAuditQuery = z
	.strictObject({
		...paginationFields,
		/** `accion_auditoria.codigo`. */
		accion: z.enum(CODIGOS, { error: `Tiene que ser una de: ${CODIGOS.join(', ')}.` }).optional(),
		entidad: z.enum(ENTIDADES, { error: `Tiene que ser una de: ${ENTIDADES.join(', ')}.` }).optional(),
		entidadId: idFromText('entidadId').optional(),
		/** The admin who acted. */
		usuarioId: idFromText('usuarioId').optional(),
		desde: isoDateTime('desde').optional(),
		hasta: isoDateTime('hasta').optional(),
	})
	.refine((q) => !q.desde || !q.hasta || q.desde <= q.hasta, { message: 'desde no puede ser posterior a hasta.', path: ['hasta'] })
	.refine((q) => q.entidadId === undefined || q.entidad !== undefined, {
		message: 'entidadId necesita entidad: un id solo no dice de qué tabla es.',
		path: ['entidadId'],
	});

export type ListAuditQuery = z.infer<typeof listAuditQuery>;
