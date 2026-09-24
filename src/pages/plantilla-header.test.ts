import { describe, expect, it } from 'vitest';

/**
 * The stylesheet as text. It cannot be imported: Vitest replaces every CSS
 * import with a proxy object before the `?raw` query is ever looked at, with or
 * without a glob, so the file is read from disk instead.
 *
 * `tsconfig.app.json` deliberately keeps Node's types out of `src` — only
 * `vite/client` — so that no component can reach for `process` or `Buffer` and
 * still typecheck. Widening that for the whole front, to pin one stylesheet,
 * is the worse trade, so this single read is left untyped on purpose.
 */
// @ts-expect-error -- 'node:fs' has no types under tsconfig.app.json, by design
const { readFileSync } = await import('node:fs');
// Read from the repo root, which is where Vitest runs: under jsdom
// `import.meta.url` is an http:// URL, not a file:// one.
const css: string = readFileSync('src/pages/Plantilla.module.css', 'utf8');

/**
 * The identity header of `/plantilla/:id` must not push the page sideways on a
 * 320px screen (D-014), which it did with the real teams loaded. A classic
 * scrollbar takes 15px and the page keeps 16px of gutter on each side, so what
 * the header actually had was 273px — not the 305px the viewport is left with.
 * FINZULIANAS needed 322px of those 273, LOS IMPARABLES 320 and LAS GALACTICAS
 * DEL MASTER 306.
 *
 * jsdom does no layout — every box measures 0 there — so no test in this suite
 * can assert that nothing overflows. That was measured in a real browser, on
 * all fifteen teams. What this file pins is the CSS contract those measurements
 * rest on, so the fix cannot be undone by accident.
 *
 * Every rule of the fix lives below 36rem and is undone above it, so the wider
 * screens keep the header they already had. Two of them are easy to get wrong
 * in either direction, and both directions have been shipped and caught:
 *
 * - `overflow-wrap` must be **`anywhere`**, not `break-word`. `break-word`
 *   breaks a word inside its box but leaves the element's min-content alone, so
 *   the header, which sizes itself to its contents, still grows to the whole
 *   word and pushes the page sideways — 49px past the edge at 33 letters, the
 *   same as no fix at all.
 * - `min-width: 0` and that `anywhere` must **not** reach past the switch
 *   (D-031). What they take away is the floor a flex item has at its own
 *   longest word, and that floor is what stops a title being cut mid-word when
 *   the row is tight. Above the switch it is tight: at 768px the crest, title
 *   and competition want 780px of the 768 there are, and without the floor that
 *   12px shortfall is shared out, leaving the title just under its own width.
 *   FINZULIANAS came out as "FINZULIANA" and an "S" alone on the next line.
 *   The cost of keeping the floor is a known limit, written down with its
 *   figures in docs/pendientes.md: a one-word name of 26+ letters overflows on
 *   large screens. No loaded name is close — the longest word is 11 letters.
 *
 * The 36rem switch is a measured number, not a round one (D-029). A one-word
 * name of N letters is 16N px wide in a monospaced pixel face, and the row also
 * carries the crest (32), two gaps (12 each), the competition's longest word
 * (104 for `masculino`) and the page's two 16px gutters, so keeping all three
 * on one line needs `192 + 16N` px — at 576px, a name of up to 24 letters.
 */

