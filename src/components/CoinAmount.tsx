import { coinsText } from '../lib/betting-labels';
import CoinIcon from './CoinIcon';
import styles from './CoinAmount.module.css';

/**
 * An amount of coins with the pixel-art coin of the navbar counter: the coins
 * won by right forecasts (BR-057, C-09) or a movement of the balance. Always
 * in coins, never points (BR-039). `signed` puts the "+" of a gain (a loss
 * already carries its "-").
 */
export default function CoinAmount({ amount, signed = false }: { amount: number; signed?: boolean }) {
	return (
		<span className={styles.amount}>
			<CoinIcon />
			<span>
				{signed && amount > 0 ? '+' : ''}
				{coinsText(amount)}
			</span>
		</span>
	);
}
