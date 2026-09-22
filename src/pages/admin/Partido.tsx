import { createContext, type FormEvent, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
	type ActionFunctionArgs,
	data as routeData,
	Link,
	type LoaderFunctionArgs,
	type ShouldRevalidateFunctionArgs,
	useFetcher,
	useLoaderData,
} from 'react-router';
import { ActionMessage, ConfirmStep, LoadNotice, type Option, Stat, useOutcomeFocus } from '../../components/admin/AdminUi';
import { SearchSelect } from '../../components/admin/SearchSelect';
import TextField from '../../components/TextField';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { ApiError } from '../../lib/api';
import {
	type ActionOutcome,
	deOf,
	intOf,
	isoFromLeagueInput,
	jsonBody,
	leagueInputOf,
	perform,
	refused,
	textOf,
} from '../../lib/admin-core';
import {
	addMatchImage,
	addMatchVideo,
	adminImageSrc,
	cancelMatch,
	catalogOptions,
	confirmResult,
	createGoal,
	deleteGoal,
	deleteMatch,
	deleteMedia,
	getCancellationPreview,
	getMatch,
	getResultPreview,
	listGoals,
	listMedia,
	removeGoalImage,
	removeGoalVideo,
	safeEmbedUrl,
	setGoalImage,
	setGoalVideo,
	setResult,
	updateGoal,
	updateMatch,
} from '../../lib/admin-catalog';
import { useRememberedNavigate } from '../../hooks/useRequestedPath';
import { fixedSource } from '../../lib/admin-choices';
import { loadAdmin } from '../../lib/admin-load';
import { resultLabel } from '../../lib/betting-labels';
import { positiveInt } from '../../lib/betting';
import type { AdminEnrollment, AdminGoal, AdminMatch, CancellationPreview, MatchMedia, ResultPreview, VideoLink } from '../../types/admin';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';
import { competitionName, leagueDateTime, MATCH_STATE_LABEL, MATCH_STATE_TONE, MatchFields } from './Partidos';

/**
 * `/admin/partidos/:id` (T-21): one match, all it takes. Its data (BR-011),
 * its result with the preview and the explicit confirmation (BR-028 to
 * BR-032), its goals with their scorers and media (BR-033), the match's own
 * media (BR-001) and its cancellation (BR-045 to BR-047). The backend decides
 * what each state allows; the page explains it and shows the backend's reason
 * when it refuses.
 */

/** Largest upload the backend takes (UPLOAD_MAX_BYTES): checked here only to say it sooner. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** A form file (by shape: a file from another realm, as in tests, isn't `instanceof File` here). */
const isFile = (value: unknown): value is File =>
	typeof value === 'object' && value !== null && typeof (value as File).size === 'number' && typeof (value as File).name === 'string';

const IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';

export async function loader(args: LoaderFunctionArgs) {
	const id = positiveInt(args.params.id ?? '', Number.MAX_SAFE_INTEGER);
	if (!id) throw routeData(null, { status: 404 });
	return loadAdmin(args, 'el partido', async (signal) => {
		let partido: AdminMatch;
		try {
			partido = await getMatch(id, signal);
		} catch (error) {
			if (error instanceof ApiError && (error.status === 404 || error.status === 400)) throw routeData(null, { status: 404 });
			throw error;
		}
		// A team's squad is bounded (one shirt number each, 1 to 99), so it fits in one page.
		const [preview, goles, multimedia, cancelacion, plantelLocal, plantelVisita] = await Promise.all([
			getResultPreview(id, signal),
			listGoals(id, signal),
			listMedia(id, signal),
			getCancellationPreview(id, signal),
			catalogOptions('planteles', { equipoId: partido.local.equipoId }, signal),
			catalogOptions('planteles', { equipoId: partido.visita.equipoId }, signal),
		]);
		return { partido, preview, goles, multimedia, cancelacion, planteles: { local: plantelLocal, visita: plantelVisita } };
	});
}

type Data = NonNullable<Awaited<ReturnType<typeof loader>>['data']>;

