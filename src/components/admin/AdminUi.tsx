import { type FormEvent, forwardRef, type ReactNode, type RefObject, type SelectHTMLAttributes, useEffect, useId, useRef, useState } from 'react';
import { Link, useRevalidator } from 'react-router';
import { useRememberedNavigate } from '../../hooks/useRequestedPath';
import { type ActionOutcome, type FilterValues, searchOf } from '../../lib/admin-core';
import shared from '../../pages/Apuestas.module.css';
import styles from '../../pages/admin/Admin.module.css';
import TextField from '../TextField';
import fieldStyles from '../TextField.module.css';
import { SearchSelect, type SearchSource } from './SearchSelect';

/**
 * Small pieces every admin screen uses (T-21): labelled selects and
 * checkboxes (like `TextField`), the message after an action, the explicit
 * step of an irreversible one, the notice of a failed load, pagination and a
 * table that stacks on phones.
 */

export interface Option {
	value: string;
	label: string;
}

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'className'> {
	label: string;
	name: string;
	options: readonly Option[];
	/** The first, empty option ("Todos", "Elige..."); none when missing. */
	empty?: string;
	error?: string;
	hint?: string;
}

/** A labelled pixel select whose hint and error are tied to it. */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
	{ label, name, options, empty, error, hint, ...select },
	ref,
) {
	const id = useId();
	const hintId = hint ? `${id}-hint` : undefined;
	const errorId = error ? `${id}-error` : undefined;
	return (
		<div className={fieldStyles.field}>
			<label className={fieldStyles.label} htmlFor={id}>
				{label}
			</label>
			{hint && (
				<p className={fieldStyles.hint} id={hintId}>
					{hint}
				</p>
			)}
			<select
				{...select}
				ref={ref}
				id={id}
				name={name}
				className={styles.select}
				aria-invalid={error ? true : undefined}
				aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
			>
				{empty !== undefined && <option value="">{empty}</option>}
				{options.map((option) => (
					<option key={option.value} value={option.value}>
						{option.label}
					</option>
				))}
			</select>
			{error && (
				<p className={fieldStyles.error} id={errorId}>
					<span aria-hidden="true">! </span>
					{error}
				</p>
			)}
		</div>
	);
});

/** A labelled checkbox, 44px tall. */
export function CheckField({ label, name, defaultChecked, error }: { label: string; name: string; defaultChecked?: boolean; error?: string }) {
	const id = useId();
	return (
		<div className={fieldStyles.field}>
			<label className={styles.check} htmlFor={id}>
				<input
					id={id}
					type="checkbox"
					name={name}
					defaultChecked={defaultChecked}
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? `${id}-error` : undefined}
				/>
				{label}
			</label>
			{error && (
				<p className={fieldStyles.error} id={`${id}-error`}>
					<span aria-hidden="true">! </span>
					{error}
				</p>
			)}
		</div>
	);
}

/**
 * How an action went. Focusable (the form moves the focus here when no field
 * is to blame), announced as a status or, for a refusal, as an alert.
 */
export const ActionMessage = forwardRef<HTMLParagraphElement, { outcome: ActionOutcome | null | undefined }>(function ActionMessage({ outcome }, ref) {
	if (!outcome) return null;
	return (
		<p ref={ref} tabIndex={-1} className={styles.message} data-ok={outcome.ok || undefined} role={outcome.ok ? 'status' : 'alert'}>
			<strong>{outcome.ok ? 'Listo: ' : 'No se pudo: '}</strong>
			{outcome.message}
		</p>
	);
});

/**
 * After a submit: the first invalid field takes the focus or, if no field is
 * to blame, the message; a success message takes it too, since the form that
 * had it may be gone.
 */
export function useOutcomeFocus(outcome: ActionOutcome | null | undefined, form: RefObject<HTMLElement | null>, message: RefObject<HTMLElement | null>) {
	useEffect(() => {
		if (!outcome) return;
		const invalid = outcome.ok ? null : form.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
		(invalid ?? message.current)?.focus();
	}, [outcome, form, message]);
}

interface ConfirmStepProps {
	/** The button that opens the step ("Borrar", "Cancelar partido"...). */
	trigger: string;
	title: string;
	children: ReactNode;
	/** The button that does it ("Sí, borrar"). */
	confirmLabel: string;
	onConfirm: () => void;
	busy?: boolean;
	/** The trigger's look: `danger` for the irreversible ones. */
	tone?: 'danger' | 'plain';
	disabled?: boolean;
}

