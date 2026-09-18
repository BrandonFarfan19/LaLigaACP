import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import {
	Link,
	type LoaderFunctionArgs,
	type ShouldRevalidateFunctionArgs,
	useLoaderData,
	useLocation,
	useNavigation,
	useNavigationType,
	useRevalidator,
} from 'react-router';
import ChoiceGroup from '../components/ChoiceGroup';
import StateTag from '../components/StateTag';
import TeamCrest from '../components/TeamCrest';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';
import { type ApiError, isTransientError, waitText } from '../lib/api';
import {
	getMyBetsSummary,
	groupByTicket,
	type HistoryFilters,
	historySearch,
	listAllCompetitions,
	listCompetitions,
	listMyBets,
	parseHistoryFilters,
	SELECTION_STATES,
	TICKET_STATES,
} from '../lib/bet-history';
import { listSports } from '../lib/betting';
import { BET_TYPE_LABEL, coinsText, forecastValue, resultLabel, SELECTION_STATE_LABEL, TICKET_STATE_LABEL } from '../lib/betting-labels';
import { useRememberedNavigate } from '../hooks/useRequestedPath';
import { requireKnownUser } from '../lib/route-guards';
import type { ApiCompetition, ApiPage, ApiSport, MyBet, MyBetsSummary, SelectionState, TicketState } from '../types/betting';
import { formatKickoff } from '../utils/format-date';
import shared from './Apuestas.module.css';
import styles from './MisApuestas.module.css';

export interface HistoryPageData {
	filters: HistoryFilters;
	problems: string[];
	sports: ApiSport[];
	/**
	 * The competitions the form can offer: every one when they fit in one page
	 * (`allCompetitions`), otherwise only the chosen sport's (empty without one).
	 */
	competitions: ApiCompetition[];
	allCompetitions: boolean;
	/** `null` when this load failed (see `loadError`). */
	page: ApiPage<MyBet> | null;
	summary: MyBetsSummary | null;
	loadError: string | null;
	/** The page shown isn't the one the URL asked for (`?page=999`): the page replaces its URL. */
	pageFixed: boolean;
}

function loadMessage(error: ApiError): string {
	if (error.code === 'RATE_LIMITED') {
		return `No se pudieron cargar tus apuestas: demasiadas solicitudes. Espera ${waitText(error.retryAfterSeconds) ?? 'unos minutos'} y vuelve a intentarlo.`;
	}
	return `No se pudieron cargar tus apuestas. ${error.message}`.trim();
}

/**
 * `/mis-apuestas` (T-20, BR-026): the participant's own bets, newest ticket
 * first, with the summary on top. Only `apostador` accounts (an admin gets
 * the 403 page, BR-001); a pending one sees an empty history and why. A
 * failure to read the data, or to check the session when this tab already
 * knows the participant (T-20 fix), stays on the page with "Reintentar";
 * with no known user it is the error page.
 */
