import { useRef } from 'react';
import { type ActionFunctionArgs, type LoaderFunctionArgs, useFetcher, useLoaderData } from 'react-router';
import { ActionMessage, ConfirmStep, LoadNotice, useOutcomeFocus } from '../../components/admin/AdminUi';
import TextField from '../../components/TextField';
import { useCrtHole } from '../../hooks/useCrtHole';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { type ActionOutcome, jsonBody, perform, refused } from '../../lib/admin-core';
import { loadAdmin } from '../../lib/admin-load';
import { getAdminLiveStream, removeLiveStream, saveLiveStream } from '../../lib/live-stream';
import { PLAYER_ALLOW, PLAYER_SANDBOX } from '../EnVivo';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';
import { leagueDateTime } from './Partidos';

/**
 * `/admin/transmision` (C-14, D-043): the link of the site's live stream, a
 * public Facebook video. The backend validates and normalizes it (and never
 * visits it); the preview plays the `embedUrl` the API answered, never an
 * address built here. Saving and removing are audited by the backend.
 */

const SAVE = 'guardar';
const REMOVE = 'quitar';
const TARGET = 'transmision';

export async function loader(args: LoaderFunctionArgs) {
	return loadAdmin(args, 'la transmisión', (signal) => getAdminLiveStream(signal));
}

export async function action({ request }: ActionFunctionArgs): Promise<ActionOutcome> {
	const body = await jsonBody(request);
	const intent = String(body.intent ?? '');
	if (intent === REMOVE) {
		return perform(REMOVE, TARGET, () => removeLiveStream(), () => 'Se quitó la transmisión: la página «En vivo» dice que no hay ninguna.');
	}
	if (intent !== SAVE) return refused(intent, TARGET, 'Acción desconocida.');
	const url = typeof body.url === 'string' ? body.url.trim() : '';
	// Empty is not «quitar»: that has its own button and its own step.
	if (!url) return refused(SAVE, TARGET, 'Revisa los campos marcados.', { url: 'Pega el link del video en vivo de Facebook.' });
	return perform(SAVE, TARGET, () => saveLiveStream(url), () => 'La transmisión quedó publicada en la página «En vivo».');
}

export default function Transmision() {
	useDocumentTitle('Transmisión · Administración · La Liga ACP');
	const { user } = useSession();
	const load = useLoaderData<typeof loader>();
	const stream = useKept(load.data);
	const writer = useFetcher<ActionOutcome>({ key: TARGET });
	const outcome = writer.data;
	const busy = writer.state !== 'idle';
	const formRef = useRef<HTMLFormElement>(null);
	const messageRef = useRef<HTMLParagraphElement>(null);
	useOutcomeFocus(outcome, formRef, messageRef);
	// The site's scanlines never draw over the preview (C-14 fix).
	const previewRef = useRef<HTMLIFrameElement>(null);
	useCrtHole(previewRef, Boolean(user?.rol === 'admin' && stream?.url && stream.embedUrl));
	if (user?.rol !== 'admin') return null;

	const fields = outcome && !outcome.ok ? outcome.fields : {};
	const submit = (intent: string, extra: Record<string, string> = {}) => {
		if (writer.state === 'idle') writer.submit({ intent, ...extra }, { method: 'post', encType: 'application/json' });
	};

	return (
		<section className={styles.page} aria-labelledby="stream-admin-title">
			<header className={shared.head}>
				<p className={shared.kicker}>Administración</p>
				<h1 className={shared.title} id="stream-admin-title">
					Transmisión en vivo
				</h1>
				<p className={shared.lead}>
					El video de Facebook que muestra la página «En vivo». Tiene que ser una publicación pública (con el globo gris). En la publicación del
					video en vivo, copia su enlace y pégalo aquí; cada transmisión tiene su propio enlace, así que hay que cambiarlo en cada una.
				</p>
			</header>

			<LoadNotice message={load.loadError} stale={Boolean(stream)} />

			{stream && (
				<>
					<div className={`${styles.section} pixel-box`}>
						<h2 className={styles.sectionTitle}>Ahora</h2>
						{stream.url && stream.embedUrl ? (
							<>
								<p className={styles.text}>
									Publicada el {stream.actualizadoEn ? leagueDateTime(stream.actualizadoEn) : '—'} (hora de Lima).
								</p>
								<iframe
									ref={previewRef}
									className={styles.video}
									src={stream.embedUrl}
									title="Vista previa de la transmisión (Facebook)"
									sandbox={PLAYER_SANDBOX}
									allow={PLAYER_ALLOW}
									allowFullScreen
									referrerPolicy="strict-origin-when-cross-origin"
									loading="lazy"
								/>
								<p className={styles.text}>
									<a className={shared.textLink} href={stream.url} target="_blank" rel="noopener noreferrer">
										Abrir la transmisión en Facebook
									</a>
								</p>
							</>
						) : (
							<p className={styles.text}>No hay transmisión: la página «En vivo» dice que no hay ninguna en este momento.</p>
						)}
					</div>

					<ActionMessage ref={messageRef} outcome={outcome} />

					<form
						ref={formRef}
						className={`${styles.section} ${styles.form} pixel-box`}
						aria-label="Link de la transmisión"
						noValidate
						onSubmit={(event) => {
							event.preventDefault();
							submit(SAVE, { url: String(new FormData(event.currentTarget).get('url') ?? '') });
						}}
					>
						<h2 className={`${styles.sectionTitle} ${styles.formWide}`}>{stream.url ? 'Cambiar el link' : 'Poner el link'}</h2>
						<div className={styles.formWide}>
							<TextField
								// A saved link refills the field with the form the backend stored.
								key={stream.url ?? 'sin-transmision'}
								label="Link del video de Facebook"
								name="url"
								type="url"
								inputMode="url"
								autoComplete="off"
								spellCheck={false}
								defaultValue={stream.url ?? ''}
								placeholder="https://www.facebook.com/…/videos/…"
								hint="Con el en vivo al aire y la publicación pública, ábrelo en Facebook y copia el link de la barra de direcciones del navegador: https://www.facebook.com/<página>/videos/<número>, …/watch/?v=<número> o …/reel/<número>. Los links para compartir (fb.watch o …/share/…) no sirven. Cada transmisión tiene su propio link."
								error={fields.url}
							/>
						</div>
						<div className={styles.actions}>
							<button type="submit" className={shared.button} aria-disabled={busy || undefined}>
								{busy && writer.formData ? 'Guardando…' : 'Guardar'}
							</button>
							{stream.url && (
								<ConfirmStep
									trigger="Quitar"
									title="¿Quitar la transmisión?"
									confirmLabel="Sí, quitar"
									busy={busy}
									onConfirm={() => submit(REMOVE)}
								>
									La página «En vivo» dirá que no hay transmisión en este momento. Se puede volver a poner un link cuando quieras.
								</ConfirmStep>
							)}
						</div>
					</form>
				</>
			)}
		</section>
	);
}