/**
 * The explicit step of an irreversible action: the trigger opens a box that
 * says what will happen, with the button that does it and one to go back. The
 * focus moves into the box, and back to the trigger when it closes.
 */
export function ConfirmStep({ trigger, title, children, confirmLabel, onConfirm, busy = false, tone = 'danger', disabled = false }: ConfirmStepProps) {
	const [open, setOpen] = useState(false);
	const box = useRef<HTMLDivElement>(null);
	const opener = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	useEffect(() => {
		if (open) box.current?.focus();
	}, [open]);
	if (!open) {
		return (
			<button ref={opener} type="button" className={tone === 'danger' ? styles.danger : styles.plain} onClick={() => setOpen(true)} disabled={disabled}>
				{trigger}
			</button>
		);
	}
	const close = () => {
		setOpen(false);
		setTimeout(() => opener.current?.focus(), 0);
	};
	return (
		<div ref={box} className={styles.confirm} role="group" aria-labelledby={titleId} tabIndex={-1}>
			<p className={styles.confirmTitle} id={titleId}>
				{title}
			</p>
			<div className={styles.text}>{children}</div>
			<div className={styles.actions}>
				<button
					type="button"
					className={styles.danger}
					aria-disabled={busy || undefined}
					onClick={() => {
						if (!busy) onConfirm();
					}}
				>
					{busy ? 'Procesando…' : confirmLabel}
				</button>
				<button type="button" className={styles.plain} onClick={close}>
					Volver
				</button>
			</div>
		</div>
	);
}

/** A failed load: the page keeps what it had, with the reason and "Reintentar" (T-19, T-20). */
export function LoadNotice({ message, stale }: { message: string | null; stale?: boolean }) {
	const revalidator = useRevalidator();
	const busy = revalidator.state !== 'idle';
	if (!message) return null;
	return (
		<div className={`${shared.notice} pixel-box`} role="alert">
			<p>{message}</p>
			{stale && <p>Abajo sigue lo que se cargó antes: puede no corresponder a lo elegido.</p>}
			<p>
				<button
					type="button"
					className={shared.button}
					aria-disabled={busy || undefined}
					onClick={() => {
						if (!busy) void revalidator.revalidate();
					}}
				>
					{busy ? 'Cargando…' : 'Reintentar'}
				</button>
			</p>
		</div>
	);
}

/** Problems with the page URL's filters, dropped with a notice. */
export function FilterProblems({ problems }: { problems: string[] }) {
	if (problems.length === 0) return null;
	return (
		<div role="status">
			{problems.map((problem) => (
				<p key={problem} className={shared.error}>
					{problem}
				</p>
			))}
		</div>
	);
}

/** Navigation state of the list links: the new page moves the focus to its results. */
export const FOCUS_RESULTS = { focusResults: true };

export function Pager({ path, filters, page, totalPages, label }: { path: string; filters: FilterValues; page: number; totalPages: number; label: string }) {
	if (totalPages <= 1) return null;
	const current = Math.min(page, totalPages);
	return (
		<nav className={styles.pagination} aria-label={label}>
			{current > 1 ? (
				<Link className={shared.button} to={`${path}${searchOf({ ...filters, page: current - 1 })}`} state={FOCUS_RESULTS}>
					&lt; Anterior
				</Link>
			) : (
				<span />
			)}
			<p className={styles.muted}>
				Página {current} de {totalPages}
			</p>
			{current < totalPages ? (
				<Link className={shared.button} to={`${path}${searchOf({ ...filters, page: current + 1 })}`} state={FOCUS_RESULTS}>
					Siguiente &gt;
				</Link>
			) : (
				<span />
			)}
		</nav>
	);
}

export interface Column<T> {
	header: string;
	cell: (row: T) => ReactNode;
}

/**
 * A table that stacks into cards on phones (each cell shows its heading) and
 * is a real grid from 48rem. The roles are explicit, so the stacked layout
 * keeps its table semantics for screen readers.
 */
export function DataTable<T>({
	caption,
	columns,
	rows,
	rowKey,
	extraRow,
}: {
	caption: string;
	columns: Column<T>[];
	rows: T[];
	rowKey: (row: T) => string | number;
	/** Something shown under a row (an edit form), spanning every column. */
	extraRow?: (row: T) => ReactNode;
}) {
	return (
		<table className={styles.table} role="table">
			<caption className={styles.srOnly}>{caption}</caption>
			<thead role="rowgroup">
				<tr role="row">
					{columns.map((column) => (
						<th key={column.header} role="columnheader" scope="col">
							{column.header}
						</th>
					))}
				</tr>
			</thead>
			<tbody role="rowgroup">
				{rows.map((row) => {
					const extra = extraRow?.(row);
					return (
						<RowGroup key={rowKey(row)}>
							<tr role="row">
								{columns.map((column) => (
									<td key={column.header} role="cell" data-label={column.header}>
										<span>{column.cell(row)}</span>
									</td>
								))}
							</tr>
							{extra ? (
								<tr role="row" className={styles.editRow}>
									<td role="cell" colSpan={columns.length} data-label="">
										{extra}
									</td>
								</tr>
							) : null}
						</RowGroup>
					);
				})}
			</tbody>
		</table>
	);
}

