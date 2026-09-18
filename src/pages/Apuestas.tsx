import { type FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
	type ActionFunctionArgs,
	Link,
	type LoaderFunctionArgs,
	redirect,
	type ShouldRevalidateFunctionArgs,
	useFetcher,
	useLoaderData,
	useRevalidator,
} from 'react-router';
import BetMatchCard from '../components/BetMatchCard';
import ChoiceGroup from '../components/ChoiceGroup';
import RenderGuard from '../components/RenderGuard';
import TicketPanel from '../components/TicketPanel';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';
import { ApiError, CLIENT_ERROR, rateLimitKind, waitText } from '../lib/api';
import { getSessionState, refreshSession } from '../lib/auth';
import {
	BETTING_STATES,
	bettingSearch,
	type BettingFilters,
	confirmTicket,
	listBettingMatches,
	listSports,
	MAX_SELECTIONS,
	parseBettingFilters,
	previewTicket,
} from '../lib/betting';
import { BETTING_STATE_LABEL, forecastLabel } from '../lib/betting-labels';
import { useRememberedNavigate } from '../hooks/useRequestedPath';
import { requireRole } from '../lib/route-guards';
import {
	addSelection,
	clearDraft,
	type DraftMatch,
	draftMatchOf,
	droppedNotice,
	emptyDraft,
	isIdempotencyKey,
	loadDraft,
	readDraft,
	refreshMatches,
	removeSelection,
	renewKey,
	saveDraft,
	selectionInputOf,
	type TicketDraft,
} from '../lib/ticket-draft';
import type { ApiPage, ApiSport, BettingMatch, BettingState, SelectionInput, TicketEvaluation } from '../types/betting';
import styles from './Apuestas.module.css';

const requireBettorPage = requireRole('apostador');

/**
 * `/apuestas` (T-19): the matches to bet on, with their filters in the page
 * URL (BR-051) and in the API's order (BR-013). Only `apostador` accounts;
 * a pending one sees the list but can't bet (BR-005); an admin gets the 403
 * page (BR-001).
 */
export interface BettingPageData {
	sports: ApiSport[];
	/** `null` when the list couldn't be read while a ticket is being built (see `loadError`). */
	page: ApiPage<BettingMatch> | null;
	filters: BettingFilters;
	problems: string[];
	/** Why the list couldn't be read this time. */
	loadError: string | null;
}

function listLoadMessage(error: ApiError): string {
	if (error.code === 'RATE_LIMITED') {
		return `No se pudo actualizar la lista de partidos: demasiadas solicitudes. Espera ${waitText(error.retryAfterSeconds) ?? 'unos minutos'} y vuelve a intentarlo.`;
	}
	return `No se pudo actualizar la lista de partidos. ${error.message}`.trim();
}

/** A failure worth waiting out (no connection, a limit, the server down), not a wrong request. */
const transient = (error: unknown): error is ApiError => error instanceof ApiError && (error.status === 0 || error.status === 429 || error.status >= 500);

export async function loader(args: LoaderFunctionArgs): Promise<BettingPageData> {
	const { filters, problems } = parseBettingFilters(new URL(args.request.url).searchParams);
	try {
		await requireBettorPage(args);
		const sports = await listSports(args.request.signal);
		// A sport that no longer exists isn't sent: the list would come back empty with no reason (T-19 note).
		if (filters.deporteId && !sports.some((sport) => sport.id === filters.deporteId)) {
			problems.push('El deporte elegido ya no existe: se muestran todos.');
			delete filters.deporteId;
		}
		const page = await listBettingMatches(filters, args.request.signal);
		return { sports, page, filters, problems, loadError: null };
	} catch (error) {
		// T-19 fix: a failed reload never takes away a ticket being built, nor
		// (T-20 fix) a list already on screen: the page keeps its last list and
		// says the reload failed. That covers a session that can't be checked
		// right now, too (the user known in this tab stays). A first visit with
		// no ticket, redirects, 403s and anything else go to the error page.
		const user = getSessionState().user;
		if (!transient(error) || user?.rol !== 'apostador') throw error;
		if (listShownFor !== user.id && loadDraft(user.id).items.length === 0) throw error;
		return { sports: [], page: null, filters, problems, loadError: listLoadMessage(error) };
	}
}

