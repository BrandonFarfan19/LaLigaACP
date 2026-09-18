/** "1 moneda", "3 monedas": a count with the right form, never "moneda(s)". */
export function plural(n: number, singular: string, pluralForm: string): string {
	return `${n} ${n === 1 ? singular : pluralForm}`;
}