/** A deleted match is gone: its page isn't read again (the screen goes back to the list). */
export function shouldRevalidate({ actionResult, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs): boolean {
	const outcome = actionResult as ActionOutcome | undefined;
	if (outcome?.intent === 'deleteMatch' && outcome.ok) return false;
	return defaultShouldRevalidate;
}

const n = (value: unknown) => intOf(value) ?? value;

const videoMessage = (video: VideoLink | null) => (video ? `Video de ${video.plataforma === 'youtube' ? 'YouTube' : 'Vimeo'} guardado.` : 'Video quitado.');

/** "1 apuesta", "3 apuestas": a count with the form that fits it. */
const count = (many: number, one: string, other: string) => `${many} ${many === 1 ? one : other}`;

export async function action({ request, params }: ActionFunctionArgs): Promise<ActionOutcome> {
	const id = positiveInt(params.id ?? '', Number.MAX_SAFE_INTEGER);
	if (!id) return refused('', '', 'Partido desconocido.');

	// An image upload (multipart): the file goes to the API as it is.
	if ((request.headers.get('Content-Type') ?? '').startsWith('multipart/form-data')) {
		const form = await request.formData();
		const intent = String(form.get('intent') ?? '');
		const file = form.get('imagen');
		const target = String(form.get('target') ?? '');
		// The form already checked that a file was chosen and its size; the backend checks its content, size and pixels.
		if (!isFile(file)) return refused(intent, target, 'Elige una imagen.', { imagen: 'Elige un archivo de imagen.' });
		if (intent === 'goalImage') {
			const golId = intOf(form.get('golId'));
			if (!golId) return refused(intent, target, 'Gol desconocido.');
			return perform(intent, target, () => setGoalImage(id, golId, file), () => 'Imagen del gol guardada.');
		}
		if (intent === 'addImage') return perform(intent, target, () => addMatchImage(id, file), () => 'Imagen agregada al partido.');
		return refused(intent, target, 'Acción desconocida.');
	}

	const body = await jsonBody(request);
	const intent = String(body.intent ?? '');
	const target = String(body.target ?? intent);
	const golId = intOf(body.golId);
	switch (intent) {
		case 'updateMatch': {
			const patch: Record<string, unknown> = {};
			for (const key of ['competicionId', 'localId', 'visitaId', 'jornada'] as const) {
				if (body[key] !== undefined && body[key] !== '') patch[key] = n(body[key]);
			}
			if (typeof body.sede === 'string') patch.sede = body.sede.trim();
			if (typeof body.fecha === 'string') {
				const fechaHora = isoFromLeagueInput(body.fecha);
				if (!fechaHora) return refused(intent, target, 'Revisa los campos marcados.', { fechaHora: 'Elige una fecha y hora válidas (hora de Lima).' });
				patch.fechaHora = fechaHora;
			}
			return perform(intent, target, () => updateMatch(id, patch), () => 'Se guardaron los datos del partido.');
		}
		case 'deleteMatch':
			return perform(intent, target, () => deleteMatch(id), () => 'Se borró el partido.');
		case 'setResult':
			return perform(intent, target, () => setResult(id, n(body.golesLocal ?? ''), n(body.golesVisitante ?? '')), (m) => `Marcador cargado: ${m.local.goles} - ${m.visita.goles}. Todavía no es público: confírmalo cuando termine el partido.`);
		case 'confirmResult': {
			const local = intOf(body.golesLocal);
			const visita = intOf(body.golesVisitante);
			if (local === undefined || visita === undefined) return refused(intent, target, 'Falta el marcador que revisaste.');
			return perform(intent, target, () => confirmResult(id, local, visita), () => `Resultado confirmado: ${local} - ${visita}. El partido quedó finalizado y sus apuestas se liquidaron.`);
		}
		case 'createGoal':
			return perform(intent, target, () => createGoal(id, { jugadorId: n(body.jugadorId ?? ''), equipoId: n(body.equipoId ?? ''), minuto: n(body.minuto ?? '') }), (g) => `Gol de ${g.jugador.nombre} (minuto ${g.minuto}) registrado.`);
		case 'updateGoal': {
			if (!golId) return refused(intent, target, 'Gol desconocido.');
			const patch: Record<string, unknown> = {};
			for (const key of ['jugadorId', 'equipoId', 'minuto'] as const) {
				if (body[key] !== undefined && body[key] !== '') patch[key] = n(body[key]);
			}
			return perform(intent, target, () => updateGoal(id, golId, patch), (g) => `Gol de ${g.jugador.nombre} (minuto ${g.minuto}) guardado.`);
		}
		case 'deleteGoal':
			if (!golId) return refused(intent, target, 'Gol desconocido.');
			return perform(intent, target, () => deleteGoal(id, golId), () => 'Gol borrado.');
		case 'removeGoalImage':
			if (!golId) return refused(intent, target, 'Gol desconocido.');
			return perform(intent, target, () => removeGoalImage(id, golId), () => 'Imagen del gol quitada.');
		case 'goalVideo':
			if (!golId) return refused(intent, target, 'Gol desconocido.');
			return perform(intent, target, () => setGoalVideo(id, golId, textOf(body.url) ?? ''), (g) => videoMessage(g.video));
		case 'removeGoalVideo':
			if (!golId) return refused(intent, target, 'Gol desconocido.');
			return perform(intent, target, () => removeGoalVideo(id, golId), () => 'Video del gol quitado.');
		case 'addVideo':
			return perform(intent, target, () => addMatchVideo(id, textOf(body.url) ?? ''), (v) => videoMessage(v.video));
		case 'deleteMedia': {
			const mediaId = intOf(body.mediaId);
			if (!mediaId) return refused(intent, target, 'Elemento desconocido.');
			return perform(intent, target, () => deleteMedia(id, mediaId), () => 'Se quitó del partido.');
		}
		case 'cancel':
			return perform(intent, target, () => cancelMatch(id), (r) => `Partido cancelado: se ${r.selecciones === 1 ? 'anuló' : 'anularon'} ${count(r.selecciones, 'apuesta', 'apuestas')} y se ${r.monedasDevueltas === 1 ? 'devolvió' : 'devolvieron'} ${count(r.monedasDevueltas, 'moneda', 'monedas')}.`);
		default:
			return refused(intent, target, 'Acción desconocida.');
	}
}

/**
 * Which form of the page was used last. The page has many forms and each one
 * keeps its own answer; only the one just used says anything, so an older
 * message never sits next to a different form (T-21 fix).
 */
const LastForm = createContext<{ shown: string; show: (key: string) => void }>({ shown: '', show: () => undefined });

interface Writer {
	state: 'idle' | 'loading' | 'submitting';
	/** Its outcome, only while this is the form last used. */
	data: ActionOutcome | undefined;
	json: unknown;
	submit: (value: FormData | Record<string, unknown>, options?: { method: 'post'; encType: 'multipart/form-data' }) => void;
}

/** One fetcher per form of the page: keyed, so its message survives the reload that follows a write. */
function useWriter(key: string, id: number): Writer {
	const fetcher = useFetcher<ActionOutcome>({ key: `partido-${id}-${key}` });
	const { shown, show } = useContext(LastForm);
	return {
		state: fetcher.state,
		data: shown === key ? fetcher.data : undefined,
		json: fetcher.json,
		submit: (value, options) => {
			show(key);
			fetcher.submit(value as never, options ?? { method: 'post', encType: 'application/json' });
		},
	};
}

function submitJson(writer: Writer, body: Record<string, unknown>) {
	if (writer.state === 'idle') writer.submit(body);
}

export default function Partido() {
	const { user } = useSession();
	const load = useLoaderData<typeof loader>();
	const data = useKept(load.data);
	const title = data ? `${data.partido.local.nombre} vs ${data.partido.visita.nombre}` : 'Partido';
	useDocumentTitle(`${title} · Administración · La Liga ACP`);
	const [shown, setShown] = useState('');
	const lastForm = useMemo(() => ({ shown, show: setShown }), [shown]);
	if (user?.rol !== 'admin') return null;

	return (
		<LastForm.Provider value={lastForm}>
			<section className={styles.page} aria-labelledby="match-title">
				<header className={shared.head}>
					<p className={shared.kicker}>
						<Link className={shared.textLink} to="/admin/partidos">
							&lt; Partidos
						</Link>
					</p>
					<h1 className={shared.title} id="match-title">
						{title}
					</h1>
					{data && (
						<p className={shared.lead}>
							{competitionName(data.partido)} · jornada {data.partido.jornada} · {leagueDateTime(data.partido.fechaHora)} (hora de Lima) ·{' '}
							{data.partido.sede}
						</p>
					)}
				</header>

				<LoadNotice message={load.loadError} stale={Boolean(data)} />

				{data && (
					<>
						<MatchData data={data} />
						<ResultSection data={data} />
						<GoalsSection data={data} />
						<MediaSection id={data.partido.id} media={data.multimedia} estado={data.partido.estado} />
						<CancelSection id={data.partido.id} preview={data.cancelacion} />
					</>
				)}
			</section>
		</LastForm.Provider>
	);
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
	return (
		<section className={`${styles.section} pixel-box`} aria-labelledby={id}>
			<h2 className={styles.sectionTitle} id={id}>
				{title}
			</h2>
			{children}
		</section>
	);
}

const STATE_NOTE: Record<AdminMatch['estado'], string> = {
	programado: 'Todavía no empezó: se puede editar todo (con apuestas, solo postergar). Empieza solo a su hora.',
	en_curso: 'Ya empezó: se cargan el marcador, los goles y la multimedia. No se posterga ni cambia de equipos. El resultado se confirma pasados 60 minutos.',
	finalizado: 'Resultado confirmado: el partido quedó bloqueado. Solo se agregan o quitan imágenes y videos.',
	cancelado: 'Cancelado: es definitivo. No admite cambios, resultado, goles ni multimedia nueva.',
};

function MatchData({ data }: { data: Data }) {
	const { partido } = data;
	const writer = useWriter('datos', partido.id);
	const deleter = useWriter('borrar', partido.id);
	const navigate = useRememberedNavigate();
	const formRef = useRef<HTMLFormElement>(null);
	const messageRef = useRef<HTMLParagraphElement>(null);
	const deleteRef = useRef<HTMLParagraphElement>(null);
	const noForm = useRef<HTMLElement>(null);
	useOutcomeFocus(writer.data, formRef, messageRef);
	useOutcomeFocus(deleter.data?.ok ? null : deleter.data, noForm, deleteRef);
	useEffect(() => {
		if (deleter.data?.ok) {
			navigate('/admin/partidos', { replace: true, state: { deleted: `Se borró el partido ${partido.local.nombre} vs ${partido.visita.nombre}.`, focusResults: true } });
		}
	}, [deleter.data]);
	const locked = partido.estado === 'finalizado' || partido.estado === 'cancelado';
	const started = partido.estado !== 'programado';
	const bets = data.preview.seleccionesPendientes > 0 || data.cancelacion.selecciones > 0;
	const errors = writer.data && !writer.data.ok ? writer.data.fields : {};
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const body: Record<string, unknown> = { intent: 'updateMatch', target: 'datos' };
		for (const [key, value] of form.entries()) body[key] = String(value);
		// Only what changed: unchanged competition and teams aren't sent (with bets they can't be).
		if (body.competicionId === String(partido.competicionId) && body.localId === String(partido.local.equipoId) && body.visitaId === String(partido.visita.equipoId)) {
			delete body.competicionId;
			delete body.localId;
			delete body.visitaId;
		}
		if (body.fecha === leagueInputOf(partido.fechaHora)) delete body.fecha;
		submitJson(writer, body);
	};

	return (
		<Section id="match-data" title="Datos del partido">
			<dl className={`${styles.stats} ${styles.statsWide}`}>
				<Stat
					label="Estado"
					value={
						<span className={styles.tag} data-tone={MATCH_STATE_TONE[partido.estado]}>
							{MATCH_STATE_LABEL[partido.estado]}
						</span>
					}
				/>
				<Stat label="Inicio (Lima)" value={leagueDateTime(partido.fechaHora)} />
				<Stat label="Cierre de apuestas" value={leagueDateTime(partido.cierreApuestas)} note="24 horas antes del inicio." />
			</dl>
			<p className={styles.muted}>{STATE_NOTE[partido.estado]}</p>

			{!locked && (
				<form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate aria-label="Editar el partido">
					<MatchFields
						errors={errors}
						initial={{
							competicionId: partido.competicionId,
							competicion: competitionName(partido),
							localId: partido.local.equipoId,
							local: partido.local.nombre,
							visitaId: partido.visita.equipoId,
							visita: partido.visita.nombre,
							jornada: partido.jornada,
							fecha: leagueInputOf(partido.fechaHora),
							sede: partido.sede,
						}}
						lockTeams={
							started
								? `Competición y equipos: ${partido.local.nombre} vs ${partido.visita.nombre}. No cambian porque el partido ya empezó.`
								: bets
									? `Competición y equipos: ${partido.local.nombre} vs ${partido.visita.nombre}. No cambian porque el partido tiene apuestas.`
									: undefined
						}
						lockDate={started ? `Fecha: ${leagueDateTime(partido.fechaHora)}. No se posterga un partido que ya empezó.` : undefined}
					/>
					{!started && bets && <p className={`${styles.muted} ${styles.formWide}`}>Con apuestas, la fecha solo puede postergarse.</p>}
					<div className={styles.actions}>
						<button type="submit" className={shared.button} aria-disabled={writer.state !== 'idle' || undefined}>
							{writer.state !== 'idle' ? 'Guardando…' : 'Guardar datos'}
						</button>
					</div>
				</form>
			)}
			<ActionMessage ref={messageRef} outcome={writer.data} />

			{(partido.estado === 'programado' || partido.estado === 'cancelado') && (
				<div className={styles.actions}>
					<ConfirmStep
						trigger="Borrar partido"
						title="¿Borrar este partido?"
						confirmLabel="Sí, borrar"
						busy={deleter.state !== 'idle'}
						onConfirm={() => submitJson(deleter, { intent: 'deleteMatch', target: 'borrar' })}
					>
						{partido.estado === 'cancelado'
							? 'Solo se borra un partido cancelado si no tiene apuestas, goles, resultado ni multimedia. La cancelación ya quedó registrada en la auditoría.'
							: 'Solo se borra un partido sin apuestas, goles, resultado ni multimedia. Si tiene apuestas y no se jugará, cancélalo.'}
					</ConfirmStep>
				</div>
			)}
			<ActionMessage ref={deleteRef} outcome={deleter.data?.ok ? null : deleter.data} />
		</Section>
	);
}

