import type {
	AdminBet,
	AdminCompetition,
	AdminEnrollment,
	AdminGoal,
	AdminMatch,
	AdminParticipant,
	AdminPlayer,
	AdminSport,
	AdminTeam,
	ApiPage,
	AuditRecord,
	CancellationPreview,
	MatchMedia,
	ParticipantCounts,
	PoolStats,
	ResultPreview,
} from '../types/admin';
import type { AuthUser } from '../types/api';
import { apiRoutes, myBet } from './betting-fixtures';
import { admin, apostador, type Handler, ok } from './fetch-mock';

/** Sample admin API data (T-21 tests). */

export const pageOf = <T>(items: T[], extra: Partial<ApiPage<T>> = {}): ApiPage<T> => ({
	items,
	page: 1,
	pageSize: 20,
	total: items.length,
	totalPages: items.length ? 1 : 0,
	...extra,
});

export const counts: ParticipantCounts = { inscritos: 3, validados: 1, pendientes: 2, pagosConfirmados: 2, pagosPendientes: 1 };

export const stats: PoolStats = {
	participantes: { inscritos: 3, validados: 1, pendientes: 2 },
	tickets: { total: 4, pendiente: 2, finalizado: 1, anulado: 1 },
	selecciones: { total: 7, pendiente: 3, acertada: 2, no_acertada: 1, anulada: 1 },
	monedasUtilizadas: 7,
	monedasDevueltas: 1,
	monedasDisponibles: 4,
	puntos: 6,
	aciertos: 2,
};

export const participant = (overrides: Partial<AdminParticipant> = {}): AdminParticipant => ({
	...apostador,
	id: 21,
	nombre: 'Rosa',
	email: 'rosa@liga.test',
	estadoValidacion: 'pendiente',
	estadoPago: 'pendiente',
	saldoMonedas: 0,
	puntos: 0,
	...overrides,
});

export const sport: AdminSport = { id: 1, nombre: 'Fútbol', slug: 'futbol', permiteEmpate: true };
export const voleyball: AdminSport = { id: 2, nombre: 'Vóley', slug: 'voley', permiteEmpate: false };
export const league: AdminCompetition = { id: 10, deporteId: 1, deporteNombre: 'Fútbol', nombre: 'Liga', slug: 'liga' };
export const home: AdminTeam = { id: 100, competicionId: 10, competicionNombre: 'Liga', deporteNombre: 'Fútbol', nombre: 'Halcones', nombreCorto: 'HAL', escudo: 'favicon.png', colorAcento: '#3cf281' };
export const away: AdminTeam = { id: 101, competicionId: 10, competicionNombre: 'Liga', deporteNombre: 'Fútbol', nombre: 'Pumas', nombreCorto: 'PUM', escudo: 'https://img.test/pumas.png', colorAcento: '#ffd23f' };
export const player: AdminPlayer = { id: 500, nombre: 'Luis Paredes', foto: null };
export const enrollment: AdminEnrollment = { id: 700, jugadorId: 500, jugadorNombre: 'Luis Paredes', equipoId: 100, equipoNombre: 'Halcones', competicionId: 10, competicionNombre: 'Liga', deporteNombre: 'Fútbol', numeroCamiseta: 9 };
/** The away side's own squad: the panel asks for each team separately (`Partido.tsx`). */
export const awayEnrollment: AdminEnrollment = { ...enrollment, id: 701, jugadorId: 501, jugadorNombre: 'Sofía Díaz', equipoId: 101, equipoNombre: 'Pumas', numeroCamiseta: 4 };

export const adminMatch = (overrides: Partial<AdminMatch> = {}): AdminMatch => ({
	id: 42,
	competicionId: 10,
	competicionNombre: 'Liga',
	deporteId: 1,
	deporteNombre: 'Fútbol',
	estado: 'en_curso',
	jornada: 3,
	fechaHora: '2026-09-17T15:00:00.000Z',
	cierreApuestas: '2026-09-16T15:00:00.000Z',
	sede: 'Estadio Norte',
	local: { equipoId: 100, nombre: 'Halcones', goles: null },
	visita: { equipoId: 101, nombre: 'Pumas', goles: null },
	...overrides,
});

export const resultPreview = (overrides: Partial<ResultPreview> = {}): ResultPreview => ({
	partido: adminMatch(),
	competicion: { id: 10, nombre: 'Liga' },
	deporte: { id: 1, nombre: 'Fútbol', permiteEmpate: true },
	marcador: null,
	resultado: null,
	ganador: null,
	goles: [],
	seleccionesPendientes: 4,
	confirmableDesde: '2026-09-17T16:00:00.000Z',
	puedeConfirmar: false,
	// The very texts the backend sends (`services/results.service.ts`): the
	// screen shows them as they come, so a simulation with its own wording
	// would test a message that never reaches a user (T-23).
	problemas: [{ code: 'RESULT_INCOMPLETE', message: 'Faltan los goles de uno o de los dos equipos.' }],
	avisos: [],
	advertencia: 'Confirmar el resultado es definitivo: el partido pasa a finalizado, el marcador y el ganador ya no se pueden modificar y se liquidan las apuestas.',
	...overrides,
});

/**
 * What `POST /admin/partidos/:id/resultado/confirmar` answers: the match and
 * the **official result** (`OfficialResult`: the score plus its derived code),
 * not a bare code (`services/results.service.ts`, `ConfirmedResult`).
 */
