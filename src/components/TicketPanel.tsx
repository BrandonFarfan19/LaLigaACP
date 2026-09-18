import { useEffect, useId, useRef, useState } from 'react';
import { BET_TYPE_LABEL, coinsText, forecastLabel, forecastValue } from '../lib/betting-labels';
import { MAX_SELECTIONS } from '../lib/betting';
import { type DraftSelection, repeatOf } from '../lib/ticket-draft';
import type { SelectionProblem, TicketEvaluation } from '../types/betting';
import { formatKickoff } from '../utils/format-date';
import PixelIcon from './PixelIcon';
import styles from './TicketPanel.module.css';

export interface TicketPanelProps {
	items: DraftSelection[];
	/** The latest preview of exactly these items (BR-023), or `null` while it loads or failed. */
	evaluation: TicketEvaluation | null;
	/** The preview is being requested. */
	previewing: boolean;
	/** Why the preview couldn't be read. */
	previewError: string | null;
	/** Positions (from 0) of selections that aren't valid, so nothing was sent. */
	invalidItems?: readonly number[];
	/** The balance known from the session, until the preview says. */
	balance: number;
	confirming: boolean;
	/** The last confirmation's failure, for the whole ticket. */
	confirmError: string | null;
	/** Something the screen reader should hear about the ticket (added, removed...). */
	announcement: string;
	onRemove: (id: string) => void;
	onClear: () => void;
	onConfirm: () => void;
}

/** "02 oct 20:00", or nothing for a date that can't be read. */
function kickoffText(iso: string): string {
	try {
		const { day, time } = formatKickoff(iso);
		return `${day} ${time}`;
	} catch {
		return '';
	}
}

const INVALID_PROBLEM: SelectionProblem = { code: 'INVALID_SELECTION', message: 'Esta selección no es válida: quítala del ticket.' };

const problemsOf = (evaluation: TicketEvaluation | null, index: number, invalid: readonly number[]): SelectionProblem[] =>
	invalid.includes(index) ? [INVALID_PROBLEM] : (evaluation?.selecciones[index]?.errores ?? []);

/**
 * The ticket being built (BR-019, BR-023, BR-024): its selections, what it
 * costs and the balance before and after, with the problems of each
 * selection. Remove one (modify), empty it (cancel) or confirm it. On phones
 * it is a bar at the bottom that opens into a panel; from 64rem it sits next
 * to the matches.
 */
