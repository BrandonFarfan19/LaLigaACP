import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Where uploaded images live (T-13): one flat directory outside the code
 * (a Docker volume), with names the server makes up. A stored name is always
 * 32 hex characters + `.webp`, so it can't point anywhere else (no `/`, no
 * `..`); the database checks the same shape.
 *
 * Files and rows are not in one transaction, so every caller follows the
 * same order:
 * 1. `save` the file BEFORE the transaction (never inside it, or inside a
 *    hook: a deadlock retry would run it again);
 * 2. run the transaction;
 * 3. if it failed, `remove` the new file; if it replaced or deleted a row
 *    with a file, `remove` the old one AFTER the commit.
 * A crash between 1 and 2 can leave an unreferenced file (docs/pendientes.md).
 */

const NAME = /^[0-9a-f]{32}\.webp$/;

export const isStoredImageName = (name: unknown): name is string => typeof name === 'string' && NAME.test(name);

export interface MediaStore {
	readonly dir: string;
	/** Writes a new file and returns its name. */
	save(content: Buffer): Promise<string>;
	/** Deletes a file. Never throws: a failure is logged and leaves an orphan behind. */
	remove(name: string | null | undefined): Promise<void>;
	/** Absolute path of a valid name. */
	pathOf(name: string): string;
}

export function createMediaStore(dir: string): MediaStore {
	let ready: Promise<unknown> | undefined;
	const pathOf = (name: string) => {
		if (!isStoredImageName(name)) throw new Error(`Nombre de archivo inválido: ${JSON.stringify(name)}`);
		return join(dir, name);
	};
	return {
		dir,
		pathOf,
		async save(content) {
			ready ??= mkdir(dir, { recursive: true });
			await ready;
			const name = `${randomBytes(16).toString('hex')}.webp`;
			// 'wx': never overwrite, even in the astronomically unlikely case of a repeated name.
			await writeFile(pathOf(name), content, { flag: 'wx', mode: 0o644 });
			return name;
		},
		async remove(name) {
			if (!name) return;
			try {
				await unlink(pathOf(name));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
				console.warn(`No se pudo borrar la imagen ${name}; queda huérfana:`, error);
			}
		},
	};
}
