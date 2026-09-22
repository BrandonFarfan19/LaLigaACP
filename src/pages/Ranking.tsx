import { useEffect, useRef, useState } from 'react';
import { Link, type LoaderFunctionArgs, useLoaderData, useRevalidator } from 'react-router';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';
import { isTransientError, waitText } from '../lib/api';
import { getRanking, sharedPositions } from '../lib/ranking';
import { requireKnownUser } from '../lib/route-guards';
import type { AuthUser } from '../types/api';
import type { RankingData, RankingRow } from '../types/betting';
import { formatKickoff } from '../utils/format-date';
import shared from './Apuestas.module.css';
import styles from './Ranking.module.css';

export interface RankingPageData {
	/** `null` when this load failed (see `loadError`). */
	ranking: RankingData | null;
	loadError: string | null;
}

/**
 * `/ranking` (T-20, BR-041 to BR-044): the pool's top, for any signed-in
 * user (BR-002). Computed by the backend on every read, so loading the page
 * (or "Actualizar") is the update. There is no public version (T-15).
 */
export async function loader(args: LoaderFunctionArgs): Promise<RankingPageData> {
	// A session that can't be checked right now keeps the page, like a failed read (T-20 fix).
	const { sessionError } = await requireKnownUser(args);
	try {
		if (sessionError) throw sessionError;
		return { ranking: await getRanking(args.request.signal), loadError: null };
	} catch (error) {
		if (!isTransientError(error)) throw error;
		const message =
			error.code === 'RATE_LIMITED'
				? `No se pudo cargar el ranking: demasiadas solicitudes. Espera ${waitText(error.retryAfterSeconds) ?? 'unos minutos'} y vuelve a intentarlo.`
				: `No se pudo cargar el ranking. ${error.message}`;
		return { ranking: null, loadError: message };
	}
}

const points = (n: number) => `${n} ${n === 1 ? 'punto' : 'puntos'}`;
const hits = (n: number) => `${n} ${n === 1 ? 'acierto' : 'aciertos'}`;

/** `08:58`, in the league's zone (the same clock as every other time on the site). */
const clock = (date: Date) => formatKickoff(date.toISOString()).time;

export default function Ranking() {
	useDocumentTitle('Ranking · La Liga ACP');
	const { user } = useSession();
	const data = useLoaderData<typeof loader>();
	const { ranking, loadError } = data;
	const revalidator = useRevalidator();
	// The last ranking that loaded: a failed update keeps showing it, with the error on top.
	const [loaded, setLoaded] = useState(ranking);
	if (ranking && ranking !== loaded) setLoaded(ranking);
	const busy = revalidator.state !== 'idle';

	// "Actualizar" keeps the focus (aria-disabled, never disabled) and says how it went.
	// The loader data the update started from: the update is over when other data arrives.
	const askedFrom = useRef<RankingPageData | null>(null);
	const [news, setNews] = useState('');
	useEffect(() => {
		if (!askedFrom.current || data === askedFrom.current) return;
		askedFrom.current = null;
		setNews(data.loadError ? 'No se pudo actualizar el ranking.' : `Ranking actualizado a las ${clock(new Date())}.`);
	}, [data]);
	const refresh = () => {
		if (busy) return;
		askedFrom.current = data;
		setNews('');
		void revalidator.revalidate();
	};

	if (!user) return null;

	return (
		<section className={`${shared.page} ${styles.page}`} aria-labelledby="ranking-title" aria-busy={busy || undefined}>
			<header className={shared.head}>
				<p className={shared.kicker}>Polla deportiva</p>
				<h1 className={shared.title} id="ranking-title">
					Ranking
				</h1>
				<p className={shared.lead}>
					Los mejores de la polla: primero por puntos y, a igual puntos, por aciertos. Quienes empatan en los dos comparten el puesto.
				</p>
			</header>

			{loadError && (
				<div className={`${shared.notice} pixel-box`} role="alert">
					<p>{loadError}</p>
					{loaded && <p>Abajo sigue el ranking que se cargó antes.</p>}
				</div>
			)}

			{loaded && <Board ranking={loaded} user={user} />}

			<p className={styles.actions}>
				<button type="button" className={shared.button} onClick={refresh} aria-disabled={busy || undefined}>
					{busy ? 'Actualizando…' : loadError ? 'Reintentar' : 'Actualizar'}
				</button>
				<span className={styles.status} role="status">
					{busy ? 'Actualizando el ranking…' : news}
				</span>
			</p>
		</section>
	);
}

