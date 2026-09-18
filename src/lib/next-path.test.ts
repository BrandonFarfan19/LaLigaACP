import { describe, expect, it } from 'vitest';
import { loginPathFor, safeNextPath } from './next-path';

describe('?next= after signing in (T-18)', () => {
	it('keeps paths inside the app, with their query and hash', () => {
		for (const [raw, expected] of [
			['/', '/'],
			['/cuenta', '/cuenta'],
			['/plantilla/42', '/plantilla/42'],
			['/posiciones?x=1#tabla', '/posiciones?x=1#tabla'],
			['/admin/', '/admin/'],
			['/plantilla/%C3%B1', '/plantilla/%C3%B1'],
			['/a/../cuenta', '/cuenta'],
		]) {
			expect(safeNextPath(raw), raw).toBe(expected);
		}
	});

	it('refuses anything that could leave the app, and falls back', () => {
		const bad = [
			null,
			undefined,
			'',
			'cuenta',
			'https://evil.test/',
			'http:evil.test',
			'//evil.test',
			'//evil.test/cuenta',
			'///evil.test',
			'/\\evil.test',
			'\\\\evil.test',
			'/\t/evil.test',
			'/\n/evil.test',
			'/cuenta\u0000',
			'/ cuenta',
			'javascript:alert(1)',
			'data:text/html,hola',
			' /cuenta',
			`/${'a'.repeat(2048)}`,
			'/ingresar',
			'/ingresar/',
			'/ingresar?next=/cuenta',
			'/registro',
		];
		for (const raw of bad) expect(safeNextPath(raw, '/inicio'), String(raw)).toBe('/inicio');
		expect(safeNextPath('//evil.test')).toBe('/');
	});

	it('dot segments that normalize into //host never leave the site (T-18 fix)', () => {
		const attacks = [
			'/.//evil.com',
			'/..//evil.com',
			'/%2e//evil.com',
			'/%2E//evil.com',
			'/%2e%2e//evil.com',
			'/%2E%2e//evil.com',
			'/a/..//evil.com',
			'/.%2e/.%2e//x.com',
			'/.///evil.com/x',
			'/././/evil.com',
			'/a/b/../..//evil.com',
			'/.//evil.com?x=1#y',
			'/%2e/%2e//evil.com',
			'/cuenta/..//evil.com',
			'/.\\/evil.com',
			'/./\\evil.com',
			'/.//%5cevil.com',
		];
		for (const raw of attacks) {
			const result = safeNextPath(raw, '/cuenta');
			expect(result, raw).toBe('/cuenta');
		}
	});

	it('whatever it returns is always a same-site path that React Router keeps inside the app', () => {
		const pieces = ['/', '.', '..', '%2e', '%2E', '%2f', '%5c', '\\', 'evil.com', 'a', '?', '#', ':', '@'];
		let seed = 11;
		const random = () => {
			seed = (seed * 1103515245 + 12345) % 2 ** 31;
			return seed / 2 ** 31;
		};
		for (let i = 0; i < 3000; i++) {
			let raw = '/';
			const length = 1 + Math.floor(random() * 8);
			for (let j = 0; j < length; j++) raw += pieces[Math.floor(random() * pieces.length)];
			const result = safeNextPath(raw, '/cuenta');
			expect(result.startsWith('/'), raw).toBe(true);
			expect(/^(?:[a-z][a-z0-9+.-]*:|[\\/]{2})/i.test(result), `${raw} -> ${result}`).toBe(false);
			expect(new URL(result, 'https://liga.test').origin, raw).toBe('https://liga.test');
			// Idempotent: the result is accepted as is.
			expect(safeNextPath(result, '/otro'), raw).toBe(result);
		}
	});

	it('builds the sign-in link of a protected page', () => {
		expect(loginPathFor('/cuenta')).toBe('/ingresar?next=%2Fcuenta');
		expect(loginPathFor('/posiciones?x=1')).toBe('/ingresar?next=%2Fposiciones%3Fx%3D1');
		expect(loginPathFor('/')).toBe('/ingresar');
		expect(loginPathFor('/ingresar?next=/cuenta')).toBe('/ingresar');
		expect(loginPathFor('//evil.test')).toBe('/ingresar');
	});
});