/** The user whose list `/apuestas` is showing right now (`null` when the page isn't mounted with one). */
let listShownFor: number | null = null;

export type PreviewResult = {
	intent: 'preview';
	signature: string;
	evaluation: TicketEvaluation | null;
	error: string | null;
	/** Positions (from 0) of the selections that aren't valid and weren't sent. */
	invalid?: number[];
};
export type ConfirmFailure = {
	intent: 'confirm';
	signature: string;
	message: string;
	/** `TICKET_REJECTED`: the backend's evaluation, per selection. */
	evaluation: TicketEvaluation | null;
	/** `IDEMPOTENCY_KEY_REUSED`: this attempt needs a new key. */
	renewKey: boolean;
	/** The API's error code, or `null` for an unknown failure. */
	code: string | null;
	/**
	 * Nothing reached or changed on the server (no connection, a limit, the server down):
	 * reloading the list would only fail again (T-19 fix).
	 */
	transient: boolean;
	/** Positions (from 0) of the selections that aren't valid and weren't sent. */
	invalid?: number[];
};

interface ActionBody {
	intent?: unknown;
	selecciones?: unknown;
	idempotencyKey?: unknown;
}

const signatureOf = (selecciones: unknown) => JSON.stringify(selecciones ?? []);

function confirmFailure(error: unknown, signature: string): ConfirmFailure {
	const base = { intent: 'confirm' as const, signature, evaluation: null, renewKey: false, code: error instanceof ApiError ? error.code : null, transient: transient(error) };
	if (!(error instanceof ApiError)) return { ...base, message: 'No se pudo confirmar el ticket. Intenta de nuevo.' };
	switch (error.code) {
		case 'TICKET_REJECTED':
			return {
				...base,
				message: 'El ticket no se confirmó y no se descontó nada: corrige las selecciones marcadas o tu saldo.',
				evaluation: (error.details as TicketEvaluation | undefined) ?? null,
			};
		case 'IDEMPOTENCY_KEY_REUSED':
			return {
				...base,
				renewKey: true,
				message: 'Esa confirmación ya se había usado para otro ticket. Se preparó una nueva: revisa el ticket y vuelve a confirmar.',
			};
		case 'RATE_LIMITED': {
			const wait = waitText(error.retryAfterSeconds);
			return {
				...base,
				message: `Demasiadas solicitudes${rateLimitKind(error) === 'general' ? ' desde esta conexión' : ''}. ${wait ? `Espera ${wait}` : 'Espera unos minutos'} y vuelve a confirmar: no se cobrará dos veces.`,
			};
		}
		case 'USER_NOT_VALIDATED':
			return { ...base, message: 'Tu cuenta todavía no está validada: no puedes apostar.' };
		case 'ADMIN_CANNOT_BET':
			return { ...base, message: 'Los administradores no participan en la polla.' };
		case 'UNAUTHENTICATED':
			return { ...base, message: 'Tu sesión terminó. Ingresa de nuevo para confirmar el ticket.' };
		case CLIENT_ERROR.NETWORK:
		case CLIENT_ERROR.TIMEOUT:
			return {
				...base,
				message: `${error.message} Tu ticket sigue aquí: al volver a confirmar se usa la misma confirmación, así que no se cobra dos veces.`,
			};
		default:
			return {
				...base,
				// The server down (a 5xx, often a proxy's 502) is retried the same way as a lost connection.
				message: `No se pudo confirmar el ticket. ${error.message}${base.transient ? ' Tu ticket sigue aquí: al volver a confirmar se usa la misma confirmación, así que no se cobra dos veces.' : ''}`,
			};
	}
}

/** A confirmation refused before reaching the API: nothing was sent, nothing needs reloading. */
const refused = (signature: string, code: string, message: string, invalid: number[] = []): ConfirmFailure => ({
	intent: 'confirm',
	signature,
	evaluation: null,
	renewKey: false,
	code,
	transient: true,
	message,
	invalid,
});

/** "la 2", "las 2 y 5", "las 1, 3 y 4": selection numbers as the panel shows them. */
function positionsText(invalid: number[]): string {
	const numbers = invalid.map((i) => String(i + 1));
	if (numbers.length === 1) return `la ${numbers[0]}`;
	return `las ${numbers.slice(0, -1).join(', ')} y ${numbers.at(-1)}`;
}

