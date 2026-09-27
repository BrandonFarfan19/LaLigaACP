import type { Handler } from './fetch-mock';
import { ok } from './fetch-mock';

/**
 * The public API as T-22 reads it (`/public/...`), in the shape the backend
 * sends (server/README.md, "Contrato para T-22"): Spanish names, numeric ids.
 *
 * The shapes here must be the API's own, not a convenient one: a simulation
 * that answers something the backend never sends hides a defect instead of
 * catching it (T-22 fix). In particular the sport travels **beside** the
 * competition, never nested inside it, wherever the API puts the two together
 * (`/public/partidos`, `/public/equipos/:id`); only `/public/competiciones`
 * nests it.
 */

export const futbol = { id: 1, nombre: 'Fútbol', slug: 'futbol', permiteEmpate: true };
export const voley = { id: 2, nombre: 'Vóley', slug: 'voley', permiteEmpate: false };

/**
 * C-05: the statistics profiles, as the API sends them beside a sport in
 * `/public/deportes` and in a team's detail (never inside a match or a
 * competition, where the sport travels without it).
 */
export const futbolProfile = {
	codigo: 'futbol',
	nombre: 'Fútbol',
	atributos: [
		{ codigo: 'disparo', nombre: 'Disparo' },
		{ codigo: 'pase', nombre: 'Pase' },
		{ codigo: 'fuerza', nombre: 'Fuerza' },
		{ codigo: 'defensa', nombre: 'Defensa' },
		{ codigo: 'velocidad', nombre: 'Velocidad' },
		{ codigo: 'dribbling', nombre: 'Dribbling' },
	],
};
export const voleyProfile = {
	codigo: 'voley',
	nombre: 'Vóley',
	atributos: [
		{ codigo: 'mate', nombre: 'Mate' },
		{ codigo: 'saque', nombre: 'Saque' },
		{ codigo: 'recepcion', nombre: 'Recepción' },
		{ codigo: 'armado', nombre: 'Armado' },
		{ codigo: 'bloqueo', nombre: 'Bloqueo' },
	],
};
const PROFILE_OF: Record<string, typeof futbolProfile | null> = { futbol: futbolProfile, voley: voleyProfile };

/** A sport with its profile, the shape of `/public/deportes` and of a team's `deporte`. */
export const withProfile = (deporte: typeof futbol) => ({ ...deporte, perfilEstadistico: PROFILE_OF[deporte.slug] ?? null });

export const liga = { id: 10, nombre: 'Liga Apertura', slug: 'liga-apertura', deporte: futbol };
export const copa = { id: 11, nombre: 'Copa Vóley', slug: 'copa-voley', deporte: voley };

/** A competition as it travels inside a match or a team: without its sport. */
export const ref = ({ id, nombre, slug }: typeof liga) => ({ id, nombre, slug });

export const halcones = { id: 100, competicionId: 10, nombre: 'Halcones', nombreCorto: 'HAL', escudo: 'escudos/halcones.webp', colorAcento: '#3cf281' };
export const pumas = { id: 101, competicionId: 10, nombre: 'Pumas', nombreCorto: 'PUM', escudo: 'https://img.test/pumas.png', colorAcento: '#ffd23f' };
// Every crest is a value the API can really hold (`imageRef`): an `https://` URL
// or a relative image path. What is not one is exercised in `imageSrc`'s own test.
export const aguilas = { id: 200, competicionId: 11, nombre: 'Águilas', nombreCorto: 'AGU', escudo: 'escudos/aguilas.webp', colorAcento: '#4d53a6' };

type ApiMatchInput = {
	id: number;
	jornada?: number;
	estado?: 'programado' | 'en_curso' | 'finalizado' | 'cancelado';
	fechaHora?: string;
	sede?: string;
	local?: typeof halcones;
	visita?: typeof halcones;
	goles?: [number, number] | null;
	competicion?: typeof liga;
};

export function apiMatch({ id, jornada = 1, estado = 'programado', fechaHora = '2026-10-01T20:00:00.000Z', sede = 'Estadio Norte', local = halcones, visita = pumas, goles = null, competicion = liga }: ApiMatchInput) {
	const official = estado === 'finalizado' ? goles : null;
	return {
		id,
		competicion: ref(competicion),
		deporte: competicion.deporte,
		jornada,
		fechaHora,
		estado,
		sede,
		// The score (and the result derived from it) is public only with the
		// official result: finished and both sides loaded (BR-049, `officialResult`).
		local: { equipo: local, goles: official ? official[0] : null },
		visita: { equipo: visita, goles: official ? official[1] : null },
		resultado: official ? (official[0] > official[1] ? 'local_gana' : official[0] === official[1] ? 'empate' : 'visitante_gana') : null,
	};
}

/** A team with its squad, exactly as `GET /public/equipos/:id` answers: the sport with its profile (C-05). */
export const apiTeamDetail = (
	equipo: typeof halcones,
	competicion: typeof liga,
	plantel: ReturnType<typeof squadMember>[],
	deporte: ReturnType<typeof withProfile> = withProfile(competicion.deporte),
) => ({
	...equipo,
	competicion: ref(competicion),
	deporte,
	plantel,
});

