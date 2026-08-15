import type {
	InputHTMLAttributes,
	ReactNode,
	SelectHTMLAttributes,
	TextareaHTMLAttributes,
} from "react";

type FieldProps = {
	label: string;
	htmlFor: string;
	error?: string;
	hint?: string;
	children: ReactNode;
};

export function Field({ label, htmlFor, error, hint, children }: FieldProps) {
	return (
		<div className="field">
			<label htmlFor={htmlFor}>{label}</label>
			{children}
			{hint && !error ? <span className="hint">{hint}</span> : null}
			{error ? (
				<span className="error" role="alert">
					{error}
				</span>
			) : null}
		</div>
	);
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
	error?: boolean;
	fullBorder?: boolean;
};

export function Input({ error, fullBorder, className = "", ...rest }: InputProps) {
	return (
		<input
			className={[
				"input",
				fullBorder ? "input--full-border" : "",
				error ? "input--error" : "",
				className,
			]
				.filter(Boolean)
				.join(" ")}
			{...rest}
		/>
	);
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
	error?: boolean;
	fullBorder?: boolean;
};

export function Select({
	error,
	fullBorder,
	className = "",
	children,
	...rest
}: SelectProps) {
	return (
		<select
			className={[
				"select",
				fullBorder ? "select--full-border" : "",
				error ? "select--error" : "",
				className,
			]
				.filter(Boolean)
				.join(" ")}
			{...rest}
		>
			{children}
		</select>
	);
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
	error?: boolean;
};

export function Textarea({ error, className = "", ...rest }: TextareaProps) {
	return (
		<textarea
			className={["textarea", error ? "textarea--error" : "", className]
				.filter(Boolean)
				.join(" ")}
			{...rest}
		/>
	);
}
