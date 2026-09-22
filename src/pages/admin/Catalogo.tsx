import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { type ActionFunctionArgs, type FetcherWithComponents, type LoaderFunctionArgs, useFetcher, useLoaderData } from 'react-router';
import {
	ActionMessage,
	CheckField,
	type Column,
	ConfirmStep,
	DataTable,
	FilterForm,
	type FilterField,
	FilterProblems,
	LoadNotice,
	Pager,
	useOutcomeFocus,
} from '../../components/admin/AdminUi';
import { SearchSelect } from '../../components/admin/SearchSelect';
import TeamCrest, { crestSrc } from '../../components/TeamCrest';
import TextField from '../../components/TextField';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useArrivalFocus, useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { type ActionOutcome, deOf, type FilterValues, intOf, jsonBody, parseFilters, perform, refused } from '../../lib/admin-core';
import { CATALOG_FILTERS, type CatalogResource, type CatalogRow, createCatalog, deleteCatalog, listCatalog, updateCatalog } from '../../lib/admin-catalog';
import { catalogSource, labelById } from '../../lib/admin-choices';
import { loadAdmin, pageInRange, skipPageFix, usePageUrlFix } from '../../lib/admin-load';
import type { AdminCompetition, AdminEnrollment, AdminPlayer, AdminSport, AdminTeam, ApiPage } from '../../types/admin';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';

/**
 * The sports catalog in the panel (T-21, BR-001; the API is T-06): sports,
 * competitions, teams, players and squads. One engine for the five: a list
 * with filters and pages, a form to add, an inline form to edit each row and
 * a delete with its explicit step. The backend decides what's allowed and
 * says why not (`*_IN_USE`, `SLUG_TAKEN`, `DRAW_RULE_LOCKED`...).
 */

interface FormField {
	name: string;
	label: string;
	kind: 'text' | 'number' | 'check' | 'search';
	/** `search`: the list its options come from (D-019). */
	resource?: CatalogResource;
	hint?: string;
	/** Text: left out when empty (the backend fills it: a slug). */
	optional?: boolean;
	/** Text: `null` when emptied on edit (removes it: a photo). */
	nullable?: boolean;
	/** Only when adding (a squad's player and team never change, D4). */
	createOnly?: boolean;
}

/** The whole text of the ids a filter already carries, read by the loader. */
type ChosenLabels = Record<string, string>;

interface Section<R extends CatalogResource> {
	resource: R;
	path: string;
	title: string;
	/** "el deporte", for messages. */
	one: string;
	/** "los deportes", for the notice when the list can't be read. */
	many: string;
	lead: string;
	fields: FormField[];
	filters: (labels: ChosenLabels) => FilterField[];
	columns: () => Column<CatalogRow[R]>[];
	name: (row: CatalogRow[R]) => string;
	/** What the delete step says. */
	deleteNote: string;
	/** Current values of a row for its edit form. */
	values: (row: CatalogRow[R]) => Record<string, string | number | boolean | null>;
	/** The text of a row's chosen ids, so its edit form reads without another call. */
	chosen?: (row: CatalogRow[R]) => ChosenLabels;
}

/** Filters that choose a record: searched in the API, never a capped list (D-019). */
const searchFilter = (name: string, label: string, resource: CatalogResource, labels: ChosenLabels, within: Record<string, string | number | undefined> = {}): FilterField => ({
	name,
	label,
	type: 'search',
	source: catalogSource(resource, within),
	chosen: labels[name],
});

const NAME_HINT = 'De 1 a 100 caracteres, con al menos una letra o un número.';
const IMAGE_HINT = 'Una URL https:// o una ruta relativa a una imagen (por ejemplo escudos/club.webp). Se muestra solo como imagen.';

