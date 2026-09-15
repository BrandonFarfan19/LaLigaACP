import type { Team } from '../types';

import barcelonaCrest from '../assets/barcelona.webp?pixel=crest';
import bocaCrest from '../assets/boca.avif?pixel=crest';
import universitarioCrest from '../assets/Logo_Universitario.png?pixel=crest';

/**
 * Static seed data. Replaced by a database table later — the shape here is
 * intentionally flat and id-keyed so that swap costs nothing in the UI.
 */
export const teams: Team[] = [
	{
		id: 'barcelona',
		name: 'FC Barcelona',
		shortName: 'Barcelona',
		country: 'España',
		crest: barcelonaCrest,
		accent: '#a50044',
	},
	{
		id: 'boca-juniors',
		name: 'Club Atlético Boca Juniors',
		shortName: 'Boca Juniors',
		country: 'Argentina',
		crest: bocaCrest,
		accent: '#0d4b9e',
	},
	{
		id: 'universitario',
		name: 'Club Universitario de Deportes',
		shortName: 'Universitario',
		country: 'Perú',
		crest: universitarioCrest,
		accent: '#9b1b1b',
	},
];
