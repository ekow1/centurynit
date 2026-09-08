import { useEffect, useState } from "react";
import { useAppState } from "../../context/AppState";
import { Button } from "../../components/ui/Button";
import { ChapterGate } from "./PortalLayout";
import { meApi, ApiError } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import { usdFromCents, type ApiInvoice } from "century-nit-shared";

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
		<ChapterGate chapter="travel_assistance">
			<PreDepartureInner />
		</ChapterGate>
	);
}

function PreDepartureInner() {
	const { preDepartureTasks, togglePreDepartureTask, preDepartureProgress, application, syncFromServer } =
		useAppState();
	const { toast } = useNotifier();

	const ticketingPaid = Boolean(application.travelInvoicePaid);

	// Fetch the real server travel invoice on mount so the card reflects
	// actual status and a real Paystack checkout can be charged against it.
	const [serverInv, setServerInv] = useState<ApiInvoice | null>(null);
	const [payPhase, setPayPhase] = useState<"idle" | "loading">("idle");

	useEffect(() => {
		let cancelled = false;
		meApi
			.invoices()
			.then(({ invoices }) => {
				if (cancelled) return;
				setServerInv(invoices.find((i) => i.type === "travel") ?? null);
			})
			.catch(() => {});
		return () => { cancelled = true; };
	}, []);

	const trip = serverInv ?? null;
	const tripDue = Boolean(trip) && trip.status !== "paid" && trip.balanceCents > 0;
	const tripAmountUsd = (trip?.balanceCents ?? 0) > 0 ? trip.balanceCents : trip?.subtotalCents ?? 0;
	const ticketingEffectivePaid = ticketingPaid || (trip?.status === "paid");

	async function payTicketing() {
		setPayPhase("loading");
		try {
			let backend = serverInv && serverInv.balanceCents > 0 ? serverInv : null;
			if (!backend) {
				const { invoices } = await meApi.invoices();
				backend = invoices.find((i) => i.type === "travel" && i.balanceCents > 0) ?? null;
			}
			if (!backend) {
				toast.error(
					"Your ticketing invoice has not been issued on the server yet. Ask your consultant to raise it.",
				);
				return;
			}
			const checkout = await meApi.paystackCheckout(backend.id);
			if (checkout.authorizationUrl && checkout.authorizationUrl.startsWith("http")) {
				window.location.href = checkout.authorizationUrl;
				return;
			}
			toast.error("Could not initialize Paystack checkout.");
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Payment could not be processed. Please try again.",
			);
		} finally {
			setPayPhase("idle");
		}
	}

	const [advancing, setAdvancing] = useState(false);
	async function handleAdvanceToPlan() {
		if (advancing) return;
		setAdvancing(true);
		try {
			await meApi.advanceToPaymentPlan();
			await syncFromServer();
			toast.success("Your payment plan chapter is now open.");
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Could not open your payment plan. Please try again.",
			);
			setAdvancing(false);
		}
	}

	if (payPhase === "loading") {
		return (
			<div className="portal-page">
				<div className="loading-overlay">
					<div className="spinner" aria-hidden />
					<p className="mono">Contacting payment provider…</p>
					<p className="muted">Charging ${usdFromCents(tripAmountUsd)} ticketing fee</p>
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
					<p className="eyebrow">Travel assistance</p>
					<h1 className="page-title mt-1">Almost ready to fly</h1>
					<p className="lead mt-2">
						Pay your ticketing fee, work through the checklist below, and your handler clears you
						for departure. All other services are covered by your payment plan.
					</p>
				</div>
			</header>

			{/* Ticketing fee — this chapter's payment */}
			<section className="mt-4">
				<div className="card card--pad">
					<p className="eyebrow">Ticketing fee</p>
					<div className="row mt-2" style={{ alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
						<div>
							<p className="display" style={{ fontSize: "1.25rem" }}>
								{tripDue || tripAmountUsd > 0 ? (
									<>${usdFromCents(trip ? (trip.balanceCents > 0 ? trip.balanceCents : trip.subtotalCents) : tripAmountUsd)}</>
								) : (
									"Flights & transfers"
								)}
							</p>
							<p className="muted" style={{ fontSize: "0.85rem" }}>
								{ticketingEffectivePaid
									? "Paid — your flight and transfer ticketing is confirmed."
									: tripDue
										? `Invoice ${trip?.invoiceNumber ?? ""} · ${trip?.status === "partial" ? "partially paid, balance outstanding" : "awaiting payment"}`
										: "Raised by your consultant when tickets are confirmed."}
							</p>
						</div>
						<div className="row" style={{ marginLeft: "auto" }}>
							{!ticketingEffectivePaid ? (
								<Button variant="primary" onClick={() => void payTicketing()} disabled={!tripDue}>
									{!tripDue && !trip ? "Awaiting invoice…" : "Pay ticketing fee"}
								</Button>
							) : (
								<span className="success-check" aria-hidden>
									✓
								</span>
							)}
						</div>
					</div>
				</div>
			</section>

			{/* Pre-departure checklist */}
			<section className="mt-6">
				<div className="portal-page__row" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
					<p className="eyebrow">Pre-departure checklist</p>
					<p className="muted" style={{ fontSize: "0.85rem" }}>
						{preDepartureTasks.filter((t) => t.done).length}/{preDepartureTasks.length} done
					</p>
				</div>

				<div
					style={{
						marginTop: "0.75rem",
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

				<div className="portal-grid portal-grid--2 portal-grid--align-start mt-4">
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

			{/* Next action: move on to the payment plan once the ticketing fee is paid */}
			<div className="card card--pad mt-5 next-action">
				{ticketingEffectivePaid ? (
					<>
						<p className="eyebrow">Next step</p>
						<p className="display mt-2" style={{ fontSize: "1.25rem" }}>
							{preDepartureProgress === 100 ? "You're ready to fly 🛫" : "Ticketing fee paid"}
						</p>
						<p className="muted mt-1">
							{preDepartureProgress === 100
								? "Your checklist is done and your ticketing is settled. Move to your payment plan, settle your service fee, then complete your journey."
								: "Your ticketing fee is settled. You can keep working the checklist here, or move to your payment plan now."}
						</p>
						<div className="row mt-3">
							<Button className="btn btn--primary" onClick={() => void handleAdvanceToPlan()} disabled={advancing}>
								{advancing ? "Opening payment plan…" : "Move to Payment Plan →"}
							</Button>
							{preDepartureProgress === 100 ? (
								<Button to="/portal/payment-execution" variant="ghost">
									See payment plan
								</Button>
							) : null}
						</div>
					</>
				) : (
					<>
						<p className="eyebrow">Almost there</p>
						<p className="display mt-2" style={{ fontSize: "1.25rem" }}>
							Pay your ticketing fee
						</p>
						<p className="muted mt-1">
							Settle your ticketing fee above to open your payment plan chapter, where you'll
							choose how to cover the agency service fee.
						</p>
					</>
				)}
			</div>

			<div className="card card--pad mt-5">
				<p className="eyebrow">Need help?</p>
				<p className="muted mt-2">
					Message your consultant through the chat widget at the bottom right of
					the portal if you have questions about any of these tasks. We're here to
					help you prepare for departure.
				</p>
			</div>
		</div>
	);
}