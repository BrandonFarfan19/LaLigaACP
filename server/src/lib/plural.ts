/** "1 ticket", "3 tickets": a count with the right form, never "ticket(s)". */
export function plural(n: number, singular: string, pluralForm: string): string {
	return `${n} ${n === 1 ? singular : pluralForm}`;
}
