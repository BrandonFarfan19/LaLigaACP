import type { Readable, Writable } from 'node:stream';

/** A readable that may be a terminal (`process.stdin` is a `tty.ReadStream` when it is). */
export interface SecretInput extends Readable {
	isTTY?: boolean;
	setRawMode?: (mode: boolean) => unknown;
}

/** Ctrl+C, or Ctrl+D on an empty line, while typing a secret. */
export class PromptAborted extends Error {
	constructor() {
		super('Cancelado.');
		this.name = 'PromptAborted';
	}
}

/**
 * Reads one line from a terminal **without echo**: raw mode, so the terminal
 * prints nothing, and this function prints nothing per key either. Works in
 * Windows consoles and in `docker compose exec -it` (both give a TTY with raw
 * mode). The question goes to `output` (stderr by default, so stdout stays
 * clean for scripts).
 */
export function promptHidden(
	question: string,
	input: SecretInput = process.stdin,
	output: Writable = process.stderr,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let value = '';
		output.write(question);

		const finish = (error?: Error) => {
			input.off('data', onData);
			input.setRawMode?.(false);
			input.pause();
			output.write('\n');
			if (error) reject(error);
			else resolve(value);
		};

		const onData = (chunk: Buffer | string) => {
			for (const ch of String(chunk)) {
				if (ch === '\r' || ch === '\n') return finish();
				if (ch === '\u0003' || (ch === '\u0004' && value === '')) return finish(new PromptAborted());
				if (ch === '\u007F' || ch === '\b') {
					value = Array.from(value).slice(0, -1).join('');
					continue;
				}
				// Arrow keys and other escape sequences arrive as one chunk: drop the rest of it.
				if (ch === '\u001B') break;
				if (ch < ' ') continue;
				value += ch;
			}
		};

		input.setRawMode?.(true);
		input.setEncoding('utf8');
		input.on('data', onData);
		input.resume();
	});
}

/**
 * Non-interactive mode: the first line of a piped stdin (`... | npm run
 * admin:create` or a file redirected into it). Whatever follows is ignored.
 */
export async function readFirstLine(input: Readable = process.stdin): Promise<string> {
	let text = '';
	input.setEncoding('utf8');
	for await (const chunk of input) {
		text += String(chunk);
		if (text.includes('\n')) break;
	}
	return firstLine(text);
}

/** Drops everything from the first line break on (`\n` or `\r\n`). */
export function firstLine(text: string): string {
	return text.split(/\r?\n/, 1)[0] ?? '';
}
