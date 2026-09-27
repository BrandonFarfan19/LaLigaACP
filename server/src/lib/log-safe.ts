/** Cuánto de un texto del cliente se escribe en el registro, en puntos de código. */
const MAX_TEXTO_LOG = 120;

const RECORTADO = '…(recortado)';

/**
 * Lo que ocupa el lugar de un carácter peligroso. Se escribe con el escape y no
 * con el carácter literal a propósito: el proyecto escanea el código buscando
 * U+FFFD, porque suele ser el rastro de una edición que rompió la codificación.
 */
const REEMPLAZO = String.fromCharCode(0xfffd);

/**
 * Categorías que nunca deben llegar crudas a un registro: controles (C0/C1),
 * formato (bidi, invisibles), mitades sueltas de pares suplentes y separadores
 * de línea y de párrafo. Son las mismas familias que `displayName` ya rechaza
 * en los nombres del catálogo (T-06), por el mismo motivo: no se ven.
 */
const PELIGROSOS = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/gu;

/**
 * Un texto que vino del cliente, listo para escribir en el registro del
 * servidor.
 *
 * Lo que se registra de una petición rechazada (una cabecera, una ruta) lo
 * eligió quien la mandó, así que tiene dos riesgos que no tiene el resto de lo
 * que registra el proyecto:
 *
 * - **Falsificar líneas del registro.** Un `\n` o un `\r` dentro del valor
 *   parte la línea en dos y deja escribir una entrada entera inventada, que
 *   después se lee como si la hubiera puesto el servidor. Por eso los
 *   controles se reemplazan, no se escapan.
 * - **Llenar la pantalla de quien lee.** Un valor enorme, o con secuencias de
 *   escape de terminal, ensucia el `docker logs`. De ahí el tope y el
 *   reemplazo de los invisibles.
 *
 * Devuelve una marca legible cuando no hay valor, para distinguir "no mandó la
 * cabecera" de "la mandó vacía": son dos causas distintas.
 */
export function textoParaLog(value: string | undefined, max = MAX_TEXTO_LOG): string {
	if (value === undefined) return '(ausente)';
	if (value === '') return '(vacío)';
	const limpio = value.replace(PELIGROSOS, REEMPLAZO);
	const puntos = Array.from(limpio);
	return puntos.length > max ? `${puntos.slice(0, max).join('')}${RECORTADO}` : limpio;
}
