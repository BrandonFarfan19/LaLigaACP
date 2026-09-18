import { type KeyboardEvent, useEffect, useId, useRef, useState } from 'react';
import type { Option } from './AdminUi';
import fieldStyles from '../TextField.module.css';
import styles from '../../pages/admin/Admin.module.css';

/**
 * The panel's chooser for competitions, teams, players and squads (D-019). A
 * native `select` can't do what those lists need: it only offers the options
 * already loaded (one page, so the 101st record was unreachable) and it cuts
 * long names at 320 px. This is a combobox with a listbox: it asks the API for
 * the options that match what is typed, page by page, and shows the chosen one
 * whole, in as many lines as it takes.
 *
 * Keyboard: the arrows move through the options, Enter chooses, Escape closes
 * without changing the choice. The active option is `aria-activedescendant`
 * (the focus stays in the text field), and every load is announced.
 */

/** One page of options for what is typed. `total` counts every match, not only this page. */
export type SearchSource = (text: string, page: number, signal: AbortSignal) => Promise<{ options: Option[]; total: number; totalPages: number }>;

interface SearchSelectProps {
	label: string;
	/** The form field the chosen id travels in. */
	name: string;
	search: SearchSource;
	/** The chosen id when the screen opens (''). */
	defaultValue?: string;
	/** Its full text, so the choice reads without another call. */
	defaultLabel?: string;
	/** Changes with what the choice depends on (the competition of a team): the search starts over. */
	scope?: string;
	hint?: string;
	error?: string;
	/** Told when the choice changes (the teams of a competition follow it). */
	onChoose?: (value: string, label: string) => void;
	/** Why there is nothing to choose yet ("Elige antes la competición"). */
	blocked?: string;
}

const DEBOUNCE_MS = 250;
/** Longest search the API takes (`q`), counted in code points: the field stops there. */
export const MAX_SEARCH = 100;

/** Cuts by code point, never in the middle of an emoji (the same rule as the audit detail). */
export const cutSearch = (text: string) => [...text].slice(0, MAX_SEARCH).join('');

