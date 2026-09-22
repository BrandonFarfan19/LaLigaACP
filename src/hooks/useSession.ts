import { useSyncExternalStore } from 'react';
import { getSessionState, type SessionState, subscribeSession } from '../lib/auth';

/** The session store of `src/lib/auth.ts`, for the layout. */
export function useSession(): SessionState {
	return useSyncExternalStore(subscribeSession, getSessionState, getSessionState);
}