export const standingRow = (equipo: typeof halcones, posicion: number, puntos: number, extra: Partial<{ jugados: number; ganados: number; empatados: number; perdidos: number; golesAFavor: number; golesEnContra: number; diferencia: number }> = {}) => ({
	posicion,
	equipo,
	jugados: 3,
	ganados: puntos / 3,
	empatados: 0,
	perdidos: 3 - puntos / 3,
	golesAFavor: 5,
	golesEnContra: 2,
	diferencia: 3,
	puntos,
	...extra,
});

/** A squad member; `estadisticas` (C-05) is `codigo` → 0-99 for every attribute of the profile, or `null`. */
export const squadMember = (jugadorId: number, nombre: string, numeroCamiseta: number, foto: string | null = null, estadisticas: Record<string, number> | null = null) => ({
	jugadorId,
	nombre,
	foto,
	numeroCamiseta,
	estadisticas,
});

/** A whole football set, as the API stores it. */
export const futbolStats = { disparo: 88, pase: 75, fuerza: 60, defensa: 42, velocidad: 91, dribbling: 80 };

export const page = <T>(items: T[], extra: Partial<{ page: number; pageSize: number; total: number; totalPages: number }> = {}) => ({
	items,
	page: 1,
	pageSize: 100,
	total: items.length,
	totalPages: items.length ? 1 : 0,
	...extra,
});

type ApiMatchRow = ReturnType<typeof apiMatch>;

/**
 * `GET /public/partidos` as the backend answers it: it applies the filters it
 * is given (`competicionId`, `estado`, `jornada`), orders by proximity
 * (BR-013: upcoming soonest first, then past most recent first, then id) and
 * cuts the page asked for. A handler that answered the same list whatever was
 * asked let a wrong read pass unnoticed (T-22 fix).
 *
 * `estado` matches the state written in each row, so a fixture that wants a
 * match "in progress" gives it that state and a past date.
 */
/**
 * `GET /public/competiciones` as the backend answers it: `deporteId` filters,
 * and each row carries its sport nested. A handler that ignored the filter let
 * a screen ask for one sport and get another's competitions (T-22 second fix).
 */
export function competitionsRoute(all: (typeof liga)[] = [liga, copa]): Handler {
	return ({ url }) => {
		const wanted = new URL(url, 'http://x').searchParams.get('deporteId');
		return ok(page(all.filter((competition) => !wanted || String(competition.deporte.id) === wanted)));
	};
}

export function matchesRoute(all: ApiMatchRow[], now: number = Date.now()): Handler {
	const proximity = (a: ApiMatchRow, b: ApiMatchRow) => {
		const first = Date.parse(a.fechaHora);
		const second = Date.parse(b.fechaHora);
		const upcoming = (time: number) => (time >= now ? 0 : 1);
		if (upcoming(first) !== upcoming(second)) return upcoming(first) - upcoming(second);
		return (upcoming(first) === 0 ? first - second : second - first) || a.id - b.id;
	};
	return ({ url }) => {
		const query = new URL(url, 'http://x').searchParams;
		const equals = (name: string, value: number | string) => !query.get(name) || query.get(name) === String(value);
		const items = all.filter((match) => equals('competicionId', match.competicion.id) && equals('deporteId', match.deporte.id) && equals('estado', match.estado) && equals('jornada', match.jornada)).sort(proximity);
		const pageSize = Number(query.get('pageSize') ?? 100);
		const asked = Number(query.get('page') ?? 1);
		return ok(page(items.slice((asked - 1) * pageSize, asked * pageSize), { page: asked, pageSize, total: items.length, totalPages: Math.ceil(items.length / pageSize) }));
	};
}

/** A league API with two sports, two competitions and one fixture; each route replaceable. */
export function leagueRoutes(extra: Record<string, Handler> = {}): Record<string, Handler> {
	return {
		'GET /api/public/deportes': () => ok([withProfile(futbol), withProfile(voley)]),
		'GET /api/public/competiciones': competitionsRoute(),
		'GET /api/public/competiciones/10': () => ok(liga),
		'GET /api/public/competiciones/11': () => ok(copa),
		'GET /api/public/competiciones/10/equipos': () => ok([halcones, pumas]),
		'GET /api/public/competiciones/11/equipos': () => ok([aguilas]),
		'GET /api/public/competiciones/10/posiciones': () => ok({ competicion: liga, filas: [standingRow(halcones, 1, 9), standingRow(pumas, 2, 3)] }),
		'GET /api/public/competiciones/11/posiciones': () => ok({ competicion: copa, filas: [] }),
		'GET /api/public/partidos': matchesRoute([apiMatch({ id: 1 })]),
		// Luis has his statistics (C-05), Sofía doesn't.
		'GET /api/public/equipos/100': () => ok(apiTeamDetail(halcones, liga, [squadMember(500, 'Luis Paredes', 9, null, futbolStats), squadMember(501, 'Sofía Díaz', 4)])),
		...extra,
	};
}
