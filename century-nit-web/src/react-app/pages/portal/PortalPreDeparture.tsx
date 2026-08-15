import { useAppState } from "../../context/AppState";
import { Button } from "../../components/ui/Button";
import { ChapterGate } from "./PortalLayout";

const CATEGORY_LABELS: Record<string, string> = {
	travel: "Travel",
	accommodation: "Accommodation",
	documents: "Documents",
	health: "Health & Insurance",
	finance: "Finance",
	orientation: "Orientation",
};

const CATEGORY_ICONS: Record<string, string> = {
	travel: "✈",
	accommodation: "⌂",
	documents: "≡",
	health: "✚",
	finance: "¤",
	orientation: "◯",
};

export function PortalPreDeparture() {
	return (
		<ChapterGate chapter="pre_departure">
			<PreDepartureInner />
		</ChapterGate>
	);
}

function PreDepartureInner() {
	const { preDepartureTasks, togglePreDepartureTask, preDepartureProgress, application } =
		useAppState();

	const finished =
		Boolean(application.completedAt) ||
		(Boolean(application.agencySettledAt) && application.visaStatus === "complete");

	if (!finished) {
		return (
			<div className="portal-page">
				<header className="portal-page__header">
					<div>
						<p className="eyebrow">Pre-departure</p>
						<h1 className="page-title mt-1">Almost ready to fly</h1>
						<p className="lead mt-2">
							Complete your visa, payment plan, and agency settlement first - then your
							pre-departure checklist unlocks here.
						</p>
					</div>
				</header>
				<div className="row mt-4">
					<Button to="/portal/visa" arrow>
						Visa & travel
					</Button>
					<Button to="/portal/agency" variant="secondary">
						Agency settlement
					</Button>
				</div>
			</div>
		);
	}

	const categories = Object.keys(CATEGORY_LABELS);
	const byCategory = categories.map((cat) => ({
		category: cat,
		tasks: preDepartureTasks.filter((t) => t.category === cat),
	}));

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Pre-departure</p>
					<h1 className="page-title mt-1">Pre-departure briefing</h1>
					<p className="lead mt-2">
						Your application is complete. Before you fly, work through this checklist to ensure
						a smooth transition to your destination.
					</p>
				</div>
				<div className="success-check" aria-hidden>
					✓
				</div>
			</header>

			<div className="stat-band mt-4">
				<div className="stat-cell">
					<p className="stat-cell__label">Checklist progress</p>
					<p className="stat-cell__value">{preDepartureProgress}%</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Tasks done</p>
					<p className="stat-cell__value">
						{preDepartureTasks.filter((t) => t.done).length}/{preDepartureTasks.length}
					</p>
				</div>
				<div className="stat-cell stat-cell--accent">
					<p className="stat-cell__label">Status</p>
					<p className="stat-cell__value">
						{preDepartureProgress === 100 ? "Ready to fly" : "In progress"}
					</p>
				</div>
			</div>

			<div
				style={{
					marginTop: "1.5rem",
					height: "6px",
					background: "var(--muted)",
					borderRadius: "999px",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						width: `${preDepartureProgress}%`,
						height: "100%",
						background: "var(--foreground)",
						transition: "width 300ms ease",
					}}
				/>
			</div>

			<section className="mt-6">
				<div className="portal-grid portal-grid--2 portal-grid--align-start">
					{byCategory.map(({ category, tasks }) => {
						const done = tasks.filter((t) => t.done).length;
						return (
							<div key={category} className="card card--pad">
								<div
									style={{
										display: "flex",
										alignItems: "center",
										gap: "0.75rem",
										marginBottom: "1rem",
									}}
								>
									<span
										style={{
											fontSize: "1.1rem",
											width: "32px",
											height: "32px",
											display: "flex",
											alignItems: "center",
											justifyContent: "center",
											background: "var(--foreground)",
											color: "var(--background)",
											flexShrink: 0,
										}}
									>
										{CATEGORY_ICONS[category]}
									</span>
									<div>
										<p style={{ fontWeight: 600, fontSize: "0.95rem" }}>
											{CATEGORY_LABELS[category]}
										</p>
										<p className="muted" style={{ fontSize: "0.75rem" }}>
											{done}/{tasks.length} complete
										</p>
									</div>
								</div>

								<ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
									{tasks.map((task) => (
										<li
											key={task.id}
											style={{
												padding: "0.6rem 0",
												borderBottom: "1px solid var(--border-light)",
												display: "flex",
												gap: "0.75rem",
												alignItems: "flex-start",
												cursor: "pointer",
											}}
											onClick={() => togglePreDepartureTask(task.id)}
										>
											<span
												style={{
													width: "20px",
													height: "20px",
													border: task.done
														? "none"
														: "1.5px solid var(--border)",
													background: task.done
														? "var(--foreground)"
														: "transparent",
													color: task.done ? "var(--background)" : "transparent",
													display: "flex",
													alignItems: "center",
													justifyContent: "center",
													fontSize: "0.7rem",
													flexShrink: 0,
													marginTop: "0.1rem",
													borderRadius: "2px",
												}}
											>
												✓
											</span>
											<div style={{ flex: 1 }}>
												<p
													style={{
														fontWeight: task.done ? 400 : 500,
														fontSize: "0.85rem",
														textDecoration: task.done ? "line-through" : "none",
														opacity: task.done ? 0.6 : 1,
													}}
												>
													{task.label}
												</p>
												<p
													className="muted"
													style={{ fontSize: "0.78rem", marginTop: "0.2rem" }}
												>
													{task.detail}
												</p>
											</div>
										</li>
									))}
								</ul>
							</div>
						);
					})}
				</div>
			</section>

			{preDepartureProgress === 100 ? (
				<div className="card card--pad mt-5 next-action">
					<p className="eyebrow">All clear!</p>
					<p className="display mt-2" style={{ fontSize: "1.3rem" }}>
						You're ready to fly 🛫
					</p>
					<p className="muted mt-1">
						All pre-departure tasks are complete. Safe travels, and don't forget to check in
						with us after you arrive!
					</p>
					<div className="row mt-3">
						<Button to="/portal/complete" variant="secondary">
							Back to completion summary
						</Button>
					</div>
				</div>
			) : null}

			<div className="card card--pad mt-5">
				<p className="eyebrow">Need help?</p>
				<p className="muted mt-2">
					Message your consultant through the Messages tab if you have questions about any of
					these tasks. We're here to help you prepare for departure.
				</p>
				<div className="row mt-3">
					<Button to="/portal/messages" variant="ghost">
						Message consultant
					</Button>
				</div>
			</div>
		</div>
	);
}