export async function loader(args: LoaderFunctionArgs): Promise<HistoryPageData> {
	const { filters, problems } = parseHistoryFilters(new URL(args.request.url).searchParams);
	const requested = filters.page;
	const { sessionError } = await requireKnownUser(args, 'apostador');
	const { signal } = args.request;
	let sports: ApiSport[] = [];
	let competitions: ApiCompetition[] = [];
	let allCompetitions = false;
	try {
		if (sessionError) throw sessionError;
		const [sportList, all] = await Promise.all([listSports(signal), listAllCompetitions(signal)]);
		sports = sportList;
		// Filters that can't be shown aren't sent: the list would come back empty with no reason.
		if (filters.deporteId && !sports.some((sport) => sport.id === filters.deporteId)) {
			problems.push('El deporte elegido ya no existe: se muestran todos.');
			delete filters.deporteId;
		}
		if (filters.competicionId && !filters.deporteId) {
			problems.push('Para filtrar por competición elige también su deporte: se muestran todas.');
			delete filters.competicionId;
		}
		if (all) {
			competitions = all;
			allCompetitions = true;
		} else if (filters.deporteId) {
			competitions = await listCompetitions(filters.deporteId, signal);
		}
		if (filters.competicionId && !competitions.some((c) => c.id === filters.competicionId && c.deporte.id === filters.deporteId)) {
			problems.push('La competición elegida no es de ese deporte: se muestran todas.');
			delete filters.competicionId;
		}
		const [first, summary] = await Promise.all([listMyBets(filters, signal), getMyBetsSummary(signal)]);
		let page = first;
		// A page past the end (`?page=999`): say so and show the last one (the first when there is nothing).
		if (filters.page > Math.max(1, page.totalPages)) {
			const last = Math.max(1, page.totalPages);
			problems.push(
				last === 1 ? `La página ${filters.page} no existe: se muestra la primera.` : `La página ${filters.page} no existe: se muestra la última (${last}).`,
			);
			filters.page = last;
			if (page.totalPages > 0) page = await listMyBets(filters, signal);
		}
		return { filters, problems, sports, competitions, allCompetitions, page, summary, loadError: null, pageFixed: filters.page !== requested };
	} catch (error) {
		if (!isTransientError(error)) throw error;
		return { filters, problems, sports, competitions, allCompetitions, page: null, summary: null, loadError: loadMessage(error), pageFixed: false };
	}
}

/** The URL the page itself is writing after showing another page than the one asked for (see `pageFixed`). */
let fixingSearch: string | null = null;

/**
 * Replacing `?page=999` by the page shown doesn't read everything again: the
 * data already on screen is that page's (T-20 fix).
 */
