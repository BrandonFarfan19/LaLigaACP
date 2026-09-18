import { type FormEvent, useRef, useState } from 'react';
import { type ActionFunctionArgs, Link, type LoaderFunctionArgs, useFetcher, useLoaderData, useLocation } from 'react-router';
import {
	ActionMessage,
	type Column,
	DataTable,
	FilterForm,
	type FilterField,
	FilterProblems,
	LoadNotice,
	Pager,
	useOutcomeFocus,
} from '../../components/admin/AdminUi';
import { SearchSelect } from '../../components/admin/SearchSelect';
import TextField from '../../components/TextField';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useArrivalFocus, useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { type ActionOutcome, intOf, isoFromLeagueInput, jsonBody, parseFilters, perform, refused, textOf } from '../../lib/admin-core';
import { createMatch, MATCH_FILTERS, MATCH_STATES, listMatches } from '../../lib/admin-catalog';
import { catalogSource, labelById } from '../../lib/admin-choices';
import { loadAdmin, pageInRange, skipPageFix, usePageUrlFix } from '../../lib/admin-load';
import type { AdminMatch } from '../../types/admin';
import type { MatchState } from '../../types/betting';
import { formatDateOnly, formatKickoff } from '../../utils/format-date';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';

const PATH = '/admin/partidos';

export const MATCH_STATE_LABEL: Record<MatchState, string> = {
	programado: 'Programado',
	en_curso: 'En curso',
	finalizado: 'Finalizado',
	cancelado: 'Cancelado',
};

export const MATCH_STATE_TONE: Record<MatchState, string | undefined> = {
	programado: 'off',
	en_curso: 'warn',
	finalizado: undefined,
	cancelado: 'danger',
};

/** `20 oct 2026 18:00` in league time (Lima). */
export const leagueDateTime = (iso: string) => `${formatDateOnly(iso)} ${formatKickoff(iso).time}`;

/** The competition of a match, as its own row tells it (T-21 fix: never a capped list). */
export const competitionName = (match: Pick<AdminMatch, 'competicionNombre' | 'deporteNombre'>) => `${match.competicionNombre} (${match.deporteNombre})`;

/** `/admin/partidos` (T-21, BR-011 to BR-013): the matches in proximity order, and a new one. */
export async function loader(args: LoaderFunctionArgs) {
	const { filters, problems } = parseFilters(new URL(args.request.url).searchParams, MATCH_FILTERS);
	let pageFixed = false;
	const load = await loadAdmin(args, 'los partidos', async (signal) => {
		const [first, ...labels] = await Promise.all([
			listMatches(filters, signal),
			labelById('deportes', filters.deporteId, signal),
			labelById('competiciones', filters.competicionId, signal),
			labelById('equipos', filters.equipoId, signal),
		]);
		const { page, problem } = await pageInRange(filters, first, () => listMatches(filters, signal));
		if (problem) {
			problems.push(problem);
			pageFixed = true;
		}
		return { page, labels: { deporteId: labels[0], competicionId: labels[1], equipoId: labels[2] } };
	});
	return { ...load, filters, problems, pageFixed };
}

export const shouldRevalidate = skipPageFix;

/** BR-011: a new match (always `programado`, in the future). Date and time are league time, sent with their zone. */
export async function action({ request }: ActionFunctionArgs): Promise<ActionOutcome<AdminMatch>> {
	const body = await jsonBody(request);
	const fecha = typeof body.fecha === 'string' ? body.fecha : '';
	const fechaHora = isoFromLeagueInput(fecha);
	if (!fechaHora) {
		return refused('create', 'nuevo', 'Revisa los campos marcados.', { fechaHora: 'Elige una fecha y hora válidas (hora de Lima).' }) as ActionOutcome<AdminMatch>;
	}
	return perform(
		'create',
		'nuevo',
		() =>
			createMatch({
				competicionId: intOf(body.competicionId) ?? body.competicionId,
				localId: intOf(body.localId) ?? body.localId,
				visitaId: intOf(body.visitaId) ?? body.visitaId,
				jornada: intOf(body.jornada) ?? body.jornada,
				fechaHora,
				sede: textOf(body.sede) ?? '',
			}),
		(match) => `Se creó el partido ${match.local.nombre} vs ${match.visita.nombre}.`,
	);
}

