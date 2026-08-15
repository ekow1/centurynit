import { useAppState } from "../../context/AppState";
import { Button } from "./Button";
import { STAGE_SHORT } from "../../data/stageLabels";
import type { CSSProperties } from "react";

type Props = {
	variant?: "primary" | "secondary" | "ghost" | "inverted";
	size?: "md" | "sm";
	block?: boolean;
	arrow?: boolean;
	style?: CSSProperties;
};

export function JourneyButton({
	variant = "primary",
	size = "md",
	block,
	arrow = true,
	style,
}: Props) {
	const { isAuthenticated, journeyPhase } = useAppState();

	if (isAuthenticated) {
		return (
			<Button to="/portal/home" variant={variant} size={size} block={block} arrow={arrow} style={style}>
				Continue · {STAGE_SHORT[journeyPhase.stage] ?? journeyPhase.label}
			</Button>
		);
	}

	return (
		<Button to="/start" variant={variant} size={size} block={block} arrow={arrow} style={style}>
			Start Journey
		</Button>
	);
}
