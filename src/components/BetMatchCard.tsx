import { useEffect, useId, useRef, useState } from 'react';
import { BETTING_STATE_HINT, BETTING_STATE_LABEL, resultLabel } from '../lib/betting-labels';
import { MAX_GOALS } from '../lib/betting';
import type { BettingMatch, GeneralResult, SelectionInput } from '../types/betting';
import { formatKickoff } from '../utils/format-date';
import PixelIcon from './PixelIcon';
import TeamCrest from './TeamCrest';
import styles from './BetMatchCard.module.css';

interface BetMatchCardProps {
	match: BettingMatch;
	/** Adds a selection to the ticket. Absent: this user can't bet (pending), the controls are disabled. */
	onAdd?: (input: SelectionInput) => void;
	/** Why the controls are disabled, when they are. */
	disabledReason?: string;
	/** Selections of this match already in the ticket. */
	inTicket: number;
	/** The ticket is full (50). */
	ticketFull: boolean;
}

const when = (iso: string) => {
	const { day, time } = formatKickoff(iso);
	return `${day} · ${time}`;
};

const clampGoals = (value: number) => Math.min(MAX_GOALS, Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0));

/**
 * One match of the betting list (T-19): teams, competition, kick-off and
 * betting close in the league's time, and its betting state (BR-052) with an
 * icon and a label. Only an open match shows the forecast controls: general
 * result (no draw where the sport has none, BR-015) and exact score (0 to
 * 999 per side, BR-016). Every choice adds one selection; repeats are allowed.
 */
