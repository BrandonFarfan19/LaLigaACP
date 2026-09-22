import { type RefObject, useEffect, useState } from 'react';
import { useLocation, useNavigationType } from 'react-router';

/** The last value that loaded: a failed reload (`null`) keeps showing it (T-19, T-20). */
export function useKept<T>(value: T | null): T | null {
	const [kept, setKept] = useState(value);
	if (value !== null && value !== kept) setKept(value);
	return value ?? kept;
}

/**
 * After a list link or a filter (navigation state `focusResults`), the focus
 * goes to the results (their count or heading). Back and Forward leave it
 * where the browser puts it (T-20).
 */
export function useArrivalFocus(target: RefObject<HTMLElement | null>, fallback?: RefObject<HTMLElement | null>) {
	const location = useLocation();
	const type = useNavigationType();
	const wanted = type !== 'POP' && (location.state as { focusResults?: boolean } | null)?.focusResults === true;
	useEffect(() => {
		if (!wanted) return;
		(target.current ?? fallback?.current)?.focus();
		// Once per arrival.
	}, [location.key]);
}
