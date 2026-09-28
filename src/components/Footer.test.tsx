import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Footer from './Footer';

describe('the company footer', () => {
	it('lists Grupo ACP first, then Finantty and Finzul', () => {
		render(<Footer />);
		const list = screen.getByRole('list', { name: 'Empresas' });
		const names = within(list).getAllByRole('img').map((image) => image.getAttribute('alt'));
		expect(names).toEqual(['Grupo ACP', 'Finantty', 'Finzul']);
	});
});
