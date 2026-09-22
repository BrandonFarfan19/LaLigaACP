import styles from './ChoiceGroup.module.css';

export interface Choice {
	/** Sent with the form; `''` is "any". */
	value: string;
	label: string;
}

interface ChoiceGroupProps {
	legend: string;
	/** The form field's name. */
	name: string;
	choices: readonly Choice[];
	/** The value chosen when the page loads (the form reads the rest). */
	defaultValue: string;
}

/**
 * A filter as visible choices (D-017): radios drawn as pixel-art chips, 44px
 * tall, whose text wraps instead of being cut (D-014). The chosen one is filled
 * and its square too, so it never relies on color alone. Uncontrolled: give
 * the group a `key` that changes with `defaultValue` to reset it.
 */
export default function ChoiceGroup({ legend, name, choices, defaultValue }: ChoiceGroupProps) {
	return (
		<fieldset className={styles.group}>
			<legend className={styles.legend}>{legend}</legend>
			<div className={styles.choices}>
				{choices.map((choice) => (
					<label className={styles.choice} key={choice.value}>
						<input type="radio" name={name} value={choice.value} defaultChecked={choice.value === defaultValue} />
						<span>{choice.label}</span>
					</label>
				))}
			</div>
		</fieldset>
	);
}
