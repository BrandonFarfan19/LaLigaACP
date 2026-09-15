import type { Player } from '../types';

/**
 * Static seed squads — seven players per club.
 *
 * Stored flat and keyed by `teamId`, exactly the way a `players` table does
 * it. The per-team array the UI wants is assembled in `src/lib/players.ts`,
 * so nesting these under their club here would only have to be unpicked once
 * the API lands.
 */
export const players: Player[] = [
	// FC Barcelona
	{ id: 'p-01', teamId: 'barcelona', name: 'Íker Salvat' },
	{ id: 'p-02', teamId: 'barcelona', name: 'Rubén Ferrán' },
	{ id: 'p-03', teamId: 'barcelona', name: 'Marc Olivella' },
	{ id: 'p-04', teamId: 'barcelona', name: 'Adrià Bonet' },
	{ id: 'p-05', teamId: 'barcelona', name: 'Nacho Quintana' },
	{ id: 'p-06', teamId: 'barcelona', name: 'Gorka Elizalde' },
	{ id: 'p-07', teamId: 'barcelona', name: 'Pau Berenguer' },

	// Club Atlético Boca Juniors
	{ id: 'p-08', teamId: 'boca-juniors', name: 'Tomás Aguirre' },
	{ id: 'p-09', teamId: 'boca-juniors', name: 'Facundo Pereyra' },
	{ id: 'p-10', teamId: 'boca-juniors', name: 'Lautaro Bermúdez' },
	{ id: 'p-11', teamId: 'boca-juniors', name: 'Nicolás Ibarrola' },
	{ id: 'p-12', teamId: 'boca-juniors', name: 'Emiliano Cardozo' },
	{ id: 'p-13', teamId: 'boca-juniors', name: 'Joaquín Rossi' },
	{ id: 'p-14', teamId: 'boca-juniors', name: 'Gonzalo Vera' },

	// Club Universitario de Deportes
	{ id: 'p-15', teamId: 'universitario', name: 'Diego Zegarra' },
	{ id: 'p-16', teamId: 'universitario', name: 'Álvaro Chumpitaz' },
	{ id: 'p-17', teamId: 'universitario', name: 'Renzo Malpartida' },
	{ id: 'p-18', teamId: 'universitario', name: 'Piero Casanova' },
	{ id: 'p-19', teamId: 'universitario', name: 'Sebastián Arriola' },
	{ id: 'p-20', teamId: 'universitario', name: 'Jhonatan Rumiche' },
	{ id: 'p-21', teamId: 'universitario', name: 'Bruno Talledo' },
];