/** The JSON body when it is an object; anything else (null, a list, bad JSON) counts as empty. */
async function readBody(request: Request): Promise<ActionBody> {
	const parsed: unknown = await request.json().catch(() => null);
	return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as ActionBody) : {};
}

/**
 * The ticket's preview and confirmation (BR-023, BR-024), sent as JSON by the
 * page's fetchers. A confirmed ticket empties the draft, refreshes the coin
 * counter and opens its receipt.
 */
export async function action({ request }: ActionFunctionArgs): Promise<PreviewResult | ConfirmFailure | Response> {
	const body = await readBody(request);
	const raw: unknown[] = Array.isArray(body.selecciones) ? body.selecciones : [];
	// The page keys its messages by what it sent.
	const signature = signatureOf(raw);
	// Only well-formed selections, with only the fields of their type, reach the API.
	const checked = raw.map(selectionInputOf);
	const selecciones = checked.filter((input): input is SelectionInput => input !== null);
	// T-19 fix: never a smaller ticket than the one shown. If anything would be left out, nothing is sent.
	const invalid = checked.flatMap((input, i) => (input === null || i >= MAX_SELECTIONS ? [i] : []));
	const invalidText = `${invalid.length === 1 ? 'Una selección del ticket no es válida' : 'Algunas selecciones del ticket no son válidas'} (${positionsText(invalid)})`;
	/** Why nothing may be sent: what the confirmation and the preview say. */
	const problem: { code: string; confirm: string; preview: string } | null = !Array.isArray(body.selecciones)
		? {
				code: 'INVALID_SELECTIONS',
				confirm: 'No se pudo leer el ticket, así que no se confirmó nada ni se descontaron monedas.',
				preview: 'No se pudo leer el ticket.',
			}
		: raw.length === 0
			? {
					code: 'EMPTY_TICKET',
					confirm: 'El ticket está vacío: agrega al menos una selección. No se confirmó nada.',
					preview: 'El ticket está vacío: agrega al menos una selección.',
				}
			: invalid.length > 0
				? {
						code: 'INVALID_SELECTIONS',
						confirm: `${invalidText}, así que no se confirmó nada ni se descontaron monedas. Quita las marcadas y vuelve a confirmar.`,
						preview: `${invalidText}: quita las marcadas para ver el resumen.`,
					}
				: null;

	if (body.intent !== 'preview' && body.intent !== 'confirm') {
		return refused(signature, 'INVALID_INTENT', 'La solicitud no es válida: no se hizo nada.');
	}

	if (body.intent === 'preview') {
		if (problem) {
			return {
				intent: 'preview',
				signature,
				evaluation: null,
				invalid,
				error: problem.preview,
			};
		}
		try {
			return { intent: 'preview', signature, evaluation: await previewTicket(selecciones), error: null };
		} catch (error) {
			const message =
				error instanceof ApiError && error.code === 'RATE_LIMITED'
					? `No se pudo calcular el resumen: demasiadas solicitudes. Espera ${waitText(error.retryAfterSeconds) ?? 'unos minutos'}.`
					: `No se pudo calcular el resumen. ${error instanceof Error ? error.message : ''}`.trim();
			return { intent: 'preview', signature, evaluation: null, error: message };
		}
	}

	if (problem) {
		return refused(signature, problem.code, problem.confirm, invalid);
	}
	if (!isIdempotencyKey(body.idempotencyKey)) {
		return {
			intent: 'confirm',
			signature,
			evaluation: null,
			renewKey: true,
			code: null,
			transient: false,
			message: 'No se pudo preparar la confirmación. Se preparó una nueva: vuelve a confirmar.',
		};
	}
	const key = body.idempotencyKey;
	try {
		const ticket = await confirmTicket(selecciones, key);
		const user = getSessionState().user;
		if (user) clearDraft(user.id);
		// The coin counter shows the new balance right away.
		await refreshSession().catch(() => undefined);
		return redirect(`/apuestas/tickets/${ticket.id}`);
	} catch (error) {
		return confirmFailure(error, signature);
	}
}