function OwnSummary({ ranking, user }: { ranking: RankingData; user: AuthUser }) {
	const own = ranking.propia;
	if (!own) {
		const text =
			user.rol === 'admin'
				? 'Los administradores no participan en la polla: no tienen fila en el ranking.'
				: 'Tu cuenta está pendiente de validación: aparecerás en el ranking cuando un administrador la valide.';
		return (
			<p className={`${styles.own} pixel-box`} data-none>
				{text}
			</p>
		);
	}
	return (
		<p className={`${styles.own} pixel-box`}>
			<span className={styles.ownLabel}>Tu puesto</span>
			<span className={styles.ownPosition}>#{own.posicion}</span>
			<span>
				{points(own.puntos)} · {hits(own.aciertos)}
			</span>
			<span className={styles.small}>
				{own.enTop ? (own.enLista ? 'Estás en el top: tu fila está marcada con TÚ.' : 'Estás en el top, pero la lista no alcanza a mostrar tu fila: va al final.') : 'Todavía no estás en el top: tu fila va al final.'}
			</span>
		</p>
	);
}

function Board({ ranking, user }: { ranking: RankingData; user: AuthUser }) {
	const tied = sharedPositions(ranking.top);
	const own = ranking.propia;
	const ownApart = own && !own.enLista ? own : null;
	// Apart, its position is shared when a listed row holds it too (the list was cut inside a tie).
	// Below the top the API doesn't say whether someone else holds it (docs/pendientes.md).
	const ownShared = Boolean(ownApart && ranking.top.some((row) => row.posicion === ownApart.posicion));
	const hidden = ranking.topSinMostrar;

	return (
		<>
			<OwnSummary ranking={ranking} user={user} />

			<div className={`${styles.board} pixel-box`}>
				<table className={styles.table}>
					<caption className={styles.caption}>
						Top {ranking.posicionesTop} · {ranking.participantes} {ranking.participantes === 1 ? 'participante' : 'participantes'}
					</caption>
					<thead>
						<tr>
							<Heading short="#" long="Posición" className={styles.pos} />
							<Heading short="Nombre" long="Participante" />
							<Heading short="Pts" long="Puntos" className={styles.num} />
							<Heading short="Ac" long="Aciertos" className={styles.num} />
						</tr>
					</thead>
					<tbody>
						{ranking.top.length === 0 && (
							<tr>
								<td colSpan={4} className={styles.empty}>
									Todavía no hay participantes validados.
								</td>
							</tr>
						)}
						{ranking.top.map((row, index) => (
							<Row key={index} row={row} shared={tied.has(row.posicion)} />
						))}
						{hidden > 0 && (
							<tr className={styles.more}>
								<td colSpan={4}>
									{hidden === 1
										? 'Y 1 participante más empatado en el top que no entra en la lista.'
										: `Y ${hidden} participantes más empatados en el top que no entran en la lista.`}
								</td>
							</tr>
						)}
						{ownApart && (
							<>
								<tr className={styles.gap} aria-hidden="true">
									<td colSpan={4}>· · ·</td>
								</tr>
								<Row row={ownApart} shared={ownShared} />
							</>
						)}
					</tbody>
				</table>
			</div>

			{ranking.top.length > 0 && ranking.participantes > ranking.top.length + hidden && (
				<p className={styles.small}>El resto de los participantes está fuera del top {ranking.posicionesTop}.</p>
			)}
			{user.rol === 'apostador' && (
				<p className={styles.small}>
					<Link className={shared.textLink} to="/mis-apuestas">
						Ver mis apuestas y mis puntos
					</Link>
				</p>
			)}
		</>
	);
}

/** A column heading: short on phones, the full word from 48rem; screen readers always get the full word. */
function Heading({ short, long, className }: { short: string; long: string; className?: string }) {
	return (
		<th scope="col" className={className}>
			<span className={styles.short} aria-hidden="true">
				{short}
			</span>
			<span className={styles.long}>{long}</span>
		</th>
	);
}

function Row({ row, shared }: { row: RankingRow; shared: boolean }) {
	return (
		<tr className={styles.row} data-own={row.esPropia || undefined} data-podium={row.posicion <= 3 ? row.posicion : undefined}>
			<td className={styles.pos}>
				{shared ? (
					<>
						<span aria-hidden="true">={row.posicion}</span>
						<span className={styles.status}>{row.posicion}, compartido</span>
					</>
				) : (
					row.posicion
				)}
			</td>
			<td className={styles.name}>
				{row.esPropia && (
					<span className={styles.you}>
						<span aria-hidden="true">TÚ</span>
						<span className={styles.status}>Tu fila:</span>
					</span>
				)}
				<span>{row.participante.nombre}</span>
			</td>
			<td className={styles.num}>{row.puntos}</td>
			<td className={styles.num}>{row.aciertos}</td>
		</tr>
	);
}
