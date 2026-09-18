import { forwardRef, type InputHTMLAttributes, useId } from 'react';
import styles from './TextField.module.css';

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id' | 'className'> {
	label: string;
	name: string;
	/** Shown under the field and announced with it; marks the field invalid. */
	error?: string;
	/** A short rule shown under the label (e.g. the password length). */
	hint?: string;
}

/** A labelled pixel input whose hint and error are tied to it (`aria-describedby`). */
const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, name, error, hint, ...input }, ref) {
	const id = useId();
	const hintId = hint ? `${id}-hint` : undefined;
	const errorId = error ? `${id}-error` : undefined;
	const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

	return (
		<div className={styles.field}>
			<label className={styles.label} htmlFor={id}>
				{label}
			</label>
			{hint && (
				<p className={styles.hint} id={hintId}>
					{hint}
				</p>
			)}
			<input
				{...input}
				ref={ref}
				id={id}
				name={name}
				className={`${styles.input} pixel-box`}
				aria-invalid={error ? true : undefined}
				aria-describedby={describedBy}
			/>
			{error && (
				<p className={styles.error} id={errorId}>
					<span aria-hidden="true">! </span>
					{error}
				</p>
			)}
		</div>
	);
});

export default TextField;
