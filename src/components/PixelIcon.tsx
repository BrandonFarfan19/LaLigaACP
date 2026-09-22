import styles from './PixelIcon.module.css';

/**
 * Small 7×7 pixel icons in the current text color, drawn like the coin
 * (`CoinIcon`): one fat pixel and a hard box-shadow per pixel. They go next to
 * a text label, so the meaning never depends on the color alone (BR-052).
 */
const SPRITES = {
	// A "play" arrow: open for bets.
	disponible: ['#......', '###....', '#####..', '#######', '#####..', '###....', '#......'],
	// A padlock: bets closed.
	cerrada: ['..###..', '.#...#.', '.#...#.', '#######', '###.###', '###.###', '#######'],
	// A ball: in progress.
	en_curso: ['..###..', '.#####.', '##.#.##', '#######', '##.#.##', '.#####.', '..###..'],
	// A check mark: finished.
	finalizado: ['......#', '.....##', '#...##.', '##.##..', '.###...', '..#....', '.......'],
	// A cross: cancelled.
	cancelado: ['#.....#', '##...##', '.##.##.', '..###..', '.##.##.', '##...##', '#.....#'],
	// A warning sign: a problem to fix.
	alerta: ['...#...', '..###..', '..#.#..', '.##.##.', '.#####.', '###.###', '#######'],
	// An hourglass: waiting for the result (T-20).
	espera: ['#######', '.#...#.', '..#.#..', '...#...', '..#.#..', '.#...#.', '#######'],
	// A dash: a bet that missed (T-20).
	fallo: ['.......', '.......', '.......', '#######', '#######', '.......', '.......'],
} as const;

export type PixelIconName = keyof typeof SPRITES;

const unit = (n: number) => (n === 0 ? '0' : `calc(var(--icon-px) * ${n})`);

const SHADOWS = Object.fromEntries(
	Object.entries(SPRITES).map(([name, rows]) => [
		name,
		rows
			.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === '#' ? [`${unit(x + 1)} ${unit(y)} 0 0 currentColor`] : [])))
			.join(', '),
	]),
) as Record<PixelIconName, string>;

export default function PixelIcon({ name, className }: { name: PixelIconName; className?: string }) {
	return (
		<span className={`${styles.icon} ${className ?? ''}`} aria-hidden="true">
			{/* Drawn one fat pixel to the left of the box: shadows can't paint under the element itself. */}
			<span className={styles.pixel} style={{ boxShadow: SHADOWS[name] }} />
		</span>
	);
}
