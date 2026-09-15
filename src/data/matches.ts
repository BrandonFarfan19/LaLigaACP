import type { Match } from '../types';

/**
 * Static seed fixture. Teams are referenced by id so the rows map 1:1 onto a
 * future `matches` table — no nested objects to unpick when the API lands.
 */
export const matches: Match[] = [
	{
		id: 'm-01',
		matchday: 1,
		kickoff: '2026-09-05T20:00:00-05:00',
		homeTeamId: 'barcelona',
		awayTeamId: 'boca-juniors',
		venue: 'Camp Nou',
		status: 'finished',
		score: { home: 2, away: 1 },
	},
	{
		id: 'm-02',
		matchday: 2,
		kickoff: '2026-09-09T18:30:00-05:00',
		homeTeamId: 'universitario',
		awayTeamId: 'barcelona',
		venue: 'Estadio Monumental',
		status: 'finished',
		score: { home: 0, away: 3 },
	},
	{
		id: 'm-03',
		matchday: 3,
		kickoff: '2026-09-19T21:00:00-05:00',
		homeTeamId: 'boca-juniors',
		awayTeamId: 'universitario',
		venue: 'La Bombonera',
		status: 'scheduled',
	},
	{
		id: 'm-04',
		matchday: 4,
		kickoff: '2026-09-26T20:00:00-05:00',
		homeTeamId: 'boca-juniors',
		awayTeamId: 'barcelona',
		venue: 'La Bombonera',
		status: 'scheduled',
	},
	{
		id: 'm-05',
		matchday: 5,
		kickoff: '2026-10-03T19:00:00-05:00',
		homeTeamId: 'barcelona',
		awayTeamId: 'universitario',
		venue: 'Camp Nou',
		status: 'scheduled',
	},
	{
		id: 'm-06',
		matchday: 6,
		kickoff: '2026-10-10T18:30:00-05:00',
		homeTeamId: 'universitario',
		awayTeamId: 'boca-juniors',
		venue: 'Estadio Monumental',
		status: 'scheduled',
	},
];
