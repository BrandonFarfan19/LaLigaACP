import { beforeEach, describe, expect, it } from 'vitest';
import { CLICK_WINDOW_MS, forgetRequested, pendingPath, rememberRequested, requestedForTest as read } from './useRequestedPath';
import { inAppHref } from '../lib/next-path';

/**
 * Where the redirect to sign in points when the session turns out to be gone
 * (T-21 second fix): the page asked for, never the one left on screen.
 */
describe('pendingPath', () => {
	const going = { pathname: '/mis-apuestas', search: '?page=2', hash: '' };
	const now = 1_000_000;

	it('takes the navigation in flight (a filter or a page link already under way)', () => {
		expect(pendingPath('/mis-apuestas', going, null, now)).toBe('/mis-apuestas?page=2');
	});

	it('takes the link just clicked when that navigation has not started yet', () => {
		expect(pendingPath('/mis-apuestas', null, { path: '/mis-apuestas?page=2', at: now - 50 }, now)).toBe('/mis-apuestas?page=2');
	});

	it('prefers the navigation over an earlier click', () => {
		expect(pendingPath('/mis-apuestas', going, { path: '/ranking', at: now - 10 }, now)).toBe('/mis-apuestas?page=2');
	});

	it('forgets a click that is no longer where the user is going', () => {
		expect(pendingPath('/mis-apuestas', null, { path: '/ranking', at: now - CLICK_WINDOW_MS - 1 }, now)).toBe('/mis-apuestas');
		// A clock that jumped backwards never makes a click count.
		expect(pendingPath('/mis-apuestas', null, { path: '/ranking', at: now + 5000 }, now)).toBe('/mis-apuestas');
	});

	it('with nothing pending it is the page on screen', () => {
		expect(pendingPath('/admin/participantes?page=3', null, null, now)).toBe('/admin/participantes?page=3');
	});
});

describe('rememberRequested: every way of asking for a page records it', () => {
	beforeEach(() => forgetRequested());

	it('records a path of this app and uses it while it is recent', () => {
		rememberRequested('/mis-apuestas?estado=acertada', 1000);
		expect(pendingPath('/mis-apuestas?page=2', null, read(), 1200)).toBe('/mis-apuestas?estado=acertada');
	});

	it('ignores anything that is not a page of this app', () => {
		rememberRequested('https://evil.test/x', 1000);
		rememberRequested('javascript:alert(1)', 1000);
		expect(read()).toBeNull();
	});
});

describe('inAppHref: only a link this app would follow', () => {
	const from = 'https://liga.test/mis-apuestas';

	it('keeps an in-app path with its query and hash', () => {
		expect(inAppHref('/mis-apuestas?page=2', from)).toBe('/mis-apuestas?page=2');
		expect(inAppHref('?page=3', from)).toBe('/mis-apuestas?page=3');
		expect(inAppHref('/admin/partidos/42#goles', from)).toBe('/admin/partidos/42#goles');
	});

	it('refuses anything that leaves the site or that `?next=` would refuse', () => {
		for (const href of ['https://evil.test/x', '//evil.test', '/\\evil.test', 'javascript:alert(1)', 'mailto:a@b.test', '', null, undefined]) {
			expect(inAppHref(href, from), String(href)).toBeNull();
		}
		// The sign-in pages are never a destination to come back to.
		expect(inAppHref('/ingresar', from)).toBeNull();
		// Dot segments that would resolve outside the app.
		expect(inAppHref('/.//evil.test', from)).toBeNull();
	});
});
