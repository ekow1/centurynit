import { useState } from "react";
import type { ReactNode } from "react";

/**
 * One password input for every ops auth surface: show/hide toggle, an
 * optional four-bar strength meter, and an optional live "does it match"
 * indicator for confirmation fields. Login, invite acceptance and
 * reset-password all render this so the rules and the affordances are
 * identical everywhere.
 */

export const PASSWORD_MIN_LENGTH = 12;

const EYE_SVG =
	'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF_SVG =
	'<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

/** 0-4: length, case mix, digits, symbols. */
export function passwordScore(pw: string): number {
	if (!pw) return 0;
	let s = 0;
	if (pw.length >= PASSWORD_MIN_LENGTH) s++;
	if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
	if (/\d/.test(pw)) s++;
	if (/[^A-Za-z0-9]/.test(pw)) s++;
	return s;
}

const STRENGTH_LABEL = ["Too weak", "Weak", "Fair", "Good", "Strong"];

export function PasswordField({
	id,
	label,
	value,
	onChange,
	autoComplete = "current-password",
	placeholder,
	disabled,
	autoFocus,
	required = true,
	showStrength = false,
	matchWith,
	hint,
}: {
	id?: string;
	label: ReactNode;
	value: string;
	onChange: (value: string) => void;
	autoComplete?: string;
	placeholder?: string;
	disabled?: boolean;
	autoFocus?: boolean;
	required?: boolean;
	/** Show the strength meter under the field. */
	showStrength?: boolean;
	/** When set, shows a live match/mismatch hint against this other value. */
	matchWith?: string;
	hint?: string;
}) {
	const [visible, setVisible] = useState(false);
	const score = passwordScore(value);
	const mismatch = matchWith !== undefined && value.length > 0 && value !== matchWith;
	const tooShort = value.length > 0 && value.length < PASSWORD_MIN_LENGTH;

	return (
		<div className="ops-login__field">
			<label className="ops-login__label" htmlFor={id}>
				{label}
			</label>
			<div className="ops-login__pw">
				<input
					id={id}
					type={visible ? "text" : "password"}
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder={placeholder}
					className="ops-login__input ops-login__input--pw"
					autoComplete={autoComplete}
					disabled={disabled}
					autoFocus={autoFocus}
					required={required}
				/>
				<button
					type="button"
					className="ops-login__pw-toggle"
					onClick={() => setVisible((v) => !v)}
					aria-label={visible ? "Hide password" : "Show password"}
					title={visible ? "Hide password" : "Show password"}
					tabIndex={-1}
					dangerouslySetInnerHTML={{ __html: visible ? EYE_OFF_SVG : EYE_SVG }}
				/>
			</div>
			{showStrength && value.length > 0 && (
				<div className="pw-meter" aria-hidden="true">
					{[0, 1, 2, 3].map((i) => (
						<span key={i} className={`pw-meter__bar${i < score ? " pw-meter__bar--on" : ""}`} />
					))}
					<span className="pw-meter__label">{STRENGTH_LABEL[score]}</span>
				</div>
			)}
			{mismatch ? (
				<p className="ops-login__error" role="alert">Passwords do not match.</p>
			) : matchWith !== undefined && value.length > 0 ? (
				<p className="ops-login__hint ops-login__hint--ok">Passwords match.</p>
			) : tooShort ? (
				<p className="ops-login__hint">At least {PASSWORD_MIN_LENGTH} characters.</p>
			) : hint ? (
				<p className="ops-login__hint">{hint}</p>
			) : null}
		</div>
	);
}
