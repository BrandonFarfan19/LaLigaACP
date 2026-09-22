import { type ReactNode, useRef } from 'react';
import { type LoaderFunctionArgs, useLoaderData } from 'react-router';
import { type Column, DataTable, FilterForm, type FilterField, FilterProblems, LoadNotice, Pager } from '../../components/admin/AdminUi';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useArrivalFocus, useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { parseFilters } from '../../lib/admin-core';
import { fixedSource } from '../../lib/admin-choices';
import { loadAdmin, pageInRange, skipPageFix, usePageUrlFix } from '../../lib/admin-load';
import { AUDIT_ACTIONS, AUDIT_ENTITIES, AUDIT_FILTERS, detailText, fieldName, listAudit } from '../../lib/admin-pool';
import type { AuditRecord } from '../../types/admin';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';
import { leagueDateTime } from './Partidos';

const PATH = '/admin/auditoria';

/** `/admin/auditoria` (T-21, NFR-006): every admin write, newest first. Read only. */
export async function loader(args: LoaderFunctionArgs) {
	const { filters, problems } = parseFilters(new URL(args.request.url).searchParams, AUDIT_FILTERS);
	if (filters.entidadId !== undefined && filters.entidad === undefined) {
		problems.push('Para buscar un registro por su id elige también el tipo de dato: se ignoró el id.');
		delete filters.entidadId;
	}
	let pageFixed = false;
	const load = await loadAdmin(args, 'la auditoría', async (signal) => {
		const { page, problem } = await pageInRange(filters, await listAudit(filters, signal), () => listAudit(filters, signal));
		if (problem) {
			problems.push(problem);
			pageFixed = true;
		}
		return page;
	});
	return { ...load, filters, problems, pageFixed };
}

/** The audit actions, as the chooser wants them. */
const ACTION_OPTIONS = AUDIT_ACTIONS.map(([value, label]) => ({ value, label }));

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const valueText = (value: unknown) => (typeof value === 'string' && ISO.test(value) ? `${leagueDateTime(value)} (Lima)` : detailText(value));
const isChange = (value: unknown): value is { antes: unknown; despues: unknown; recortado?: boolean } =>
	Boolean(value && typeof value === 'object' && 'antes' in value && 'despues' in value);

function ChangeLine({ field, change }: { field: string; change: { antes: unknown; despues: unknown; recortado?: boolean } }) {
	return (
		<li>
			<strong>{fieldName(field)}:</strong> {valueText(change.antes)} → {valueText(change.despues)}
			{change.recortado && <span className={styles.muted}> (texto recortado en el registro)</span>}
		</li>
	);
}

/** The detail, in words: what changed (before and after), what was created or deleted, the figures. */
function AuditDetail({ detalle }: { detalle: AuditRecord['detalle'] }): ReactNode {
	if (!detalle || Object.keys(detalle).length === 0) return <span className={styles.muted}>Sin detalle</span>;
	const lines: ReactNode[] = [];
	for (const [key, value] of Object.entries(detalle)) {
		if (key === 'cambios' && value && typeof value === 'object') {
			for (const [field, change] of Object.entries(value as Record<string, unknown>)) {
				if (isChange(change)) lines.push(<ChangeLine key={`c-${field}`} field={field} change={change} />);
				else lines.push(<li key={`c-${field}`}>{fieldName(field)} (cambió)</li>);
			}
		} else if (isChange(value)) {
			lines.push(<ChangeLine key={key} field={key} change={value} />);
		} else if ((key === 'nuevo' || key === 'anterior') && value && typeof value === 'object' && !('golesLocal' in value)) {
			lines.push(
				<li key={key}>
					<strong>{key === 'nuevo' ? 'Creado' : 'Borrado'}:</strong>{' '}
					{Object.entries(value as Record<string, unknown>)
						.map(([field, inner]) => `${fieldName(field)}: ${valueText(inner)}`)
						.join(' · ')}
				</li>,
			);
		} else if (key === 'recortado') {
			lines.push(
				<li key={key} className={styles.muted}>
					El detalle era muy largo: se guardaron solo los nombres de los datos.
				</li>,
			);
		} else {
			lines.push(
				<li key={key}>
					<strong>{fieldName(key)}:</strong> {valueText(value)}
				</li>,
			);
		}
	}
	return <ul className={styles.detailList}>{lines}</ul>;
}

