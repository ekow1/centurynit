import { useRef } from "react";

/**
 * Six segment boxes for one-time codes. Emits the joined string; the parent
 * decides when to auto-submit (already wired on code.length === length).
 * Digits only, auto-advances, Backspace steps back, paste fills all boxes.
 */
export function OtpInput({
	value,
	onChange,
	length = 6,
	autoFocus = false,
	disabled = false,
	id,
}: {
	value: string;
	onChange: (v: string) => void;
	length?: number;
	autoFocus?: boolean;
	disabled?: boolean;
	id?: string;
}) {
	const refs = useRef<(HTMLInputElement | null)[]>([]);
	const digits = value.padEnd(length, " ").slice(0, length).split("");

	function setDigit(i: number, d: string) {
		const next = digits.slice();
		next[i] = d;
		onChange(next.join("").replace(/ /g, ""));
	}

	function handleChange(i: number, raw: string) {
		const clean = raw.replace(/\D/g, "");
		if (!clean) return;
		// Typing or pasting several chars into one box — distribute from i.
		if (clean.length > 1) {
			const next = digits.slice();
			clean.split("").forEach((ch, j) => {
				if (i + j < length) next[i + j] = ch;
			});
			onChange(next.join("").replace(/ /g, ""));
			refs.current[Math.min(i + clean.length, length - 1)]?.focus();
			return;
		}
		setDigit(i, clean);
		if (i < length - 1) refs.current[i + 1]?.focus();
	}

	function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
		if (e.key === "Backspace") {
			e.preventDefault();
			if (digits[i].trim()) {
				setDigit(i, "");
			} else if (i > 0) {
				setDigit(i - 1, "");
				refs.current[i - 1]?.focus();
			}
		} else if (e.key === "ArrowLeft" && i > 0) {
			refs.current[i - 1]?.focus();
		} else if (e.key === "ArrowRight" && i < length - 1) {
			refs.current[i + 1]?.focus();
		}
	}

	function handlePaste(e: React.ClipboardEvent) {
		e.preventDefault();
		const clean = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
		if (!clean) return;
		onChange(clean);
		refs.current[Math.min(clean.length, length - 1)]?.focus();
	}

	return (
		<div className="ops-otp" role="group" aria-label="Verification code" id={id}>
			{digits.map((d, i) => (
				<input
					key={i}
					ref={(el) => { refs.current[i] = el; }}
					type="text"
					inputMode="numeric"
					autoComplete={i === 0 ? "one-time-code" : "off"}
					maxLength={6}
					className={`ops-otp__cell${d.trim() ? " ops-otp__cell--filled" : ""}`}
					value={d.trim()}
					onChange={(e) => handleChange(i, e.target.value)}
					onKeyDown={(e) => handleKeyDown(i, e)}
					onPaste={i === 0 ? handlePaste : undefined}
					onFocus={(e) => e.target.select()}
					disabled={disabled}
					autoFocus={autoFocus && i === 0}
					aria-label={`Digit ${i + 1}`}
				/>
			))}
		</div>
	);
}
