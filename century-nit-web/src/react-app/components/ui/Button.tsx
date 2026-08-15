import { Link } from "react-router-dom";
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "inverted";

type Common = {
	variant?: Variant;
	size?: "md" | "sm";
	block?: boolean;
	children: ReactNode;
	className?: string;
	arrow?: boolean;
	style?: CSSProperties;
};

type AsButton = Common &
	ButtonHTMLAttributes<HTMLButtonElement> & {
		to?: undefined;
	};

type AsLink = Common & {
	to: string;
	disabled?: boolean;
	onClick?: () => void;
};

export function Button(props: AsButton | AsLink) {
	const {
		variant = "primary",
		size = "md",
		block,
		children,
		className = "",
		arrow,
		style,
	} = props;

	const cls = [
		"btn",
		`btn--${variant}`,
		size === "sm" ? "btn--sm" : "",
		block ? "btn--block" : "",
		className,
	]
		.filter(Boolean)
		.join(" ");

	const content = (
		<>
			{children}
			{arrow ? <span aria-hidden>→</span> : null}
		</>
	);

	if ("to" in props && props.to) {
		if (props.disabled) {
			return (
				<span className={cls} aria-disabled="true" style={style}>
					{content}
				</span>
			);
		}
		return (
			<Link to={props.to} className={cls} onClick={props.onClick} style={style}>
				{content}
			</Link>
		);
	}

	const btnProps = props as AsButton;
	return (
		<button
			type={btnProps.type ?? "button"}
			className={cls}
			disabled={btnProps.disabled}
			onClick={btnProps.onClick}
			aria-label={btnProps["aria-label"]}
			style={style}
		>
			{content}
		</button>
	);
}
