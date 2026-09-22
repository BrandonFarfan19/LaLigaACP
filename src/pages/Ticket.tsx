import { data, Link, type LoaderFunctionArgs, useLoaderData } from 'react-router';
import PixelIcon from '../components/PixelIcon';
import TeamCrest from '../components/TeamCrest';
import { useDocumentTitle } from '../hooks/useDocumentTitle';
import { useSession } from '../hooks/useSession';
import { getTicket } from '../lib/betting';
import { BET_TYPE_LABEL, coinsText, forecastValue, resultLabel, SELECTION_STATE_LABEL, TICKET_STATE_LABEL } from '../lib/betting-labels';
import { requireUser } from '../lib/route-guards';
import { formatKickoff } from '../utils/format-date';
import styles from './Ticket.module.css';

/**
 * `/apuestas/tickets/:id` (T-19): the receipt of one of the user's own
 * tickets (BR-025). Someone else's ticket, or one that doesn't exist, is the
 * not-found page (the backend answers the same 404 for both).
 */
export async function loader(args: LoaderFunctionArgs) {
	await requireUser(args);
	const ticket = await getTicket(args.params.id ?? '');
	if (!ticket) throw data(null, { status: 404 });
	return ticket;
}

const when = (iso: string) => {
	const { day, time } = formatKickoff(iso);
	return `${day} ${time}`;
};

export default function Ticket() {
	const ticket = useLoaderData<typeof loader>();
	useDocumentTitle(`Ticket #${ticket.id} · La Liga ACP`);
	// Only while the session that loaded it is still there.
	const { user } = useSession();
	if (!user || user.id !== ticket.usuario.id) return null;

	return (
		<section className={styles.page} aria-labelledby="ticket-title">
			<header className={styles.head}>
				<p className={styles.kicker}>Comprobante</p>
				<h1 className={styles.title} id="ticket-title">
					Ticket #{ticket.id}
				</h1>
				<p className={styles.lead}>
					Confirmado el <time dateTime={ticket.creadoEn}>{when(ticket.creadoEn)}</time> por {ticket.usuario.nombre}.
				</p>
			</header>

			<div className={`${styles.summary} pixel-box`}>
				<dl className={styles.facts}>
					<div>
						<dt>Estado</dt>
						<dd>
							<span className={styles.state} data-estado={ticket.estado}>
								{TICKET_STATE_LABEL[ticket.estado]}
							</span>
						</dd>
					</div>
					<div>
						<dt>Selecciones</dt>
						<dd>{ticket.cantidadSelecciones}</dd>
					</div>
					<div>
						<dt>Monedas utilizadas</dt>
						<dd>{coinsText(ticket.monedasUtilizadas)}</dd>
					</div>
					<div>
						<dt>Monedas devueltas</dt>
						<dd>{coinsText(ticket.monedasDevueltas)}</dd>
					</div>
					<div>
						<dt>Puntos</dt>
						<dd>{ticket.puntosObtenidos}</dd>
					</div>
				</dl>
			</div>

			<ol className={styles.list} aria-label="Selecciones del ticket">
				{ticket.selecciones.map((selection, index) => {
					const local = selection.partido.local.equipo;
					const visita = selection.partido.visita.equipo;
					return (
						<li key={selection.id} className={`${styles.item} pixel-box`} data-estado={selection.estado}>
							<p className={styles.match}>
								<span className={styles.number}>{index + 1}.</span>
								<TeamCrest team={local} size={24} />
								<span>
									{local.nombre} vs {visita.nombre}
								</span>
								<TeamCrest team={visita} size={24} />
							</p>
							<p className={styles.small}>
								{selection.partido.deporte.nombre} · {selection.partido.competicion.nombre} ·{' '}
								<time dateTime={selection.partido.fechaHora}>{when(selection.partido.fechaHora)}</time>
							</p>
							<dl className={styles.facts}>
								<div>
									<dt>Tipo</dt>
									<dd>{BET_TYPE_LABEL[selection.tipo]}</dd>
								</div>
								<div>
									<dt>Pronóstico</dt>
									<dd>{forecastValue(selection, local.nombre, visita.nombre)}</dd>
								</div>
								<div>
									<dt>Estado</dt>
									<dd>
										<span className={styles.state} data-estado={selection.estado}>
											{selection.estado === 'anulada' && <PixelIcon name="cancelado" />}
											{selection.estado === 'acertada' && <PixelIcon name="finalizado" />}
											{SELECTION_STATE_LABEL[selection.estado]}
										</span>
									</dd>
								</div>
								<div>
									<dt>Costo</dt>
									<dd>{coinsText(selection.costo)}</dd>
								</div>
								<div>
									<dt>Resultado real</dt>
									<dd>
										{selection.resultadoReal
											? `${selection.resultadoReal.golesLocal} - ${selection.resultadoReal.golesVisitante} (${resultLabel(selection.resultadoReal.resultado, local.nombre, visita.nombre)})`
											: 'Todavía no hay resultado oficial'}
									</dd>
								</div>
								<div>
									<dt>Puntos</dt>
									<dd>{selection.puntosObtenidos ?? '-'}</dd>
								</div>
							</dl>
						</li>
					);
				})}
			</ol>

			<p className={styles.actions}>
				<Link className={styles.button} to="/apuestas">
					Seguir apostando
				</Link>
			</p>
		</section>
	);
}