export default function BetMatchCard({ match, onAdd, disabledReason, inTicket, ticketFull }: BetMatchCardProps) {
	const titleId = useId();
	const hintId = useId();
	const local = match.local.equipo;
	const visita = match.visita.equipo;
	const { estado, cierre, pronosticosAdmitidos } = match.apuesta;
	const open = estado === 'disponible';
	const [golesLocal, setGolesLocal] = useState(0);
	const [golesVisitante, setGolesVisitante] = useState(0);
	/** Said aloud when a goal field reaches (or is pushed against) its limit. */
	const [limitNote, setLimitNote] = useState('');
	/** The field a +/- button changed last: reaching a limit by typing stays quiet. */
	const stepped = useRef<'local' | 'visita' | null>(null);
	const say = (note: string) => {
		// The same text twice in a row isn't read again: a trailing space makes it new.
		setLimitNote((previous) => (note && previous === note ? `${note} ` : note));
	};
	const announceLimit = (label: string, value: number) =>
		say(value === 0 ? `${label}: 0 goles, el mínimo.` : value === MAX_GOALS ? `${label}: ${MAX_GOALS} goles, el máximo.` : '');
	useEffect(() => {
		if (stepped.current === 'local') announceLimit(match.local.equipo.nombre, golesLocal);
		// Only when that value changes.
	}, [golesLocal]);
	useEffect(() => {
		if (stepped.current === 'visita') announceLimit(match.visita.equipo.nombre, golesVisitante);
	}, [golesVisitante]);
	const drawBlocked = !pronosticosAdmitidos.marcadorExacto.admiteEmpate && golesLocal === golesVisitante;
	const disabled = !onAdd || ticketFull;
	const reason = !onAdd ? disabledReason : ticketFull ? 'El ticket ya tiene 50 selecciones, el máximo.' : undefined;
	const showScore = match.local.goles !== null && match.visita.goles !== null;

	const add = (input: SelectionInput) => {
		if (!disabled) onAdd?.(input);
	};
	const pick = (pronostico: GeneralResult) => add({ partidoId: match.id, tipo: 'resultado_general', pronostico });

	type Setter = (update: (current: number) => number) => void;
	const step = (team: 'local' | 'visita', label: string, value: number, set: Setter, delta: 1 | -1) => {
		stepped.current = team;
		// Pressed at the limit: nothing changes, so it is said here.
		if (clampGoals(value + delta) === value) announceLimit(label, value);
		else set((current) => clampGoals(current + delta));
	};
	const stepper = (label: string, value: number, set: Setter, team: 'local' | 'visita') => (
		<div className={styles.goals}>
			<label className={styles.goalsLabel} htmlFor={`${titleId}-${team}`}>
				{label}
			</label>
			<div className={styles.stepper}>
				<button
					type="button"
					className={styles.step}
					onClick={() => step(team, label, value, set, -1)}
					disabled={disabled}
					// At the limit the button stays focusable (aria-disabled): disabling it would drop the focus to the page.
					aria-disabled={value <= 0 || undefined}
					aria-label={`Restar un gol a ${label}`}
				>
					-
				</button>
				<input
					id={`${titleId}-${team}`}
					className={`${styles.goalsInput} pixel-box`}
					type="number"
					inputMode="numeric"
					min={0}
					max={MAX_GOALS}
					step={1}
					value={value}
					disabled={disabled}
					onChange={(event) => {
						stepped.current = null;
						const typed = event.currentTarget.valueAsNumber;
						const next = clampGoals(typed);
						// A value out of range is adjusted, and said (T-19 fix); anything else stays quiet.
						if (typed > MAX_GOALS) say(`${label}: ${typed} no se admite, quedó en ${MAX_GOALS} goles, el máximo.`);
						else if (typed < 0) say(`${label}: ${typed} no se admite, quedó en 0 goles, el mínimo.`);
						else setLimitNote('');
						set(() => next);
					}}
				/>
				<button
					type="button"
					className={styles.step}
					onClick={() => step(team, label, value, set, 1)}
					disabled={disabled}
					aria-disabled={value >= MAX_GOALS || undefined}
					aria-label={`Sumar un gol a ${label}`}
				>
					+
				</button>
			</div>
		</div>
	);

	return (
		<article className={`${styles.card} pixel-box`} aria-labelledby={titleId} data-estado={estado}>
			<header className={styles.head}>
				<p className={styles.state} data-estado={estado}>
					<PixelIcon name={estado} />
					<span>{BETTING_STATE_LABEL[estado]}</span>
				</p>
				<p className={styles.meta}>
					{match.deporte.nombre} · {match.competicion.nombre} · J{match.jornada}
				</p>
			</header>

			<h3 className={styles.teams} id={titleId}>
				<span className={styles.team}>
					<TeamCrest team={local} />
					<span>{local.nombre}</span>
				</span>
				<span className={styles.versus}>{showScore ? `${match.local.goles} - ${match.visita.goles}` : 'vs'}</span>
				<span className={`${styles.team} ${styles.away}`}>
					<span>{visita.nombre}</span>
					<TeamCrest team={visita} />
				</span>
			</h3>

			<dl className={styles.facts}>
				<div>
					<dt>Inicio</dt>
					<dd>
						<time dateTime={match.fechaHora}>{when(match.fechaHora)}</time>
					</dd>
				</div>
				<div>
					<dt>Cierre</dt>
					<dd>
						<time dateTime={cierre}>{when(cierre)}</time>
					</dd>
				</div>
				<div>
					<dt>Sede</dt>
					<dd>{match.sede}</dd>
				</div>
			</dl>
			<p className={styles.hint} id={hintId}>
				{BETTING_STATE_HINT[estado]}
			</p>

			{open && (
				<div className={styles.bets} role="group" aria-labelledby={titleId} aria-describedby={reason ? `${hintId}-reason` : undefined}>
					{reason && (
						<p className={styles.reason} id={`${hintId}-reason`}>
							<PixelIcon name="alerta" /> {reason}
						</p>
					)}
					<p className={styles.betTitle}>Resultado</p>
					<div className={styles.results}>
						{pronosticosAdmitidos.resultadoGeneral.map((result) => (
							<button
								key={result}
								type="button"
								className={styles.pick}
								disabled={disabled}
								onClick={() => pick(result)}
								aria-label={`Apostar: ${resultLabel(result, local.nombre, visita.nombre)}`}
							>
								{resultLabel(result, local.nombreCorto, visita.nombreCorto)}
							</button>
						))}
					</div>

					<p className={styles.betTitle}>Marcador exacto</p>
					<p className={styles.live} role="status" aria-live="polite">
						{limitNote}
					</p>
					<div className={styles.score}>
						{stepper(local.nombre, golesLocal, setGolesLocal, 'local')}
						{stepper(visita.nombre, golesVisitante, setGolesVisitante, 'visita')}
					</div>
					<button
						type="button"
						className={styles.pick}
						disabled={disabled || drawBlocked}
						onClick={() => add({ partidoId: match.id, tipo: 'marcador_exacto', golesLocal, golesVisitante })}
						aria-describedby={drawBlocked ? `${hintId}-draw` : undefined}
						aria-label={`Apostar: marcador ${local.nombre} ${golesLocal} - ${golesVisitante} ${visita.nombre}`}
					>
						Agregar {golesLocal} - {golesVisitante}
					</button>
					{drawBlocked && (
						<p className={styles.reason} id={`${hintId}-draw`}>
							Este deporte no admite empate: el marcador no puede quedar igualado.
						</p>
					)}
					{inTicket > 0 && (
						<p className={styles.inTicket}>
							En tu ticket: {inTicket} {inTicket === 1 ? 'selección' : 'selecciones'}
						</p>
					)}
				</div>
			)}
		</article>
	);
}