/** The stylesheet without comments, so prose about a rule is never read as one. */
const source = css.replace(/\/\*[\s\S]*?\*\//g, '');

type Rule = { prelude: string; body: string };

/** The rules `text` holds at its own top level, each split into prelude and body. */
function rulesOf(text: string): Rule[] {
	const rules: Rule[] = [];
	let depth = 0;
	let start = 0;
	let preludeEnd = -1;
	for (let i = 0; i < text.length; i += 1) {
		if (text[i] === '{') {
			if (depth === 0) preludeEnd = i;
			depth += 1;
		} else if (text[i] === '}') {
			depth -= 1;
			if (depth === 0) {
				rules.push({ prelude: text.slice(start, preludeEnd).trim(), body: text.slice(preludeEnd + 1, i) });
				start = i + 1;
			}
		}
	}
	return rules;
}

/** The declarations of `selector` inside `text`, as property to value. */
function declarations(text: string, selector: string): Record<string, string> {
	const rule = rulesOf(text).find((candidate) => candidate.prelude === selector);
	if (!rule) throw new Error(`No hay regla para ${selector}`);
	const found: Record<string, string> = {};
	for (const piece of rule.body.split(';')) {
		const colon = piece.indexOf(':');
		if (colon === -1) continue;
		found[piece.slice(0, colon).trim()] = piece.slice(colon + 1).trim();
	}
	return found;
}

/** The body of a media rule, to read the rules nested in it. */
function media(query: string): string {
	const rule = rulesOf(source).find((candidate) => candidate.prelude === query);
	if (!rule) throw new Error(`No hay bloque ${query}`);
	return rule.body;
}

describe('cabecera de la ficha de plantilla', () => {
	it('deja que la fila se parta en pantallas angostas', () => {
		// Without this the crest, the name and the competition are locked on one
		// line, and three of the fifteen teams ran off the page.
		expect(declarations(source, '.identity')['flex-wrap']).toBe('wrap');
	});

	it('deja que el nombre se encoja y se parta en pantallas angostas', () => {
		const name = declarations(source, '.name');
		// Partir la fila no alcanza: un nombre de una sola palabra sigue siendo un
		// bloque indivisible, y un elemento flex nunca baja de su palabra más larga
		// mientras su min-width sea auto. Hacen falta las dos cosas.
		expect(name['min-width']).toBe('0');
		// `anywhere` y no `break-word`: solo `anywhere` baja también el min-content,
		// y sin eso la cabecera se agranda hasta la palabra entera y desborda igual.
		expect(name['overflow-wrap']).toBe('anywhere');
		// Con base cero el nombre no se lleva un renglón para él solo, que dejaría
		// al escudo colgado encima en lugar de al lado.
		expect(name.flex).toMatch(/\s0(%|px)?$/);
	});

	it('le devuelve al nombre su piso por encima del tope (D-031)', () => {
		// Lo contrario de esto es lo que partía FINZULIANAS a 768px: sin piso, el
		// faltante de 12px se reparte y el título queda justo debajo de su palabra.
		// El precio, anotado en docs/pendientes.md, es que 26+ letras desbordan.
		const wide = declarations(media('@media (min-width: 36rem)'), '.name');
		expect(wide['min-width']).toBe('auto');
		expect(wide['overflow-wrap']).toBe('normal');
	});

	it('da a la competición un renglón propio mientras la cabecera puede partirse', () => {
		// Sin esto, en cuanto los tres vuelven a entrar en un renglón el párrafo se
		// queda con su ancho entero y al título, al que se acaba de permitir
		// encogerse hasta nada, le tocan las sobras: a 520px la caja quedaba en 4px.
		expect(declarations(source, '.identity > p')['flex-basis']).toBe('100%');
	});

	it('desde 36rem deja la cabecera tal como estaba antes del arreglo', () => {
		// Medido equipo por equipo: a 768 y a 1280 los 15 dan idéntico a la línea
		// base. El tope sale de la medida 192 + 16N (D-029).
		const wide = media('@media (min-width: 36rem)');
		expect(declarations(wide, '.identity')['flex-wrap']).toBe('nowrap');
		expect(declarations(wide, '.name').flex).toBe('0 1 auto');
		expect(declarations(wide, '.identity > p')['flex-basis']).toBe('auto');
	});

	it('mantiene el escudo cuadrado', () => {
		// A long name must never squeeze the crest out of square.
		expect(declarations(source, '.badge')['flex-shrink']).toBe('0');
	});
});