const entityName = (code: string) => AUDIT_ENTITIES.find(([c]) => c === code)?.[1] ?? code;

export const shouldRevalidate = skipPageFix;

export default function Auditoria() {
	useDocumentTitle('Auditoría · Administración · La Liga ACP');
	const { user } = useSession();
	const load = useLoaderData<typeof loader>();
	const page = useKept(load.data);
	const countRef = useRef<HTMLParagraphElement>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	usePageUrlFix(PATH, load.filters, load.pageFixed);
	// A load that failed has no results to go to: the notice says why (T-21 fix).
	useArrivalFocus(load.loadError ? noticeRef : countRef, countRef);
	if (user?.rol !== 'admin') return null;

	const fields: FilterField[] = [
		// 31 actions with long names: searched, never a cut select (D-019).
		{ name: 'accion', label: 'Acción', type: 'search', source: fixedSource(ACTION_OPTIONS), chosen: ACTION_OPTIONS.find((o) => o.value === load.filters.accion)?.label },
		{ name: 'entidad', label: 'Tipo de dato', type: 'select', options: AUDIT_ENTITIES.map(([value, label]) => ({ value, label })) },
		{ name: 'entidadId', label: 'Id del registro', type: 'id', hint: 'Junto con el tipo de dato.' },
		{ name: 'usuarioId', label: 'Administrador (id)', type: 'id' },
		{ name: 'desde', label: 'Desde', type: 'date' },
		{ name: 'hasta', label: 'Hasta', type: 'date' },
	];

	const columns: Column<AuditRecord>[] = [
		{ header: 'Fecha', cell: (r) => leagueDateTime(r.fecha) },
		{ header: 'Administrador', cell: (r) => `${r.administrador.nombre} (id ${r.administrador.id})` },
		{ header: 'Acción', cell: (r) => r.accion.nombre },
		{ header: 'Registro', cell: (r) => `${entityName(r.entidad)} ${r.entidadId}` },
		{ header: 'Detalle', cell: (r) => <AuditDetail detalle={r.detalle} /> },
	];

	return (
		<section className={styles.page} aria-labelledby="audit-title">
			<header className={shared.head}>
				<p className={shared.kicker}>Administración</p>
				<h1 className={shared.title} id="audit-title">
					Auditoría
				</h1>
				<p className={shared.lead}>
					Cada operación de los administradores, de la más reciente a la más antigua, con lo que cambió. Los registros no se modifican ni se
					borran. Las fechas son de Lima.
				</p>
			</header>

			<div ref={noticeRef} tabIndex={-1}>
				<LoadNotice message={load.loadError} stale={Boolean(page)} />
			</div>
			<FilterForm path={PATH} fields={fields} values={load.filters} label="Filtrar la auditoría" />
			<FilterProblems problems={load.problems} />

			{page && (
				<>
					<p className={`${styles.muted} ${styles.focusable}`} ref={countRef} tabIndex={-1}>
						{page.total === 0
							? 'No hay registros con esos filtros.'
							: `${page.total} ${page.total === 1 ? 'registro' : 'registros'}.${page.totalPages > 1 ? ` Página ${Math.min(load.filters.page, page.totalPages)} de ${page.totalPages}.` : ''}`}
					</p>
					{page.items.length > 0 && <DataTable caption="Registro de auditoría" columns={columns} rows={page.items} rowKey={(r) => r.id} />}
					<Pager path={PATH} filters={load.filters} page={load.filters.page} totalPages={page.totalPages} label="Páginas de la auditoría" />
				</>
			)}
		</section>
	);
}
