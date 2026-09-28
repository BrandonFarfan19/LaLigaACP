/**
 * The statements of a `.sql` file in order, split the way the `mysql` client
 * does (honoring `DELIMITER`), so a migration of `db/migraciones/` runs in a
 * test exactly as it runs by hand.
 */
export function statements(sql: string): string[] {
	const out: string[] = [];
	let delimiter = ';';
	let current = '';
	for (const line of sql.replace(/\r\n/g, '\n').split('\n')) {
		const change = /^DELIMITER\s+(\S+)\s*$/i.exec(line.trim());
		if (change) {
			delimiter = change[1]!;
			continue;
		}
		if (current === '' && line.trim().startsWith('--')) continue;
		current += `${line}\n`;
		if (line.trimEnd().endsWith(delimiter)) {
			const text = current.trimEnd().slice(0, -delimiter.length).trim();
			if (text) out.push(text);
			current = '';
		}
	}
	if (current.trim()) out.push(current.trim());
	return out;
}
