/**
 * The audit log's rules (NFR-006, T-17), defined once: which admin actions
 * are audited, under which `accion_auditoria.codigo` and entity, and how the
 * short JSON detail of each record is built (never a secret, never more than
 * `MAX_DETALLE_BYTES`).
 */

/** The table each audit code affects (`accion_auditoria.entidad`). */
export type EntidadAuditada = 'usuario' | 'partido' | 'deporte' | 'competicion' | 'equipo' | 'jugador' | 'plantel' | 'gol' | 'multimedia_partido';

export interface AccionAuditada {
	codigo: string;
	entidad: EntidadAuditada;
	/** The row is gone after the action: its existence isn't checked. */
	borra?: true;
}

const alta = (codigo: string, entidad: EntidadAuditada): AccionAuditada => ({ codigo, entidad });
const borrado = (codigo: string, entidad: EntidadAuditada): AccionAuditada => ({ codigo, entidad, borra: true });

/**
 * App action name (the `action` of `runAdminAction` and of the participant
 * actions) → audit code. Every admin write is here; `tests/audit.test.ts`
 * checks each code exists in `02-catalogos.sql` with this entity.
 */
export const ACCIONES_AUDITADAS = {
	// Participants (T-04). NFR-006: "Validación de usuario".
	validar: alta('validacion_usuario', 'usuario'),
	confirmar_pago: alta('confirmacion_pago', 'usuario'),
	revertir_pago: alta('reversion_pago', 'usuario'),
	// The server command `admin:create` (D-005): the affected account is also the author.
	crear_administrador: alta('creacion_administrador', 'usuario'),
	promover_administrador: alta('promocion_administrador', 'usuario'),
	// Matches (T-07, T-12, T-16). NFR-006: modification, result, confirmation and cancellation.
	crear_partido: alta('alta_partido', 'partido'),
	editar_partido: alta('modificacion_partido', 'partido'),
	borrar_partido: borrado('borrado_partido', 'partido'),
	registrar_resultado_partido: alta('registro_resultado', 'partido'),
	confirmar_resultado_partido: alta('confirmacion_resultado', 'partido'),
	cancelar_partido: alta('cancelacion_partido', 'partido'),
	// Sports catalog (T-06).
	crear_deporte: alta('alta_deporte', 'deporte'),
	editar_deporte: alta('modificacion_deporte', 'deporte'),
	borrar_deporte: borrado('borrado_deporte', 'deporte'),
	crear_competicion: alta('alta_competicion', 'competicion'),
	editar_competicion: alta('modificacion_competicion', 'competicion'),
	borrar_competicion: borrado('borrado_competicion', 'competicion'),
	crear_equipo: alta('alta_equipo', 'equipo'),
	editar_equipo: alta('modificacion_equipo', 'equipo'),
	borrar_equipo: borrado('borrado_equipo', 'equipo'),
	crear_jugador: alta('alta_jugador', 'jugador'),
	editar_jugador: alta('modificacion_jugador', 'jugador'),
	borrar_jugador: borrado('borrado_jugador', 'jugador'),
	crear_plantel: alta('alta_plantel', 'plantel'),
	editar_plantel: alta('modificacion_plantel', 'plantel'),
	borrar_plantel: borrado('borrado_plantel', 'plantel'),
	// Goals and media (T-13). Setting or removing a goal's image or video is `editar_gol`.
	crear_gol: alta('alta_gol', 'gol'),
	editar_gol: alta('modificacion_gol', 'gol'),
	borrar_gol: borrado('borrado_gol', 'gol'),
	crear_multimedia: alta('alta_multimedia', 'multimedia_partido'),
	borrar_multimedia: borrado('borrado_multimedia', 'multimedia_partido'),
} as const satisfies Record<string, AccionAuditada>;

export type AccionApp = keyof typeof ACCIONES_AUDITADAS;

/** Own keys only (`toString` is not an action). */
export function accionAuditada(action: string): AccionAuditada | undefined {
	return Object.hasOwn(ACCIONES_AUDITADAS, action) ? ACCIONES_AUDITADAS[action as AccionApp] : undefined;
}

