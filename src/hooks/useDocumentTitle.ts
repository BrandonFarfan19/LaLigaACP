import { useEffect } from 'react';

/** Sets `<title>`. Pages pass the full title, site name included. */
export function useDocumentTitle(title: string) {
	useEffect(() => {
		document.title = title;
	}, [title]);
}
