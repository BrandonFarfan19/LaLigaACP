import { type RefObject, useEffect } from 'react';

/**
 * After a failed submit: empties the password fields (they are never kept
 * around after an attempt), then moves the focus to the first invalid field
 * of the form, or else to the form's message box, so keyboard and screen
 * reader users land on what needs fixing.
 */
export function useFocusOnError(result: unknown, form: RefObject<HTMLFormElement | null>, message: RefObject<HTMLElement | null>) {
	useEffect(() => {
		if (!result) return;
		for (const password of form.current?.querySelectorAll<HTMLInputElement>('input[type="password"]') ?? []) {
			password.value = '';
		}
		const invalid = form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
		(invalid ?? message.current)?.focus();
	}, [result, form, message]);
}
