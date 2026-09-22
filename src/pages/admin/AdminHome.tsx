import { Link, type LoaderFunctionArgs, useLoaderData } from 'react-router';
import { LoadNotice, Stat } from '../../components/admin/AdminUi';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { loadAdmin } from '../../lib/admin-load';
import { countParticipants, getPoolStats } from '../../lib/admin-pool';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';

/** `/admin` (T-21): the pool at a glance (BR-001: participants signed up and validated, the pool's figures). */
export function loader(args: LoaderFunctionArgs) {
	return loadAdmin(args, 'el resumen', async (signal) => {
		const [conteos, estadisticas] = await Promise.all([countParticipants(signal), getPoolStats(signal)]);
		return { conteos, estadisticas };
	});
}

const coins = (n: number) => `${n} ${n === 1 ? 'moneda' : 'monedas'}`;
/** "1 pendiente", "2 pendientes", "0 no acertadas": every word here takes an s. */
const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export default function AdminHome() {
	useDocumentTitle('Administración · La Liga ACP');
	const { user } = useSession();
	const load = useLoaderData<typeof loader>();
	const data = useKept(load.data);
	if (user?.rol !== 'admin') return null;
	const stats = data?.estadisticas;
	const counts = data?.conteos;

	return (
		<section className={styles.page} aria-labelledby="admin-title">
			<header className={shared.head}>
				<p className={shared.kicker}>Administrador</p>
				<h1 className={shared.title} id="admin-title">
					Resumen
				</h1>
				<p className={shared.lead}>
					Hola, {user.nombre}. Valida participantes, administra los partidos y sus resultados, y consulta la polla. Los administradores no
					participan: estas cifras cuentan solo a los participantes.
				</p>
			</header>

			<LoadNotice message={load.loadError} stale={Boolean(data)} />

			{counts && (
				<section className={`${styles.section} pixel-box`} aria-labelledby="counts-title">
					<h2 className={styles.sectionTitle} id="counts-title">
						Participantes
					</h2>
					<dl className={styles.stats}>
						<Stat label="Inscritos" value={counts.inscritos} />
						<Stat label="Validados" value={counts.validados} />
						<Stat label="Pendientes" value={counts.pendientes} />
						<Stat label="Pagos confirmados" value={counts.pagosConfirmados} />
						<Stat label="Pagos pendientes" value={counts.pagosPendientes} />
					</dl>
					<p>
						<Link className={shared.textLink} to="/admin/participantes?estadoValidacion=pendiente">
							Ver los pendientes de validación
						</Link>
					</p>
				</section>
			)}

			{stats && (
				<section className={`${styles.section} pixel-box`} aria-labelledby="stats-title">
					<h2 className={styles.sectionTitle} id="stats-title">
						Estadísticas de la polla
					</h2>
					<dl className={styles.stats}>
						<Stat
							label="Tickets"
							value={stats.tickets.total}
							note={[count(stats.tickets.pendiente, 'pendiente'), count(stats.tickets.finalizado, 'finalizado'), count(stats.tickets.anulado, 'anulado')].join(' · ')}
						/>
						<Stat
							label="Selecciones"
							value={stats.selecciones.total}
							note={[
								count(stats.selecciones.pendiente, 'pendiente'),
								count(stats.selecciones.acertada, 'acertada'),
								count(stats.selecciones.no_acertada, 'no acertada'),
								count(stats.selecciones.anulada, 'anulada'),
							].join(' · ')}
						/>
						<Stat label="Monedas usadas" value={coins(stats.monedasUtilizadas)} />
						<Stat label="Monedas devueltas" value={coins(stats.monedasDevueltas)} />
						<Stat label="Monedas disponibles" value={coins(stats.monedasDisponibles)} note="Suma de los saldos de los participantes." />
						<Stat label="Puntos" value={stats.puntos} />
						<Stat label="Aciertos" value={stats.aciertos} />
					</dl>
					<p>
						<Link className={shared.textLink} to="/admin/ranking">
							Ver el ranking completo
						</Link>
					</p>
				</section>
			)}
		</section>
	);
}
