import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

export type RolCodigo = 'apostador' | 'admin';
export type EstadoUsuarioCodigo = 'pendiente' | 'validado';
export type EstadoPagoCodigo = 'pendiente' | 'confirmado';

/**
 * The user as the API shows it. Never carries `password_hash`: queries that
 * need the hash select it separately (`findCredentialsByEmail`).
 */
export interface PublicUser {
	id: number;
	nombre: string;
	email: string;
	rol: RolCodigo;
	estadoValidacion: EstadoUsuarioCodigo;
	estadoPago: EstadoPagoCodigo;
	saldoMonedas: number;
	creadoEn: Date;
}

export interface UserRow extends RowDataPacket {
	id: number;
	nombre: string;
	email: string;
	rol: RolCodigo;
	estado_usuario: EstadoUsuarioCodigo;
	estado_pago: EstadoPagoCodigo;
	saldo_monedas: number;
	creado_en: Date;
}

type Db = Pool | PoolConnection;

/** Columns and joins shared by every query that returns a `PublicUser`. Alias `u` is the `usuario` row. */
export const USER_COLUMNS = `u.id, u.nombre, u.email, u.saldo_monedas, u.creado_en,
	r.codigo AS rol, eu.codigo AS estado_usuario, ep.codigo AS estado_pago`;
export const USER_JOINS = `JOIN rol r ON r.id = u.rol_id
	JOIN estado_usuario eu ON eu.id = u.estado_usuario_id
	JOIN estado_pago ep ON ep.id = u.estado_pago_id`;

export function toPublicUser(row: UserRow): PublicUser {
	return {
		id: row.id,
		nombre: row.nombre,
		email: row.email,
		rol: row.rol,
		estadoValidacion: row.estado_usuario,
		estadoPago: row.estado_pago,
		saldoMonedas: row.saldo_monedas,
		creadoEn: row.creado_en,
	};
}

export async function findUserById(db: Db, id: number): Promise<PublicUser | null> {
	const [rows] = await db.query<UserRow[]>(`SELECT ${USER_COLUMNS} FROM usuario u ${USER_JOINS} WHERE u.id = ?`, [id]);
	return rows[0] ? toPublicUser(rows[0]) : null;
}

interface CredentialsRow extends UserRow {
	password_hash: string;
}

export async function findCredentialsByEmail(
	db: Db,
	email: string,
): Promise<{ user: PublicUser; passwordHash: string } | null> {
	const [rows] = await db.query<CredentialsRow[]>(
		`SELECT ${USER_COLUMNS}, u.password_hash FROM usuario u ${USER_JOINS} WHERE u.email = ?`,
		[email],
	);
	const row = rows[0];
	return row ? { user: toPublicUser(row), passwordHash: row.password_hash } : null;
}

export interface NewUser {
	nombre: string;
	email: string;
	passwordHash: string;
	rol: RolCodigo;
}

/**
 * Inserts a user in `pendiente` / pago `pendiente` with 0 coins (BR-003,
 * BR-008: the 10 coins come with validation). Catalog ids are resolved by
 * `codigo`, never hardcoded. A duplicate email surfaces as mysql2's
 * `ER_DUP_ENTRY` for the caller to translate.
 */
export async function insertUser(db: Db, input: NewUser, now: Date): Promise<number> {
	const [result] = await db.query<ResultSetHeader>(
		`INSERT INTO usuario (rol_id, estado_usuario_id, estado_pago_id, nombre, email, password_hash, saldo_monedas, creado_en)
		SELECT r.id, eu.id, ep.id, ?, ?, ?, 0, ?
		FROM rol r
		JOIN estado_usuario eu ON eu.codigo = 'pendiente'
		JOIN estado_pago ep ON ep.codigo = 'pendiente'
		WHERE r.codigo = ?`,
		[input.nombre, input.email, input.passwordHash, now, input.rol],
	);
	if (result.affectedRows !== 1) {
		throw new Error(`Faltan filas de catálogo para crear un usuario con rol "${input.rol}" (¿se cargó 02-catalogos.sql?).`);
	}
	return result.insertId;
}

export function isDuplicateEntry(error: unknown): boolean {
	return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ER_DUP_ENTRY';
}
