import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { admin, apostador } from '../test/fetch-mock';
import Navbar from './Navbar';
import SessionBar from './SessionBar';

/**
 * C-02: in the navbar, **only the landing's sections** (Inicio, Fixture,
 * Posiciones) keep the site's normal colour. Everything that belongs to the
 * pool or to the account — Polla and its links, Mi cuenta, Salir, Ingresar,
 * Crear cuenta, Admin — is gold, so the two groups never read as the same
 * thing.
 *
 * The rule is fixed here by the **class** each link carries: the section links
 * come from `Navbar.module.css` and the rest from `SessionBar.module.css`, so
 * a new link styled with the wrong one shows up as a failure.
 */

const bar = (user: typeof apostador | typeof admin | null) => (
	<SessionBar session={{ status: 'ready', user }} currentPath="/posiciones" onLogout={() => undefined} loggingOut={false} logoutError={null} />
);

function renderNavbar(user: typeof apostador | typeof admin | null) {
	render(
		<MemoryRouter>
			<Navbar session={bar(user)} />
		</MemoryRouter>,
	);
	const sections = within(screen.getByRole('navigation', { name: 'Principal' }));
	const account = within(screen.getByRole('navigation', { name: 'Cuenta' }));
	return { sections, account };
}

/** The class a link is styled with (the CSS module gives each file its own). */
const classOf = (element: Element) => element.getAttribute('class') ?? '';

describe('what is gold in the navbar (C-02)', () => {
	it('the landing sections and the pool or account links never share a class', () => {
		const { sections, account } = renderNavbar(apostador);

		const sectionClasses = ['Inicio', 'Fixture', 'Posiciones'].map((name) => classOf(sections.getByRole('link', { name })));
		const accountClasses = [account.getByRole('button', { name: /Polla/ }), account.getByRole('link', { name: 'Mi cuenta' }), account.getByRole('button', { name: 'Salir' })].map(classOf);

		// The three sections are styled the same way as each other…
		expect(new Set(sectionClasses).size).toBe(1);
		// …the account ones too…
		expect(new Set(accountClasses).size).toBe(1);
		// …and the two groups are never the same.
		expect(sectionClasses[0]).not.toBe(accountClasses[0]);
	});

	it('holds for a guest (Ingresar, Crear cuenta) and for an admin (Admin, Ranking)', () => {
		const guest = renderNavbar(null);
		const sectionClass = classOf(guest.sections.getByRole('link', { name: 'Inicio' }));
		for (const name of ['Ingresar', 'Crear cuenta']) {
			expect(classOf(guest.account.getByRole('link', { name })), name).not.toBe(sectionClass);
		}
		cleanupDom();

		const asAdmin = renderNavbar(admin);
		for (const name of ['Admin', 'Ranking']) {
			expect(classOf(asAdmin.account.getByRole('link', { name })), name).not.toBe(classOf(asAdmin.sections.getByRole('link', { name: 'Inicio' })));
		}
	});

	it('the links inside the Polla menu are account links too, not section ones', async () => {
		const { sections, account } = renderNavbar(apostador);
		await userEvent.setup().click(account.getByRole('button', { name: /Polla/ }));

		const sectionClass = classOf(sections.getByRole('link', { name: 'Inicio' }));
		for (const name of ['Apostar', 'Mis apuestas', 'Ranking']) {
			expect(classOf(account.getByRole('link', { name })), name).not.toBe(sectionClass);
		}
	});
});

/** Removes the rendered tree between two renders in the same test. */
function cleanupDom() {
	document.body.innerHTML = '';
}
