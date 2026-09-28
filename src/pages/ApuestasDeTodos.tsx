import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link, type LoaderFunctionArgs, useLoaderData, useLocation } from 'react-router';
import { type Column, DataTable, FilterProblems, FOCUS_RESULTS, Pager } from '../components/admin/AdminUi';
import ChoiceGroup from '../components/ChoiceGroup';
import TeamCrest from '../components/TeamCrest';
import TextField from '../components/TextField';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useArrivalFocus, useKept } from '../hooks/useKept';
import { useRememberedNavigate } from '../hooks/useRequestedPath';
import { useRetryFocus } from '../hooks/useRetryFocus';
import { useSession } from '../hooks/useSession';
import { type FilterValues, parseFilters, searchOf } from '../lib/admin-core';
import { loadMessage, pageInRange, skipPageFix, usePageUrlFix } from '../lib/admin-load';
import { isTransientError } from '../lib/api';
import { listSports } from '../lib/betting';
import { BET_TYPE_LABEL, forecastValue } from '../lib/betting-labels';
import { EVERYONE_FILTERS, EVERYONE_PATH, listParticipantBets } from '../lib/participant-bets';
import { requireKnownUser } from '../lib/route-guards';
import type { ApiPage, ApiSport, ParticipantBet } from '../types/betting';
import { formatKickoff } from '../utils/format-date';
import shared from './Apuestas.module.css';
import styles from './ApuestasDeTodos.module.css';

interface EveryonePageData {
	filters: FilterValues;
	problems: string[];
	/** A pending participant sees why there is nothing yet, and nothing is asked of the API. */
	pending: boolean;
	data: { page: ApiPage<ParticipantBet>; sports: ApiSport[] } | null;
	loadError: string | null;
	/** The page shown isn't the one the URL asked for (`?page=999`): the page replaces its URL. */
	pageFixed: boolean;
}

/**
 * `/apuestas-de-todos` (C-07, BR-056, D-036): every participant's bets, once
 * the result of their match is official, for a validated participant. An
 * admin gets the 403 page (BR-001: they keep their own query in the panel);
 * a pending participant sees why it's empty. A failure to read, or to check
 * the session when this tab already knows the participant, stays on the page
 * with "Reintentar", like `/mis-apuestas`.
 */
export async function loader(args: LoaderFunctionArgs): Promise<EveryonePageData> {
	const { filters, problems } = parseFilters(new URL(args.request.url).searchParams, EVERYONE_FILTERS);
	// A control character in the name (a pasted tab or line break) would be a 400 from the backend: dropped, with the notice.
	if (typeof filters.participante === 'string' && /\p{Cc}/u.test(filters.participante)) {
		problems.push(EVERYONE_FILTERS.participante!.invalid!);
		delete filters.participante;
	}
	const { user, sessionError } = await requireKnownUser(args, 'apostador');
	if (!sessionError && user.estadoValidacion !== 'validado') {
		return { filters, problems, pending: true, data: null, loadError: null, pageFixed: false };
	}
	const { signal } = args.request;
	try {
		if (sessionError) throw sessionError;
		const [first, sports] = await Promise.all([listParticipantBets(filters, signal), listSports(signal)]);
		// A sport the list doesn't know any more: say so instead of an empty list with no reason.
		if (filters.deporteId && !sports.some((sport) => sport.id === filters.deporteId)) problems.push('El deporte elegido ya no existe.');
		const { page, problem } = await pageInRange(filters, first, () => listParticipantBets(filters, signal));
		if (problem) problems.push(problem);
		return { filters, problems, pending: false, data: { page, sports }, loadError: null, pageFixed: Boolean(problem) };
	} catch (error) {
		if (!isTransientError(error)) throw error;
		return { filters, problems, pending: false, data: null, loadError: loadMessage(error, 'las apuestas de todos'), pageFixed: false };
	}
}

/** Replacing `?page=999` by the page shown reads nothing again. */
export const shouldRevalidate = skipPageFix;

const when = (iso: string) => {
	const { day, time } = formatKickoff(iso);
	return `${day} ${time}`;
};

/** A row and its place on the page: the API sends no selection id (BR-056), so the key is the position. */
interface Keyed {
	key: number;
	bet: ParticipantBet;
}

const COLUMNS: Column<Keyed>[] = [
	{ header: 'Participante', cell: ({ bet }) => bet.participante.nombre },
	{
		header: 'Partido',
		cell: ({ bet }) => (
			<span className={styles.match}>
				<span className={styles.teams}>
					<TeamCrest team={bet.partido.local} size={24} />
					<span>
						{bet.partido.local.nombre} vs {bet.partido.visita.nombre}
					</span>
					<TeamCrest team={bet.partido.visita} size={24} />
				</span>
				<span className={styles.small}>
					{bet.partido.deporte.nombre} · {bet.partido.competicion.nombre} · <time dateTime={bet.partido.fechaHora}>{when(bet.partido.fechaHora)}</time>
				</span>
			</span>
		),
	},
	{
		header: 'Apuesta',
		cell: ({ bet }) => `${BET_TYPE_LABEL[bet.apuesta.tipo]}: ${forecastValue(bet.apuesta, bet.partido.local.nombre, bet.partido.visita.nombre)}`,
	},
];