export const confirmedResult = (partido: AdminMatch, golesLocal: number, golesVisitante: number) => ({
	partido,
	resultado: { golesLocal, golesVisitante, resultado: golesLocal > golesVisitante ? 'local_gana' : golesLocal === golesVisitante ? 'empate' : 'visitante_gana' },
});

export const goal = (overrides: Partial<AdminGoal> = {}): AdminGoal => ({
	id: 900,
	partidoId: 42,
	minuto: 12,
	equipoId: 100,
	lado: 'local',
	plantelId: 700,
	jugador: { id: 500, nombre: 'Luis Paredes' },
	imagen: null,
	video: null,
	...overrides,
});

export const noMedia: MatchMedia = { imagenes: [], videos: [] };

/** The figures both the preview and the confirmation carry (`CancellationFigures`). */
export const cancellationFigures = (overrides: Partial<CancellationPreview> = {}) => ({
	selecciones: 4,
	monedasDevueltas: 3,
	seleccionesSinDevolucion: { total: 1, sinDebito: 0, cuentaAdministrador: 1 },
	usuarios: 2,
	tickets: 3,
	ticketsAnulados: 1,
	...overrides,
});

export const cancellation = (overrides: Partial<CancellationPreview> = {}): CancellationPreview => ({
	partido: adminMatch(),
	...cancellationFigures(),
	puedeCancelar: true,
	problemas: [],
	advertencia: 'Cancelar el partido es definitivo: sus apuestas pendientes quedan anuladas, se devuelve 1 moneda por cada una y el partido ya no se puede reprogramar ni reactivar.',
	...overrides,
});

/**
 * What `POST /admin/partidos/:id/cancelacion/confirmar` answers: the figures
 * and the match, **without** `puedeCancelar`, `problemas` or `advertencia`,
 * which only exist in the preview (`CancelledMatch` in the backend, T-23).
 */
export const cancelled = (partido: AdminMatch, overrides: Partial<CancellationPreview> = {}) => ({ partido, ...cancellationFigures(overrides) });

export const adminBet = (overrides: Partial<AdminBet> = {}): AdminBet => ({ ...myBet(30), usuario: { id: 21, nombre: 'Rosa' }, ...overrides });

export const auditRecord = (overrides: Partial<AuditRecord> = {}): AuditRecord => ({
	id: 1,
	fecha: '2026-09-17T15:30:00.000Z',
	accion: { codigo: 'modificacion_partido', nombre: 'Modificación de partido' },
	entidad: 'partido',
	entidadId: 42,
	administrador: { id: 1, nombre: 'Admin' },
	detalle: { cambios: { sede: { antes: 'Estadio Norte', despues: 'Estadio Sur' }, fechaHora: { antes: '2026-09-17T15:00:00.000Z', despues: '2026-09-18T15:00:00.000Z' } } },
	...overrides,
});

/**
 * A fake admin API: the session of `user` (an admin by default) and the
 * panel's reads, each replaceable by `extra`. Anything else is a 404.
 */
export function adminRoutes(extra: Record<string, Handler> = {}, user: AuthUser = admin): Handler {
	return apiRoutes({
		'GET /api/auth/me': () => ok({ user, csrfToken: 't' }),
		'GET /api/admin/participantes/conteos': () => ok(counts),
		'GET /api/admin/participantes': () => ok(pageOf([participant()])),
		'GET /api/admin/polla/estadisticas': () => ok(stats),
		'GET /api/admin/polla/ranking': () => ok(pageOf([{ posicion: 1, empatados: 1, participante: { id: 21, nombre: 'Rosa' }, puntos: 6, aciertos: 2 }])),
		'GET /api/admin/polla/apuestas': () => ok(pageOf([adminBet()])),
		'GET /api/admin/auditoria': () => ok(pageOf([auditRecord()])),
		'GET /api/admin/deportes': () => ok(pageOf([sport, voleyball])),
		'GET /api/admin/competiciones': () => ok(pageOf([league])),
		'GET /api/admin/equipos': () => ok(pageOf([home, away])),
		'GET /api/admin/jugadores': () => ok(pageOf([player])),
		// The API filters by `equipoId` (`services/enrollments.service.ts`): answering
		// the same squad for every team hid which one the screen asked for (T-23).
		'GET /api/admin/planteles': ({ url }) => {
			const wanted = new URL(url, 'http://x').searchParams.get('equipoId');
			const rows = [enrollment, awayEnrollment].filter((row) => !wanted || String(row.equipoId) === wanted);
			return ok(pageOf(rows));
		},
		'GET /api/admin/partidos': () => ok(pageOf([adminMatch()])),
		'GET /api/admin/partidos/42': () => ok(adminMatch()),
		'GET /api/admin/competiciones/10': () => ok(league),
		'GET /api/admin/equipos/100': () => ok(home),
		'GET /api/admin/equipos/101': () => ok(away),
		'GET /api/admin/deportes/1': () => ok(sport),
		'GET /api/admin/jugadores/500': () => ok(player),
		'GET /api/admin/partidos/42/resultado': () => ok(resultPreview()),
		'GET /api/admin/partidos/42/goles': () => ok([]),
		'GET /api/admin/partidos/42/multimedia': () => ok(noMedia),
		'GET /api/admin/partidos/42/cancelacion': () => ok(cancellation()),
		...extra,
	});
}