export default function Partidos() {
	useDocumentTitle('Partidos · Administración · La Liga ACP');
	const { user } = useSession();
	const load = useLoaderData<typeof loader>();
	const data = useKept(load.data);
	const location = useLocation();
	const countRef = useRef<HTMLParagraphElement>(null);
	const deletedRef = useRef<HTMLParagraphElement>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	usePageUrlFix(PATH, load.filters, load.pageFixed);
	// Back from a deleted match: its message first. A failed load: the notice (T-21 fix).
	useArrivalFocus(deletedRef, load.loadError ? noticeRef : countRef);
	if (user?.rol !== 'admin') return null;
	const page = data?.page;
	const labels: Record<string, string> = data?.labels ?? {};
	const deleted = (location.state as { deleted?: string } | null)?.deleted;

	const filterFields: FilterField[] = [
		{ name: 'deporteId', label: 'Deporte', type: 'search', source: catalogSource('deportes'), chosen: labels.deporteId },
		{ name: 'competicionId', label: 'Competición', type: 'search', source: catalogSource('competiciones'), chosen: labels.competicionId },
		{ name: 'equipoId', label: 'Equipo', type: 'search', source: catalogSource('equipos'), chosen: labels.equipoId },
		{ name: 'estado', label: 'Estado', type: 'select', options: MATCH_STATES.map((s) => ({ value: s, label: MATCH_STATE_LABEL[s] })) },
		{ name: 'desde', label: 'Desde', type: 'date' },
		{ name: 'hasta', label: 'Hasta', type: 'date' },
	];

	const columns: Column<AdminMatch>[] = [
		{ header: 'Fecha', cell: (m) => leagueDateTime(m.fechaHora) },
		{ header: 'Partido', cell: (m) => `${m.local.nombre} vs ${m.visita.nombre}` },
		{ header: 'Competición', cell: (m) => `${competitionName(m)} · jornada ${m.jornada}` },
		{
			header: 'Estado',
			cell: (m) => (
				<span className={styles.tag} data-tone={MATCH_STATE_TONE[m.estado]}>
					{MATCH_STATE_LABEL[m.estado]}
				</span>
			),
		},
		{
			header: 'Marcador',
			cell: (m) =>
				m.local.goles === null || m.visita.goles === null
					? 'Sin cargar'
					: `${m.local.goles} - ${m.visita.goles}${m.estado === 'finalizado' ? '' : ' (sin confirmar)'}`,
		},
		{
			header: 'Acciones',
			cell: (m) => (
				<Link className={shared.textLink} to={`${PATH}/${m.id}`}>
					Gestionar {m.local.nombre} vs {m.visita.nombre}
				</Link>
			),
		},
	];

	return (
		<section className={styles.page} aria-labelledby="matches-title">
			<header className={shared.head}>
				<p className={shared.kicker}>Administración</p>
				<h1 className={shared.title} id="matches-title">
					Partidos
				</h1>
				<p className={shared.lead}>
					Del más próximo al más lejano, y después los pasados. Un partido empieza solo a su hora y dura 60 minutos; su resultado se confirma
					después. Las fechas y horas son de Lima.
				</p>
			</header>

			{deleted && (
				<p ref={deletedRef} tabIndex={-1} className={styles.message} data-ok role="status">
					<strong>Listo: </strong>
					{deleted}
				</p>
			)}

			<div ref={noticeRef} tabIndex={-1}>
				<LoadNotice message={load.loadError} stale={Boolean(data)} />
			</div>

			<section className={`${styles.section} pixel-box`} aria-labelledby="new-match">
				<h2 className={styles.sectionTitle} id="new-match">
					Nuevo partido
				</h2>
				<NewMatchForm />
			</section>

			<FilterForm path={PATH} fields={filterFields} values={load.filters} label="Filtrar partidos" />
			<FilterProblems problems={load.problems} />

			{page && (
				<>
					<p className={`${styles.muted} ${styles.focusable}`} ref={countRef} tabIndex={-1}>
						{page.total === 0
							? 'No hay partidos con esos filtros.'
							: `${page.total} ${page.total === 1 ? 'partido' : 'partidos'}, del más próximo al más lejano.${page.totalPages > 1 ? ` Página ${Math.min(load.filters.page, page.totalPages)} de ${page.totalPages}.` : ''}`}
					</p>
					{page.items.length > 0 && <DataTable caption="Partidos" columns={columns} rows={page.items} rowKey={(m) => m.id} />}
					<Pager path={PATH} filters={load.filters} page={load.filters.page} totalPages={page.totalPages} label="Páginas de partidos" />
				</>
			)}
		</section>
	);
}