export default function ApuestasDeTodos() {
	useDocumentTitle('Apuestas de todos · La Liga ACP');
	const { user } = useSession();
	const load = useLoaderData<typeof loader>();
	const data = useKept(load.data);
	const location = useLocation();
	const countRef = useRef<HTMLParagraphElement>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	const [news, setNews] = useState('');
	usePageUrlFix(EVERYONE_PATH, load.filters, load.pageFixed);
	// "Filtrar", "Quitar filtros" and the page links move the focus to the results, or to the notice if the load failed.
	useArrivalFocus(load.loadError ? noticeRef : countRef, countRef);
	// What was announced belongs to the page it was said on.
	useEffect(() => setNews(''), [location.key]);
	const page = data?.page;
	const filtered = Boolean(load.filters.deporteId || load.filters.participante);
	const countText = page
		? page.total === 0
			? filtered
				? 'No hay apuestas con esos filtros. Solo se ven las de partidos con el resultado confirmado.'
				: 'Todavía no hay apuestas para mostrar: solo se ven las de partidos con el resultado confirmado.'
			: `${page.total} ${page.total === 1 ? 'apuesta' : 'apuestas'}.${page.totalPages > 1 ? ` Página ${Math.min(load.filters.page, page.totalPages)} de ${page.totalPages}.` : ''}`
		: '';
	// "Reintentar" reads again without a new location, so the arrival focus doesn't run: like `/mis-apuestas`
	// (`useRetryFocus`), a retry that loads takes the focus to the count and announces it, and one that
	// failed again leaves it on its button, inside the notice (C-07 fix).
	const { retry, busy } = useRetryFocus(load, (next) => Boolean(next.data), () => {
		countRef.current?.focus();
		setNews(countRef.current?.textContent ?? '');
	});
	if (!user || user.rol !== 'apostador') return null;

	return (
		<section className={`${shared.page} ${styles.page}`} aria-labelledby="everyone-title">
			<header className={shared.head}>
				<p className={shared.kicker}>Polla deportiva</p>
				<h1 className={shared.title} id="everyone-title">
					Apuestas de todos
				</h1>
				<p className={shared.lead}>
					Lo que apostó cada participante, del partido más reciente al más antiguo. Una apuesta aparece recién cuando se confirma el resultado de
					su partido.
				</p>
			</header>

			{load.pending ? (
				<div className={`${shared.notice} pixel-box`} role="status">
					<p>
						<strong>Tu cuenta está pendiente de validación.</strong> Las apuestas de los demás las ven los participantes validados. Cuando un
						administrador confirme tu pago y valide tu cuenta, las verás aquí.
					</p>
					<p>
						<Link className={shared.textLink} to="/cuenta">
							Ver mi cuenta
						</Link>
					</p>
				</div>
			) : (
				<>
					{load.loadError && (
						<div className={`${shared.notice} pixel-box`} role="alert" ref={noticeRef} tabIndex={-1}>
							<p>{load.loadError}</p>
							{data && <p>Abajo sigue lo que se cargó antes: puede no corresponder a lo elegido.</p>}
							<p>
								{/* aria-disabled, never disabled: a disabled button would drop the focus. */}
								<button type="button" className={shared.button} onClick={retry} aria-disabled={busy || undefined}>
									{busy ? 'Cargando…' : 'Reintentar'}
								</button>
							</p>
						</div>
					)}
					{/* Remounted when the URL's filters change, so every field shows them again. */}
					<Filters key={searchOf({ ...load.filters, page: 1 })} filters={load.filters} sports={data?.sports ?? []} />
					<FilterProblems problems={load.problems} />
					<p className={styles.status} role="status">
						{busy ? 'Cargando las apuestas…' : news}
					</p>
					{page && (
						<>
							<p className={styles.count} ref={countRef} tabIndex={-1}>
								{countText}
							</p>
							{page.items.length > 0 && (
								<DataTable caption="Apuestas de todos" columns={COLUMNS} rows={page.items.map((bet, key) => ({ key, bet }))} rowKey={(row) => row.key} />
							)}
							<Pager path={EVERYONE_PATH} filters={load.filters} page={load.filters.page} totalPages={page.totalPages} label="Páginas de apuestas de todos" />
						</>
					)}
				</>
			)}
		</section>
	);
}

function Filters({ filters, sports }: { filters: FilterValues; sports: ApiSport[] }) {
	const navigate = useRememberedNavigate();
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const value = (name: string) => String(form.get(name) ?? '').trim();
		const next: FilterValues = { page: 1, deporteId: value('deporteId') ? Number(value('deporteId')) : undefined, participante: value('participante') || undefined };
		// Like a page link: the new results take the focus.
		navigate(`${EVERYONE_PATH}${searchOf(next)}`, { state: FOCUS_RESULTS });
	};
	const active = Boolean(filters.deporteId || filters.participante);

	return (
		<form className={`${shared.filters} pixel-box`} onSubmit={onSubmit} aria-label="Filtrar apuestas de todos" noValidate>
			<div className={styles.wide}>
				<ChoiceGroup
					legend="Deporte"
					name="deporteId"
					choices={[{ value: '', label: 'Todos' }, ...sports.map((sport) => ({ value: String(sport.id), label: sport.nombre }))]}
					defaultValue={filters.deporteId ? String(filters.deporteId) : ''}
				/>
			</div>
			<TextField
				label="Participante"
				name="participante"
				hint="Parte de su nombre."
				defaultValue={typeof filters.participante === 'string' ? filters.participante : ''}
				maxLength={100}
				autoComplete="off"
			/>
			<div className={shared.filterActions}>
				<button type="submit" className={shared.button}>
					Filtrar
				</button>
				{active && (
					<Link className={shared.textLink} to={EVERYONE_PATH} state={FOCUS_RESULTS}>
						Quitar filtros
					</Link>
				)}
			</div>
		</form>
	);
}