/** The largest detail stored, in bytes of JSON text. */
export const MAX_DETALLE_BYTES = 3000;
/**
 * The largest detail stored, in bytes of MySQL's binary JSON, as estimated by
 * `tamanoBinario` (an upper bound). The column's CHECK allows 4096: nested
 * arrays and objects can take more room there than as text.
 */
export const MAX_DETALLE_BINARIO = 3800;
/** Longest string kept inside a detail, in code points (never splits a character). */
export const MAX_TEXTO_DETALLE = 200;
/** Most elements kept of an array, and keys of an object. */
export const MAX_ELEMENTOS_DETALLE = 20;
export const MAX_CLAVES_DETALLE = 50;
/** Deepest nesting kept (MySQL refuses JSON deeper than 100). Deeper values become `TRUNCADO`. */
export const MAX_PROFUNDIDAD_DETALLE = 8;
/** What replaces a cut value. */
export const TRUNCADO = '…';

/**
 * Words that make a key forbidden, at any depth: secrets and personal data
 * the log doesn't need (who acted is `usuario_id`; the participant is
 * `entidad_id`). Matched as whole words of the key (second fix of T-17),
 * never as substrings: `hashtag`, `passport`, `compass`, `secretaria`,
 * `mailing` or `clavel` are ordinary keys.
 */
const PALABRAS_PROHIBIDAS = new Set([
	'pass', 'passwd', 'password', 'passwords', 'passphrase', 'pwd',
	'contrasena', 'contrasenas',
	'hash', 'hashes', 'hashed',
	'token', 'tokens',
	'secret', 'secrets', 'secreto', 'secretos',
	'clave', 'claves',
	'huella', 'huellas',
	'idempotencia', 'idempotency', 'idempotent',
	'cookie', 'cookies',
	'sesion', 'sesiones', 'session', 'sessions', 'sessionid',
	'email', 'emails', 'mail', 'mails', 'correo', 'correos',
	'saldo', 'saldos',
	'csrf', 'xsrf',
	'apikey', 'apikeys', 'privatekey', 'privatekeys',
	'authorization',
	'credencial', 'credenciales', 'credential', 'credentials',
	'pin', 'pins',
]);

/**
 * Ordinary words that appear glued to a forbidden one inside a single
 * lowercase token (`userpassword`, `accesstoken`, `passwordhash`), so the
 * token can be split into words. A token that can't be split entirely into
 * known words (`hashtag` = hash + "tag") is just a word of its own.
 */
const PALABRAS_COMUNES = [
	'user', 'usuario', 'access', 'refresh', 'id', 'api', 'key', 'keys', 'client', 'cliente', 'x', 'auth',
	'new', 'nuevo', 'nueva', 'old', 'anterior', 'current', 'actual', 'confirm', 'code', 'codigo', 'reset',
	'temp', 'plain', 'raw', 'value', 'valor', 'de', 'del', 'bearer', 'header', 'admin', 'account', 'cuenta',
	'login', 'private', 'e', 'my', 'mi', 'monedas', 'address', 'electronico', 'number', 'numero',
];

/**
 * Qualifiers that turn a key into a fact about the secret rather than the
 * secret itself (`emailVerificado`, `passwordRequired`). Such a key is kept
 * only when its value is a boolean (or null): `emailVerificado: "ana@..."`
 * is still dropped.
 */
const CALIFICADORES_BANDERA = new Set([
	'verificado', 'verificada', 'verified',
	'confirmado', 'confirmada', 'confirmed',
	'habilitado', 'habilitada', 'enabled',
	'requerido', 'requerida', 'required',
	'valido', 'valida', 'valid',
]);

const DICCIONARIO = new Set([...PALABRAS_PROHIBIDAS, ...PALABRAS_COMUNES, ...CALIFICADORES_BANDERA]);

/**
 * `token` split into dictionary words, preferring a split that contains a
 * forbidden word; `[token]` if it can't be split entirely.
 */