/**
 * A preview changes nothing: the match list doesn't need to load again. A
 * confirmation that failed for the connection, a limit or the server being down doesn't either (the
 * reload would fail too, T-19 fix); a rejected ticket does, since a match may
 * have closed meanwhile.
 */
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs): boolean {
	const result = actionResult as PreviewResult | ConfirmFailure | undefined;
	if (result?.intent === 'preview') return false;
	if (result?.intent === 'confirm' && result.transient) return false;
	return defaultShouldRevalidate;
}

const PREVIEW_DELAY_MS = 300;

/** Arrival order of lists and previews (T-19 fix): the later one has the newer match data. */
let arrivals = 0;
const nextSeq = () => ++arrivals;

export default function Apuestas() {
	useDocumentTitle('Apuestas · La Liga ACP');
	const { user } = useSession();
	if (!user || user.rol !== 'apostador') return null;
	return <BettingScreen key={user.id} userId={user.id} validated={user.estadoValidacion === 'validado'} balance={user.saldoMonedas} />;
}

function BettingScreen({ userId, validated, balance }: { userId: number; validated: boolean; balance: number }) {
	const data = useLoaderData<typeof loader>();
	const { filters, problems, loadError } = data;
	const revalidator = useRevalidator();
	const preview = useFetcher<PreviewResult>();
	const confirm = useFetcher<ConfirmFailure>();
	const confirmingRef = useRef(false);
	/** A "Reintentar" is under way: when it loads, the old confirmation error goes. */
	const [retrying, setRetrying] = useState(false);
	/** A confirmation failure the user no longer needs to see. */
	const [dismissed, setDismissed] = useState<ConfirmFailure | null>(null);

	// The last list that loaded: a failed reload keeps showing it (T-19 fix). `seq`
	// orders it against the previews, so the newest match data wins.
	const [shown, setShown] = useState(() => (data.page ? { sports: data.sports, page: data.page, seq: nextSeq() } : null));
	if (data.page && shown?.page !== data.page) {
		setShown({ sports: data.sports, page: data.page, seq: nextSeq() });
		if (retrying) {
			setRetrying(false);
			setDismissed(confirm.data ?? null);
		}
	}
	const [seenPreview, setSeenPreview] = useState<{ data: PreviewResult; seq: number } | null>(null);
	if (preview.data && seenPreview?.data !== preview.data) setSeenPreview({ data: preview.data, seq: nextSeq() });
	const sports = shown?.sports ?? [];
	const page = shown?.page ?? null;
	const hasList = page !== null;
	// Marked in the same commit that paints the list, so a navigation right after already sees it.
	useLayoutEffect(() => {
		if (!hasList) return;
		listShownFor = userId;
		return () => {
			if (listShownFor === userId) listShownFor = null;
		};
	}, [hasList, userId]);

	// A "Reintentar" that loads moves the focus to the count of the new list (its button goes away).
	const countRef = useRef<HTMLParagraphElement>(null);
	const retryBusy = revalidator.state !== 'idle';
	// The loader data the retry started from: the retry is over when other data arrives.
	const retriedFrom = useRef<BettingPageData | null>(null);
	useEffect(() => {
		if (!retriedFrom.current || data === retriedFrom.current) return;
		retriedFrom.current = null;
		// A retry that failed again keeps the focus on its button.
		if (!data.loadError) countRef.current?.focus();
	}, [data]);

	const [loaded] = useState(() => (validated ? readDraft(userId) : { draft: emptyDraft(userId), dropped: 0, reasons: [] }));
	const [draft, setDraft] = useState<TicketDraft>(loaded.draft);
	const [dropNotice, setDropNotice] = useState(() => droppedNotice(loaded.dropped, loaded.reasons));
	const [announcement, setAnnouncement] = useState('');

	const update = useCallback((next: TicketDraft) => {
		setDraft(next);
		saveDraft(next);
	}, []);

	// The stored draft goes back as it was read: checked, with bad parts dropped (T-19 fix).
	useEffect(() => {
		if (validated) saveDraft(draft);
		// Only once, on arriving.
	}, []);

	// Keyed by content: refreshing a match's data isn't a change of the selections.
	const signature = signatureOf(draft.items.map((item) => item.input));
	const selecciones = useMemo(() => JSON.parse(signature) as SelectionInput[], [signature]);
	const confirming = confirm.state !== 'idle';

	// BR-023: the summary follows every change, a moment after the last one.
	const { submit: submitPreview } = preview;
	useEffect(() => {
		if (!validated || selecciones.length === 0) return;
		const timer = setTimeout(() => {
			void submitPreview({ intent: 'preview', selecciones }, { method: 'post', encType: 'application/json', action: '/apuestas' });
		}, PREVIEW_DELAY_MS);
		return () => clearTimeout(timer);
	}, [validated, selecciones, submitPreview]);

	// A reloaded list may bring changed matches: the summary is asked again too.
	const firstList = useRef(shown?.page ?? null);
	useEffect(() => {
		if (!page || page === firstList.current) return;
		firstList.current = page;
		if (validated && selecciones.length > 0) {
			void submitPreview({ intent: 'preview', selecciones }, { method: 'post', encType: 'application/json', action: '/apuestas' });
		}
		// Only when the list changes.
	}, [page]);

	const failure = confirm.state === 'idle' && confirm.data !== dismissed ? confirm.data : undefined;
	useEffect(() => {
		confirmingRef.current = false;
		// The alert says what happened: "Confirmando…" must not stay next to it.
		if (failure) setAnnouncement('');
		if (failure?.renewKey) update(renewKey(draft));
		// Only when a new failure arrives (the draft is the current one then).
	}, [failure]);

	const previewData = preview.data?.signature === signature ? preview.data : undefined;
	const rejected = failure?.signature === signature && failure.evaluation ? failure.evaluation : null;
	const evaluation = rejected ?? previewData?.evaluation ?? null;
	const previewing = selecciones.length > 0 && (preview.state !== 'idle' || !previewData);
	const confirmError = failure && failure.signature === signature ? failure.message : null;
	// Selections the action refused to send (T-19 fix): the panel marks each one.
	const invalidItems = (failure?.signature === signature ? failure.invalid : undefined) ?? previewData?.invalid ?? [];

	// The ticket shows each match as the list or the preview saw it last (a postponed
	// kick-off, for instance): whichever arrived later wins (T-19 fix).
	const previewEvaluation = previewData && seenPreview?.data === previewData ? previewData.evaluation : null;
	const previewSeq = seenPreview?.seq ?? 0;
	const listSeq = shown?.seq ?? 0;
	const fresh = useMemo(() => {
		const map = new Map<number, DraftMatch>();
		const fromList = () => {
			for (const match of page?.items ?? []) map.set(match.id, draftMatchOf(match));
		};
		const fromPreview = () => {
			for (const selection of previewEvaluation?.selecciones ?? []) if (selection.partido) map.set(selection.partido.id, draftMatchOf(selection.partido));
		};
		if (listSeq > previewSeq) {
			fromPreview();
			fromList();
		} else {
			fromList();
			fromPreview();
		}
		return map;
	}, [page, previewEvaluation, listSeq, previewSeq]);
	useEffect(() => {
		const next = refreshMatches(draft, fresh);
		if (next !== draft) update(next);
	}, [draft, fresh, update]);

	const add = (match: BettingMatch, input: SelectionInput) => {
		const next = addSelection(draft, input, draftMatchOf(match));
		if (next === draft) {
			setAnnouncement(`El ticket ya tiene ${MAX_SELECTIONS} selecciones, el máximo.`);
			return;
		}
		update(next);
		setAnnouncement(
			`Agregado: ${match.local.equipo.nombre} vs ${match.visita.equipo.nombre}, ${forecastLabel(input, match.local.equipo.nombre, match.visita.equipo.nombre)}. Tu ticket tiene ${next.items.length} ${next.items.length === 1 ? 'selección' : 'selecciones'}.`,
		);
	};

	const remove = (id: string) => {
		const item = draft.items.find((entry) => entry.id === id);
		const next = removeSelection(draft, id);
		update(next);
		if (item) {
			setAnnouncement(
				`Quitado: ${item.match.local} vs ${item.match.visita}, ${forecastLabel(item.input, item.match.local, item.match.visita)}. Quedan ${next.items.length}.`,
			);
		}
	};

	const clear = () => {
		update({ ...emptyDraft(userId) });
		setAnnouncement('Ticket vaciado.');
	};

	const onConfirm = () => {
		// Never two confirmations at once (a double click): the button is disabled too.
		if (confirmingRef.current || confirming || selecciones.length === 0) return;
		confirmingRef.current = true;
		setAnnouncement('Confirmando el ticket…');
		void confirm.submit(
			{ intent: 'confirm', selecciones, idempotencyKey: draft.idempotencyKey },
			{ method: 'post', encType: 'application/json', action: '/apuestas' },
		);
	};

	const inTicket = (matchId: number) => draft.items.filter((item) => item.input.partidoId === matchId).length;
	const full = draft.items.length >= MAX_SELECTIONS;

	return (
		<section className={styles.page} aria-labelledby="bets-title" data-bettor={validated || undefined}>
			<header className={styles.head}>
				<p className={styles.kicker}>Polla deportiva</p>
				<h1 className={styles.title} id="bets-title">
					Apuestas
				</h1>
				<p className={styles.lead}>Cada selección cuesta 1 moneda. Las apuestas cierran 24 horas antes del inicio de cada partido.</p>
			</header>

			{dropNotice && (
				<div className={`${styles.notice} pixel-box`} role="status">
					<p>{dropNotice}</p>
					<p>
						<button type="button" className={styles.button} onClick={() => setDropNotice(null)}>
							Entendido
						</button>
					</p>
				</div>
			)}

			{!validated && (
				<div className={`${styles.notice} pixel-box`} role="status">
					<p>
						<strong>Tu cuenta está pendiente de validación.</strong> Puedes ver los partidos, pero no apostar hasta que un administrador
						confirme tu pago y valide tu cuenta.
					</p>
					<p>
						<Link className={styles.textLink} to="/cuenta">
							Ver mi cuenta
						</Link>
					</p>
				</div>
			)}

			<Filters sports={sports} filters={filters} problems={problems} />

			<div className={styles.layout}>
				<div className={styles.matches}>
					{loadError && (
						<div className={`${styles.notice} pixel-box`} role="alert">
							<p>
								{loadError} {draft.items.length > 0 ? 'Tu ticket sigue aquí.' : 'Abajo sigue la lista que se cargó antes.'}
							</p>
							<p>
								{/* aria-disabled, never disabled: a disabled button would drop the focus. */}
								<button
									type="button"
									className={styles.button}
									onClick={() => {
										if (retryBusy) return;
										retriedFrom.current = data;
										setRetrying(true);
										void revalidator.revalidate();
									}}
									aria-disabled={retryBusy || undefined}
								>
									{retryBusy ? 'Cargando…' : 'Reintentar'}
								</button>
							</p>
						</div>
					)}
					{page && (
						<p className={styles.count} aria-live="polite" ref={countRef} tabIndex={-1}>
							{page.total === 0 ? 'No hay partidos con esos filtros.' : `${page.total} ${page.total === 1 ? 'partido' : 'partidos'}, del más próximo al más lejano.`}
						</p>
					)}
					<ol className={styles.list}>
						{(page?.items ?? []).map((match) => (
							<li key={match.id}>
								<BetMatchCard
									match={match}
									onAdd={validated ? (input) => add(match, input) : undefined}
									disabledReason={validated ? undefined : 'Tu cuenta está pendiente de validación: todavía no puedes apostar.'}
									inTicket={inTicket(match.id)}
									ticketFull={full}
								/>
							</li>
						))}
					</ol>
					{page && <Pagination filters={filters} totalPages={page.totalPages} />}
				</div>

				{validated && (
					<RenderGuard resetKey={draft} fallback={<BrokenTicket onClear={clear} />}>
						<TicketPanel
						items={draft.items}
						evaluation={evaluation}
						previewing={previewing}
						previewError={previewData?.error ?? null}
						invalidItems={invalidItems}
						balance={balance}
						confirming={confirming}
						confirmError={confirmError}
						announcement={announcement}
						onRemove={remove}
						onClear={clear}
						onConfirm={onConfirm}
						/>
					</RenderGuard>
				)}
			</div>
		</section>
	);
}

