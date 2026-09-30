import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CRT_HOLE_PROPS, useCrtHole } from './useCrtHole';

// Stylesheets as text, read from disk as in `plantilla-header.test.ts`: Vitest proxies CSS imports, and
// tsconfig.app.json keeps Node's types out of src on purpose. Paths are from the repo root, where Vitest runs.
// @ts-expect-error -- 'node:fs' has no types under tsconfig.app.json, by design
const { readFileSync } = await import('node:fs');
const globalCss: string = readFileSync('src/styles/global.css', 'utf8');
const textFieldCss: string = readFileSync('src/components/TextField.module.css', 'utf8');
const adminCss: string = readFileSync('src/pages/admin/Admin.module.css', 'utf8');

function Player({ active = true }: { active?: boolean }) {
	const ref = useRef<HTMLDivElement>(null);
	useCrtHole(ref, active);
	return <div ref={ref} data-testid="player" />;
}

const rect = (left: number, top: number, width: number, height: number) =>
	({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

describe('useCrtHole (C-14 fix: the scanlines never draw over the player)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('marks <body> with the player\'s viewport rectangle, follows it on scroll, and cleans up on unmount', async () => {
		let box = rect(16, 120, 358, 201);
		vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => box);
		const { unmount } = render(<Player />);
		const body = document.body;
		expect(body.hasAttribute('data-crt-hole')).toBe(true);
		expect(CRT_HOLE_PROPS.map((p) => body.style.getPropertyValue(p))).toEqual(['16px', '120px', '358px', '201px']);

		box = rect(16, 40, 358, 201);
		// At once, without waiting for an animation frame (a hidden tab never runs one).
		window.dispatchEvent(new Event('scroll'));
		expect(body.style.getPropertyValue('--crt-hole-y')).toBe('40px');
		box = rect(0, 10, 320, 180);
		document.dispatchEvent(new Event('scroll'));
		expect(CRT_HOLE_PROPS.map((p) => body.style.getPropertyValue(p))).toEqual(['0px', '10px', '320px', '180px']);

		unmount();
		expect(body.hasAttribute('data-crt-hole')).toBe(false);
		expect(CRT_HOLE_PROPS.map((p) => body.style.getPropertyValue(p))).toEqual(['', '', '', '']);
	});

	it('inactive: no hole at all', () => {
		render(<Player active={false} />);
		expect(document.body.hasAttribute('data-crt-hole')).toBe(false);
	});

	it('the stylesheet cuts the hole only while <body> asks for it, and keeps the scanlines everywhere else', () => {
		const css = globalCss;
		expect(css).toMatch(/body::after\s*\{[^}]*repeating-linear-gradient/);
		const hole = /body\[data-crt-hole\]::after\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
		expect(hole).toMatch(/mask-composite:\s*exclude/);
		expect(hole).toMatch(/var\(--crt-hole-x/);
	});
});

describe('C-14 fixes in shared styles', () => {
	it('a field\'s hint and error break anywhere, so an example link never widens the page at 320 px', () => {
		const css = textFieldCss;
		expect(/\.hint\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/overflow-wrap:\s*anywhere/);
		expect(/\.error\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/overflow-wrap:\s*anywhere/);
	});

	it('the «Listo:» of an admin message is never a synthesized bold', () => {
		const css = adminCss;
		expect(/\.message strong\s*\{([^}]*)\}/.exec(css)?.[1]).toMatch(/font-weight:\s*400/);
	});
});