function partir(token: string): string[] {
	// best[i]: a split of token.slice(0, i), or undefined; a split with a forbidden word wins.
	const best: (string[] | undefined)[] = [[]];
	const risky = (split: string[]) => split.some((word) => PALABRAS_PROHIBIDAS.has(word));
	for (let end = 1; end <= token.length; end++) {
		for (let start = 0; start < end; start++) {
			const head = best[start];
			const word = token.slice(start, end);
			if (!head || !DICCIONARIO.has(word)) continue;
			const candidate = [...head, word];
			const current = best[end];
			if (!current || (risky(candidate) && !risky(current))) best[end] = candidate;
		}
	}
	return best[token.length] ?? [token];
}

/**
 * The words of a key, without accents or case: camelCase, `snake_case`,
 * `kebab-case`, digits and glued known words all split (`X-CSRF-Token`,
 * `userPin`, `user_pin`, `userpassword`).
 */
function palabras(key: string): string[] {
	return key
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.replace(/([a-z])([A-Z])/g, '$1 $2')
		.replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
		.split(/[^A-Za-z]+/)
		.filter(Boolean)
		.flatMap((token) => partir(token.toLowerCase()));
}

/**
 * Whether `key` names a secret or personal data. A forbidden word, or two
 * neighbouring words that make one (`api` + `key`, `e` + `mail`), makes it
 * forbidden, unless a flag qualifier says it's only a fact about it and the
 * value (when given) is a boolean or null.
 */
export function claveProhibida(key: string, value?: unknown): boolean {
	// Also the whole key glued and lowercased: mixed case (`SeSiOn`) would otherwise split into non-words.
	const glued = key
		.normalize('NFD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z]/g, '');
	const words = [...palabras(key), ...partir(glued)];
	const forbidden =
		words.some((word) => PALABRAS_PROHIBIDAS.has(word)) ||
		words.some((word, i) => i > 0 && PALABRAS_PROHIBIDAS.has(`${words[i - 1]}${word}`));
	if (!forbidden) return false;
	const flag = words.some((word) => CALIFICADORES_BANDERA.has(word));
	return !(flag && (value === undefined || value === null || typeof value === 'boolean'));
}

/**
 * No lone UTF-16 surrogates: an unpaired half becomes U+FFFD. MySQL refuses
 * such a string inside JSON (3141), which would roll the action back.
 */
export function bienFormado(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/** At most `MAX_TEXTO_DETALLE` code points, cut on a character boundary. */
function cortarTexto(text: string): string {
	const clean = bienFormado(text);
	const points = Array.from(clean);
	return points.length > MAX_TEXTO_DETALLE ? `${points.slice(0, MAX_TEXTO_DETALLE).join('')}${TRUNCADO}` : clean;
}

export type DetalleAuditoria = Record<string, unknown>;

/**
 * A JSON-safe copy: no forbidden keys, dates as ISO text, well-formed strings
 * of at most `MAX_TEXTO_DETALLE` characters, at most `MAX_ELEMENTOS_DETALLE`
 * array elements and `MAX_CLAVES_DETALLE` keys, and no deeper than
 * `MAX_PROFUNDIDAD_DETALLE` (a deeper object or array becomes `TRUNCADO`).
 */
export function sanitize(value: unknown, depth = 0): unknown {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
	if (typeof value === 'string') return cortarTexto(value);
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'boolean') return value;
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'object') {
		if (depth >= MAX_PROFUNDIDAD_DETALLE) return TRUNCADO;
		if (Array.isArray(value)) return value.slice(0, MAX_ELEMENTOS_DETALLE).map((item) => sanitize(item, depth + 1));
		const out: Record<string, unknown> = {};
		let kept = 0;
		for (const [key, inner] of Object.entries(value)) {
			if (claveProhibida(key, inner)) continue;
			if (kept === MAX_CLAVES_DETALLE) {
				out[TRUNCADO] = true;
				break;
			}
			out[cortarTexto(key)] = sanitize(inner, depth + 1);
			kept++;
		}
		return out;
	}
	return cortarTexto(String(value));
}

/**
 * The real value, comparable: like `sanitize` (no forbidden keys, dates as
 * ISO text) but nothing cut, so two values that differ only past what the
 * detail keeps still differ (D-004, second fix of T-17).
 */
