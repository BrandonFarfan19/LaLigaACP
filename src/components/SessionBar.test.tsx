import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { SessionState } from '../lib/auth';
import { admin, apostador, pendiente } from '../test/fetch-mock';
import SessionBar from './SessionBar';

function renderBar(session: SessionState, extra: Partial<Parameters<typeof SessionBar>[0]> = {}) {
	const onLogout = vi.fn();
	const { container } = render(
		<MemoryRouter>
			<SessionBar session={session} currentPath="/posiciones" onLogout={onLogout} loggingOut={false} logoutError={null} {...extra} />
		</MemoryRouter>,
	);
	return { onLogout, container };
}

describe('the account corner of the navbar (T-18, BR-010)', () => {
	it('shows nothing while the session is unknown', () => {
		renderBar({ status: 'unknown', user: null });
		expect(screen.queryByRole('link')).toBeNull();
		expect(screen.queryByRole('button')).toBeNull();
	});

	it('a guest gets sign in (back to this page) and sign up', () => {
		renderBar({ status: 'ready', user: null });
		expect(screen.getByRole('link', { name: 'Ingresar' }).getAttribute('href')).toBe('/ingresar?next=%2Fposiciones');
		expect(screen.getByRole('link', { name: 'Crear cuenta' }).getAttribute('href')).toBe('/registro');
		expect(screen.queryByTestId('coin-counter')).toBeNull();
	});

	it('a session that could not be read (429, no network) is unknown: never shown as signed out', () => {
		renderBar({ status: 'error', user: null });
		expect(screen.queryByRole('link', { name: 'Ingresar' })).toBeNull();
		expect(screen.queryByRole('button')).toBeNull();
	});

	it('a failed read after a known session keeps showing that session', () => {
		renderBar({ status: 'error', user: apostador });
		expect(screen.getByRole('link', { name: 'Mi cuenta' })).toBeTruthy();
		expect(screen.queryByRole('link', { name: 'Ingresar' })).toBeNull();
	});

	it('C-13: a validated participant sees the pool and the account, and no coin counter or balance', () => {
		const { container } = renderBar({ status: 'ready', user: apostador });
		expect(screen.queryByTestId('coin-counter')).toBeNull();
		const account = screen.getByRole('link', { name: 'Mi cuenta' });
		expect(account.getAttribute('href')).toBe('/cuenta');
		expect(account.textContent).not.toMatch(/Pendiente/);
		expect(screen.getByRole('button', { name: /Polla/ })).toBeTruthy();
		expect(container.textContent).not.toMatch(/moneda|saldo/i);
	});

	it('a pending participant sees the pending tag on "Mi cuenta"', () => {
		const { container } = renderBar({ status: 'ready', user: pendiente });
		const account = screen.getByRole('link', { name: 'Mi cuenta, pendiente de validación' });
		expect(account.getAttribute('href')).toBe('/cuenta');
		expect(account.textContent).toMatch(/Pendiente/);
		expect(container.textContent).not.toMatch(/moneda|saldo/i);
	});

	it('an admin gets administration, no pool account links', () => {
		renderBar({ status: 'ready', user: admin });
		expect(screen.queryByTestId('coin-counter')).toBeNull();
		expect(screen.getByRole('link', { name: 'Admin' }).getAttribute('href')).toBe('/admin');
	});

	it('sign out calls back, shows progress and a failure', async () => {
		const { onLogout } = renderBar({ status: 'ready', user: apostador });
		await userEvent.setup().click(screen.getByRole('button', { name: 'Salir' }));
		expect(onLogout).toHaveBeenCalledTimes(1);

		const { unmount } = render(
			<MemoryRouter>
				<SessionBar
					session={{ status: 'ready', user: apostador }}
					currentPath="/"
					onLogout={() => undefined}
					loggingOut
					logoutError="No se pudo cerrar la sesión."
				/>
			</MemoryRouter>,
		);
		const busy = screen.getByRole('button', { name: 'Saliendo…' }) as HTMLButtonElement;
		expect(busy.disabled).toBe(true);
		expect(screen.getByRole('alert').textContent).toBe('No se pudo cerrar la sesión.');
		unmount();
	});
});
