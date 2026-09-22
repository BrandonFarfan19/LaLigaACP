import { readFile } from 'node:fs/promises';
import type { Writable } from 'node:stream';
import { firstLine, promptHidden, readFirstLine, type SecretInput } from './read-secret.js';

/** A usage mistake in how the command was invoked (exit 1 with this message). */
export class UsageError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UsageError';
	}
}

/**
 * Where `admin:create` gets the password from, in order of preference:
 *
 * - **Terminal prompt** (default, no variable set): typed twice, no echo.
 *   Nothing ends up in shell history or in any process command line.
 * - `ADMIN_PASSWORD_FILE`: path to a file whose first line is the password
 *   (Docker/CI secret files).
 * - `ADMIN_PASSWORD_STDIN=1`: first line of a piped stdin.
 * - `ADMIN_PASSWORD`: the value itself. Only for CI, where the variable comes
 *   from the platform's secret store; typed by hand it lands in shell history
 *   and, with `docker compose exec -e`, in docker's command line.
 *
 * `value`: the password is already known (read eagerly, so promoting an
 * existing account can report that it was ignored). `prompt`: asked only if
 * the account has to be created.
 */
export type PasswordSource =
	| { kind: 'value'; from: 'ADMIN_PASSWORD' | 'ADMIN_PASSWORD_FILE' | 'ADMIN_PASSWORD_STDIN'; value: string }
	| { kind: 'prompt'; ask: () => Promise<string> }
	| { kind: 'none' };

export interface PasswordIo {
	input: SecretInput;
	output: Writable;
}

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'si', 'sí']);

export async function resolvePasswordSource(
	vars: NodeJS.ProcessEnv,
	io: PasswordIo = { input: process.stdin, output: process.stderr },
): Promise<PasswordSource> {
	const inline = vars.ADMIN_PASSWORD;
	const file = vars.ADMIN_PASSWORD_FILE?.trim();
	const stdin = TRUE_VALUES.has((vars.ADMIN_PASSWORD_STDIN ?? '').trim().toLowerCase());

	const chosen = [inline ? 'ADMIN_PASSWORD' : '', file ? 'ADMIN_PASSWORD_FILE' : '', stdin ? 'ADMIN_PASSWORD_STDIN' : ''].filter(
		Boolean,
	);
	if (chosen.length > 1) {
		throw new UsageError(`Usa una sola fuente para la contraseña; llegaron varias: ${chosen.join(', ')}.`);
	}

	if (inline) return { kind: 'value', from: 'ADMIN_PASSWORD', value: inline };

	if (file) {
		let text: string;
		try {
			text = await readFile(file, 'utf8');
		} catch {
			// The path is not secret; the file's contents never appear in a message.
			throw new UsageError(`No se pudo leer ADMIN_PASSWORD_FILE (${file}).`);
		}
		return { kind: 'value', from: 'ADMIN_PASSWORD_FILE', value: firstLine(text) };
	}

	if (stdin) return { kind: 'value', from: 'ADMIN_PASSWORD_STDIN', value: await readFirstLine(io.input) };

	if (io.input.isTTY) {
		return {
			kind: 'prompt',
			ask: async () => {
				const first = await promptHidden('Contraseña del administrador (no se muestra): ', io.input, io.output);
				const again = await promptHidden('Repetila: ', io.input, io.output);
				if (first !== again) throw new UsageError('Las contraseñas no coinciden. No se creó nada.');
				return first;
			},
		};
	}

	return { kind: 'none' };
}