const SECTIONS: { [R in CatalogResource]: Section<R> } = {
	deportes: {
		resource: 'deportes',
		path: '/admin/deportes',
		title: 'Deportes',
		one: 'el deporte',
		many: 'los deportes',
		lead: 'Cada deporte dice si admite empate (BR-015). Esa regla solo cambia mientras ninguna apuesta dependa de ella.',
		fields: [
			{ name: 'nombre', label: 'Nombre', kind: 'text', hint: NAME_HINT },
			{ name: 'slug', label: 'Slug (opcional)', kind: 'text', optional: true, hint: 'Vacío: sale del nombre. Minúsculas, números y guiones.' },
			{ name: 'permiteEmpate', label: 'Admite empate', kind: 'check' },
		],
		filters: () => [
			{ name: 'q', label: 'Buscar', type: 'text' },
			{ name: 'permiteEmpate', label: 'Empate', type: 'select', options: [{ value: 'true', label: 'Admite empate' }, { value: 'false', label: 'Sin empate' }] },
		],
		columns: () => [
			{ header: 'Nombre', cell: (d) => d.nombre },
			{ header: 'Slug', cell: (d) => d.slug },
			{ header: 'Empate', cell: (d) => (d.permiteEmpate ? 'Admite empate' : 'Sin empate') },
		],
		name: (d: AdminSport) => d.nombre,
		deleteNote: 'Solo se borra un deporte sin competiciones. Queda en la auditoría.',
		values: (d) => ({ nombre: d.nombre, slug: d.slug, permiteEmpate: d.permiteEmpate }),
	},
	competiciones: {
		resource: 'competiciones',
		path: '/admin/competiciones',
		title: 'Competiciones',
		one: 'la competición',
		many: 'las competiciones',
		lead: 'Cada competición es un torneo de un deporte. Solo cambia de deporte mientras no tenga partidos.',
		fields: [
			{ name: 'deporteId', label: 'Deporte', kind: 'search', resource: 'deportes' },
			{ name: 'nombre', label: 'Nombre', kind: 'text', hint: NAME_HINT },
			{ name: 'slug', label: 'Slug (opcional)', kind: 'text', optional: true, hint: 'Vacío: sale del nombre. Único dentro del deporte.' },
		],
		filters: (labels) => [
			{ name: 'q', label: 'Buscar', type: 'text' },
			searchFilter('deporteId', 'Deporte', 'deportes', labels),
		],
		columns: () => [
			{ header: 'Nombre', cell: (x) => x.nombre },
			{ header: 'Deporte', cell: (x) => x.deporteNombre },
			{ header: 'Slug', cell: (x) => x.slug },
		],
		name: (x: AdminCompetition) => x.nombre,
		deleteNote: 'Solo se borra una competición sin equipos, partidos ni jugadores inscritos.',
		values: (x) => ({ deporteId: x.deporteId, nombre: x.nombre, slug: x.slug }),
		chosen: (x) => ({ deporteId: x.deporteNombre }),
	},
	equipos: {
		resource: 'equipos',
		path: '/admin/equipos',
		title: 'Equipos',
		one: 'el equipo',
		many: 'los equipos',
		lead: 'Cada equipo juega en una sola competición. Solo cambia de competición mientras no tenga partidos, jugadores ni goles.',
		fields: [
			{ name: 'competicionId', label: 'Competición', kind: 'search', resource: 'competiciones' },
			{ name: 'nombre', label: 'Nombre', kind: 'text', hint: NAME_HINT },
			{ name: 'nombreCorto', label: 'Nombre corto', kind: 'text', hint: 'Hasta 50 caracteres.' },
			{ name: 'escudo', label: 'Escudo', kind: 'text', hint: IMAGE_HINT },
			{ name: 'colorAcento', label: 'Color', kind: 'text', hint: 'Hexadecimal #rrggbb, por ejemplo #3cf281.' },
		],
		filters: (labels) => [
			{ name: 'q', label: 'Buscar', type: 'text' },
			searchFilter('deporteId', 'Deporte', 'deportes', labels),
			searchFilter('competicionId', 'Competición', 'competiciones', labels),
		],
		columns: () => [
			{ header: 'Escudo', cell: (t) => <TeamCrest team={t} /> },
			{
				header: 'Nombre',
				cell: (t) => (
					<>
						{t.nombre} <span className={styles.muted}>({t.nombreCorto})</span>
					</>
				),
			},
			{ header: 'Competición', cell: (t) => `${t.competicionNombre} (${t.deporteNombre})` },
			{
				header: 'Color',
				cell: (t) => (
					<>
						<span className={styles.swatch} style={{ background: /^#[0-9a-f]{6}$/i.test(t.colorAcento) ? t.colorAcento : undefined }} aria-hidden="true" />
						{t.colorAcento}
					</>
				),
			},
		],
		name: (t: AdminTeam) => t.nombre,
		deleteNote: 'Solo se borra un equipo sin partidos, jugadores inscritos ni goles.',
		values: (t) => ({ competicionId: t.competicionId, nombre: t.nombre, nombreCorto: t.nombreCorto, escudo: t.escudo, colorAcento: t.colorAcento }),
		chosen: (t) => ({ competicionId: `${t.competicionNombre} (${t.deporteNombre})` }),
	},
	jugadores: {
		resource: 'jugadores',
		path: '/admin/jugadores',
		title: 'Jugadores',
		one: 'el jugador',
		many: 'los jugadores',
		lead: 'La persona. Para que juegue en un equipo, inscríbela en su plantel (sección Planteles).',
		fields: [
			{ name: 'nombre', label: 'Nombre', kind: 'text', hint: NAME_HINT },
			{ name: 'foto', label: 'Foto (opcional)', kind: 'text', nullable: true, optional: true, hint: `${IMAGE_HINT} Vacía: sin foto.` },
		],
		filters: (labels) => [
			{ name: 'q', label: 'Buscar', type: 'text' },
			searchFilter('competicionId', 'Inscritos en la competición', 'competiciones', labels),
			searchFilter('equipoId', 'Inscritos en el equipo', 'equipos', labels),
		],
		columns: () => [
			{ header: 'Foto', cell: (j) => <PlayerPhoto foto={j.foto} /> },
			{ header: 'Nombre', cell: (j) => j.nombre },
		],
		name: (j: AdminPlayer) => j.nombre,
		deleteNote: 'Solo se borra un jugador que no esté inscrito en ningún plantel.',
		values: (j) => ({ nombre: j.nombre, foto: j.foto }),
	},
	planteles: {
		resource: 'planteles',
		path: '/admin/planteles',
		title: 'Planteles',
		one: 'la inscripción',
		many: 'las inscripciones de los planteles',
		lead: 'Inscribe a un jugador en un equipo: uno solo por competición y sin transferencias; después solo cambia el número de camiseta.',
		fields: [
			{ name: 'jugadorId', label: 'Jugador', kind: 'search', resource: 'jugadores', createOnly: true },
			{ name: 'equipoId', label: 'Equipo', kind: 'search', resource: 'equipos', createOnly: true },
			{ name: 'numeroCamiseta', label: 'Número de camiseta', kind: 'number', hint: 'De 1 a 99, sin repetir en el equipo.' },
		],
		filters: (labels) => [
			{ name: 'q', label: 'Buscar por jugador o equipo', type: 'text' },
			searchFilter('competicionId', 'Competición', 'competiciones', labels),
			searchFilter('equipoId', 'Equipo', 'equipos', labels),
			searchFilter('jugadorId', 'Jugador', 'jugadores', labels),
		],
		columns: () => [
			{ header: 'Jugador', cell: (p) => p.jugadorNombre },
			{ header: 'Equipo', cell: (p) => `${p.equipoNombre} · ${p.competicionNombre} (${p.deporteNombre})` },
			{ header: 'Camiseta', cell: (p) => p.numeroCamiseta },
		],
		name: (p: AdminEnrollment) => p.jugadorNombre,
		deleteNote: 'Solo se da de baja una inscripción sin goles registrados.',
		values: (p) => ({ numeroCamiseta: p.numeroCamiseta }),
	},
};

function PlayerPhoto({ foto }: { foto: string | null }) {
	const src = foto ? crestSrc(foto) : null;
	if (!src) return <span className={styles.muted}>Sin foto</span>;
	return <img className={`${styles.crest} pixelated`} src={src} alt="" width={32} height={32} loading="lazy" decoding="async" referrerPolicy="no-referrer" />;
}

/** Which list each filter chooses from, so the loader can read its whole text. */
const FILTER_RESOURCE: Record<string, CatalogResource> = {
	deporteId: 'deportes',
	competicionId: 'competiciones',
	equipoId: 'equipos',
	jugadorId: 'jugadores',
};

/** The text of every id the page URL carries (one read each, only when set). */
async function readLabels(filters: FilterValues, signal: AbortSignal): Promise<ChosenLabels> {
	const set = Object.keys(FILTER_RESOURCE).filter((name) => filters[name] !== undefined);
	const texts = await Promise.all(set.map((name) => labelById(FILTER_RESOURCE[name]!, filters[name], signal)));
	return Object.fromEntries(set.map((name, index) => [name, texts[index]!]));
}

/** The body a form sends, from its fields (the backend validates every value). */
function bodyOf(fields: FormField[], form: FormData, editing: boolean): Record<string, unknown> {
	const body: Record<string, unknown> = {};
	for (const field of fields) {
		if (editing && field.createOnly) continue;
		const raw = form.get(field.name);
		if (field.kind === 'check') {
			body[field.name] = raw === 'on';
			continue;
		}
		const value = typeof raw === 'string' ? raw.trim() : '';
		if (field.kind === 'number' || field.kind === 'search') {
			// A value that isn't a number goes as it is: the backend says what's wrong with it.
			body[field.name] = value === '' ? undefined : (intOf(value) ?? value);
		} else if (value === '') {
			if (field.nullable && editing) body[field.name] = null;
			else if (!field.optional) body[field.name] = '';
		} else {
			body[field.name] = value;
		}
	}
	return body;
}

type SectionData<R extends CatalogResource> = { page: ApiPage<CatalogRow[R]>; labels: ChosenLabels };

function makeLoader<R extends CatalogResource>(section: Section<R>) {
	return async (args: LoaderFunctionArgs) => {
		const { filters, problems } = parseFilters(new URL(args.request.url).searchParams, CATALOG_FILTERS[section.resource]);
		let pageFixed = false;
		const load = await loadAdmin<SectionData<R>>(args, section.many, async (signal) => {
			const [first, labels] = await Promise.all([listCatalog(section.resource, filters, signal), readLabels(filters, signal)]);
			const { page, problem } = await pageInRange(filters, first, () => listCatalog(section.resource, filters, signal));
			if (problem) {
				problems.push(problem);
				pageFixed = true;
			}
			return { page, labels };
		});
		return { ...load, filters, problems, pageFixed };
	};
}

function makeAction<R extends CatalogResource>(section: Section<R>) {
	return async ({ request }: ActionFunctionArgs): Promise<ActionOutcome> => {
		const body = await jsonBody(request);
		const intent = String(body.intent ?? '');
		const values = (body.values ?? {}) as Record<string, unknown>;
		const label = typeof body.label === 'string' ? body.label : section.one;
		if (intent === 'create') {
			return perform(intent, 'nuevo', () => createCatalog(section.resource, values), () => `Se agregó ${section.one}.`);
		}
		const id = intOf(body.id);
		if (!id) return refused(intent, '', 'Falta el registro.');
		if (intent === 'update') return perform(intent, String(id), () => updateCatalog(section.resource, id, values), () => `Se guardaron los cambios ${deOf(label)}.`);
		if (intent === 'delete') return perform(intent, String(id), () => deleteCatalog(section.resource, id), () => `Se borró ${label}.`);
		return refused(intent, String(id), 'Acción desconocida.');
	};
}

function makeScreen<R extends CatalogResource>(section: Section<R>) {
	return function CatalogScreen() {
		useDocumentTitle(`${section.title} · Administración · La Liga ACP`);
		const { user } = useSession();
		const load = useLoaderData() as Awaited<ReturnType<ReturnType<typeof makeLoader<R>>>>;
		const data = useKept(load.data);
		const [editing, setEditing] = useState<number | null>(null);
		const countRef = useRef<HTMLParagraphElement>(null);
		const noticeRef = useRef<HTMLDivElement>(null);
		usePageUrlFix(section.path, load.filters, load.pageFixed);
		// A load that failed has no results to go to: the notice says why (T-21 fix).
		useArrivalFocus(load.loadError ? noticeRef : countRef, countRef);
		// Every write of the page goes through one fetcher: its message stays even if the row goes away.
		const writer = useFetcher<ActionOutcome>({ key: `catalogo-${section.resource}` });
		const rowOutcome = writer.data && writer.data.target !== 'nuevo' && (writer.data.ok || writer.data.intent === 'delete') ? writer.data : null;
		const rowMessage = useRef<HTMLParagraphElement>(null);
		const noForm = useRef<HTMLElement>(null);
		useOutcomeFocus(rowOutcome, noForm, rowMessage);
		useEffect(() => {
			if (writer.data?.ok && writer.data.intent === 'update') setEditing(null);
		}, [writer.data]);
		if (user?.rol !== 'admin') return null;
		const labels = data?.labels ?? {};
		const page = data?.page;
		const columns: Column<CatalogRow[R]>[] = [
			...section.columns(),
			{
				header: 'Acciones',
				cell: (row) => (
					<RowActions
						section={section}
						row={row}
						name={section.name(row)}
						writer={writer}
						editing={editing === row.id}
						onEdit={() => setEditing(editing === row.id ? null : row.id)}
					/>
				),
			},
		];

		return (
			<section className={styles.page} aria-labelledby="catalog-title">
				<header className={shared.head}>
					<p className={shared.kicker}>Administración · Catálogo</p>
					<h1 className={shared.title} id="catalog-title">
						{section.title}
					</h1>
					<p className={shared.lead}>{section.lead}</p>
				</header>

				<div ref={noticeRef} tabIndex={-1}>
					<LoadNotice message={load.loadError} stale={Boolean(data)} />
				</div>

				<section className={`${styles.section} pixel-box`} aria-labelledby="catalog-new">
					<h2 className={styles.sectionTitle} id="catalog-new">
						Agregar
					</h2>
					<RecordForm section={section} target="nuevo" writer={writer} />
				</section>

				<FilterForm path={section.path} fields={section.filters(labels)} values={load.filters} label={`Filtrar ${section.title.toLowerCase()}`} />
				<FilterProblems problems={load.problems} />

				{page && (
					<>
						<ActionMessage ref={rowMessage} outcome={rowOutcome} />
						<p className={`${styles.muted} ${styles.focusable}`} ref={countRef} tabIndex={-1}>
							{page.total === 0
								? 'No hay registros con esos filtros.'
								: `${page.total} ${page.total === 1 ? 'registro' : 'registros'}.${page.totalPages > 1 ? ` Página ${Math.min(load.filters.page, page.totalPages)} de ${page.totalPages}.` : ''}`}
						</p>
						{page.items.length > 0 && (
							<DataTable
								caption={section.title}
								columns={columns}
								rows={page.items}
								rowKey={(row) => row.id}
								extraRow={(row) =>
									editing === row.id ? (
										<RecordForm section={section} target={String(row.id)} row={row} writer={writer} onDone={() => setEditing(null)} />
									) : null
								}
							/>
						)}
						<Pager path={section.path} filters={load.filters} page={load.filters.page} totalPages={page.totalPages} label={`Páginas de ${section.title.toLowerCase()}`} />
					</>
				)}
			</section>
		);
	};
}

function RecordForm<R extends CatalogResource>({
	section,
	target,
	row,
	writer,
	onDone,
}: {
	section: Section<R>;
	target: string;
	row?: CatalogRow[R];
	writer: FetcherWithComponents<ActionOutcome>;
	onDone?: () => void;
}) {
	const formRef = useRef<HTMLFormElement>(null);
	const messageRef = useRef<HTMLParagraphElement>(null);
	// Only this form's outcomes: an edit's success is told by the page (the form closes).
	const mine = writer.data?.target === target && writer.data.intent !== 'delete' ? writer.data : null;
	const outcome = mine && (!mine.ok || !row) ? mine : null;
	useOutcomeFocus(outcome, formRef, messageRef);
	const editing = Boolean(row);
	const current = row ? section.values(row) : {};
	// A row already says what it chose (the API joins those names): no extra call to show it.
	const chosen = row ? (section.chosen?.(row) ?? {}) : {};
	const [formKey, setFormKey] = useState(0);
	const [seen, setSeen] = useState(outcome);
	if (outcome !== seen) {
		setSeen(outcome);
		// A new record starts a clean form.
		if (outcome?.ok && !editing) setFormKey((k) => k + 1);
	}
	const errors = outcome && !outcome.ok ? outcome.fields : {};
	const sending = writer.state !== 'idle' ? (writer.json as { target?: unknown } | undefined)?.target : undefined;
	const busy = sending === target;
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const values = bodyOf(section.fields, new FormData(event.currentTarget), editing);
		if (writer.state !== 'idle') return;
		writer.submit(
			{ intent: editing ? 'update' : 'create', target, id: row?.id ?? null, label: row ? `${section.one} ${section.name(row)}` : null, values } as never,
			{ method: 'post', encType: 'application/json' },
		);
	};
	const fields = section.fields.filter((field) => !(editing && field.createOnly));

	return (
		<>
			<form ref={formRef} key={formKey} className={styles.form} onSubmit={onSubmit} noValidate aria-label={editing ? `Editar ${section.one}` : `Agregar ${section.one}`}>
				{fields.map((field) => (
					<FieldControl key={field.name} field={field} value={current[field.name]} chosen={chosen[field.name]} error={errors[field.name]} />
				))}
				<div className={styles.actions}>
					<button type="submit" className={shared.button} aria-disabled={busy || undefined}>
						{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Agregar'}
					</button>
					{editing && (
						<button type="button" className={styles.plain} onClick={onDone}>
							Cerrar sin guardar
						</button>
					)}
				</div>
			</form>
			<ActionMessage ref={messageRef} outcome={outcome} />
		</>
	);
}

function FieldControl({ field, value, chosen, error }: { field: FormField; value: unknown; chosen?: string; error?: string }): ReactNode {
	if (field.kind === 'check') return <CheckField label={field.label} name={field.name} defaultChecked={value === true} error={error} />;
	if (field.kind === 'search') {
		return (
			<SearchSelect
				label={field.label}
				name={field.name}
				search={catalogSource(field.resource!)}
				defaultValue={value === undefined || value === null ? '' : String(value)}
				defaultLabel={chosen ?? ''}
				error={error}
				hint={field.hint}
			/>
		);
	}
	return (
		<TextField
			label={field.label}
			name={field.name}
			type={field.kind === 'number' ? 'number' : 'text'}
			inputMode={field.kind === 'number' ? 'numeric' : undefined}
			defaultValue={value === undefined || value === null ? '' : String(value)}
			error={error}
			hint={field.hint}
			autoComplete="off"
		/>
	);
}

function RowActions<R extends CatalogResource>({
	section,
	row,
	name,
	writer,
	editing,
	onEdit,
}: {
	section: Section<R>;
	row: CatalogRow[R];
	name: string;
	writer: FetcherWithComponents<ActionOutcome>;
	editing: boolean;
	onEdit: () => void;
}) {
	const sending = writer.state !== 'idle' ? (writer.json as { target?: unknown } | undefined)?.target : undefined;
	return (
		<div className={styles.cellActions}>
			<button type="button" className={styles.plain} aria-expanded={editing} onClick={onEdit}>
				{editing ? 'Cerrar' : 'Editar'}
			</button>
			<ConfirmStep
				trigger="Borrar"
				title={`¿Borrar ${section.one} ${name}?`}
				confirmLabel="Sí, borrar"
				busy={sending === String(row.id)}
				onConfirm={() => {
					if (writer.state === 'idle') {
						writer.submit({ intent: 'delete', target: String(row.id), id: row.id, label: `${section.one} ${name}` }, { method: 'post', encType: 'application/json' });
					}
				}}
			>
				{section.deleteNote}
			</ConfirmStep>
		</div>
	);
}

/** The five catalog routes: loader, action and screen of each. */
export const catalogRoutes = Object.fromEntries(
	(Object.keys(SECTIONS) as CatalogResource[]).map((resource) => {
		const section = SECTIONS[resource] as Section<typeof resource>;
		return [resource, { loader: makeLoader(section), action: makeAction(section), shouldRevalidate: skipPageFix, Component: makeScreen(section) }];
	}),
) as Record<
	CatalogResource,
	{ loader: ReturnType<typeof makeLoader>; action: ReturnType<typeof makeAction>; shouldRevalidate: typeof skipPageFix; Component: () => ReactNode }
>;

export type { FilterValues };
