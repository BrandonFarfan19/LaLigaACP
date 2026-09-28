import { type FormEvent, type RefObject, useCallback, useEffect, useRef, useState } from 'react';
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
import TextField from '../../components/TextField';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import { useArrivalFocus, useKept } from '../../hooks/useKept';
import { useSession } from '../../hooks/useSession';
import { type ActionOutcome, intOf, jsonBody, parseFilters, perform, refused } from '../../lib/admin-core';
import { loadAdmin, pageInRange, skipPageFix, usePageUrlFix } from '../../lib/admin-load';
import { countParticipants, listParticipants, PARTICIPANT_FILTERS, participantAction, resetParticipantPassword } from '../../lib/admin-pool';
import { checkNewPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/auth-rules';
import type { AdminParticipant, ParticipantAction } from '../../types/admin';
import { formatDateOnly } from '../../utils/format-date';
import shared from '../Apuestas.module.css';
import styles from './Admin.module.css';

const PATH = '/admin/participantes';

/** `/admin/participantes` (T-21, BR-006, BR-007): participants only, never admins (BR-001). */
export async function loader(args: LoaderFunctionArgs) {
	const { filters, problems } = parseFilters(new URL(args.request.url).searchParams, PARTICIPANT_FILTERS);
	let pageFixed = false;
	const load = await loadAdmin(args, 'los inscritos', async (signal) => {
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

/** C-08: the intent of a password reset. */
const RESET = 'restablecer_contrasena';

/** How many sessions a reset closed, in words. */
function closedSessionsText(count: number): string {
	if (count === 0) return 'no tenía sesiones abiertas';
	return count === 1 ? 'se cerró su sesión abierta' : `se cerraron sus ${count} sesiones abiertas`;
}

/**
 * C-08 (D-037): the admin's new password for a participant. Checked here with
 * the registration rule (C-01) before calling the API, which checks it again.
 * No outcome ever carries it: neither the refusal nor the success message.
 */
async function resetPassword(id: number, body: Record<string, unknown>): Promise<ActionOutcome> {
	const contrasena = typeof body.contrasena === 'string' ? body.contrasena : '';
	const problem = checkNewPassword(contrasena);
	if (problem) return refused(RESET, String(id), 'Revisa la contraseña nueva.', { contrasena: problem });
	return perform(
		RESET,
		String(id),
		() => resetParticipantPassword(id, contrasena),
		({ participante: p, sesionesCerradas }) =>
			`La contraseña de ${p.nombre} se cambió y ${closedSessionsText(sesionesCerradas)}: tendrá que ingresar con la nueva. Comunícasela tú; la app no se la envía.`,
	);
}

/** BR-006: confirm the payment, revert it or validate, one participant at a time. The backend checks the order. C-08: reset the password. */
export async function action({ request }: ActionFunctionArgs): Promise<ActionOutcome> {
	const body = await jsonBody(request);
	const intent = String(body.intent ?? '');
	const id = intOf(body.id);
	if (intent === RESET && id) return resetPassword(id, body);
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
	useDocumentTitle('Inscritos · Administración · La Liga ACP');
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
	// The password form that sent the last reset (C-08): a refusal on its field focuses the field.
	const resetForm = useRef<HTMLElement | null>(null);
	useOutcomeFocus(writer.data, resetForm, messageRef);
	// The participant whose password form is open (C-08), one at a time. It goes in a row of its own
	// under theirs, the whole width of the table: in the stacked phone table a cell leaves it 128 px.
	const [resettingId, setResettingId] = useState<number | null>(null);
	const closeReset = useCallback((restoreFocus: boolean) => {
		setResettingId((id) => {
			// After a success the message takes the focus (useOutcomeFocus); after "Cancelar" the opener gets it back.
			if (restoreFocus && id !== null) setTimeout(() => document.getElementById(resetOpenerId(id))?.focus(), 0);
			return null;
		});
	}, []);
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
		{
			header: 'Acciones',
			cell: (p) => (
				<ParticipantActions
					participant={p}
					writer={writer}
					resetting={resettingId === p.id}
					onReset={() => setResettingId((id) => (id === p.id ? null : p.id))}
				/>
			),
		},
	];

	return (
		<section className={styles.page} aria-labelledby="participants-title">
			<header className={shared.head}>
				<p className={shared.kicker}>Administración</p>
				<h1 className={shared.title} id="participants-title">
					Inscritos
				</h1>
				<p className={shared.lead}>
					Primero confirma el pago y después valida: al validar, el inscrito recibe sus 10 monedas una sola vez. La validación no se
					deshace. Si alguien olvidó su contraseña, puedes escribirle una nueva: se cierran sus sesiones y tú se la comunicas. Los roles no
					se cambian desde aquí.
				</p>
			</header>

			<div ref={noticeRef} tabIndex={-1}>
				<LoadNotice message={load.loadError} stale={Boolean(data)} />
			</div>

			{data && (
				<dl className={styles.stats}>
					<Stat label="Total" value={data.conteos.inscritos} />
					<Stat label="Validados" value={data.conteos.validados} />
					<Stat label="Pendientes" value={data.conteos.pendientes} />
				</dl>
			)}

			<FilterForm path={PATH} fields={FIELDS} values={load.filters} label="Filtrar inscritos" />
			<FilterProblems problems={load.problems} />

			<ActionMessage ref={messageRef} outcome={writer.data} />

			{page && (
				<>
					<p className={`${styles.muted} ${styles.focusable}`} ref={countRef} tabIndex={-1}>
						{page.total === 0
							? 'No hay inscritos con esos filtros.'
							: `${page.total} ${page.total === 1 ? 'inscrito' : 'inscritos'}.${page.totalPages > 1 ? ` Página ${Math.min(load.filters.page, page.totalPages)} de ${page.totalPages}.` : ''}`}
					</p>
					{page.items.length > 0 && (
						<DataTable
							caption="Inscritos"
							columns={columns}
							rows={page.items}
							rowKey={(p) => p.id}
							extraRow={(p) =>
								resettingId === p.id ? <PasswordReset participant={p} writer={writer} resetForm={resetForm} onClose={closeReset} /> : null
							}
						/>
					)}
					<Pager path={PATH} filters={load.filters} page={load.filters.page} totalPages={page.totalPages} label="Páginas de inscritos" />
				</>
			)}
		</section>
	);
}

/** The "Restablecer contraseña" button of a row, and the form it opens (C-08). */
const resetOpenerId = (id: number) => `restablecer-${id}`;
const resetFormId = (id: number) => `restablecer-form-${id}`;

interface RowActionsProps {
	participant: AdminParticipant;
	writer: FetcherWithComponents<ActionOutcome>;
	/** Whether this participant's password form is open. */
	resetting: boolean;
	onReset: () => void;
}

/** The actions a participant's state allows (§23), each with its explicit step, and the password reset (C-08) for anyone. */
function ParticipantActions({ participant: p, writer, resetting, onReset }: RowActionsProps) {
	const sending = writer.state !== 'idle' ? (writer.json as { id?: unknown; intent?: unknown } | undefined) : undefined;
	const busy = sending?.id === p.id && sending.intent !== RESET;
	const run = (intent: ParticipantAction) => {
		if (writer.state === 'idle') writer.submit({ intent, id: p.id }, { method: 'post', encType: 'application/json' });
	};
	const validated = p.estadoValidacion === 'validado';
	const paid = p.estadoPago === 'confirmado';

	return (
		<div className={styles.cellActions}>
			{validated && <span className={styles.muted}>Ya está validado: no le quedan pasos.</span>}
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
			{/* The form opens in the row under this one; the button stays, and says whether it is open. */}
			<button
				id={resetOpenerId(p.id)}
				type="button"
				className={styles.plain}
				aria-expanded={resetting}
				aria-controls={resetting ? resetFormId(p.id) : undefined}
				onClick={onReset}
			>
				Restablecer contraseña
			</button>
		</div>
	);
}

/**
 * C-08 (D-037): the admin types the participant's new password. It lives only
 * in this form's state while it is open: never in the URL, a message or
 * storage. The length is checked before the explicit step sends it (6 to 20
 * characters, C-01, with no `maxLength` that would cut it silently); the
 * backend checks it again. A success closes the form, which empties it.
 */
interface PasswordResetProps {
	participant: AdminParticipant;
	writer: FetcherWithComponents<ActionOutcome>;
	/** The page's record of the form that sent the last reset, so a refusal focuses its field. */
	resetForm: RefObject<HTMLElement | null>;
	onClose: (restoreFocus: boolean) => void;
}

function PasswordReset({ participant: p, writer, resetForm, onClose }: PasswordResetProps) {
	const target = String(p.id);
	const [password, setPassword] = useState('');
	const [visible, setVisible] = useState(false);
	const [localError, setLocalError] = useState<string>();
	const formRef = useRef<HTMLFormElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	// Only what happened while this form is open: an older outcome of the same row stays unsaid.
	const initial = useRef(writer.data);
	const outcome = writer.data !== initial.current && writer.data?.intent === RESET && writer.data.target === target ? writer.data : null;
	// A refusal's field error stays until the password is edited.
	const [edited, setEdited] = useState(false);
	const [seen, setSeen] = useState(outcome);
	if (outcome !== seen) {
		setSeen(outcome);
		setEdited(false);
	}
	useEffect(() => {
		if (!outcome?.ok) return;
		setPassword('');
		onClose(false);
	}, [outcome, onClose]);
	useEffect(() => {
		// Opening moves the focus to the field: the button that opened it stays in its own cell.
		inputRef.current?.focus();
		const form = formRef.current;
		return () => {
			if (resetForm.current === form) resetForm.current = null;
		};
	}, [resetForm]);

	const sending = writer.state !== 'idle' ? (writer.json as { id?: unknown; intent?: unknown } | undefined) : undefined;
	const busy = sending?.id === p.id && sending.intent === RESET;
	const error = localError ?? (!edited && outcome && !outcome.ok ? outcome.fields.contrasena : undefined);

	/** Only the length is checked here; true when it can be sent. */
	const check = () => {
		const problem = checkNewPassword(password);
		setLocalError(problem);
		if (problem) inputRef.current?.focus();
		return !problem;
	};
	const send = () => {
		if (writer.state !== 'idle' || !check()) return;
		resetForm.current = formRef.current;
		writer.submit({ intent: RESET, id: p.id, contrasena: password }, { method: 'post', encType: 'application/json' });
	};

	return (
		<form
			ref={formRef}
			id={resetFormId(p.id)}
			className={styles.resetForm}
			noValidate
			aria-label={`Contraseña nueva de ${p.nombre}`}
			onSubmit={(event: FormEvent<HTMLFormElement>) => {
				event.preventDefault();
				check();
			}}
		>
			<TextField
				ref={inputRef}
				label="Contraseña nueva"
				name="contrasena"
				type={visible ? 'text' : 'password'}
				autoComplete="new-password"
				autoCapitalize="none"
				autoCorrect="off"
				spellCheck={false}
				value={password}
				onChange={(event) => {
					setPassword(event.target.value);
					setLocalError(undefined);
					setEdited(true);
				}}
				hint={`De ${PASSWORD_MIN_LENGTH} a ${PASSWORD_MAX_LENGTH} caracteres, sin más reglas. Algunos emoji, como una familia o una bandera, cuentan más de uno.`}
				error={error}
			/>
			<label className={styles.check}>
				<input type="checkbox" checked={visible} onChange={(event) => setVisible(event.target.checked)} />
				Mostrar la contraseña
			</label>
			{/* The whole password, in lines, to check it: a one-line field can't show 20 wide glyphs at 320 px.
			    Hidden from screen readers, which already read the field as text while it is shown. */}
			{visible && password !== '' && (
				<p className={styles.revealed} aria-hidden="true" data-testid="contrasena-visible">
					{password}
				</p>
			)}
			<div className={styles.actions}>
				<ConfirmStep trigger="Cambiar contraseña" tone="plain" title={`¿Cambiar la contraseña de ${p.nombre}?`} confirmLabel="Sí, cambiarla" busy={busy} onConfirm={send}>
					Se cerrarán todas sus sesiones abiertas y tendrá que ingresar con la contraseña nueva. Comunícasela tú: la app no se la envía.
				</ConfirmStep>
				<button type="button" className={styles.plain} onClick={() => onClose(true)}>
					Cancelar
				</button>
			</div>
		</form>
	);
}