export function shouldRevalidate({ nextUrl, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs): boolean {
	if (fixingSearch !== null && nextUrl.pathname === '/mis-apuestas' && nextUrl.search === fixingSearch) {
		fixingSearch = null;
		return false;
	}
	return defaultShouldRevalidate;
}

const when = (iso: string) => {
	const { day, time } = formatKickoff(iso);
	return `${day} ${time}`;
};

export default function MisApuestas() {
	useDocumentTitle('Mis apuestas · La Liga ACP');
	const { user } = useSession();
	if (!user || user.rol !== 'apostador') return null;
	return <HistoryScreen key={user.id} pending={user.estadoValidacion !== 'validado'} />;
}

function HistoryScreen({ pending }: { pending: boolean }) {
	const data = useLoaderData<typeof loader>();
	const { filters, problems, loadError } = data;
	const navigation = useNavigation();
	const location = useLocation();
	const revalidator = useRevalidator();
	const navigationType = useNavigationType();
	const navigate = useRememberedNavigate();
	// The last data that loaded, with the filters and the form's choices it was read with:
	// a failed reload keeps showing it, with the error on top.
	const snapshot = () =>
		data.page && data.summary
			? { page: data.page, summary: data.summary, filters, sports: data.sports, competitions: data.competitions, allCompetitions: data.allCompetitions }
			: null;
	const [shown, setShown] = useState(snapshot);
	if (data.page && data.summary && shown?.page !== data.page) setShown(snapshot());
	// The form keeps its sports and competitions when this load read none.
	const formData = !data.page && shown ? { ...data, sports: shown.sports, competitions: shown.competitions, allCompetitions: shown.allCompetitions } : data;
	const busy = revalidator.state !== 'idle';
	const loading = busy || (navigation.state === 'loading' && navigation.location.pathname === location.pathname);
	// A failed reload after changing the filters or the page: the list below is still the previous one.
	const stale = Boolean(loadError && shown && historySearch(shown.filters) !== historySearch(filters));
	const listFilters = shown?.filters ?? filters;
	const filtered = Boolean(
		listFilters.estado || listFilters.estadoTicket || listFilters.deporteId || listFilters.competicionId || listFilters.desde || listFilters.hasta,
	);

	const countText = shown
		? (shown.page.total === 0
				? filtered
					? 'No hay apuestas con esos filtros.'
					: 'Todavía no tienes apuestas.'
				: `${shown.page.total} ${shown.page.total === 1 ? 'selección' : 'selecciones'}, del ticket más reciente al más antiguo.`) +
			(shown.page.totalPages > 1 ? ` Página ${Math.min(listFilters.page, shown.page.totalPages)} de ${shown.page.totalPages}.` : '')
		: '';

	// After "Anterior"/"Siguiente", "Filtrar" or a "Reintentar" that loads, the focus goes to the
	// top of the new list (the count, which says the page) and it is announced. If the load
	// failed, it goes to the notice. Back and Forward (POP) leave the focus where the browser puts it.
	const countRef = useRef<HTMLParagraphElement>(null);
	const alertRef = useRef<HTMLDivElement>(null);
	const [news, setNews] = useState('');
	const wantsFocus = navigationType !== 'POP' && (location.state as { focusList?: boolean } | null)?.focusList === true;
	const focusResults = () => {
		if (data.page) {
			countRef.current?.focus();
			setNews(countText);
		} else {
			alertRef.current?.focus();
			setNews('');
		}
	};
	useEffect(() => {
		if (wantsFocus) focusResults();
		else setNews('');
		// Once per arrival.
	}, [location.key]);
	// The loader data the retry started from: the retry is over when other data arrives.
	const retriedFrom = useRef<HistoryPageData | null>(null);
	useEffect(() => {
		if (!retriedFrom.current || data === retriedFrom.current) return;
		retriedFrom.current = null;
		// A retry that failed again keeps the focus on its button.
		if (data.page) focusResults();
	}, [data]);
	const retry = () => {
		if (busy) return;
		retriedFrom.current = data;
		void revalidator.revalidate();
	};

	// `?page=999` shows the last page: the URL says that page too, without a new history entry.
	useEffect(() => {
		if (!data.pageFixed) return;
		fixingSearch = historySearch(filters);
		navigate(`/mis-apuestas${fixingSearch}`, { replace: true });
	}, [data]);

	return (
		<section className={`${shared.page} ${styles.page}`} aria-labelledby="history-title" aria-busy={loading || undefined}>
			<header className={shared.head}>
				<p className={shared.kicker}>Polla deportiva</p>
				<h1 className={shared.title} id="history-title">
					Mis apuestas
				</h1>
				<p className={shared.lead}>Tus tickets, del más reciente al más antiguo, con el estado y los puntos de cada selección.</p>
			</header>

			{pending && (
				<div className={`${shared.notice} pixel-box`} role="status">
					<p>
						<strong>Tu cuenta está pendiente de validación.</strong> Todavía no puedes apostar, así que aquí no hay apuestas. Cuando un
						administrador confirme tu pago y valide tu cuenta, tus tickets aparecerán aquí.
					</p>
					<p>
						<Link className={shared.textLink} to="/cuenta">
							Ver mi cuenta
						</Link>
					</p>
				</div>
			)}

			{loadError && (
				<div className={`${shared.notice} pixel-box`} role="alert" ref={alertRef} tabIndex={-1}>
					<p>{loadError}</p>
					{stale && (
						<p>
							<strong>La lista de abajo es la anterior:</strong> no corresponde a los filtros ni a la página elegidos. Reintenta para ver la
							nueva.
						</p>
					)}
					<p>
						{/* aria-disabled, never disabled: a disabled button would drop the focus. */}
						<button type="button" className={shared.button} onClick={retry} aria-disabled={busy || undefined}>
							{busy ? 'Cargando…' : 'Reintentar'}
						</button>
					</p>
				</div>
			)}

			{shown && <Summary summary={shown.summary} />}

			{/* Remounted when the URL's filters change, so every field shows them again. */}
			<Filters key={historySearch({ ...filters, page: 1 })} data={formData} />

			{problems.length > 0 && (
				<div className={styles.problems} role="status">
					{problems.map((problem) => (
						<p key={problem} className={shared.error}>
							{problem}
						</p>
					))}
				</div>
			)}

			<p className={styles.status} role="status">
				{loading ? 'Cargando tus apuestas…' : news}
			</p>

			{shown && (
				<>
					<p className={styles.count} ref={countRef} tabIndex={-1}>
						{countText}
					</p>
					{shown.page.total === 0 && !filtered && !pending && (
						<p>
							<Link className={shared.button} to="/apuestas">
								Ir a apostar
							</Link>
						</p>
					)}
					<ol className={styles.tickets} aria-label="Tickets">
						{groupByTicket(shown.page.items).map((group) => (
							<li key={group.ticket.id}>
								<TicketCard ticket={group.ticket} selections={group.selections} />
							</li>
						))}
					</ol>
					<Pagination filters={listFilters} page={Math.min(listFilters.page, Math.max(1, shown.page.totalPages))} totalPages={shown.page.totalPages} />
				</>
			)}

		</section>
	);
}

function Summary({ summary }: { summary: MyBetsSummary }) {
	const byState = <K extends string>(labels: Record<K, string>, keys: readonly K[], counts: Record<K, number>) =>
		// Every label ends in a vowel: the plural just adds an s ("2 acertadas", "0 no acertadas").
		keys.map((key) => `${counts[key]} ${labels[key].toLowerCase()}${counts[key] === 1 ? '' : 's'}`).join(' · ');
	return (
		<section className={`${styles.summary} pixel-box`} aria-labelledby="summary-title">
			<h2 className={styles.sectionTitle} id="summary-title">
				Resumen
			</h2>
			<dl className={`${styles.facts} ${styles.stats}`}>
				<div className={styles.wideFact}>
					<dt>Tickets</dt>
					<dd>
						<span className={styles.big}>{summary.tickets.total}</span>
						<span className={styles.small}>{byState<TicketState>(TICKET_STATE_LABEL, TICKET_STATES, summary.tickets)}</span>
					</dd>
				</div>
				<div className={styles.wideFact}>
					<dt>Selecciones</dt>
					<dd>
						<span className={styles.big}>{summary.selecciones.total}</span>
						<span className={styles.small}>{byState<SelectionState>(SELECTION_STATE_LABEL, SELECTION_STATES, summary.selecciones)}</span>
					</dd>
				</div>
				<div>
					<dt>Puntos</dt>
					<dd>
						<span className={styles.big}>{summary.puntos}</span>
					</dd>
				</div>
				<div>
					<dt>Aciertos</dt>
					<dd>
						<span className={styles.big}>{summary.aciertos}</span>
					</dd>
				</div>
				<div>
					<dt>Monedas usadas</dt>
					<dd>{coinsText(summary.monedasUtilizadas)}</dd>
				</div>
				<div>
					<dt>Monedas devueltas</dt>
					<dd>{coinsText(summary.monedasDevueltas)}</dd>
				</div>
			</dl>
		</section>
	);
}

function TicketCard({ ticket, selections }: { ticket: MyBet['ticket']; selections: MyBet[] }) {
	const titleId = useId();
	const cut = selections.length < ticket.cantidadSelecciones;
	return (
		<article className={`${styles.ticket} pixel-box`} aria-labelledby={titleId}>
			<header className={styles.ticketHead}>
				<h2 className={styles.ticketTitle} id={titleId}>
					Ticket #{ticket.id}
				</h2>
				<StateTag state={ticket.estado} kind="ticket" />
				<p className={styles.small}>
					Confirmado el <time dateTime={ticket.creadoEn}>{when(ticket.creadoEn)}</time>
				</p>
			</header>
			<dl className={styles.totals}>
				<div>
					<dt>Selecciones</dt>
					<dd>{ticket.cantidadSelecciones}</dd>
				</div>
				<div>
					<dt>Monedas</dt>
					<dd>
						{coinsText(ticket.monedasUtilizadas)}
						{ticket.monedasDevueltas > 0 && ` (${ticket.monedasDevueltas} ${ticket.monedasDevueltas === 1 ? 'devuelta' : 'devueltas'})`}
					</dd>
				</div>
				<div>
					<dt>Puntos</dt>
					<dd>{ticket.puntosObtenidos}</dd>
				</div>
			</dl>
			{cut && (
				<p className={styles.small}>
					Esta página muestra {selections.length} de sus {ticket.cantidadSelecciones} selecciones: el comprobante tiene todas.
				</p>
			)}
			<ol className={styles.selections} aria-label={`Selecciones del ticket ${ticket.id}`}>
				{selections.map((selection) => (
					<li key={selection.id} className={styles.selection} data-estado={selection.estado}>
						<SelectionRow selection={selection} />
					</li>
				))}
			</ol>
			<p className={styles.actions}>
				<Link className={shared.textLink} to={`/apuestas/tickets/${ticket.id}`}>
					Ver el comprobante del ticket #{ticket.id}
				</Link>
			</p>
		</article>
	);
}

function SelectionRow({ selection }: { selection: MyBet }) {
	const { partido } = selection;
	const local = partido.local.equipo;
	const visita = partido.visita.equipo;
	const real = selection.resultadoReal;
	return (
		<>
			<p className={styles.match}>
				<TeamCrest team={local} size={24} />
				<span>
					{local.nombre} vs {visita.nombre}
				</span>
				<TeamCrest team={visita} size={24} />
			</p>
			<p className={styles.small}>
				{partido.deporte.nombre} · {partido.competicion.nombre} · <time dateTime={partido.fechaHora}>{when(partido.fechaHora)}</time>
			</p>
			<dl className={styles.facts}>
				<div>
					<dt>{BET_TYPE_LABEL[selection.tipo]}</dt>
					<dd>{forecastValue(selection, local.nombre, visita.nombre)}</dd>
				</div>
				<div>
					<dt>Resultado real</dt>
					<dd>{real ? `${real.golesLocal} - ${real.golesVisitante} (${resultLabel(real.resultado, local.nombre, visita.nombre)})` : 'Todavía no hay'}</dd>
				</div>
				<div>
					<dt>Estado</dt>
					<dd>
						<StateTag state={selection.estado} kind="seleccion" />
					</dd>
				</div>
				<div>
					<dt>Puntos</dt>
					<dd>{selection.puntosObtenidos ?? (selection.estado === 'anulada' ? 'Sin puntos' : 'Por definir')}</dd>
				</div>
				<div>
					<dt>Costo</dt>
					<dd>{coinsText(selection.costo)}</dd>
				</div>
			</dl>
		</>
	);
}

function Filters({ data }: { data: HistoryPageData }) {
	const { filters, sports, competitions, allCompetitions } = data;
	const navigate = useRememberedNavigate();
	const [error, setError] = useState<string | null>(null);
	// Choosing a sport shows its competitions at once, when every competition was loaded;
	// if not, only the URL's sport has them, and another sport needs "Filtrar" first.
	const [sport, setSport] = useState(filters.deporteId ? String(filters.deporteId) : '');
	const known = allCompetitions || sport === String(filters.deporteId ?? '');
	const sportCompetitions = sport && known ? competitions.filter((item) => String(item.deporte.id) === sport) : [];
	const errorId = 'history-filters-error';

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const value = (name: string) => String(form.get(name) ?? '').trim();
		const deporteId = value('deporteId') ? Number(value('deporteId')) : undefined;
		const next: Partial<HistoryFilters> = {
			estado: (value('estado') || undefined) as SelectionState | undefined,
			estadoTicket: (value('estadoTicket') || undefined) as TicketState | undefined,
			deporteId,
			competicionId:
				deporteId && value('competicionId') && sportCompetitions.some((item) => item.id === Number(value('competicionId')) && item.deporte.id === deporteId)
					? Number(value('competicionId'))
					: undefined,
			desde: value('desde') || undefined,
			hasta: value('hasta') || undefined,
		};
		if (next.desde && next.hasta && next.desde > next.hasta) {
			setError('La fecha "desde" no puede ser posterior a "hasta".');
			return;
		}
		setError(null);
		// Like a page link: the new results take the focus (the form is remounted).
		navigate(`/mis-apuestas${historySearch(next)}`, { state: FOCUS_LIST });
	};

	const active = Boolean(filters.estado || filters.estadoTicket || filters.deporteId || filters.competicionId || filters.desde || filters.hasta);
	const hint = !sport
		? 'Elige un deporte para filtrar por competición.'
		: known
			? 'Este deporte no tiene competiciones para filtrar.'
			: 'Filtra por el deporte elegido para ver sus competiciones.';

	return (
		<form className={`${shared.filters} pixel-box`} onSubmit={onSubmit} aria-label="Filtrar mis apuestas" noValidate>
			<div className={shared.field}>
				<label htmlFor="h-estado">Estado de la apuesta</label>
				<select id="h-estado" name="estado" defaultValue={filters.estado ?? ''}>
					<option value="">Todos</option>
					{SELECTION_STATES.map((state) => (
						<option key={state} value={state}>
							{SELECTION_STATE_LABEL[state]}
						</option>
					))}
				</select>
			</div>
			<div className={shared.field}>
				<label htmlFor="h-ticket">Estado del ticket</label>
				<select id="h-ticket" name="estadoTicket" defaultValue={filters.estadoTicket ?? ''}>
					<option value="">Todos</option>
					{TICKET_STATES.map((state) => (
						<option key={state} value={state}>
							{TICKET_STATE_LABEL[state]}
						</option>
					))}
				</select>
			</div>
			<div className={styles.wide} onChange={(event) => setSport((event.target as HTMLInputElement).value)}>
				<ChoiceGroup
					legend="Deporte"
					name="deporteId"
					choices={[{ value: '', label: 'Todos' }, ...sports.map((item) => ({ value: String(item.id), label: item.nombre }))]}
					defaultValue={filters.deporteId ? String(filters.deporteId) : ''}
				/>
			</div>
			{sportCompetitions.length > 0 ? (
				// Remounted per sport, so "Todas" is picked unless the URL's competition is one of these.
				<ChoiceGroup
					key={sport}
					legend="Competición"
					name="competicionId"
					choices={[{ value: '', label: 'Todas' }, ...sportCompetitions.map((item) => ({ value: String(item.id), label: item.nombre }))]}
					defaultValue={
						filters.competicionId && sportCompetitions.some((item) => item.id === filters.competicionId) ? String(filters.competicionId) : ''
					}
				/>
			) : (
				<p className={styles.hint}>{hint}</p>
			)}
			<div className={shared.field}>
				<label htmlFor="h-desde">Desde</label>
				<input id="h-desde" name="desde" type="date" defaultValue={filters.desde ?? ''} aria-describedby={error ? errorId : undefined} />
			</div>
			<div className={shared.field}>
				<label htmlFor="h-hasta">Hasta</label>
				<input
					id="h-hasta"
					name="hasta"
					type="date"
					defaultValue={filters.hasta ?? ''}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? errorId : undefined}
				/>
			</div>
			<div className={shared.filterActions}>
				<button type="submit" className={shared.button}>
					Filtrar
				</button>
				{active && (
					<Link className={shared.textLink} to="/mis-apuestas" state={FOCUS_LIST}>
						Quitar filtros
					</Link>
				)}
			</div>
			<p className={styles.hint}>Las fechas son las de confirmación del ticket, en la hora de Lima.</p>
			{error && (
				<p className={shared.error} id={errorId} role="alert">
					{error}
				</p>
			)}
		</form>
	);
}

/** Navigation state of the page links: the new page moves the focus to its list. */
const FOCUS_LIST = { focusList: true };

function Pagination({ filters, page, totalPages }: { filters: HistoryFilters; page: number; totalPages: number }) {
	if (totalPages <= 1) return null;
	return (
		<nav className={shared.pagination} aria-label="Páginas de mis apuestas">
			{page > 1 ? (
				<Link className={shared.button} to={`/mis-apuestas${historySearch({ ...filters, page: page - 1 })}`} state={FOCUS_LIST}>
					&lt; Anterior
				</Link>
			) : (
				<span />
			)}
			<p className={styles.small}>
				Página {page} de {totalPages}
			</p>
			{page < totalPages ? (
				<Link className={shared.button} to={`/mis-apuestas${historySearch({ ...filters, page: page + 1 })}`} state={FOCUS_LIST}>
					Siguiente &gt;
				</Link>
			) : (
				<span />
			)}
		</nav>
	);
}
