import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { resolvePasswordSource, UsageError } from '../src/cli/admin-password.js';
import { firstLine, PromptAborted, promptHidden, readFirstLine, type SecretInput } from '../src/cli/read-secret.js';

/**
 * A stand-in for a terminal: a stream flagged as TTY with a `setRawMode` spy.
 * No real console needed; the interactive run is checked by hand (see the
 * T-03 summary).
 */
function fakeTerminal() {
	const input = new PassThrough() as PassThrough & SecretInput;
	input.isTTY = true;
	input.setRawMode = vi.fn();
	const output = new PassThrough();
	let shown = '';
	output.on('data', (chunk) => {
		shown += String(chunk);
	});
	return { input, output, shown: () => shown };
}

/** Types `answers` one per prompt, each after its question appears. */
function typeAnswers(term: ReturnType<typeof fakeTerminal>, questions: string[], answers: string[]) {
	let next = 0;
	term.output.on('data', (chunk) => {
		if (next < answers.length && String(chunk).includes(questions[next]!)) {
			const answer = answers[next++]!;
			setImmediate(() => term.input.write(answer));
		}
	});
}

describe('promptHidden', () => {
	it('reads a line in raw mode and never echoes it', async () => {
		const term = fakeTerminal();
		const pending = promptHidden('Clave: ', term.input, term.output);
		for (const ch of 'mi-clave-secreta') term.input.write(ch);
		term.input.write('\r');

		await expect(pending).resolves.toBe('mi-clave-secreta');
		expect(term.shown()).toBe('Clave: \n');
		expect(term.input.setRawMode).toHaveBeenNthCalledWith(1, true);
		expect(term.input.setRawMode).toHaveBeenLastCalledWith(false);
	});

	it('handles backspace, pasted text with CRLF and escape sequences', async () => {
		const term = fakeTerminal();
		const pending = promptHidden('Clave: ', term.input, term.output);
		term.input.write('abcx\u007F');
		term.input.write('\u001B[D');
		term.input.write('ñé\r\n');

		await expect(pending).resolves.toBe('abcñé');
	});

	it('Ctrl+C cancels and restores the terminal', async () => {
		const term = fakeTerminal();
		const pending = promptHidden('Clave: ', term.input, term.output);
		term.input.write('abc\u0003');

		await expect(pending).rejects.toBeInstanceOf(PromptAborted);
		expect(term.input.setRawMode).toHaveBeenLastCalledWith(false);
	});
});

describe('non-interactive helpers', () => {
	it('firstLine drops everything after the first line break', () => {
		expect(firstLine('clave\r\nresto')).toBe('clave');
		expect(firstLine('clave\n')).toBe('clave');
		expect(firstLine('clave')).toBe('clave');
	});

	it('readFirstLine reads a piped stdin', async () => {
		const input = new PassThrough();
		const pending = readFirstLine(input);
		input.end('clave-por-stdin-1\notra cosa\n');

		await expect(pending).resolves.toBe('clave-por-stdin-1');
	});
});

describe('resolvePasswordSource', () => {
	let dir: string;
	const notTerminal = () => ({ input: new PassThrough() as SecretInput, output: new PassThrough() });

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), 'liga-admin-'));
	});

	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it('asks twice at a terminal, without echo, and returns the password', async () => {
		const term = fakeTerminal();
		const source = await resolvePasswordSource({}, term);
		expect(source.kind).toBe('prompt');
		if (source.kind !== 'prompt') return;

		typeAnswers(term, ['Contraseña', 'Repetila'], ['clave-interactiva-1\r', 'clave-interactiva-1\r']);
		await expect(source.ask()).resolves.toBe('clave-interactiva-1');
		expect(term.shown()).not.toContain('clave-interactiva-1');
	});

	it('fails when the confirmation does not match', async () => {
		const term = fakeTerminal();
		const source = await resolvePasswordSource({}, term);
		if (source.kind !== 'prompt') throw new Error('se esperaba prompt');

		typeAnswers(term, ['Contraseña', 'Repetila'], ['clave-interactiva-1\r', 'otra-cosa-distinta\r']);
		await expect(source.ask()).rejects.toThrow(/no coinciden/);
	});

	it('does not ask anything when there is no terminal and no source', async () => {
		await expect(resolvePasswordSource({}, notTerminal())).resolves.toEqual({ kind: 'none' });
	});

	it('reads the first line of ADMIN_PASSWORD_FILE', async () => {
		const file = join(dir, 'clave.txt');
		await writeFile(file, 'clave-de-archivo-1\r\n');

		await expect(resolvePasswordSource({ ADMIN_PASSWORD_FILE: file }, notTerminal())).resolves.toEqual({
			kind: 'value',
			from: 'ADMIN_PASSWORD_FILE',
			value: 'clave-de-archivo-1',
		});
	});

	it('reports an unreadable ADMIN_PASSWORD_FILE without its contents', async () => {
		await expect(resolvePasswordSource({ ADMIN_PASSWORD_FILE: join(dir, 'no-existe') }, notTerminal())).rejects.toThrow(
			UsageError,
		);
	});

	it('reads stdin with ADMIN_PASSWORD_STDIN=1, even from a terminal', async () => {
		const term = fakeTerminal();
		const pending = resolvePasswordSource({ ADMIN_PASSWORD_STDIN: '1' }, term);
		term.input.end('clave-por-stdin-1\n');

		await expect(pending).resolves.toEqual({ kind: 'value', from: 'ADMIN_PASSWORD_STDIN', value: 'clave-por-stdin-1' });
	});

	it('takes ADMIN_PASSWORD as is (CI)', async () => {
		await expect(resolvePasswordSource({ ADMIN_PASSWORD: 'clave-de-ci-123' }, notTerminal())).resolves.toMatchObject({
			kind: 'value',
			from: 'ADMIN_PASSWORD',
		});
	});

	it('refuses more than one source', async () => {
		await expect(
			resolvePasswordSource({ ADMIN_PASSWORD: 'x', ADMIN_PASSWORD_STDIN: '1' }, notTerminal()),
		).rejects.toThrow(/una sola fuente/);
	});
});