function ResultSection({ data }: { data: Data }) {
	const { partido, preview } = data;
	const loader = useWriter('marcador', partido.id);
	const confirmer = useWriter('confirmar', partido.id);
	const formRef = useRef<HTMLFormElement>(null);
	const messageRef = useRef<HTMLParagraphElement>(null);
	const confirmRef = useRef<HTMLParagraphElement>(null);
	const noForm = useRef<HTMLElement>(null);
	useOutcomeFocus(loader.data, formRef, messageRef);
	useOutcomeFocus(confirmer.data, noForm, confirmRef);
	const errors = loader.data && !loader.data.ok ? loader.data.fields : {};
	const canLoad = partido.estado === 'en_curso';
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		submitJson(loader, { intent: 'setResult', target: 'marcador', golesLocal: String(form.get('golesLocal') ?? '').trim(), golesVisitante: String(form.get('golesVisitante') ?? '').trim() });
	};
	const marcador = preview.marcador;
	const local = partido.local.nombre;
	const visita = partido.visita.nombre;

	return (
		<Section id="match-result" title="Resultado">
			<dl className={`${styles.stats} ${styles.statsWide}`}>
				<Stat label="Marcador cargado" value={marcador ? <span className={styles.score}>{`${marcador.golesLocal} - ${marcador.golesVisitante}`}</span> : 'Sin cargar'} note={partido.estado === 'finalizado' ? 'Confirmado y público.' : 'Privado hasta confirmarlo.'} />
				<Stat label="Ganador" value={preview.resultado ? resultLabel(preview.resultado, local, visita) : '—'} />
				<Stat label="Apuestas a liquidar" value={preview.seleccionesPendientes} />
				<Stat label="Se confirma desde" value={leagueDateTime(preview.confirmableDesde)} note="60 minutos después del inicio." />
			</dl>

			{preview.goles.length > 0 && (
				<>
					<p className={styles.text}>Goles con autor:</p>
					<ul className={styles.detailList}>
						{preview.goles.map((g) => (
							<li key={g.id} className={styles.muted}>
								{g.minuto}′ {g.jugador.nombre} ({g.equipoId === partido.local.equipoId ? local : visita})
							</li>
						))}
					</ul>
				</>
			)}
			{preview.avisos.map((a) => (
				<p key={a.code} className={styles.muted}>
					Aviso: {a.message}
				</p>
			))}

			{canLoad && (
				<form ref={formRef} className={styles.form} onSubmit={onSubmit} noValidate aria-label="Cargar el marcador">
					<TextField label={`Goles de ${local}`} name="golesLocal" type="number" inputMode="numeric" min={0} max={999} defaultValue={partido.local.goles ?? ''} error={errors.golesLocal} />
					<TextField label={`Goles de ${visita}`} name="golesVisitante" type="number" inputMode="numeric" min={0} max={999} defaultValue={partido.visita.goles ?? ''} error={errors.golesVisitante} />
					<div className={styles.actions}>
						<button type="submit" className={shared.button} aria-disabled={loader.state !== 'idle' || undefined}>
							{loader.state !== 'idle' ? 'Guardando…' : marcador ? 'Corregir marcador' : 'Cargar marcador'}
						</button>
					</div>
				</form>
			)}
			{partido.estado === 'programado' && <p className={styles.muted}>El marcador se carga desde la hora de inicio.</p>}
			<ActionMessage ref={messageRef} outcome={loader.data} />

			{partido.estado === 'en_curso' && (
				<>
					{preview.problemas.map((p) => (
						<p key={p.code} className={shared.error}>
							Todavía no se puede confirmar: {p.message}
						</p>
					))}
					<div className={styles.actions}>
						<ConfirmStep
							trigger="Confirmar resultado"
							title="Confirmación definitiva del resultado"
							confirmLabel={marcador ? `Sí, confirmar ${marcador.golesLocal} - ${marcador.golesVisitante}` : 'Sí, confirmar'}
							busy={confirmer.state !== 'idle'}
							disabled={!preview.puedeConfirmar || !marcador}
							onConfirm={() =>
								marcador &&
								submitJson(confirmer, { intent: 'confirmResult', target: 'confirmar', golesLocal: marcador.golesLocal, golesVisitante: marcador.golesVisitante })
							}
						>
							<p>
								Vas a confirmar {local} {marcador?.golesLocal} - {marcador?.golesVisitante} {visita} (
								{preview.resultado ? resultLabel(preview.resultado, local, visita) : 'sin resultado'}).
							</p>
							<p>
								{preview.seleccionesPendientes === 1
									? 'Se liquidará 1 apuesta.'
									: `Se liquidarán ${preview.seleccionesPendientes} apuestas.`}
							</p>
							<p>
								<strong>{preview.advertencia}</strong>
							</p>
						</ConfirmStep>
					</div>
				</>
			)}
			<ActionMessage ref={confirmRef} outcome={confirmer.data} />
		</Section>
	);
}

