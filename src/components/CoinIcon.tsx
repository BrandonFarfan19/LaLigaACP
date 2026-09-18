import type { CSSProperties } from 'react';
import styles from './CoinIcon.module.css';

/**
 * The coin of the navbar counter (BR-010, NFR-004), drawn as an 8×8 sprite:
 * one element one "fat pixel" in size, and a hard box-shadow per pixel on the
 * `--coin-px` grid. No image, no emoji, no smooth vector.
 *
 * Legend: R rim, L highlight, G gold, S shade, . transparent.
 */
const SPRITE = [
	'..RRRR..',
	'.RLLLGR.',
	'RLGGGGSR',
	'RLGSSGSR',
	'RLGSSGSR',
	'RGGGGGSR',
	'.RGSSSR.',
	'..RRRR..',
];

const COLORS: Record<string, string> = {
	R: 'var(--color-coin-rim)',
	L: 'var(--color-coin-light)',
	G: 'var(--color-accent-alt)',
	S: 'var(--color-coin-shade)',
};

const unit = (n: number) => (n === 0 ? '0' : `calc(var(--coin-px) * ${n})`);

/** Built once: the sprite never changes, only `--coin-px` does. */
const SHADOW = SPRITE.flatMap((row, y) =>
	[...row].flatMap((cell, x) => (COLORS[cell] ? [`${unit(x)} ${unit(y)} 0 0 ${COLORS[cell]}`] : [])),
).join(', ');

export default function CoinIcon({ className }: { className?: string }) {
	return (
		<span className={`${styles.coin} ${className ?? ''}`} aria-hidden="true">
			<span className={styles.pixel} style={{ boxShadow: SHADOW } as CSSProperties} />
		</span>
	);
}
