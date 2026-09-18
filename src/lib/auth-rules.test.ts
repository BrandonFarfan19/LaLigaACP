import { describe, expect, it } from 'vitest';
import { checkLogin, checkRegistration, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from './auth-rules';

/**
 * The password rule of the registration screen (BR-003, C-01): 6 to 20
 * characters and nothing else. It repeats the backend's rule only to help
 * while typing — the backend validates again and its answer is the one that
 * counts — so the two must say exactly the same thing.
 */

const valid = { nombre: 'Ana', email: 'ana@liga.test' };
const passwordError = (password: string) => checkRegistration({ ...valid, password }).password;

describe('choosing a password (BR-003, C-01)', () => {
	it('goes from 6 to 20 characters', () => {
		expect(PASSWORD_MIN_LENGTH).toBe(6);
		expect(PASSWORD_MAX_LENGTH).toBe(20);
		expect(passwordError('a'.repeat(5))).toMatch(/muy corta: debe tener al menos 6 caracteres/);
		expect(passwordError('a'.repeat(6))).toBeUndefined();
		expect(passwordError('a'.repeat(20))).toBeUndefined();
		expect(passwordError('a'.repeat(21))).toMatch(/muy larga: no puede superar los 20 caracteres/);
	});

	it('asks nothing about what it is made of', () => {
		for (const password of ['abcdef', '123456', '!!!!!!', '      ', 'clave con espacios', 'ñandú áéíóü', '🦅🦅🦅🦅🦅🦅', 'password', 'aaaaaa']) {
			expect(passwordError(password), password).toBeUndefined();
		}
	});

	it('counts characters, not UTF-16 units: 20 plain emoji fit and 21 do not', () => {
		expect(passwordError('🦅'.repeat(20))).toBeUndefined();
		expect(passwordError('🦅'.repeat(21))).toMatch(/muy larga/);
		// Three emoji are six UTF-16 units but only three characters.
		expect(passwordError('🦅'.repeat(3))).toMatch(/muy corta/);
	});

	it('a composed emoji counts as many characters as it is made of, as the hint says', () => {
		// A family of four is seven characters (four faces and three joiners), so
		// three of them look like three and count twenty-one: too long.
		expect([...'👨‍👩‍👧‍👦'].length).toBe(7);
		expect(passwordError('👨‍👩‍👧‍👦'.repeat(3))).toMatch(/muy larga/);
		// Eleven flags look like eleven and count twenty-two.
		expect(passwordError('🇵🇪'.repeat(11))).toMatch(/muy larga/);
		// An accent written apart counts on its own too: eleven of them are twenty-two.
		expect(passwordError('é'.normalize('NFD').repeat(11))).toMatch(/muy larga/);
		// And one family of four is already seven characters: enough on its own.
		expect(passwordError('👨‍👩‍👧‍👦')).toBeUndefined();
	});

	it('says nothing about the password when it is fine, and still checks the other fields', () => {
		expect(checkRegistration({ ...valid, password: 'seis12' })).toEqual({});
		expect(checkRegistration({ nombre: '  ', email: 'ana@liga.test', password: 'seis12' })).toEqual({ nombre: expect.stringMatching(/Escribe tu nombre/) });
	});
});

describe('signing in (D-024)', () => {
	it('only asks for something written: no length rule, however long the password is', () => {
		expect(checkLogin({ email: 'ana@liga.test', password: 'ab' })).toEqual({});
		expect(checkLogin({ email: 'ana@liga.test', password: 'x'.repeat(200) })).toEqual({});
		// An account from before the change keeps getting in with its long password.
		expect(checkLogin({ email: 'ana@liga.test', password: 'una-clave-larguisima-de-antes-del-cambio' })).toEqual({});
	});

	it('still asks for a password and a valid email', () => {
		expect(checkLogin({ email: 'ana@liga.test', password: '' })).toEqual({ password: 'Escribe tu contraseña.' });
		expect(checkLogin({ email: 'no-es-correo', password: 'seis12' })).toEqual({ email: expect.stringMatching(/no es válido/) });
	});
});
