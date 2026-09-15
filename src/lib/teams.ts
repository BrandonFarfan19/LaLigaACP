import { teams } from '../data/teams';
import type { Team } from '../types';

/**
 * Data-access layer. Pages and components must read teams through these
 * functions and never import `src/data/teams` directly.
 *
 * They are async on purpose: when the backend arrives, only the body of each
 * function changes (an `await fetch(...)` or a DB query) — no call site moves.
 */

export async function getTeams(): Promise<Team[]> {
	return teams;
}

export async function getTeamById(id: string): Promise<Team | undefined> {
	return teams.find((team) => team.id === id);
}