export default function TicketPanel(props: TicketPanelProps) {
	const { items, evaluation, previewing, previewError, invalidItems = [], balance, confirming, confirmError, announcement, onRemove, onClear, onConfirm } = props;
	const titleId = useId();
	const panelId = useId();
	const [open, setOpen] = useState(false);
	const errorRef = useRef<HTMLDivElement>(null);
	const count = items.length;

	useEffect(() => {
		if (count === 0) setOpen(false);
	}, [count]);

	useEffect(() => {
		if (confirmError) {
			setOpen(true);
			errorRef.current?.focus();
		}
	}, [confirmError]);

	const cost = evaluation?.costoTotal ?? null;
	const after = evaluation?.saldoPosterior ?? null;
	const current = evaluation?.saldoActual ?? balance;
	const ticketProblems = evaluation?.errores ?? [];
	const invalid = evaluation ? !evaluation.valido : false;
	const canConfirm = count > 0 && !!evaluation && evaluation.valido && !previewing && !confirming;
	const blockedReason =
		count === 0
			? 'Agrega al menos una selección.'
			: previewing || (!evaluation && !previewError)
				? 'Calculando el resumen…'
				: previewError
					? previewError
					: invalid
						? evaluation!.selecciones.every((selection) => selection.valida)
							? 'Tu saldo no alcanza: quita selecciones para confirmar.'
							: 'Corrige las selecciones marcadas antes de confirmar.'
						: null;

	return (
		<aside className={styles.panel} aria-labelledby={titleId} data-open={open || undefined}>
			{/* Announced changes: added, removed, emptied, preview problems. */}
			<p className={styles.live} role="status" aria-live="polite">
				{announcement}
			</p>

			<div className={`${styles.bar} pixel-box`}>
				<h2 className={styles.title} id={titleId}>
					Tu ticket
				</h2>
				<p className={styles.summary}>
					{count} {count === 1 ? 'selección' : 'selecciones'}
					{cost !== null && ` · ${coinsText(cost)}`}
				</p>
				<button
					type="button"
					className={styles.toggle}
					aria-expanded={open}
					aria-controls={panelId}
					onClick={() => setOpen((value) => !value)}
				>
					{open ? 'Ocultar' : 'Ver ticket'}
				</button>
			</div>

			<div className={`${styles.body} pixel-box`} id={panelId}>
				{count === 0 ? (
					<p className={styles.empty}>Elige un resultado o un marcador en un partido disponible para armar tu ticket.</p>
				) : (
					<ol className={styles.list}>
						{items.map((item, index) => {
							const problems = problemsOf(evaluation, index, invalidItems);
							const repeated = repeatOf(items, index);
							const kickoff = kickoffText(item.match.fechaHora);
							return (
								<li key={item.id} className={styles.item} data-invalid={problems.length > 0 || undefined}>
									<div className={styles.itemText}>
										<p className={styles.match}>
											{index + 1}. {item.match.local} vs {item.match.visita}
										</p>
										<p className={styles.small}>
											{item.match.competicion}
											{kickoff && ` · ${kickoff}`}
										</p>
										<p>
											{BET_TYPE_LABEL[item.input.tipo]}: <strong>{forecastValue(item.input, item.match.local, item.match.visita)}</strong>
										</p>
										<p className={styles.small}>{coinsText(evaluation?.selecciones[index]?.costo ?? evaluation?.costoPorSeleccion ?? 1)}</p>
										{repeated !== null && <p className={styles.tag}>Repetida (igual a la {repeated + 1})</p>}
										{problems.map((problem, i) => (
											<p key={`${problem.code}-${i}`} className={styles.problem}>
												<PixelIcon name="alerta" /> {problem.message}
											</p>
										))}
									</div>
									<button
										type="button"
										className={styles.remove}
										onClick={() => onRemove(item.id)}
										aria-label={`Quitar la selección ${index + 1}: ${item.match.local} vs ${item.match.visita}, ${forecastLabel(item.input, item.match.local, item.match.visita)}`}
									>
										Quitar
									</button>
								</li>
							);
						})}
					</ol>
				)}

				<dl className={styles.totals}>
					<div>
						<dt>Selecciones</dt>
						<dd>
							{count} de {MAX_SELECTIONS}
						</dd>
					</div>
					<div>
						<dt>Costo total</dt>
						<dd>{cost === null ? (count ? '…' : coinsText(0)) : coinsText(cost)}</dd>
					</div>
					<div>
						<dt>Saldo actual</dt>
						<dd>{coinsText(current)}</dd>
					</div>
					<div>
						<dt>Saldo después</dt>
						<dd data-negative={after !== null && after < 0 ? true : undefined}>{after === null ? (count ? '…' : coinsText(current)) : coinsText(after)}</dd>
					</div>
				</dl>

				{ticketProblems.map((problem, i) => (
					<p key={`${problem.code}-${i}`} className={styles.problem}>
						<PixelIcon name="alerta" /> {problem.message}
					</p>
				))}

				{confirmError && (
					<div className={`${styles.alert} pixel-box`} role="alert" tabIndex={-1} ref={errorRef}>
						{confirmError}
					</div>
				)}

				{blockedReason && count > 0 && <p className={styles.small}>{blockedReason}</p>}

				<div className={styles.actions}>
					<button type="button" className={styles.secondary} onClick={onClear} disabled={count === 0 || confirming}>
						Vaciar ticket
					</button>
					<button type="button" className={styles.primary} onClick={onConfirm} disabled={!canConfirm} aria-busy={confirming || undefined}>
						{confirming ? 'Confirmando…' : `Confirmar${cost !== null ? ` (${coinsText(cost)})` : ''}`}
					</button>
				</div>
				<p className={styles.small}>Confirmar descuenta las monedas y crea el ticket. Un ticket confirmado no se puede modificar.</p>
			</div>
		</aside>
	);
}