function GoalsSection({ data }: { data: Data }) {
	const { partido } = data;
	const canEdit = partido.estado === 'en_curso';
	const canMedia = partido.estado === 'en_curso' || partido.estado === 'finalizado';
	const lister = useWriter('goles', partido.id);
	const listRef = useRef<HTMLParagraphElement>(null);
	const noForm = useRef<HTMLElement>(null);
	// Deleting a goal removes its row: the message is told here.
	const rowOutcome = lister.data;
	useOutcomeFocus(rowOutcome, noForm, listRef);

	return (
		<Section id="match-goals" title="Goles">
			<p className={styles.muted}>
				Jugador del plantel de su equipo, minuto de 1 a 120, y nunca más goles con autor que los del marcador de ese equipo.
				{canEdit ? '' : partido.estado === 'programado' ? ' Se registran desde la hora de inicio.' : ' Los goles quedaron fijos; solo su imagen y su video pueden cambiar.'}
			</p>
			{data.goles.length === 0 ? (
				<p className={styles.text}>Todavía no hay goles registrados.</p>
			) : (
				<ul className={styles.list}>
					{data.goles.map((goal) => (
						<li key={goal.id} className={styles.item}>
							<GoalItem data={data} goal={goal} canEdit={canEdit} canMedia={canMedia} deleter={lister} />
						</li>
					))}
				</ul>
			)}
			<ActionMessage ref={listRef} outcome={rowOutcome} />
			{canEdit && <GoalForm data={data} />}
		</Section>
	);
}

