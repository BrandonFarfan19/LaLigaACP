import type { PublicUser } from '../services/users.service.js';

declare global {
	namespace Express {
		interface Request {
			/** Set by `requireAuth` once the session cookie maps to a live session. */
			auth?: {
				user: PublicUser;
				sessionToken: string;
			};
		}
	}
}

export {};
