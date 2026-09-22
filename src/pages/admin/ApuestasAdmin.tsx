import { useRef } from 'react';
import { Link, type LoaderFunctionArgs, useLoaderData } from 'react-router';
import { type Column, DataTable, FilterForm, type FilterField, FilterProblems, LoadNotice, Pager } from '../../components/admin/AdminUi';
import StateTag from '../../components/StateTag';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useArrivalFocus, useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { parseFilters } from '../../lib/admin-core';
import { catalogOptions } from '../../lib/admin-catalog';
import { loadAdmin, pageInRange, skipPageFix, usePageUrlFix } from '../../lib/admin-load';
import { BET_FILTERS, listAdminBets } from '../../lib/admin-pool';
import { SELECTION_STATES, TICKET_STATES } from '../../lib/bet-history';
import { BET_TYPE_LABEL, forecastValue, resultLabel, SELECTION_STATE_LABEL, TICKET_STATE_LABEL } from '../../lib/betting-labels';
import type { AdminBet } from '../../types/admin';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';
import { leagueDateTime } from './Partidos';

const PATH = '/admin/apuestas';

/** `/admin/apuestas` (T-21, BR-001 "consultar apuestas realizadas"): participants only, read only. */
export async function loader(args: LoaderFunctionArgs) {
	const { filters, problems } = parseFilters(new URL(args.request.url).searchParams, BET_FILTERS);
	let pageFixed = false;
	const load = await loadAdmin(args, 'las apuestas', async (signal) => {
		const [first, deportes] = await Promise.all([listAdminBets(filters, signal), catalogOptions('deportes', {}, signal)]);
		const { page, problem } = await pageInRange(filters, first, () => listAdminBets(filters, signal));
		if (problem) {
			problems.push(problem);
			pageFixed = true;
		}
		return { page, deportes };
	});
	return { ...load, filters, problems, pageFixed };
}

export const shouldRevalidate = skipPageFix;

export default function ApuestasAdmin() {
	useDocumentTitle('Apuestas · Administración · La Liga ACP');
	const { user } = useSession();
	const load = useLoaderData<typeof loader>();
	const data = useKept(load.data);
	const countRef = useRef<HTMLParagraphElement>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	usePageUrlFix(PATH, load.filters, load.pageFixed);
	// A load that failed has no results to go to: the notice says why (T-21 fix).
	useArrivalFocus(load.loadError ? noticeRef : countRef, countRef);
	if (user?.rol !== 'admin') return null;
	const page = data?.page;

	const fields: FilterField[] = [
		{ name: 'usuarioId', label: 'Participante (id)', type: 'id', hint: 'El id está en Participantes y en el ranking.' },
		{ name: 'partidoId', label: 'Partido (id)', type: 'id' },
		{ name: 'ticketId', label: 'Ticket (número)', type: 'id' },
		{ name: 'estado', label: 'Estado de la apuesta', type: 'select', options: SELECTION_STATES.map((s) => ({ value: s, label: SELECTION_STATE_LABEL[s] })) },
		{ name: 'estadoTicket', label: 'Estado del ticket', type: 'select', options: TICKET_STATES.map((s) => ({ value: s, label: TICKET_STATE_LABEL[s] })) },
		{ name: 'deporteId', label: 'Deporte', type: 'select', options: (data?.deportes ?? []).map((d) => ({ value: String(d.id), label: d.nombre })) },
		{ name: 'desde', label: 'Desde', type: 'date', hint: 'Fecha del ticket, hora de Lima.' },
		{ name: 'hasta', label: 'Hasta', type: 'date' },
	];

	const columns: Column<AdminBet>[] = [
		{
			header: 'Ticket',
			cell: (b) => (
				<>
					#{b.ticket.id} · {leagueDateTime(b.ticket.creadoEn)}
					<br />
					<StateTag state={b.ticket.estado} kind="ticket" />
				</>
			),
		},
		{
			header: 'Participante',
			cell: (b) => (
				<Link className={shared.textLink} to={`${PATH}?usuarioId=${b.usuario.id}`}>
					{b.usuario.nombre} (id {b.usuario.id})
				</Link>
			),
		},
		{
			header: 'Partido',
			cell: (b) => (
				<Link className={shared.textLink} to={`/admin/partidos/${b.partido.id}`}>
					{b.partido.local.equipo.nombre} vs {b.partido.visita.equipo.nombre}
				</Link>
			),
		},
		{
			header: 'Apuesta',
			cell: (b) => `${BET_TYPE_LABEL[b.tipo]}: ${forecastValue(b, b.partido.local.equipo.nombre, b.partido.visita.equipo.nombre)}`,
		},
		{
			header: 'Resultado real',
			cell: (b) =>
				b.resultadoReal
					? `${b.resultadoReal.golesLocal} - ${b.resultadoReal.golesVisitante} (${resultLabel(b.resultadoReal.resultado, b.partido.local.equipo.nombre, b.partido.visita.equipo.nombre)})`
					: 'Todavía no hay',
		},
		{ header: 'Estado', cell: (b) => <StateTag state={b.estado} kind="seleccion" /> },
		{ header: 'Puntos', cell: (b) => b.puntosObtenidos ?? (b.estado === 'anulada' ? 'Sin puntos' : 'Por definir') },
		{
			header: 'Monedas del ticket',
			cell: (b) =>
				`${b.ticket.monedasUtilizadas} ${b.ticket.monedasUtilizadas === 1 ? 'usada' : 'usadas'}${
					b.ticket.monedasDevueltas > 0 ? `, ${b.ticket.monedasDevueltas} ${b.ticket.monedasDevueltas === 1 ? 'devuelta' : 'devueltas'}` : ''
				}`,
		},
	];

	return (
		<section className={styles.page} aria-labelledby="bets-admin-title">
			<header className={shared.head}>
				<p className={shared.kicker}>Administración</p>
				<h1 className={shared.title} id="bets-admin-title">
					Apuestas
				</h1>
				<p className={shared.lead}>
					Las apuestas de los participantes, del ticket más reciente al más antiguo: una fila por selección. Solo consulta; nada se cambia desde
					aquí.
				</p>
			</header>

			<div ref={noticeRef} tabIndex={-1}>
				<LoadNotice message={load.loadError} stale={Boolean(data)} />
			</div>
			<FilterForm path={PATH} fields={fields} values={load.filters} label="Filtrar apuestas" />
			<FilterProblems problems={load.problems} />

			{page && (
				<>
					<p className={`${styles.muted} ${styles.focusable}`} ref={countRef} tabIndex={-1}>
						{page.total === 0
							? 'No hay apuestas con esos filtros.'
							: `${page.total} ${page.total === 1 ? 'selección' : 'selecciones'}.${page.totalPages > 1 ? ` Página ${Math.min(load.filters.page, page.totalPages)} de ${page.totalPages}.` : ''}`}
					</p>
					{page.items.length > 0 && <DataTable caption="Apuestas" columns={columns} rows={page.items} rowKey={(b) => b.id} />}
					<Pager path={PATH} filters={load.filters} page={load.filters.page} totalPages={page.totalPages} label="Páginas de apuestas" />
				</>
			)}
		</section>
	);
}