const sideOptions = (partido: AdminMatch): Option[] => [
	{ value: String(partido.local.equipoId), label: `${partido.local.nombre} (local)` },
	{ value: String(partido.visita.equipoId), label: `${partido.visita.nombre} (visita)` },
];

function squadOf(data: Data, equipoId: string): AdminEnrollment[] {
	if (equipoId === String(data.partido.local.equipoId)) return data.planteles.local;
	if (equipoId === String(data.partido.visita.equipoId)) return data.planteles.visita;
	return [];
}

/**
 * Team and player. Both lists are bounded (two teams, and a squad of at most
 * 99 because the shirt numbers go from 1 to 99), but their names can be long:
 * they use the same searchable chooser, so the chosen one reads whole at
 * 320 px (D-019, D-014).
 */
function ScorerFields({ data, errors, initial }: { data: Data; errors: Record<string, string>; initial?: AdminGoal }) {
	const [team, setTeam] = useState(initial ? String(initial.equipoId) : '');
	const sides = sideOptions(data.partido);
	const players: Option[] = squadOf(data, team).map((p) => ({ value: String(p.jugadorId), label: `${p.jugadorNombre} (camiseta ${p.numeroCamiseta})` }));
	const sameTeam = initial && String(initial.equipoId) === team;
	return (
		<>
			<SearchSelect
				label="Equipo"
				name="equipoId"
				search={fixedSource(sides)}
				defaultValue={team}
				defaultLabel={sides.find((side) => side.value === team)?.label ?? ''}
				onChoose={setTeam}
				error={errors.equipoId}
			/>
			<SearchSelect
				label="Jugador"
				name="jugadorId"
				search={fixedSource(players)}
				scope={team}
				blocked={team ? (players.length ? undefined : 'Ese equipo no tiene jugadores inscritos.') : 'Elige antes el equipo.'}
				defaultValue={sameTeam ? String(initial.jugador.id) : ''}
				defaultLabel={sameTeam ? (players.find((p) => p.value === String(initial.jugador.id))?.label ?? initial.jugador.nombre) : ''}
				error={errors.jugadorId}
			/>
			<TextField label="Minuto" name="minuto" type="number" inputMode="numeric" min={1} max={120} defaultValue={initial?.minuto ?? ''} error={errors.minuto} hint="De 1 a 120." />
		</>
	);
}

function GoalForm({ data }: { data: Data }) {
	const writer = useWriter('gol-nuevo', data.partido.id);
	const formRef = useRef<HTMLFormElement>(null);
	const messageRef = useRef<HTMLParagraphElement>(null);
	useOutcomeFocus(writer.data, formRef, messageRef);
	const [formKey, setFormKey] = useState(0);
	const [seen, setSeen] = useState(writer.data);
	if (writer.data !== seen) {
		setSeen(writer.data);
		if (writer.data?.ok) setFormKey((k) => k + 1);
	}
	const errors = writer.data && !writer.data.ok ? writer.data.fields : {};
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		submitJson(writer, { intent: 'createGoal', target: 'gol-nuevo', equipoId: String(form.get('equipoId') ?? ''), jugadorId: String(form.get('jugadorId') ?? ''), minuto: String(form.get('minuto') ?? '').trim() });
	};
	return (
		<>
			<form ref={formRef} key={formKey} className={styles.form} onSubmit={onSubmit} noValidate aria-label="Registrar un gol">
				<ScorerFields data={data} errors={errors} />
				<div className={styles.actions}>
					<button type="submit" className={shared.button} aria-disabled={writer.state !== 'idle' || undefined}>
						{writer.state !== 'idle' ? 'Registrando…' : 'Registrar gol'}
					</button>
				</div>
			</form>
			<ActionMessage ref={messageRef} outcome={writer.data} />
		</>
	);
}