/** What the ticket area shows if the panel itself can't be drawn: the page and the list stay usable. */
function BrokenTicket({ onClear }: { onClear: () => void }) {
	return (
		<aside className={`${styles.notice} pixel-box`} aria-labelledby="broken-ticket-title">
			<h2 className={styles.small} id="broken-ticket-title">
				Tu ticket
			</h2>
			<p role="alert">No se pudo mostrar el ticket guardado. Vacíalo para armar uno nuevo.</p>
			<p>
				<button type="button" className={styles.button} onClick={onClear}>
					Vaciar ticket
				</button>
			</p>
		</aside>
	);
}

function Filters({ sports, filters, problems }: { sports: { id: number; nombre: string }[]; filters: BettingFilters; problems: string[] }) {
	const navigate = useRememberedNavigate();
	const [error, setError] = useState<string | null>(null);

	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const value = (name: string) => String(form.get(name) ?? '').trim();
		const next: Partial<BettingFilters> = {
			deporteId: value('deporteId') ? Number(value('deporteId')) : undefined,
			desde: value('desde') || undefined,
			hasta: value('hasta') || undefined,
			estadoApuesta: (value('estadoApuesta') || undefined) as BettingState | undefined,
		};
		if (next.desde && next.hasta && next.desde > next.hasta) {
			setError('La fecha "desde" no puede ser posterior a "hasta".');
			return;
		}
		setError(null);
		navigate(`/apuestas${bettingSearch(next)}`);
	};

	const active = Boolean(filters.deporteId || filters.desde || filters.hasta || filters.estadoApuesta);
	const errorId = 'filters-error';

	return (
		<form className={`${styles.filters} pixel-box`} onSubmit={onSubmit} aria-label="Filtrar partidos" noValidate>
			{/*
			 * Sports as choices, not a <select> (D-014, D-017): a sport's name is free
			 * text of up to 100 characters, and a closed <select> cuts it; here it wraps.
			 */}
			<ChoiceGroup
				key={`d${filters.deporteId ?? ''}`}
				legend="Deporte"
				name="deporteId"
				choices={[{ value: '', label: 'Todos' }, ...sports.map((sport) => ({ value: String(sport.id), label: sport.nombre }))]}
				defaultValue={filters.deporteId ? String(filters.deporteId) : ''}
			/>
			<div className={styles.field}>
				<label htmlFor="f-desde">Desde</label>
				<input id="f-desde" name="desde" type="date" defaultValue={filters.desde ?? ''} key={`f${filters.desde ?? ''}`} aria-describedby={error ? errorId : undefined} />
			</div>
			<div className={styles.field}>
				<label htmlFor="f-hasta">Hasta</label>
				<input
					id="f-hasta"
					name="hasta"
					type="date"
					defaultValue={filters.hasta ?? ''}
					key={`h${filters.hasta ?? ''}`}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? errorId : undefined}
				/>
			</div>
			<div className={styles.field}>
				<label htmlFor="f-estado">Estado</label>
				<select id="f-estado" name="estadoApuesta" defaultValue={filters.estadoApuesta ?? ''} key={`e${filters.estadoApuesta ?? ''}`}>
					<option value="">Todos</option>
					{BETTING_STATES.map((state) => (
						<option key={state} value={state}>
							{BETTING_STATE_LABEL[state]}
						</option>
					))}
				</select>
			</div>
			<div className={styles.filterActions}>
				<button type="submit" className={styles.button}>
					Filtrar
				</button>
				{active && (
					<Link className={styles.textLink} to="/apuestas">
						Quitar filtros
					</Link>
				)}
			</div>
			<p className={styles.small}>Las fechas son del día en la hora de Lima.</p>
			{error && (
				<p className={styles.error} id={errorId} role="alert">
					{error}
				</p>
			)}
			{problems.map((problem) => (
				<p key={problem} className={styles.error} role="status">
					{problem}
				</p>
			))}
		</form>
	);
}

function Pagination({ filters, totalPages }: { filters: BettingFilters; totalPages: number }) {
	if (totalPages <= 1) return null;
	const current = Math.min(filters.page, totalPages);
	return (
		<nav className={styles.pagination} aria-label="Páginas de partidos">
			{current > 1 ? (
				<Link className={styles.button} to={`/apuestas${bettingSearch({ ...filters, page: current - 1 })}`}>
					&lt; Anterior
				</Link>
			) : (
				<span />
			)}
			<p className={styles.small}>
				Página {current} de {totalPages}
			</p>
			{current < totalPages ? (
				<Link className={styles.button} to={`/apuestas${bettingSearch({ ...filters, page: current + 1 })}`}>
					Siguiente &gt;
				</Link>
			) : (
				<span />
			)}
		</nav>
	);
}
