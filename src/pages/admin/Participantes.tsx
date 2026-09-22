import { useRef } from 'react';
import { type ActionFunctionArgs, type FetcherWithComponents, type LoaderFunctionArgs, useFetcher, useLoaderData } from 'react-router';
import {
	ActionMessage,
	ConfirmStep,
	type Column,
	DataTable,
	FilterForm,
	type FilterField,
	FilterProblems,
	LoadNotice,
	Pager,
	Stat,
	useOutcomeFocus,
} from '../../components/admin/AdminUi';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useArrivalFocus, useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { type ActionOutcome, intOf, jsonBody, parseFilters, perform, refused } from '../../lib/admin-core';
import { loadAdmin, pageInRange, skipPageFix, usePageUrlFix } from '../../lib/admin-load';
import { countParticipants, listParticipants, PARTICIPANT_FILTERS, participantAction } from '../../lib/admin-pool';
import type { AdminParticipant, ParticipantAction } from '../../types/admin';
import { formatDateOnly } from '../../utils/format-date';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';

const PATH = '/admin/participantes';

/** `/admin/participantes` (T-21, BR-006, BR-007): participants only, never admins (BR-001). */
export async function loader(args: LoaderFunctionArgs) {
	const { filters, problems } = parseFilters(new URL(args.request.url).searchParams, PARTICIPANT_FILTERS);
	let pageFixed = false;
	const load = await loadAdmin(args, 'los participantes', async (signal) => {
		const [first, conteos] = await Promise.all([listParticipants(filters, signal), countParticipants(signal)]);
		const { page, problem } = await pageInRange(filters, first, () => listParticipants(filters, signal));
		if (problem) {
			problems.push(problem);
			pageFixed = true;
		}
		return { page, conteos };
	});
	return { ...load, filters, problems, pageFixed };
}

export const shouldRevalidate = skipPageFix;

const ACTIONS: readonly ParticipantAction[] = ['confirmar_pago', 'revertir_pago', 'validar'];

/** BR-006: confirm the payment, revert it or validate, one participant at a time. The backend checks the order. */
export async function action({ request }: ActionFunctionArgs): Promise<ActionOutcome> {
	const body = await jsonBody(request);
	const intent = String(body.intent ?? '');
	const id = intOf(body.id);
	if (!ACTIONS.includes(intent as ParticipantAction) || !id) return refused(intent, String(body.id ?? ''), 'Acción desconocida.');
	return perform(intent, String(id), () => participantAction(id, intent as ParticipantAction), ({ participante: p }) => {
		switch (intent as ParticipantAction) {
			case 'confirmar_pago':
				return `El pago de ${p.nombre} quedó confirmado. Ahora puedes validar su cuenta.`;
			case 'revertir_pago':
				return `El pago de ${p.nombre} volvió a pendiente.`;
			case 'validar':
				return `${p.nombre} quedó validado y recibió sus monedas: su saldo es ${p.saldoMonedas}.`;
		}
	});
}

const FIELDS: readonly FilterField[] = [
	{ name: 'q', label: 'Buscar por nombre o correo', type: 'text' },
	{
		name: 'estadoPago',
		label: 'Pago',
		type: 'select',
		options: [
			{ value: 'pendiente', label: 'Pendiente' },
			{ value: 'confirmado', label: 'Confirmado' },
		],
	},
	{
		name: 'estadoValidacion',
		label: 'Validación',
		type: 'select',
		options: [
			{ value: 'pendiente', label: 'Pendiente' },
			{ value: 'validado', label: 'Validado' },
		],
	},
	{
		name: 'orden',
		label: 'Orden por inscripción',
		type: 'select',
		empty: 'Antiguos primero',
		options: [{ value: 'desc', label: 'Nuevos primero' }],
	},
];

