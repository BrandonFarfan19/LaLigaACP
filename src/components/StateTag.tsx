import { SELECTION_STATE_LABEL, TICKET_STATE_LABEL } from '../lib/betting-labels';
import type { SelectionState, TicketState } from '../types/betting';
import PixelIcon, { type PixelIconName } from './PixelIcon';
import styles from './StateTag.module.css';

type State = SelectionState | TicketState;

const ICON: Record<State, PixelIconName> = {
	pendiente: 'espera',
	acertada: 'finalizado',
	no_acertada: 'fallo',
	anulada: 'cancelado',
	finalizado: 'finalizado',
	anulado: 'cancelado',
};

/**
 * A selection's or a ticket's state (BR-025, BR-027) as a pixel tag: an icon
 * and its word, so it never depends on the color alone.
 */
export default function StateTag({ state, kind }: { state: State; kind: 'seleccion' | 'ticket' }) {
	const label = kind === 'ticket' ? TICKET_STATE_LABEL[state as TicketState] : SELECTION_STATE_LABEL[state as SelectionState];
	return (
		<span className={styles.tag} data-estado={state}>
			<PixelIcon name={ICON[state]} />
			{label}
		</span>
	);
}
