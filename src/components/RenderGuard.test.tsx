import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RenderGuard from './RenderGuard';

function Fragile({ broken }: { broken: boolean }) {
	if (broken) throw new Error('boom');
	return <p>Panel sano</p>;
}

describe('RenderGuard (T-19 fix)', () => {
	afterEach(() => vi.restoreAllMocks());

	it('shows the fallback when its part throws, and tries again when the reset key changes', () => {
		// React reports the caught error on the console: keep the output clean.
		vi.spyOn(console, 'error').mockImplementation(() => undefined);
		const { rerender } = render(
			<main>
				<h1>Página</h1>
				<RenderGuard resetKey={1} fallback={<p>Aviso de ticket</p>}>
					<Fragile broken />
				</RenderGuard>
			</main>,
		);
		expect(screen.getByText('Aviso de ticket')).toBeTruthy();
		expect(screen.getByRole('heading', { name: 'Página' })).toBeTruthy();

		// Same key: still the fallback, even if the child would render now.
		rerender(
			<main>
				<h1>Página</h1>
				<RenderGuard resetKey={1} fallback={<p>Aviso de ticket</p>}>
					<Fragile broken={false} />
				</RenderGuard>
			</main>,
		);
		expect(screen.getByText('Aviso de ticket')).toBeTruthy();

		rerender(
			<main>
				<h1>Página</h1>
				<RenderGuard resetKey={2} fallback={<p>Aviso de ticket</p>}>
					<Fragile broken={false} />
				</RenderGuard>
			</main>,
		);
		expect(screen.getByText('Panel sano')).toBeTruthy();
		expect(screen.queryByText('Aviso de ticket')).toBeNull();
	});
});