function GoalItem({ data, goal, canEdit, canMedia, deleter }: { data: Data; goal: AdminGoal; canEdit: boolean; canMedia: boolean; deleter: Writer }) {
	const { partido } = data;
	const [editing, setEditing] = useState(false);
	const editor = useWriter(`gol-${goal.id}`, partido.id);
	const media = useWriter(`gol-${goal.id}-media`, partido.id);
	const formRef = useRef<HTMLFormElement>(null);
	const messageRef = useRef<HTMLParagraphElement>(null);
	const mediaRef = useRef<HTMLParagraphElement>(null);
	const mediaForm = useRef<HTMLDivElement>(null);
	useOutcomeFocus(editor.data, formRef, messageRef);
	useOutcomeFocus(media.data, mediaForm, mediaRef);
	useEffect(() => {
		if (editor.data?.ok) setEditing(false);
	}, [editor.data]);
	const errors = editor.data && !editor.data.ok ? editor.data.fields : {};
	const team = goal.equipoId === partido.local.equipoId ? partido.local.nombre : partido.visita.nombre;
	const image = adminImageSrc(goal.imagen);
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		submitJson(editor, { intent: 'updateGoal', target: `gol-${goal.id}`, golId: goal.id, equipoId: String(form.get('equipoId') ?? ''), jugadorId: String(form.get('jugadorId') ?? ''), minuto: String(form.get('minuto') ?? '').trim() });
	};
	const label = `el gol de ${goal.jugador.nombre} (minuto ${goal.minuto})`;

	return (
		<div className={styles.form}>
			<p className={`${styles.text} ${styles.formWide}`}>
				<strong>{goal.minuto}′</strong> {goal.jugador.nombre} · {team}
			</p>
			{image && <img className={`${styles.thumb} ${styles.formWide}`} src={image} alt={`Imagen ${deOf(label)}`} loading="lazy" decoding="async" />}
			{goal.video && <VideoEmbed video={goal.video} title={`Video ${deOf(label)}`} />}

			{canEdit && (
				<div className={styles.actions}>
					<button type="button" className={styles.plain} aria-expanded={editing} onClick={() => setEditing(!editing)}>
						{editing ? 'Cerrar' : 'Editar gol'}
					</button>
					<ConfirmStep
						trigger="Borrar gol"
						title={`¿Borrar ${label}?`}
						confirmLabel="Sí, borrar"
						busy={deleter.state !== 'idle'}
						onConfirm={() => submitJson(deleter, { intent: 'deleteGoal', target: 'goles', golId: goal.id })}
					>
						También se borran su imagen y su video.
					</ConfirmStep>
				</div>
			)}
			{editing && (
				<form ref={formRef} className={`${styles.form} ${styles.formWide}`} onSubmit={onSubmit} noValidate aria-label={`Editar ${label}`}>
					<ScorerFields data={data} errors={errors} initial={goal} />
					<div className={styles.actions}>
						<button type="submit" className={shared.button} aria-disabled={editor.state !== 'idle' || undefined}>
							{editor.state !== 'idle' ? 'Guardando…' : 'Guardar gol'}
						</button>
					</div>
				</form>
			)}
			<div className={styles.formWide}>
				<ActionMessage ref={messageRef} outcome={editor.data} />
			</div>

			{canMedia && (
				<div ref={mediaForm} className={`${styles.form} ${styles.formWide}`}>
					<UploadForm
						writer={media}
						intent="goalImage"
						target={`gol-${goal.id}`}
						extra={{ golId: String(goal.id) }}
						label={image ? 'Reemplazar imagen del gol' : 'Imagen del gol'}
						hasFile={Boolean(image)}
						error={media.data && !media.data.ok ? media.data.fields.imagen : undefined}
					/>
					{image && (
						<div className={styles.actions}>
							{/* Removing it deletes the file from the server: explicit step (T-21 fix). */}
							<ConfirmStep
								trigger="Quitar imagen"
								title={`¿Quitar la imagen ${deOf(label)}?`}
								confirmLabel="Sí, quitar"
								busy={media.state !== 'idle'}
								onConfirm={() => submitJson(media, { intent: 'removeGoalImage', target: `gol-${goal.id}`, golId: goal.id })}
							>
								El archivo se borra del servidor. Después puedes subir otra imagen.
							</ConfirmStep>
						</div>
					)}
					<VideoForm
						writer={media}
						intent="goalVideo"
						extra={{ golId: goal.id }}
						target={`gol-${goal.id}`}
						label={goal.video ? 'Cambiar video del gol' : 'Video del gol'}
						error={media.data && !media.data.ok ? media.data.fields.url : undefined}
					/>
					{goal.video && (
						<div className={styles.actions}>
							<ConfirmStep
								trigger="Quitar video"
								title={`¿Quitar el video ${deOf(label)}?`}
								confirmLabel="Sí, quitar"
								busy={media.state !== 'idle'}
								onConfirm={() => submitJson(media, { intent: 'removeGoalVideo', target: `gol-${goal.id}`, golId: goal.id })}
							>
								Solo se quita el enlace del gol: el video sigue en su plataforma.
							</ConfirmStep>
						</div>
					)}
				</div>
			)}
			<div className={styles.formWide}>
				<ActionMessage ref={mediaRef} outcome={media.data} />
			</div>
		</div>
	);
}

