import { useState } from "react";
import { useAppState } from "../context/AppState";
import { useNotifier } from "./notifier/Notifier";
import { useOpsSnapshot, resetOpsStorage } from "../data/opsDemoBridge";

/**
 * Floating presenter panel.
 *
 * Keeps every simulation lever in one deliberate place so the screens
 * themselves stay clean during a demo. Collapsed by default; toggle with the
 * tab in the corner or press `d`.
 */
export function DemoControls() {
	const [open, setOpen] = useState(false);
	const { simAutopilot, setSimAutopilot, journeyPhase, resetJourney, authUser } = useAppState();
	const { confirm, toast } = useNotifier();
	const ops = useOpsSnapshot();

	// Demo/debug affordance only. The panel exposes simulation levers — most
	// importantly the `simAutopilot` toggle, which is the gate that reveals
	// the "Simulate other outcomes" self-approve buttons in the portal. A
	// production build must not let any visitor flip that gate at will, so
	// the entire panel (including the "DEMO" tab) is compiled out. Vite
	// treats `import.meta.env.DEV` as a build-time constant and tree-shakes
	// the dead branch, so none of this reaches a production bundle.
	if (!import.meta.env.DEV) return null;

	async function resetEverything() {
		const ok = await confirm({
			title: "Reset the whole demo?",
			message:
				"Clears the applicant journey, all ops records, and any issued decisions. An Operations Center window that is already open will need a refresh.",
			confirmText: "Reset demo",
			tone: "danger",
		});
		if (!ok) return;
		resetJourney();
		resetOpsStorage();
		toast.success("Demo reset.");
	}

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				aria-label="Open demo controls"
				style={{
					position: "fixed",
					right: 0,
					/* Clear of the hero CTAs and the chat FAB on phones */
					bottom: "calc(32vh + var(--shell-bottom))",
					zIndex: 3000,
					padding: "0.5rem 0.6rem",
					background: "var(--foreground)",
					color: "var(--background)",
					border: "none",
					cursor: "pointer",
					fontFamily: "var(--font-mono)",
					fontSize: "0.65rem",
					letterSpacing: "0.1em",
					writingMode: "vertical-rl",
				}}
			>
				DEMO
			</button>
		);
	}

	return (
		<aside
			style={{
				position: "fixed",
				right: "1rem",
				bottom: "calc(1rem + var(--shell-bottom))",
				zIndex: 3000,
				width: "min(310px, calc(100vw - 2rem))",
				maxHeight: "min(70dvh, 40rem)",
				overflowY: "auto",
				background: "var(--background)",
				border: "1px solid var(--foreground)",
				boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
				fontSize: "var(--text-sm)",
			}}
		>
			<header
				style={{
					display: "flex",
					justifyContent: "space-between",
					alignItems: "center",
					padding: "0.6rem 0.85rem",
					background: "var(--foreground)",
					color: "var(--background)",
				}}
			>
				<span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", letterSpacing: "0.1em" }}>
					DEMO CONTROLS
				</span>
				<button
					type="button"
					onClick={() => setOpen(false)}
					aria-label="Close demo controls"
					style={{ background: "none", border: "none", color: "inherit", cursor: "pointer", fontSize: "0.9rem" }}
				>
					✕
				</button>
			</header>

			<div style={{ padding: "0.85rem", display: "flex", flexDirection: "column", gap: "0.85rem" }}>
				{/* Mode */}
				<div>
					<p className="eyebrow" style={{ fontSize: "0.65rem" }}>Simulation mode</p>
					<div style={{ display: "flex", gap: "0.4rem", marginTop: "0.4rem" }}>
						<button
							type="button"
							onClick={() => setSimAutopilot(true)}
							className={`btn btn--sm ${simAutopilot ? "btn--primary" : "btn--ghost"}`}
							style={{ flex: 1, fontSize: "0.7rem" }}
						>
							Autopilot
						</button>
						<button
							type="button"
							onClick={() => setSimAutopilot(false)}
							className={`btn btn--sm ${!simAutopilot ? "btn--primary" : "btn--ghost"}`}
							style={{ flex: 1, fontSize: "0.7rem" }}
						>
							Ops-driven
						</button>
					</div>
					<p className="muted" style={{ fontSize: "0.7rem", marginTop: "0.4rem", lineHeight: 1.4 }}>
						{simAutopilot
							? "Timers stand in for staff - the portal runs end to end on its own."
							: "Staff decisions come from the Operations Center. Open /ops in a second window."}
					</p>
				</div>

				{/* State readout */}
				<div style={{ borderTop: "1px solid var(--border-light)", paddingTop: "0.7rem" }}>
					<p className="eyebrow" style={{ fontSize: "0.65rem" }}>Current state</p>
					<dl style={{ margin: "0.4rem 0 0", fontSize: "0.72rem", display: "grid", gridTemplateColumns: "auto 1fr", gap: "0.2rem 0.6rem" }}>
						<dt className="muted">Portal</dt>
						<dd style={{ margin: 0 }}>{authUser ? journeyPhase.label : "Signed out"}</dd>
						<dt className="muted">Live case</dt>
						<dd style={{ margin: 0 }}>
							{ops.liveCaseName ? `${ops.liveCaseName} · visible in ops` : "None"}
						</dd>
						<dt className="muted">Ops actions</dt>
						<dd style={{ margin: 0 }}>{ops.activityCount} logged</dd>
					</dl>
				</div>

				{/* Jump */}
				<div style={{ borderTop: "1px solid var(--border-light)", paddingTop: "0.7rem" }}>
					<p className="eyebrow" style={{ fontSize: "0.65rem" }}>Open in this window</p>
					<div style={{ display: "flex", gap: "0.4rem", marginTop: "0.4rem" }}>
						<a
							href="/portal/home"
							className="btn btn--sm btn--primary"
							style={{ flex: 1, fontSize: "0.7rem", textAlign: "center" }}
						>
							Portal
						</a>
						<a
							href="/ops"
							className="btn btn--sm btn--ghost"
							style={{ flex: 1, fontSize: "0.7rem", textAlign: "center" }}
						>
							Ops
						</a>
					</div>
					<p className="muted" style={{ fontSize: "0.7rem", marginTop: "0.4rem", lineHeight: 1.4 }}>
						For the two-window demo, open the other side in a separate window rather than
						navigating away.
					</p>
				</div>

				{/* Reset */}
				<div style={{ borderTop: "1px solid var(--border-light)", paddingTop: "0.7rem" }}>
					<button
						type="button"
						onClick={resetEverything}
						className="btn btn--ghost btn--sm"
						style={{ width: "100%", fontSize: "0.7rem" }}
					>
						Reset entire demo
					</button>
				</div>
			</div>
		</aside>
	);
}