/**
 * The fields of a match (new, or edited in its own page): the teams offered
 * are the chosen competition's.
 */
export function MatchFields({
	errors,
	initial,
	lockTeams,
	lockDate,
}: {
	errors: Record<string, string>;
	initial?: {
		competicionId: number;
		competicion: string;
		localId: number;
		local: string;
		visitaId: number;
		visita: string;
		jornada: number;
		fecha: string;
		sede: string;
	};
	/** Competition and teams can't change (started, or with bets): shown, not editable. */
	lockTeams?: string;
	lockDate?: string;
}) {
	const [competicion, setCompeticion] = useState(initial ? String(initial.competicionId) : '');
	const sameCompetition = initial && String(initial.competicionId) === competicion;
	// The teams offered are the chosen competition's: the API filters them (D-019).
	const teamSource = catalogSource('equipos', { competicionId: competicion || undefined });
	const blocked = competicion ? undefined : 'Elige antes la competición.';
	return (
		<>
			{lockTeams ? (
				<p className={`${styles.muted} ${styles.formWide}`}>{lockTeams}</p>
			) : (
				<>
					<SearchSelect
						label="Competición"
						name="competicionId"
						search={catalogSource('competiciones')}
						defaultValue={competicion}
						defaultLabel={initial?.competicion ?? ''}
						onChoose={setCompeticion}
						error={errors.competicionId}
					/>
					<SearchSelect
						label="Equipo local"
						name="localId"
						search={teamSource}
						scope={competicion}
						blocked={blocked}
						defaultValue={sameCompetition ? String(initial.localId) : ''}
						defaultLabel={sameCompetition ? initial.local : ''}
						error={errors.localId}
					/>
					<SearchSelect
						label="Equipo visitante"
						name="visitaId"
						search={teamSource}
						scope={competicion}
						blocked={blocked}
						defaultValue={sameCompetition ? String(initial.visitaId) : ''}
						defaultLabel={sameCompetition ? initial.visita : ''}
						error={errors.visitaId}
					/>
				</>
			)}
			<TextField label="Jornada" name="jornada" type="number" inputMode="numeric" min={1} max={999} defaultValue={initial?.jornada ?? ''} error={errors.jornada} hint="De 1 a 999." />
			{lockDate ? (
				<p className={`${styles.muted} ${styles.formWide}`}>{lockDate}</p>
			) : (
				<TextField
					label="Fecha y hora (Lima)"
					name="fecha"
					type="datetime-local"
					defaultValue={initial?.fecha ?? ''}
					error={errors.fechaHora}
					hint="Tiene que ser futura. Las apuestas cierran 24 horas antes."
				/>
			)}
			<TextField label="Sede" name="sede" defaultValue={initial?.sede ?? ''} error={errors.sede} hint="Hasta 150 caracteres." autoComplete="off" />
		</>
	);
}

function NewMatchForm() {
	const fetcher = useFetcher<ActionOutcome<AdminMatch>>({ key: 'partido-nuevo' });
	const formRef = useRef<HTMLFormElement>(null);
	const messageRef = useRef<HTMLParagraphElement>(null);
	useOutcomeFocus(fetcher.data, formRef, messageRef);
	const [formKey, setFormKey] = useState(0);
	const [seen, setSeen] = useState(fetcher.data);
	if (fetcher.data !== seen) {
		setSeen(fetcher.data);
		if (fetcher.data?.ok) setFormKey((k) => k + 1);
	}
	const errors = fetcher.data && !fetcher.data.ok ? fetcher.data.fields : {};
	const busy = fetcher.state !== 'idle';
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		const form = new FormData(event.currentTarget);
		fetcher.submit(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])), { method: 'post', encType: 'application/json' });
	};
	const created = fetcher.data?.ok ? fetcher.data.data : undefined;
	return (
		<>
			<form ref={formRef} key={formKey} className={styles.form} onSubmit={onSubmit} noValidate aria-label="Nuevo partido">
				<MatchFields errors={errors} />
				<div className={styles.actions}>
					<button type="submit" className={shared.button} aria-disabled={busy || undefined}>
						{busy ? 'Creando…' : 'Crear partido'}
					</button>
				</div>
			</form>
			<ActionMessage ref={messageRef} outcome={fetcher.data} />
			{created && (
				<p>
					<Link className={shared.textLink} to={`${PATH}/${created.id}`}>
						Gestionar el partido nuevo
					</Link>
				</p>
			)}
		</>
	);
}