/** An embedded player, only with the platform's own embed address (T-13 note). */
function VideoEmbed({ video, title }: { video: VideoLink; title: string }) {
	const src = safeEmbedUrl(video.embedUrl);
	return (
		<div className={styles.formWide}>
			{src && (
				<iframe
					className={styles.video}
					src={src}
					title={title}
					sandbox="allow-scripts allow-same-origin allow-presentation"
					referrerPolicy="strict-origin-when-cross-origin"
					allow="fullscreen"
					loading="lazy"
				/>
			)}
			<a className={shared.textLink} href={video.url} target="_blank" rel="noopener noreferrer">
				Abrir el video en {video.plataforma === 'youtube' ? 'YouTube' : 'Vimeo'}
			</a>
		</div>
	);
}

/** One image file, sent as multipart with the CSRF token (through the route action and `api.ts`). */
function UploadForm({
	writer,
	intent,
	target,
	extra = {},
	label,
	error,
	hasFile,
}: {
	writer: Writer;
	intent: string;
	target: string;
	extra?: Record<string, string>;
	label: string;
	error?: string;
	/** Whether the thing it belongs to has an image right now: losing it empties the field (T-21 fix). */
	hasFile?: boolean;
}) {
	const [key, setKey] = useState(0);
	// A missing or too big file is told here, before sending (the backend checks again).
	const [local, setLocal] = useState<string | null>(null);
	const [chosen, setChosen] = useState('');
	const input = useRef<HTMLInputElement>(null);
	const clear = () => {
		setKey((k) => k + 1);
		setChosen('');
		setLocal(null);
	};
	const [seen, setSeen] = useState(writer.data);
	if (writer.data !== seen) {
		setSeen(writer.data);
		if (writer.data?.ok) clear();
	}
	// The image was removed (or replaced elsewhere): the field stops naming a file that is gone.
	const [hadFile, setHadFile] = useState(hasFile);
	if (hasFile !== hadFile) {
		setHadFile(hasFile);
		if (chosen) clear();
	}
	const busy = writer.state !== 'idle';
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (busy) return;
		// The chosen file itself, from the field (a form's own FormData can lose it in some environments).
		const file = input.current?.files?.[0] ?? null;
		const form = new FormData();
		if (file) form.set('imagen', file);
		const problem = !isFile(file) || file.size === 0 ? 'Elige un archivo de imagen.' : file.size > MAX_UPLOAD_BYTES ? 'La imagen supera el máximo de 5 MB: elige una más liviana.' : null;
		setLocal(problem);
		if (problem) {
			setTimeout(() => input.current?.focus(), 0);
			return;
		}
		form.set('intent', intent);
		form.set('target', target);
		for (const [name, value] of Object.entries(extra)) form.set(name, value);
		writer.submit(form, { method: 'post', encType: 'multipart/form-data' });
	};
	return (
		<form key={key} className={`${styles.form} ${styles.formWide}`} onSubmit={onSubmit} noValidate aria-label={label} encType="multipart/form-data">
			{/* The system's file text is hidden (it can't wrap at 320px): the chosen name is shown below. */}
			<div className={`${styles.fileField} ${styles.formWide}`}>
				<TextField
					ref={input}
					label={label}
					name="imagen"
					type="file"
					accept={IMAGE_TYPES}
					error={local ?? error}
					hint="JPEG, PNG, WebP o GIF (nunca SVG), hasta 5 MB. Se guarda sin datos ocultos."
					onChange={(event) => {
						setLocal(null);
						setChosen(event.currentTarget.files?.[0]?.name ?? '');
					}}
				/>
				<p className={styles.muted} aria-hidden="true">
					{chosen ? `Elegido: ${chosen}` : 'Ningún archivo elegido.'}
				</p>
			</div>
			<div className={styles.actions}>
				<button type="submit" className={shared.button} aria-disabled={busy || undefined}>
					{busy ? 'Subiendo…' : 'Subir imagen'}
				</button>
			</div>
		</form>
	);
}

function VideoForm({ writer, intent, target, extra = {}, label, error }: { writer: Writer; intent: string; target: string; extra?: Record<string, unknown>; label: string; error?: string }) {
	const [key, setKey] = useState(0);
	const [seen, setSeen] = useState(writer.data);
	if (writer.data !== seen) {
		setSeen(writer.data);
		if (writer.data?.ok) setKey((k) => k + 1);
	}
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		submitJson(writer, { intent, target, ...extra, url: String(new FormData(event.currentTarget).get('url') ?? '').trim() });
	};
	return (
		<form key={key} className={`${styles.form} ${styles.formWide}`} onSubmit={onSubmit} noValidate aria-label={label}>
			<TextField label={label} name="url" type="url" inputMode="url" error={error} hint="Enlace https de YouTube o Vimeo." autoComplete="off" />
			<div className={styles.actions}>
				<button type="submit" className={shared.button} aria-disabled={writer.state !== 'idle' || undefined}>
					{writer.state !== 'idle' ? 'Guardando…' : 'Guardar video'}
				</button>
			</div>
		</form>
	);
}

