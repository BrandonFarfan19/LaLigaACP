import { ErrorCode } from './error-codes.js';
import { HttpError } from './http-error.js';

/**
 * The one place that turns a MySQL constraint violation into an HTTP answer
 * (called by `middleware/error-handler.ts`). Services check the common cases
 * first and throw their own `HttpError` with details; this is the net for
 * the rest (a race between the check and the write, or a check nobody
 * wrote): whatever happens, a constraint violation is never a 500, and the
 * driver's message (table names, values) never reaches the client.
 *
 * - 1062 `ER_DUP_ENTRY`: a UNIQUE index, named in the message (`for key 'tabla.indice'`).
 * - 1451 `ER_ROW_IS_REFERENCED_2`: deleting/updating a row other rows point at.
 * - 1452 `ER_NO_REFERENCED_ROW_2`: pointing at a row that doesn't exist.
 * - 1406 / 1264 / 1366 / 3819: a value too long, out of range, of the wrong type, or failing a CHECK.
 * - 1213 `ER_LOCK_DEADLOCK` / 1205 `ER_LOCK_WAIT_TIMEOUT`: two transactions
 *   collided. `withTransaction` already retried a deadlock; what reaches here
 *   is 409 `CONCURRENT_UPDATE` ("try again"), never a 500.
 */

interface Answer {
	status: number;
	code: ErrorCode;
	message: string;
}

const conflict = (code: ErrorCode, message: string): Answer => ({ status: 409, code, message });
const notFound = (code: ErrorCode, message: string): Answer => ({ status: 404, code, message });

/** 1062, by UNIQUE index name. */
const DUPLICATES: Record<string, Answer> = {
	uq_usuario_email: conflict(ErrorCode.EMAIL_TAKEN, 'Ya existe una cuenta con ese correo.'),
	uq_deporte_slug: conflict(ErrorCode.SLUG_TAKEN, 'Ya existe un deporte con ese slug.'),
	uq_competicion_deporte_slug: conflict(ErrorCode.SLUG_TAKEN, 'Ese deporte ya tiene una competición con ese slug.'),
	uq_plantel_jugador_competicion: conflict(
		ErrorCode.PLAYER_ALREADY_ENROLLED,
		'Ese jugador ya está inscrito en un equipo de esta competición.',
	),
	uq_plantel_equipo_camiseta: conflict(ErrorCode.SHIRT_NUMBER_TAKEN, 'Ese número de camiseta ya está en uso en el equipo.'),
	uq_partido_equipo_equipo: { status: 400, code: ErrorCode.SAME_TEAM, message: 'Un equipo no puede jugar contra sí mismo.' },
	uq_partido_equipo_lado: conflict(ErrorCode.DUPLICATE_ENTRY, 'El partido ya tiene ese lado (local o visita).'),
};

/** 1452 (the referenced row is missing) and 1451 (the row is referenced), by FOREIGN KEY name. */
const FOREIGN_KEYS: Record<string, { missing: Answer; inUse: Answer }> = {
	fk_competicion_deporte: {
		missing: notFound(ErrorCode.SPORT_NOT_FOUND, 'No existe ese deporte.'),
		inUse: conflict(ErrorCode.SPORT_IN_USE, 'El deporte tiene competiciones.'),
	},
	fk_equipo_competicion: {
		missing: notFound(ErrorCode.COMPETITION_NOT_FOUND, 'No existe esa competición.'),
		inUse: conflict(ErrorCode.COMPETITION_IN_USE, 'La competición tiene equipos.'),
	},
	fk_partido_competicion: {
		missing: notFound(ErrorCode.COMPETITION_NOT_FOUND, 'No existe esa competición.'),
		inUse: conflict(ErrorCode.COMPETITION_IN_USE, 'La competición tiene partidos.'),
	},
	fk_plantel_jugador: {
		missing: notFound(ErrorCode.PLAYER_NOT_FOUND, 'No existe ese jugador.'),
		inUse: conflict(ErrorCode.PLAYER_IN_USE, 'El jugador está inscrito en un plantel.'),
	},
	fk_plantel_competicion: {
		missing: notFound(ErrorCode.COMPETITION_NOT_FOUND, 'No existe esa competición.'),
		inUse: conflict(ErrorCode.COMPETITION_IN_USE, 'La competición tiene jugadores inscritos.'),
	},
	fk_plantel_equipo_competicion: {
		missing: conflict(ErrorCode.COMPETITION_MISMATCH, 'El equipo no existe o no pertenece a esa competición.'),
		inUse: conflict(ErrorCode.TEAM_IN_USE, 'El equipo tiene jugadores inscritos.'),
	},
	fk_partido_equipo_competicion: {
		missing: notFound(ErrorCode.COMPETITION_NOT_FOUND, 'No existe esa competición.'),
		inUse: conflict(ErrorCode.COMPETITION_IN_USE, 'La competición tiene partidos.'),
	},
	fk_partido_equipo_partido_competicion: {
		missing: conflict(ErrorCode.COMPETITION_MISMATCH, 'El partido no existe o no pertenece a esa competición.'),
		inUse: conflict(ErrorCode.RESOURCE_IN_USE, 'El partido tiene equipos asignados.'),
	},
	fk_partido_equipo_equipo_competicion: {
		missing: conflict(ErrorCode.COMPETITION_MISMATCH, 'El equipo no existe o no pertenece a la competición del partido.'),
		inUse: conflict(ErrorCode.TEAM_IN_USE, 'El equipo juega partidos.'),
	},
	fk_partido_estado: {
		missing: conflict(ErrorCode.INVALID_REFERENCE, 'No existe ese estado de partido.'),
		inUse: conflict(ErrorCode.RESOURCE_IN_USE, 'Ese estado está en uso.'),
	},
	fk_seleccion_partido: {
		missing: notFound(ErrorCode.MATCH_NOT_FOUND, 'No existe ese partido.'),
		inUse: conflict(ErrorCode.MATCH_HAS_BETS, 'El partido tiene apuestas.'),
	},
	fk_gol_partido_equipo: {
		missing: conflict(ErrorCode.INVALID_REFERENCE, 'El lado del partido no existe o no es de ese equipo.'),
		inUse: conflict(ErrorCode.MATCH_HAS_GOALS, 'El partido tiene goles registrados.'),
	},
	fk_gol_equipo: {
		missing: notFound(ErrorCode.TEAM_NOT_FOUND, 'No existe ese equipo.'),
		inUse: conflict(ErrorCode.TEAM_IN_USE, 'El equipo tiene goles registrados.'),
	},
	fk_gol_plantel: {
		missing: conflict(ErrorCode.COMPETITION_MISMATCH, 'La inscripción no existe o no es de ese equipo.'),
		inUse: conflict(ErrorCode.ENROLLMENT_IN_USE, 'La inscripción tiene goles registrados.'),
	},
};