function RowGroup({ children }: { children: ReactNode }) {
	return <>{children}</>;
}

/** A figure with its name, and an optional line under it. */
export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
	return (
		<div className={styles.stat}>
			<dt>{label}</dt>
			<dd>
				{value}
				{note && <small>{note}</small>}
			</dd>
		</div>
	);
}

export interface FilterField {
	name: string;
	label: string;
	type: 'text' | 'select' | 'date' | 'id' | 'search';
	options?: readonly Option[];
	/** The empty option of a select ("Todos"). */
	empty?: string;
	hint?: string;
	/** `search`: where its options come from (D-019). */
	source?: SearchSource;
	/** `search`: the whole text of the value the URL already carries. */
	chosen?: string;
}

/**
 * The filters of an admin list, written to the page URL (the API's own
 * names). "Filtrar" moves the focus to the results; "Quitar filtros" too. Two
 * dates the wrong way round are announced and take the focus to the field
 * (T-21 fix), instead of only being written next to it.
 */
export function FilterForm({ path, fields, values, label }: { path: string; fields: readonly FilterField[]; values: FilterValues; label: string }) {
	const navigate = useRememberedNavigate();
	const [error, setError] = useState<string | null>(null);
	const formRef = useRef<HTMLFormElement>(null);
	const active = fields.some((field) => values[field.name] !== undefined);
	const onSubmit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const form = new FormData(event.currentTarget);
		const next: Partial<FilterValues> = {};
		for (const field of fields) {
			const value = String(form.get(field.name) ?? '').trim();
			if (value) next[field.name] = value;
		}
		if (typeof next.desde === 'string' && typeof next.hasta === 'string' && next.desde > next.hasta) {
			setError('La fecha "desde" no puede ser posterior a "hasta".');
			setTimeout(() => formRef.current?.querySelector<HTMLElement>('[name="hasta"]')?.focus(), 0);
			return;
		}
		setError(null);
		navigate(`${path}${searchOf(next)}`, { state: FOCUS_RESULTS });
	};
	return (
		<form ref={formRef} className={`${shared.filters} pixel-box`} onSubmit={onSubmit} aria-label={label} noValidate key={searchOf({ ...values, page: 1 })}>
			{error && (
				<p className={`${shared.error} ${styles.formWide}`} role="alert">
					<span aria-hidden="true">! </span>
					{error}
				</p>
			)}
			{fields.map((field) =>
				field.type === 'search' ? (
					<div className={shared.field} key={field.name}>
						<SearchSelect
							label={field.label}
							name={field.name}
							search={field.source!}
							defaultValue={values[field.name] === undefined ? '' : String(values[field.name])}
							defaultLabel={field.chosen ?? ''}
							hint={field.hint}
						/>
					</div>
				) : field.type === 'select' ? (
					<div className={shared.field} key={field.name}>
						<SelectField
							label={field.label}
							name={field.name}
							options={field.options ?? []}
							empty={field.empty ?? 'Todos'}
							defaultValue={values[field.name] === undefined ? '' : String(values[field.name])}
							hint={field.hint}
						/>
					</div>
				) : (
					<div className={shared.field} key={field.name}>
						<TextField
							label={field.label}
							name={field.name}
							type={field.type === 'date' ? 'date' : field.type === 'id' ? 'number' : 'search'}
							inputMode={field.type === 'id' ? 'numeric' : undefined}
							min={field.type === 'id' ? 1 : undefined}
							defaultValue={values[field.name] === undefined ? '' : String(values[field.name])}
							hint={field.hint}
							error={field.name === 'hasta' && error ? error : undefined}
						/>
					</div>
				),
			)}
			<div className={shared.filterActions}>
				<button type="submit" className={shared.button}>
					Filtrar
				</button>
				{active && (
					<Link className={shared.textLink} to={path} state={FOCUS_RESULTS}>
						Quitar filtros
					</Link>
				)}
			</div>
		</form>
	);
}