function MediaSection({ id, media, estado }: { id: number; media: MatchMedia; estado: AdminMatch['estado'] }) {
	const images = useWriter('imagenes', id);
	const videos = useWriter('videos', id);
	const remover = useWriter('quitar', id);
	const imagesRef = useRef<HTMLParagraphElement>(null);
	const videosRef = useRef<HTMLParagraphElement>(null);
	const removeRef = useRef<HTMLParagraphElement>(null);
	const noForm = useRef<HTMLElement>(null);
	const imageForm = useRef<HTMLDivElement>(null);
	const videoForm = useRef<HTMLDivElement>(null);
	useOutcomeFocus(images.data, imageForm, imagesRef);
	useOutcomeFocus(videos.data, videoForm, videosRef);
	useOutcomeFocus(remover.data, noForm, removeRef);
	const canAdd = estado === 'en_curso' || estado === 'finalizado';

	return (
		<Section id="match-media" title="Imágenes y videos del partido">
			<p className={styles.muted}>
				Hasta 20 imágenes y 10 videos. {canAdd ? 'Se pueden agregar y quitar también después de confirmar el resultado.' : estado === 'programado' ? 'Se agregan desde la hora de inicio.' : 'Un partido cancelado no admite multimedia nueva.'}
			</p>
			{media.imagenes.length === 0 && media.videos.length === 0 && <p className={styles.text}>Todavía no hay imágenes ni videos.</p>}
			<ul className={styles.list}>
				{media.imagenes.map((image, index) => {
					const src = adminImageSrc(image.url);
					return (
						<li key={image.id} className={styles.item}>
							{src ? <img className={styles.thumb} src={src} alt={`Imagen ${index + 1} del partido`} loading="lazy" decoding="async" /> : <span className={styles.muted}>Imagen sin vista previa</span>}
							<ConfirmStep trigger="Quitar imagen" title={`¿Quitar la imagen ${index + 1}?`} confirmLabel="Sí, quitar" busy={remover.state !== 'idle'} onConfirm={() => submitJson(remover, { intent: 'deleteMedia', target: 'quitar', mediaId: image.id })}>
								El archivo se borra del servidor.
							</ConfirmStep>
						</li>
					);
				})}
				{media.videos.map((video, index) => (
					<li key={video.id} className={styles.item}>
						<VideoEmbed video={video.video} title={`Video ${index + 1} del partido`} />
						<ConfirmStep trigger="Quitar video" title={`¿Quitar el video ${index + 1}?`} confirmLabel="Sí, quitar" busy={remover.state !== 'idle'} onConfirm={() => submitJson(remover, { intent: 'deleteMedia', target: 'quitar', mediaId: video.id })}>
							Solo se quita el enlace del partido.
						</ConfirmStep>
					</li>
				))}
			</ul>
			<ActionMessage ref={removeRef} outcome={remover.data} />
			{canAdd && (
				<>
					<div ref={imageForm}>
						<UploadForm writer={images} intent="addImage" target="imagenes" label="Agregar imagen" error={images.data && !images.data.ok ? images.data.fields.imagen : undefined} />
					</div>
					<ActionMessage ref={imagesRef} outcome={images.data} />
					<div ref={videoForm}>
						<VideoForm writer={videos} intent="addVideo" target="videos" label="Agregar video" error={videos.data && !videos.data.ok ? videos.data.fields.url : undefined} />
					</div>
					<ActionMessage ref={videosRef} outcome={videos.data} />
				</>
			)}
		</Section>
	);
}

function CancelSection({ id, preview }: { id: number; preview: CancellationPreview }) {
	const writer = useWriter('cancelar', id);
	const messageRef = useRef<HTMLParagraphElement>(null);
	const noForm = useRef<HTMLElement>(null);
	useOutcomeFocus(writer.data, noForm, messageRef);
	const without = preview.seleccionesSinDevolucion;
	const figures = (
		<dl className={`${styles.stats} ${styles.statsWide}`}>
			<Stat label="Apuestas a anular" value={preview.selecciones} />
			<Stat label="Monedas a devolver" value={preview.monedasDevueltas} />
			<Stat label="Usuarios" value={preview.usuarios} />
			<Stat label="Tickets afectados" value={preview.tickets} note={`${count(preview.ticketsAnulados, 'quedaría anulado', 'quedarían anulados')} por completo.`} />
			{without.total > 0 && (
				<Stat
					label="Anuladas sin devolución"
					value={without.total}
					note={[without.sinDebito ? `${without.sinDebito} sin descuento registrado` : '', without.cuentaAdministrador ? `${count(without.cuentaAdministrador, 'apuesta', 'apuestas')} de una cuenta que hoy administra` : ''].filter(Boolean).join(' · ')}
				/>
			)}
		</dl>
	);

	return (
		<Section id="match-cancel" title="Cancelación">
			{preview.puedeCancelar ? (
				<>
					<p className={styles.muted}>Anula las apuestas pendientes del partido y devuelve sus monedas. Las demás apuestas de esos tickets siguen vigentes.</p>
					{figures}
					<div className={styles.actions}>
						<ConfirmStep trigger="Cancelar partido" title="Cancelación definitiva del partido" confirmLabel="Sí, cancelar el partido" busy={writer.state !== 'idle'} onConfirm={() => submitJson(writer, { intent: 'cancel', target: 'cancelar' })}>
							<p>
								{preview.selecciones === 1 ? 'Se anulará 1 apuesta' : `Se anularán ${preview.selecciones} apuestas`} y{' '}
								{preview.monedasDevueltas === 1 ? 'se devolverá 1 moneda' : `se devolverán ${preview.monedasDevueltas} monedas`}
								{preview.usuarios > 0 ? ` a ${count(preview.usuarios, 'usuario', 'usuarios')}` : ''}. Si entran apuestas mientras tanto, también se anulan.
							</p>
							<p>
								<strong>{preview.advertencia}</strong>
							</p>
						</ConfirmStep>
					</div>
				</>
			) : (
				preview.problemas.map((p) => (
					<p key={p.code} className={styles.muted}>
						{p.message}
					</p>
				))
			)}
			<ActionMessage ref={messageRef} outcome={writer.data} />
		</Section>
	);
}