export default function Participantes() {
	useDocumentTitle('Participantes · Administración · La Liga ACP');
	const { user } = useSession();
	const load = useLoaderData<typeof loader>();
	const data = useKept(load.data);
	const countRef = useRef<HTMLParagraphElement>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	useArrivalFocus(countRef, noticeRef);
	// One fetcher for every row: its message stays even if the row leaves the filtered list.
	usePageUrlFix(PATH, load.filters, load.pageFixed);
	const writer = useFetcher<ActionOutcome>({ key: 'participantes' });
	const messageRef = useRef<HTMLParagraphElement>(null);
	const noForm = useRef<HTMLElement>(null);
	useOutcomeFocus(writer.data, noForm, messageRef);
	if (user?.rol !== 'admin') return null;
	const page = data?.page;

	const columns: Column<AdminParticipant>[] = [
		{
			header: 'Usuario',
			cell: (p) => (
				<>
					{p.nombre}
					<br />
					<span className={styles.muted}>{p.email}</span>
				</>
			),
		},
		{ header: 'Inscripción', cell: (p) => formatDateOnly(p.creadoEn) },
		{
			header: 'Pago',
			cell: (p) => (
				<span className={styles.tag} data-tone={p.estadoPago === 'confirmado' ? undefined : 'warn'}>
					{p.estadoPago === 'confirmado' ? 'Confirmado' : 'Pendiente'}
				</span>
			),
		},
		{
			header: 'Validación',
			cell: (p) => (
				<span className={styles.tag} data-tone={p.estadoValidacion === 'validado' ? undefined : 'warn'}>
					{p.estadoValidacion === 'validado' ? 'Validado' : 'Pendiente'}
				</span>
			),
		},
		{ header: 'Saldo', cell: (p) => `${p.saldoMonedas} ${p.saldoMonedas === 1 ? 'moneda' : 'monedas'}` },
		{ header: 'Puntos', cell: (p) => p.puntos },
		{ header: 'Acciones', cell: (p) => <ParticipantActions participant={p} writer={writer} /> },
	];

	return (
		<section className={styles.page} aria-labelledby="participants-title">
			<header className={shared.head}>
				<p className={shared.kicker}>Administración</p>
				<h1 className={shared.title} id="participants-title">
					Participantes
				</h1>
				<p className={shared.lead}>
					Primero confirma el pago y después valida: al validar, el participante recibe sus 10 monedas una sola vez. La validación no se
					deshace. Los roles no se cambian desde aquí.
				</p>
			</header>

			<div ref={noticeRef} tabIndex={-1}>
				<LoadNotice message={load.loadError} stale={Boolean(data)} />
			</div>

			{data && (
				<dl className={styles.stats}>
					<Stat label="Inscritos" value={data.conteos.inscritos} />
					<Stat label="Validados" value={data.conteos.validados} />
					<Stat label="Pendientes" value={data.conteos.pendientes} />
				</dl>
			)}

			<FilterForm path={PATH} fields={FIELDS} values={load.filters} label="Filtrar participantes" />
			<FilterProblems problems={load.problems} />

			<ActionMessage ref={messageRef} outcome={writer.data} />

			{page && (
				<>
					<p className={`${styles.muted} ${styles.focusable}`} ref={countRef} tabIndex={-1}>
						{page.total === 0
							? 'No hay participantes con esos filtros.'
							: `${page.total} ${page.total === 1 ? 'participante' : 'participantes'}.${page.totalPages > 1 ? ` Página ${Math.min(load.filters.page, page.totalPages)} de ${page.totalPages}.` : ''}`}
					</p>
					{page.items.length > 0 && <DataTable caption="Participantes" columns={columns} rows={page.items} rowKey={(p) => p.id} />}
					<Pager path={PATH} filters={load.filters} page={load.filters.page} totalPages={page.totalPages} label="Páginas de participantes" />
				</>
			)}
		</section>
	);
}

/** The actions a participant's state allows (§23), each with its explicit step. */
function ParticipantActions({ participant: p, writer }: { participant: AdminParticipant; writer: FetcherWithComponents<ActionOutcome> }) {
	const busy = writer.state !== 'idle' && (writer.json as { id?: unknown } | undefined)?.id === p.id;
	const run = (intent: ParticipantAction) => {
		if (writer.state === 'idle') writer.submit({ intent, id: p.id }, { method: 'post', encType: 'application/json' });
	};
	const validated = p.estadoValidacion === 'validado';
	const paid = p.estadoPago === 'confirmado';

	return (
		<div className={styles.cellActions}>
			{validated && <span className={styles.muted}>Sin acciones: ya está validado.</span>}
			{!validated && !paid && (
				<ConfirmStep trigger="Confirmar pago" tone="plain" title={`¿Confirmar el pago de ${p.nombre}?`} confirmLabel="Sí, confirmar pago" busy={busy} onConfirm={() => run('confirmar_pago')}>
					Después podrás validar su cuenta. Mientras no lo valides, puedes revertir el pago.
				</ConfirmStep>
			)}
			{!validated && paid && (
				<>
					<ConfirmStep trigger="Validar" tone="plain" title={`¿Validar a ${p.nombre}?`} confirmLabel="Sí, validar" busy={busy} onConfirm={() => run('validar')}>
						Recibirá 10 monedas y podrá apostar. La validación no se deshace.
					</ConfirmStep>
					<ConfirmStep trigger="Revertir pago" title={`¿Revertir el pago de ${p.nombre}?`} confirmLabel="Sí, revertir" busy={busy} onConfirm={() => run('revertir_pago')}>
						El pago vuelve a pendiente y no podrás validarlo hasta confirmarlo otra vez.
					</ConfirmStep>
				</>
			)}
		</div>
	);
}
