import { useState } from "react";
import { useInstallPrompt } from "../../hooks/useInstallPrompt";

function IconInstall({ size = 16 }: { size?: number }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.75"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			<path d="M12 3v12" />
			<polyline points="7 10 12 15 17 10" />
			<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
		</svg>
	);
}

/** iOS has no programmatic install prompt — the only path is these steps. */
function IosSteps() {
	return (
		<div className="install-app__steps" role="note">
			<p className="install-app__steps-title">Install on this iPhone</p>
			<ol>
				<li>
					In Safari, tap the <strong>Share</strong> button
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ verticalAlign: "-1px", marginLeft: "0.25rem" }}>
						<path d="M12 16V4" />
						<polyline points="7 9 12 4 17 9" />
						<path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
					</svg>
				</li>
				<li>
					Choose <strong>Add to Home Screen</strong>.
				</li>
				<li>Open Century NIT from your home screen — alerts and updates work best there.</li>
			</ol>
		</div>
	);
}

/**
 * The portal's install affordance. "block" is the sidebar card; "link" is a
 * row inside a dropdown menu (the phone app bar's account menu).
 *
 * Renders nothing once installed, and nothing on browsers with no install
 * path (e.g. desktop Firefox) rather than showing a button that can't work.
 */
export function InstallAppButton({ variant = "block" }: { variant?: "block" | "link" }) {
	const { installed, promptable, ios, available, prompt } = useInstallPrompt();
	const [stepsOpen, setStepsOpen] = useState(false);
	const [busy, setBusy] = useState(false);

	if (installed || !available) return null;

	const onClick = async () => {
		if (promptable) {
			setBusy(true);
			await prompt();
			setBusy(false);
			return;
		}
		if (ios) setStepsOpen((v) => !v);
	};

	if (variant === "link") {
		return (
			<>
				<button type="button" className="nav__dropdown-link" onClick={onClick} disabled={busy}>
					{busy ? "Installing…" : ios ? "Install app — how" : "Install app"}
				</button>
				{stepsOpen && ios ? <IosSteps /> : null}
			</>
		);
	}

	return (
		<div className="install-app">
			<button type="button" className="install-app__btn" onClick={onClick} disabled={busy}>
				<span className="install-app__icon">
					<IconInstall />
				</span>
				<span className="install-app__meta">
					<span className="install-app__label">{busy ? "Installing…" : "Install the app"}</span>
					<span className="install-app__hint">
						{ios ? "Add to your Home Screen" : "Faster access · instant alerts"}
					</span>
				</span>
			</button>
			{stepsOpen && ios ? <IosSteps /> : null}
		</div>
	);
}