function real(value: unknown): unknown {
	if (value === null || value === undefined) return null;
	if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (Array.isArray(value)) return value.map(real);
	if (typeof value === 'object') {
		return Object.fromEntries(
			Object.entries(value)
				.filter(([key, inner]) => !claveProhibida(key, inner))
				.map(([key, inner]) => [key, real(inner)]),
		);
	}
	return value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export interface Cambio {
	antes: unknown;
	despues: unknown;
	/** The stored `antes` or `despues` was cut: the real values differ even if what's shown looks the same. */
	recortado?: true;
}

/**
 * `{ campo: { antes, despues } }` for every top-level field that changed.
 * Whether it changed is decided on the real values (`real`); only what is
 * shown is cut (`sanitize`). A cut side is marked `recortado`.
 */
export function cambios(before: unknown, after: unknown): Record<string, Cambio> {
	const antes = (real(before) ?? {}) as Record<string, unknown>;
	const despues = (real(after) ?? {}) as Record<string, unknown>;
	const out: Record<string, Cambio> = {};
	for (const key of new Set([...Object.keys(antes), ...Object.keys(despues)])) {
		const a = antes[key] ?? null;
		const d = despues[key] ?? null;
		if (same(a, d)) continue;
		// Stored as `detalle.cambios.<campo>.antes`: three levels down.
		const shownA = sanitize(a, 3);
		const shownD = sanitize(d, 3);
		out[key] = { antes: shownA, despues: shownD };
		if (!same(shownA, a) || !same(shownD, d)) out[key].recortado = true;
	}
	return out;
}

const textBytes = (value: string) => Buffer.byteLength(value, 'utf8');
/** Bytes of a string's length prefix in MySQL's binary JSON (a variable-length integer). */
const lengthPrefix = (bytes: number) => (bytes < 2 ** 7 ? 1 : bytes < 2 ** 14 ? 2 : bytes < 2 ** 21 ? 3 : 4);

/**
 * An upper bound of what `value` takes in MySQL's binary JSON format
 * (`JSON_STORAGE_SIZE`), counting every container in the large layout (4-byte
 * counts and offsets) and every scalar as stored out of line. The real size
 * is never above it; a test checks that against MySQL.
 */
export function tamanoBinario(value: unknown, top = true): number {
	const typeByte = top ? 1 : 0;
	if (value === null || typeof value === 'boolean') return typeByte + 1;
	if (typeof value === 'number') return typeByte + 8;
	if (typeof value === 'string') {
		const bytes = textBytes(value);
		return typeByte + lengthPrefix(bytes) + bytes;
	}
	if (Array.isArray(value)) {
		return typeByte + 8 + value.length * 5 + value.reduce((sum: number, item) => sum + tamanoBinario(item, false), 0);
	}
	if (typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>);
		return (
			typeByte +
			8 +
			entries.length * (6 + 5) +
			entries.reduce((sum, [key, item]) => sum + textBytes(key) + tamanoBinario(item, false), 0)
		);
	}
	return typeByte + 8;
}

const fits = (detail: unknown) =>
	Buffer.byteLength(JSON.stringify(detail)) <= MAX_DETALLE_BYTES && tamanoBinario(detail) <= MAX_DETALLE_BINARIO;

/**
 * The stored detail: sanitized, at most `MAX_DETALLE_BYTES` as text and
 * `MAX_DETALLE_BINARIO` as MySQL stores it, so the column's CHECK (4 KB) and
 * MySQL's depth limit are never reached. A detail that doesn't fit keeps only
 * the names of its fields, marked `recortado`; if even that doesn't fit, only
 * the mark.
 */
export function detalleAcotado(detail: DetalleAuditoria): DetalleAuditoria {
	const clean = sanitize(detail) as DetalleAuditoria;
	if (fits(clean)) return clean;
	const campos = Object.fromEntries(
		Object.keys(clean).map((key) => {
			const value = clean[key];
			return [key, value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value).slice(0, 30) : TRUNCADO];
		}),
	);
	const cut = { recortado: true, campos };
	return fits(cut) ? cut : { recortado: true };
}
