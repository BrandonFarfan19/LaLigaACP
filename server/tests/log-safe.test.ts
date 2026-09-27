import { describe, expect, it } from 'vitest';
import { textoParaLog } from '../src/lib/log-safe.js';

/**
 * D-06. `textoParaLog` prepara un valor que vino del cliente para escribirlo en
 * el registro del servidor (`middleware/csrf.ts`).
 *
 * Por qué se prueba acá y no a través de una petición: un salto de línea dentro
 * de la cabecera `Origin` nunca llega entero a la aplicación, pero **no por
 * esta función**. Son tres frenos distintos, y conviene no confundirlos:
 *
 * - Un cliente de Node ni siquiera lo manda: corta con `Invalid character in
 *   header content` antes de que la petición salga.
 * - Por socket crudo con **LF solo**, el analizador de HTTP de Node rechaza la
 *   petición con **400** y no llega a la aplicación.
 * - Por socket crudo con **CRLF**, Node **no** la rechaza: **parte** la
 *   cabecera en dos, así que la aplicación recibe el `Origin` **truncado antes
 *   del CR** y lo que seguía queda como otra cabecera. Tampoco se inyecta, pero
 *   por un motivo completamente distinto del anterior.
 *   (Los dos casos por socket crudo los midió `tester_liga_2` mandando la
 *   petición a mano, byte por byte.)
 *
 * O sea que hoy el saneo es una defensa más, no la que tapa ese agujero: el
 * mismo texto también se arma con la ruta, y mañana puede registrarse otro
 * valor del cliente que no venga de una cabecera. Así que la función se prueba
 * directo, con las entradas que un día podrían llegarle.
 */
describe('textoParaLog', () => {
	it('distingue una cabecera ausente de una vacía', () => {
		// Son dos causas distintas: ausente suele ser un proxy que no la reenvía.
		expect(textoParaLog(undefined)).toBe('(ausente)');
		expect(textoParaLog('')).toBe('(vacío)');
	});

	it('deja intacto un origen normal', () => {
		expect(textoParaLog('https://liga.ejemplo.com')).toBe('https://liga.ejemplo.com');
		expect(textoParaLog('http://localhost:5173')).toBe('http://localhost:5173');
	});

	it('no deja falsificar una línea del registro', () => {
		const falsificado = 'https://a.example\nCSRF: origen no permitido en POST /inventado';
		const escrito = textoParaLog(falsificado);

		expect(escrito).not.toContain('\n');
		expect(escrito).not.toContain('\r');
		// El texto sigue ahí, legible: lo que se anula es el salto de línea, para
		// que todo quede en el renglón que escribió el servidor.
		expect(escrito).toContain('https://a.example');
		expect(escrito).toContain('/inventado');
	});

	// Se construyen con su código y no se escriben literales a propósito: el
	// proyecto escanea los archivos buscando invisibles, y un carácter de estos
	// pegado en el código haría saltar ese escaneo en cada revisión.
	const car = (codigo: number) => String.fromCharCode(codigo);

	it('anula retornos de carro, tabuladores y escapes de terminal', () => {
		// \r, \t, ESC (el que abre las secuencias de color), NUL y NEL.
		for (const codigo of [0x0d, 0x09, 0x1b, 0x00, 0x85]) {
			const raro = car(codigo);
			expect(textoParaLog(`https://a.example${raro}x`)).not.toContain(raro);
		}
	});

	it('anula invisibles y separadores de línea Unicode', () => {
		// Un bidi o un separador de párrafo no se ven, pero mueven el texto de
		// sitio al leerlo. Mismas familias que rechaza `displayName` (T-06).
		// RLO, ZWSP, LS, PS y BOM.
		for (const codigo of [0x202e, 0x200b, 0x2028, 0x2029, 0xfeff]) {
			const raro = car(codigo);
			expect(textoParaLog(`https://a.example${raro}`)).not.toContain(raro);
		}
	});

	it('repara mitades sueltas de pares suplentes', () => {
		const media = car(0xd800);
		expect(textoParaLog(`https://a.example${media}`)).not.toContain(media);
		// Un emoji entero, que sí es un par válido, se conserva.
		const emoji = String.fromCodePoint(0x1f642);
		expect(textoParaLog(`https://a.example/${emoji}`)).toContain(emoji);
	});

	it('recorta lo larguísimo y avisa que recortó', () => {
		const largo = `https://${'a'.repeat(5000)}.example`;
		const escrito = textoParaLog(largo);

		expect(escrito).toContain('(recortado)');
		expect(escrito.length).toBeLessThan(200);
		expect(escrito.startsWith('https://aaa')).toBe(true);
	});

	it('cuenta el tope en caracteres, no en unidades UTF-16', () => {
		// Diez emoji son diez caracteres, aunque ocupen veinte unidades: si se
		// midiera en unidades, el corte podría partir uno al medio y dejar una
		// mitad suelta en el registro.
		const cara = String.fromCodePoint(0x1f642);
		expect(textoParaLog(cara.repeat(10), 10)).toBe(cara.repeat(10));
		expect(textoParaLog(cara.repeat(11), 10)).toBe(`${cara.repeat(10)}…(recortado)`);
	});
});
