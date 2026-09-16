/**
 * Coin amounts fixed by the business rules (table 28 of business-rules.md).
 * The only place these numbers live: services import them, tests assert
 * against them.
 */

/** BR-008: coins granted once, when an admin validates the user. */
export const MONEDAS_POR_VALIDACION = 10;

/** BR-020: what one confirmed selection costs. */
export const COSTO_POR_SELECCION = 1;

/** BR-046/table 27: what a selection voided by a cancelled match gives back. */
export const DEVOLUCION_POR_SELECCION = COSTO_POR_SELECCION;

/** `tipo_movimiento.codigo`: the only events that move coins (table 28). */
export type TipoMovimientoCodigo = 'validacion' | 'seleccion_confirmada' | 'devolucion_cancelacion';

/**
 * Each movement type fixes its signed amount and whether it names a
 * selection (EsquemaBD D19): `validacion` never does; a debit or a refund
 * always does, so `UNIQUE(seleccion_id, tipo_movimiento_id)` stops it from
 * being applied twice. Callers pick the type; they never pass an amount.
 */
export const MOVIMIENTOS: Readonly<Record<TipoMovimientoCodigo, { cantidad: number; conSeleccion: boolean }>> = {
	validacion: { cantidad: MONEDAS_POR_VALIDACION, conSeleccion: false },
	seleccion_confirmada: { cantidad: -COSTO_POR_SELECCION, conSeleccion: true },
	devolucion_cancelacion: { cantidad: DEVOLUCION_POR_SELECCION, conSeleccion: true },
};

/**
 * The rule of a movement type, or `undefined` for anything that isn't one of
 * the three codes. Own keys only: `toString`, `constructor` or `__proto__`
 * are not movement types.
 */
export function movementRule(tipo: unknown): { cantidad: number; conSeleccion: boolean } | undefined {
	return typeof tipo === 'string' && Object.hasOwn(MOVIMIENTOS, tipo) ? MOVIMIENTOS[tipo as TipoMovimientoCodigo] : undefined;
}

/** `usuario.saldo_monedas` is SMALLINT UNSIGNED. */
export const SALDO_MAXIMO = 65_535;
