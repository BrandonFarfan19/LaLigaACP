import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiRoutes } from '../test/betting-fixtures';
import { fail, json, mockFetch, ok } from '../test/fetch-mock';
import { FB_EMBED, FB_VIDEO, liveStream, noLiveStream } from '../test/live-stream-fixtures';
import { renderLeague } from '../test/render-league';
import { PLAYER_ALLOW, PLAYER_SANDBOX } from './EnVivo';

/** C-14 (D-043): the public «En vivo» page, with the simulated `/public/transmision`. */
describe('«En vivo» (C-14)', () => {
	it('with a stream: the player loads exactly the API\'s embedUrl, sandboxed, and a link opens it on Facebook', async () => {
		const { calls } = mockFetch(apiRoutes({ 'GET /api/public/transmision': () => ok(liveStream()) }));
		renderLeague('/en-vivo');

		const player = await screen.findByTitle(/Transmisión en vivo/);
		expect(player.tagName).toBe('IFRAME');
		expect(player.getAttribute('src')).toBe(FB_EMBED);
		expect(player.getAttribute('sandbox')).toBe(PLAYER_SANDBOX);
		expect(PLAYER_SANDBOX.split(' ').sort()).toEqual(['allow-popups', 'allow-popups-to-escape-sandbox', 'allow-presentation', 'allow-same-origin', 'allow-scripts']);
		expect(player.getAttribute('allow')).toBe(PLAYER_ALLOW);
		expect(PLAYER_ALLOW).toBe('autoplay; clipboard-write; encrypted-media; picture-in-picture');
		expect(player.hasAttribute('allowfullscreen')).toBe(true);
		expect(player.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');

		const link = screen.getByRole('link', { name: 'Ver la transmisión en Facebook' });
		expect(link.getAttribute('href')).toBe(FB_VIDEO);
		expect(link.getAttribute('target')).toBe('_blank');
		expect(link.getAttribute('rel')).toBe('noopener noreferrer');
		expect(screen.queryByText('No hay transmisión en vivo en este momento.')).toBeNull();
		// Public: one read, no session involved.
		expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/public/transmision']);
		expect(document.title).toBe('En vivo · La Liga ACP');
		// C-14 fix: the site's scanlines get a hole over the player's frame.
		expect(document.body.hasAttribute('data-crt-hole')).toBe(true);
	});

	it('without a stream: the message, and no player', async () => {
		mockFetch(apiRoutes({ 'GET /api/public/transmision': () => ok(noLiveStream()) }));
		renderLeague('/en-vivo');

		expect(await screen.findByText('No hay transmisión en vivo en este momento.')).toBeTruthy();
		// No player, no hole: the scanlines cover the page as everywhere else.
		expect(document.body.hasAttribute('data-crt-hole')).toBe(false);
		expect(document.querySelector('iframe')).toBeNull();
		expect(screen.queryByRole('link', { name: /Facebook/ })).toBeNull();
	});

	it.each([
		['a player address that is not Facebook\'s plugin', { ...liveStream(), embedUrl: 'https://evil.example/plugins/video.php?href=x' }],
		['a plugin address on another scheme', { ...liveStream(), embedUrl: 'http://www.facebook.com/plugins/video.php?href=x' }],
		['a link off Facebook', { ...liveStream(), url: 'javascript:alert(1)' }],
		['a stream without its date', { ...liveStream(), actualizadoEn: null }],
		['a null body', null],
		['an embedUrl without a link', { url: null, embedUrl: FB_EMBED, actualizadoEn: null }],
	])('a body that is not the contract (%s) is a notice with «Reintentar», never a player', async (_label, body) => {
		mockFetch(apiRoutes({ 'GET /api/public/transmision': () => ok(body) }));
		renderLeague('/en-vivo');

		expect(await screen.findByRole('button', { name: 'Reintentar' })).toBeTruthy();
		expect(screen.getByRole('alert').textContent).toMatch(/No se pudo cargar la transmisión/);
		expect(document.querySelector('iframe')).toBeNull();
	});

	it('a passing failure keeps the page with «Reintentar»; a retry that loads moves the focus to the stream, one that fails keeps it', async () => {
		let answer: () => Response = () => fail(503, 'DATABASE_UNAVAILABLE', 'La base no responde.');
		mockFetch(apiRoutes({ 'GET /api/public/transmision': () => answer() }));
		const user = userEvent.setup();
		renderLeague('/en-vivo');

		const retry = await screen.findByRole('button', { name: 'Reintentar' });
		expect(screen.getByRole('heading', { name: 'En vivo' })).toBeTruthy();

		// Fails again: the notice stays and the focus stays on its button.
		retry.focus();
		await user.click(retry);
		await waitFor(() => expect(screen.getByRole('button', { name: 'Reintentar' }).getAttribute('aria-disabled')).toBeNull());
		expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reintentar' }));

		answer = () => ok(liveStream());
		await user.click(screen.getByRole('button', { name: 'Reintentar' }));
		const player = await screen.findByTitle(/Transmisión en vivo/);
		await waitFor(() => expect(document.activeElement).toBe(player.closest('[tabindex="-1"]')));
	});

	it('a 429 says to wait', async () => {
		mockFetch(apiRoutes({ 'GET /api/public/transmision': () => json(429, { error: { code: 'RATE_LIMITED', message: 'x', details: { limite: 'publica' } } }, { 'Retry-After': '30' }) }));
		renderLeague('/en-vivo');
		expect((await screen.findByRole('alert')).textContent).toMatch(/demasiadas solicitudes/);
	});
});
