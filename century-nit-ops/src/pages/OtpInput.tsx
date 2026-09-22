import { useRef } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";

/**
 * Six segment boxes for OTP/2FA codes — digits only, auto-advance on
 * entry, backspace steps back to the previous box, arrow keys move,
 * paste fills the whole row. Parent receives the joined value via onChange
 * and can watch for length === 6 to auto-submit.
 */
export function OtpInput({
	id,
	value,
	onChange,
	disabled,
	autoFocus = true,
}: {
	id: string;
	value: string;
	onChange: (v: string) => void;
	disabled?: boolean;
	autoFocus?: boolean;
}) {
	const refs = useRef<Array<HTMLInputElement | null>>([]);
	const digits = (value || "").replace(/\D/g, "").slice(0, 6).split("");

	const setDigit = (i: number, ch: string) => {
		const d = ch.replace(/\D/g, "");
		const next = (value || "").padEnd(6, " ").split("");
		if (!d) {
			next[i] = " ";
			onChange(next.join("").trimEnd());
			return;
		}
		// typing several chars (autofill split) → walk forward filling boxes
		for (let k = 0; k < d.length && i + k < 6; k++) next[i + k] = d[k];
		onChange(next.join("").trimEnd());
		const target = Math.min(i + d.length, 5);
		if (d.length && i < 5) refs.current[target]?.focus();
	};

	const onKey = (i: number, e: KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Backspace" && !digits[i] && i > 0) {
			refs.current[i - 1]?.focus();
		} else if (e.key === "ArrowLeft" && i > 0) {
			e.preventDefault();
			refs.current[i - 1]?.focus();
		} else if (e.key === "ArrowRight" && i < 5) {
			e.preventDefault();
			refs.current[i + 1]?.focus();
		}
	};

	const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
		e.preventDefault();
		const d = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
		if (d) {
			onChange(d);
			refs.current[Math.min(d.length, 5)]?.focus();
		}
	};

	return (
		<div className="ops-otp" id={id} role="group" aria-label="Verification code">
			{Array.from({ length: 6 }, (_, i) => (
				<input
					key={i}
					ref={(el) => {
						refs.current[i] = el;
					}}
					className={`ops-otp__cell${digits[i] ? " ops-otp__cell--filled" : ""}`}
					type="text"
					inputMode="numeric"
					autoComplete={i === 0 ? "one-time-code" : "off"}
					maxLength={6}
					value={digits[i] ?? ""}
					disabled={disabled}
					autoFocus={autoFocus && i === 0}
					aria-label={`Digit ${i + 1}`}
					onFocus={(e) => e.target.select()}
					onChange={(e) => setDigit(i, e.target.value)}
					onKeyDown={(e) => onKey(i, e)}
					onPaste={onPaste}
				/>
			))}
		</div>
	);
}