export function SearchSelect({ label, name, search, defaultValue = '', defaultLabel = '', scope = '', hint, error, onChoose, blocked }: SearchSelectProps) {
	const id = useId();
	const listId = `${id}-list`;
	const [value, setValue] = useState(defaultValue);
	const [chosen, setChosen] = useState(defaultLabel);
	const [text, setText] = useState('');
	const [open, setOpen] = useState(false);
	const [options, setOptions] = useState<Option[]>([]);
	const [page, setPage] = useState(1);
	const [pages, setPages] = useState(1);
	const [total, setTotal] = useState(0);
	const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
	const [active, setActive] = useState(-1);
	const input = useRef<HTMLInputElement>(null);
	const box = useRef<HTMLDivElement>(null);
	// Which search the answer belongs to: a slower earlier one never wins.
	const run = useRef(0);

	// A new scope (another competition, another team) drops the choice made under the old one.
	const [seenScope, setSeenScope] = useState(scope);
	if (scope !== seenScope) {
		setSeenScope(scope);
		setValue('');
		setChosen('');
		setText('');
		setOptions([]);
		setOpen(false);
		setActive(-1);
	}

	useEffect(() => {
		if (!open || blocked) return;
		const controller = new AbortController();
		const mine = ++run.current;
		setState('loading');
		const timer = setTimeout(() => {
			// Never longer than the API takes: a longer text (pasted, say) is cut here, not refused there.
			void search(cutSearch(text.trim()), page, controller.signal)
				.then((result) => {
					if (mine !== run.current) return;
					setOptions((before) => (page === 1 ? result.options : [...before, ...result.options]));
					setTotal(result.total);
					setPages(result.totalPages);
					setState('idle');
				})
				.catch(() => {
					if (mine === run.current) setState('failed');
				});
		}, page === 1 ? DEBOUNCE_MS : 0);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
		// The search function is rebuilt on every render: only what it looks for matters here.
	}, [open, text, page, scope, blocked]);

	// A click outside closes the list, like a native one.
	useEffect(() => {
		if (!open) return;
		const onPointerDown = (event: MouseEvent) => {
			if (!box.current?.contains(event.target as Node)) setOpen(false);
		};
		document.addEventListener('mousedown', onPointerDown);
		return () => document.removeEventListener('mousedown', onPointerDown);
	}, [open]);

	const startSearch = (next: string) => {
		setText(next);
		setPage(1);
		setActive(-1);
		setOpen(true);
	};

	const choose = (option: Option) => {
		setValue(option.value);
		setChosen(option.label);
		setText('');
		setOpen(false);
		setActive(-1);
		onChoose?.(option.value, option.label);
		input.current?.focus();
	};

	const clear = () => {
		setValue('');
		setChosen('');
		onChoose?.('', '');
		input.current?.focus();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (blocked) return;
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			if (!open) {
				setOpen(true);
				return;
			}
			if (options.length === 0) return;
			const step = event.key === 'ArrowDown' ? 1 : -1;
			setActive((current) => (current === -1 ? (step === 1 ? 0 : options.length - 1) : (current + step + options.length) % options.length));
		} else if (event.key === 'Enter') {
			if (open && active >= 0 && options[active]) {
				event.preventDefault();
				choose(options[active]);
			}
		} else if (event.key === 'Escape') {
			if (open) {
				event.preventDefault();
				setOpen(false);
				setActive(-1);
			}
		} else if (event.key === 'Home' && open) {
			event.preventDefault();
			setActive(0);
		} else if (event.key === 'End' && open) {
			event.preventDefault();
			setActive(options.length - 1);
		}
	};

	const hintId = hint ? `${id}-hint` : undefined;
	const errorId = error ? `${id}-error` : undefined;
	const chosenId = `${id}-chosen`;
	const message =
		state === 'failed'
			? 'No se pudieron cargar las opciones. Escribe otra vez para reintentar.'
			: state === 'loading'
				? 'Buscando opciones…'
				: total === 0
					? 'Ninguna opción coincide.'
					: `${total} ${total === 1 ? 'opción' : 'opciones'}${total > options.length ? `, se muestran ${options.length}` : ''}.`;
	// The field stops at the longest search the API takes, and says so instead of cutting in silence.
	const limitNote = [...text].length >= MAX_SEARCH ? ` La búsqueda llega hasta ${MAX_SEARCH} caracteres.` : '';

	return (
		// Leaving the whole field (Tab from the text box or from "Ver más opciones") closes the list;
		// clicking an option keeps it, because the pointer never takes the focus away.
		<div
			className={fieldStyles.field}
			ref={box}
			onBlur={(event) => {
				if (!box.current?.contains(event.relatedTarget)) {
					setOpen(false);
					setActive(-1);
				}
			}}
		>
			<label className={fieldStyles.label} htmlFor={id}>
				{label}
			</label>
			{hint && (
				<p className={fieldStyles.hint} id={hintId}>
					{hint}
				</p>
			)}
			<input type="hidden" name={name} value={value} />
			{blocked ? (
				<p className={styles.muted}>{blocked}</p>
			) : (
				<>
					<input
						ref={input}
						id={id}
						type="text"
						role="combobox"
						className={`${fieldStyles.input} pixel-box`}
						autoComplete="off"
						value={text}
						maxLength={MAX_SEARCH}
						placeholder="Escribe para buscar"
						aria-expanded={open}
						aria-controls={listId}
						aria-autocomplete="list"
						aria-activedescendant={open && active >= 0 ? `${id}-o${active}` : undefined}
						aria-invalid={error ? true : undefined}
						aria-describedby={[hintId, errorId, chosenId].filter(Boolean).join(' ')}
						onChange={(event) => startSearch(event.target.value)}
						onClick={() => setOpen(true)}
						onKeyDown={onKeyDown}
					/>
					{open && (
						<div className={`${styles.comboBox} pixel-box`}>
							<p className={styles.muted} role="status">
								{message}
								{limitNote}
							</p>
							{/* Never a stop of its own with Tab: a scrollable box takes the focus in some browsers,
						    and then leaving the field would not close the list. */}
						<ul className={styles.comboList} id={listId} role="listbox" aria-label={label} tabIndex={-1}>
								{options.map((option, index) => (
									<li
										key={option.value}
										id={`${id}-o${index}`}
										role="option"
										aria-selected={option.value === value}
										className={styles.comboOption}
										data-active={index === active || undefined}
										// The focus stays in the text field: the pointer must not take it away.
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => choose(option)}
									>
										{option.label}
									</li>
								))}
							</ul>
							{page < pages && (
								<button type="button" className={styles.plain} onClick={() => setPage(page + 1)}>
									Ver más opciones
								</button>
							)}
						</div>
					)}
				</>
			)}
			<p className={styles.chosen} id={chosenId}>
				{chosen ? (
					<>
						<span>
							Elegido: <strong>{chosen}</strong>
						</span>
						<button type="button" className={styles.plain} onClick={clear}>
							Quitar
						</button>
					</>
				) : (
					<span>Sin elegir.</span>
				)}
			</p>
			{error && (
				<p className={fieldStyles.error} id={errorId}>
					<span aria-hidden="true">! </span>
					{error}
				</p>
			)}
		</div>
	);
}
