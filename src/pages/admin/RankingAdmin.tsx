import { useRef } from 'react';
import { Link, type LoaderFunctionArgs, useLoaderData } from 'react-router';
import { type Column, DataTable, FilterProblems, LoadNotice, Pager } from '../../components/admin/AdminUi';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useArrivalFocus, useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { parseFilters } from '../../lib/admin-core';
import { loadAdmin, pageInRange, skipPageFix, usePageUrlFix } from '../../lib/admin-load';
import { listAdminRanking } from '../../lib/admin-pool';
import type { AdminRankingRow } from '../../types/admin';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';

const PATH = '/admin/ranking';

/** `/admin/ranking` (T-21, BR-042): the whole ranking, with each participant's id. */
export async function loader(args: LoaderFunctionArgs) {
	const { filters, problems } = parseFilters(new URL(args.request.url).searchParams, {});
	let pageFixed = false;
	const load = await loadAdmin(args, 'el ranking', async (signal) => {
		const { page, problem } = await pageInRange(filters, await listAdminRanking(filters.page, signal), () => listAdminRanking(filters.page, signal));
		if (problem) {
			problems.push(problem);
			pageFixed = true;
		}
		return page;
	});
	return { ...load, filters, problems, pageFixed };
}

export const shouldRevalidate = skipPageFix;

export default function RankingAdmin() {
	useDocumentTitle('Ranking · Administración · La Liga ACP');
	const { user } = useSession();
	const load = useLoaderData<typeof loader>();
	const page = useKept(load.data);
	const countRef = useRef<HTMLParagraphElement>(null);
	const noticeRef = useRef<HTMLDivElement>(null);
	usePageUrlFix(PATH, load.filters, load.pageFixed);
	useArrivalFocus(load.loadError ? noticeRef : countRef, countRef);
	if (user?.rol !== 'admin') return null;

	const columns: Column<AdminRankingRow>[] = [
		{
			header: 'Posición',
			// The API counts the tie over the whole ranking, so a shared position shows as such even alone on its page.
			cell: (r) => (r.empatados > 1 ? `=${r.posicion} (compartida con ${r.empatados - 1} más)` : r.posicion),
		},
		{
			header: 'Participante',
			cell: (r) => (
				<Link className={shared.textLink} to={`/admin/apuestas?usuarioId=${r.participante.id}`}>
					{r.participante.nombre} (id {r.participante.id})
				</Link>
			),
		},
		{ header: 'Puntos', cell: (r) => r.puntos },
		{ header: 'Aciertos', cell: (r) => r.aciertos },
	];

	return (
		<section className={styles.page} aria-labelledby="ranking-admin-title">
			<header className={shared.head}>
				<p className={shared.kicker}>Administración</p>
				<h1 className={shared.title} id="ranking-admin-title">
					Ranking completo
				</h1>
				<p className={shared.lead}>
					Todos los participantes validados, por puntos y después por aciertos; quienes empatan en los dos comparten el puesto. El nombre lleva a
					sus apuestas.
				</p>
			</header>

			<div ref={noticeRef} tabIndex={-1}>
					<LoadNotice message={load.loadError} stale={Boolean(page)} />
				</div>
			<FilterProblems problems={load.problems} />

			{page && (
				<>
					<p className={`${styles.muted} ${styles.focusable}`} ref={countRef} tabIndex={-1}>
						{page.total === 0
							? 'Todavía no hay participantes validados.'
							: `${page.total} ${page.total === 1 ? 'participante' : 'participantes'}.${page.totalPages > 1 ? ` Página ${Math.min(load.filters.page, page.totalPages)} de ${page.totalPages}.` : ''}`}
					</p>
					{page.items.length > 0 && <DataTable caption="Ranking completo" columns={columns} rows={page.items} rowKey={(r) => r.participante.id} />}
					<Pager path={PATH} filters={load.filters} page={load.filters.page} totalPages={page.totalPages} label="Páginas del ranking" />
				</>
			)}
		</section>
	);
}
