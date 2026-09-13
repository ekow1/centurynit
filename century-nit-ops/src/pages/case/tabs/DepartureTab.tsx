import { useCases } from "../../../hooks/useCases";

import type { MockApplication } from "century-nit-core/ops";
import type { ApiInvoice } from "../../../lib/api";

import type { PreDepartureTask } from "century-nit-core/ops";
import { PAYMENT_PLAN_LABELS, type TravelAssistanceRequest } from "century-nit-shared";
import { TravelCard } from "../TravelCard";

const PRE_DEPARTURE_CATEGORIES: Record<string, { label: string; icon: string }> = {
	travel: { label: "Travel", icon: "✈️" },
	accommodation: { label: "Accommodation", icon: "🏠" },
	documents: { label: "Documents", icon: "📄" },
	health: { label: "Health", icon: "🩺" },
	finance: { label: "Finance", icon: "💳" },
	orientation: { label: "Orientation", icon: "🎓" },
};
function preDepartureProgress(tasks?: PreDepartureTask[]): number {
	if (!tasks || tasks.length === 0) return 0;
	return Math.round((tasks.filter((t) => t.done).length / tasks.length) * 100);
}


/** Departure — the fee milestone, the flight, the pre-departure checklist. */
export function DepartureTab({
	app,
	selectedTa,
	caseInvoices,
	canWork,
	canIssueInvoices,
	feeBlock,
	travelOpen,
	onInvoicesChanged,
}: {
	app: MockApplication;
	selectedTa: TravelAssistanceRequest | null;
	caseInvoices: ApiInvoice[];
	canWork: boolean;
	canIssueInvoices: boolean;
	/** Why the ticket cannot be invoiced yet (the pre-departure fee milestone), or null. */
	feeBlock: string | null;
	travelOpen: boolean;
	onInvoicesChanged: () => void;
}) {
	const { togglePreDepartureTask, refresh } = useCases();
	const pdProg = preDepartureProgress(app.preDepartureTasks);
	const pdCats = Object.keys(PRE_DEPARTURE_CATEGORIES);
	return (
		<>
			{/* The pre-departure fee milestone comes first: due once the visa
			    is approved, before the ticket is issued. */}
			<div className="card">
				<p className="eyebrow mb-1">Pre-departure fee milestone</p>
				<p className="text-sm">
					{feeBlock
						? feeBlock.replace(/^The ticket cannot be invoiced yet: /, "")
						: app.paymentPlanId === "installment"
							? "Pre-departure instalment paid — the ticket can be invoiced."
							: "Service fee balance paid — the ticket can be invoiced."}
				</p>
				<p className="muted mt-1 text-xs">
					Plan: {PAYMENT_PLAN_LABELS[app.paymentPlanId ?? ""] ?? "not chosen"} · {app.agencyStageIndex ?? 0} milestone{(app.agencyStageIndex ?? 0) === 1 ? "" : "s"} paid
					{app.agencySettled ? " · settled" : ""}
				</p>
			</div>

			{/* Flight — status, the flight, the one next action. Departure is
			    the last chapter; completion is recorded from the Money tab or
			    by the client. */}
			<div className="card">
				<p className="eyebrow mb-2">Flight</p>
				{selectedTa ? (
					<TravelCard
						ta={selectedTa}
						invoice={caseInvoices.find((i) => i.type === "travel") ?? null}
						canWork={canWork}
						canIssueInvoices={canIssueInvoices}
						feeBlock={feeBlock}
						onChanged={() => {
							void refresh();
							onInvoicesChanged();
						}}
					/>
				) : (
					<p className="muted text-sm">
						{app.visaStage === "complete"
							? "Waiting for the applicant to decide how they want to book their flight."
							: "Opens once the visa is complete."}
					</p>
				)}
				{selectedTa?.decision && (
					<p className="muted mt-2 text-xs">
						Decided {new Date(selectedTa.updatedAt).toLocaleDateString()} · {selectedTa.decision === "yes" ? "asked us to book" : selectedTa.decision === "hold" ? "on hold" : "booking their own"}
						{selectedTa.applicantNote ? ` · "${selectedTa.applicantNote}"` : ""}
					</p>
				)}
			</div>

					{/* Pre-departure Checklist */}
					{travelOpen && (
							<div className="card">
								<p className="eyebrow mb-2">Pre-departure Checklist</p>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
									<span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)" }}>
										{app.preDepartureTasks?.filter((t) => t.done).length ?? 0}/{app.preDepartureTasks?.length ?? 0} tasks
									</span>
									<span style={{ fontSize: "var(--text-xs)", fontFamily: "var(--font-mono)", fontWeight: 600, color: pdProg === 100 ? "var(--foreground)" : "var(--muted-foreground)" }}>
										{pdProg}%
									</span>
								</div>
								<div style={{ height: "6px", background: "var(--muted)", overflow: "hidden", marginBottom: "1rem" }}>
									<div style={{ width: `${pdProg}%`, height: "100%", background: "var(--foreground)", transition: "width 0.4s ease" }} />
								</div>

								{app.preDepartureTasks && app.preDepartureTasks.length > 0 ? (
									<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
										{pdCats.map((cat) => {
											const tasks = app.preDepartureTasks!.filter((t) => t.category === cat);
											if (tasks.length === 0) return null;
											const catDone = tasks.filter((t) => t.done).length;
											return (
												<div key={cat} style={{ border: "1px solid var(--border-light)", padding: "0.75rem" }}>
													<div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
														<span style={{ fontSize: "0.9rem" }}>{PRE_DEPARTURE_CATEGORIES[cat].icon}</span>
														<div>
															<p className="text-sm--strong">{PRE_DEPARTURE_CATEGORIES[cat].label}</p>
															<p className="muted text-xs">{catDone}/{tasks.length} complete</p>
														</div>
													</div>
													<div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
														{tasks.map((task) => (
															<div
																key={task.id}
																onClick={() => app.stage === "travel_assistance" && togglePreDepartureTask(app.appId, task.id)}
																style={{
																	display: "flex",
																	alignItems: "flex-start",
																	gap: "0.5rem",
																	padding: "0.4rem",
																	cursor: app.stage === "travel_assistance" ? "pointer" : "default",
																	border: "1px solid var(--border-light)",
																}}
															>
																<span style={{
																	width: "18px",
																	height: "18px",
																	flexShrink: 0,
																	display: "flex",
																	alignItems: "center",
																	justifyContent: "center",
																	fontSize: "0.65rem",
																	fontWeight: 700,
																	border: "2px solid",
																	borderColor: task.done ? "var(--foreground)" : "var(--border)",
																	color: task.done ? "var(--background)" : "transparent",
																	background: task.done ? "var(--foreground)" : "transparent",
																}}>
																	{task.done ? "\u2713" : ""}
																</span>
																<div>
																	<p style={{ fontWeight: task.done ? 400 : 500, fontSize: "var(--text-xs)", textDecoration: task.done ? "line-through" : "none", opacity: task.done ? 0.6 : 1 }}>
																		{task.label}
																	</p>
																	<p className="muted" style={{ fontSize: "0.68rem" }}>{task.detail}</p>
																</div>
															</div>
														))}
													</div>
												</div>
											);
										})}
									</div>
								) : (
									<p className="muted text-sm">No pre-departure tasks assigned yet.</p>
								)}
							</div>
						)}

		</>
	);
}