const GENERIC = {
	duplicate: conflict(ErrorCode.DUPLICATE_ENTRY, 'Ya existe un registro con esos datos.'),
	inUse: conflict(ErrorCode.RESOURCE_IN_USE, 'El registro está en uso por otros datos.'),
	missing: conflict(ErrorCode.INVALID_REFERENCE, 'Se hace referencia a un registro que no existe.'),
	badValue: { status: 400, code: ErrorCode.VALIDATION_ERROR, message: 'Solicitud inválida.' } satisfies Answer,
	concurrent: conflict(ErrorCode.CONCURRENT_UPDATE, 'Otra operación estaba modificando los mismos datos. Intentá de nuevo.'),
};

interface MysqlError {
	errno: number;
	sqlMessage?: string;
	message: string;
}

function isMysqlError(error: unknown): error is MysqlError {
	return typeof error === 'object' && error !== null && typeof (error as { errno?: unknown }).errno === 'number' && 'sqlState' in error;
}

/** MySQL's deadlock error: the transaction was rolled back and can be run again. */
export const ER_LOCK_DEADLOCK = 1213;
/** A lock wait gave up (`innodb_lock_wait_timeout`): only the statement was rolled back. */
export const ER_LOCK_WAIT_TIMEOUT = 1205;

export function isDeadlock(error: unknown): boolean {
	return isMysqlError(error) && error.errno === ER_LOCK_DEADLOCK;
}

/** `Duplicate entry 'x' for key 'tabla.uq_nombre'` → `uq_nombre`. */
function uniqueKeyName(message: string): string | undefined {
	return /for key '(?:[^'.]+\.)?([^']+)'$/.exec(message)?.[1];
}

/** `... CONSTRAINT \`fk_nombre\` FOREIGN KEY ...` → `fk_nombre`. */
function foreignKeyName(message: string): string | undefined {
	return /CONSTRAINT `([^`]+)` FOREIGN KEY/.exec(message)?.[1];
}

/** The HttpError for a MySQL error, or `undefined` if it isn't a constraint/value error. */
export function translateDbError(error: unknown): HttpError | undefined {
	if (!isMysqlError(error)) return undefined;
	const message = error.sqlMessage ?? error.message;
	let answer: Answer | undefined;
	switch (error.errno) {
		case 1062:
			answer = DUPLICATES[uniqueKeyName(message) ?? ''] ?? GENERIC.duplicate;
			break;
		case 1451:
			answer = FOREIGN_KEYS[foreignKeyName(message) ?? '']?.inUse ?? GENERIC.inUse;
			break;
		case 1452:
			answer = FOREIGN_KEYS[foreignKeyName(message) ?? '']?.missing ?? GENERIC.missing;
			break;
		case 1406:
		case 1264:
		case 1366:
		case 3819:
			answer = GENERIC.badValue;
			break;
		case ER_LOCK_DEADLOCK:
		case ER_LOCK_WAIT_TIMEOUT:
			answer = GENERIC.concurrent;
			break;
		default:
			return undefined;
	}
	return new HttpError(answer.status, answer.code, answer.message);
}
