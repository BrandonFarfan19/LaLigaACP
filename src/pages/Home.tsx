import { useLoaderData } from 'react-router';
import Fixture from '../components/Fixture';
import Hero from '../components/Hero';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { getFixturesByMatchday } from '../lib/matches';
import { getTeams } from '../lib/teams';

// Read through the data layer, never from `src/data` directly.
export async function loader() {
	const [teams, rounds] = await Promise.all([getTeams(), getFixturesByMatchday()]);
	return { teams, rounds };
}

export default function Home() {
	const { teams, rounds } = useLoaderData<typeof loader>();
	useDocumentTitle('La Liga ACP');

	return (
		<>
			<Hero teams={teams} />
			<Fixture rounds={rounds} />
		</>
	);
}
