import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { useAppState, type PendingAction } from "../../context/AppState";
import { PROCESS_STAGES, type ProcessStageId } from "century-nit-core";
import { STAGE_PATH, STAGE_SHORT } from "../../data/stageLabels";
import { StageConsentCard } from "../../components/StageConsentCard";

/**
 * Where "continue" goes for the current stage, with a verb that names the
 * actual next act instead of the generic "Continue". The label stays short -
 * the stage is already named in the band above the button, so repeating it
 * there just crowds narrow screens.
 */
const STAGE_CTA: Partial<Record<ProcessStageId, { to: string; label: string }>> = {
	new: { to: "/portal/consultation", label: "Book consultation" },
	consultation: { to: "/portal/consultation", label: "Book consultation" },
	eligibility: { to: "/portal/consultation", label: "View consultation" },
	proceed: { to: "/portal/package", label: "Choose package" },
	school_package: { to: "/portal/package", label: "Choose package" },
	awaiting_handler: { to: "/portal/awaiting-handler", label: "Awaiting handler" },
	school_select: { to: "/portal/application", label: "Select schools" },
	awaiting_invoice: { to: "/portal/application", label: "Awaiting invoice" },
	application_invoice: { to: "/portal/financial", label: "Pay invoice" },
	school_tracking: { to: "/portal/tracking", label: "View applications" },
	visa_invoice: { to: "/portal/visa", label: "Pay visa invoice" },
	visa: { to: "/portal/visa/tracking", label: "View visa" },
	payment_execution: { to: "/portal/payment-execution", label: "Choose plan & pay" },
	travel_assistance: { to: "/portal/pre-departure", label: "View checklist" },
	completed: { to: "/portal/complete", label: "View summary" },
};

function currentStageCta(
	stage: ProcessStageId,
	proceedStatus: "invited" | "accepted" | "declined" | "paused",
): { to: string; label: string } {
	if (stage === "proceed") {
		if (proceedStatus === "declined" || proceedStatus === "paused") {
			return { to: "/portal/consultation", label: "Resume application" };
		}
		if (proceedStatus === "accepted") {
			return STAGE_CTA.school_package ?? { to: "/portal/package", label: "Choose package" };
		}
		// invited — the consent gate is still open. The consultation page shows
		// the assessment recommendation + consent card, so we send them there
		// instead of straight to package selection.
		return { to: "/portal/consultation", label: "Review recommendation" };
	}
	return STAGE_CTA[stage] ?? { to: STAGE_PATH[stage] ?? "/portal/home", label: "Continue" };
}

const STAGE_META: Record<ProcessStageId, { title: string; desc: string }> = {
	new: { title: "Start your journey", desc: "Book your first consultation to begin your application with Century NIT." },
	consultation: { title: "Start your consultation", desc: "Book the first meeting, fill your assessment, and pay the consultation fee." },
	eligibility: { title: "Your recommendation", desc: "Review the assessment outcome and the package your consultant recommends." },
	proceed: { title: "Start your application", desc: "Confirm you want to continue so we can assign a handler and begin processing." },
	school_package: { title: "Choose your school package", desc: "Pick a funding track and degree level to shape school targeting." },
	awaiting_handler: { title: "Awaiting handler assignment", desc: "Your 10% deposit has been received. A handler is being assigned to your case." },
	school_select: { title: "Select schools & programmes", desc: "Choose where to apply, then pay the application invoice." },
	awaiting_invoice: { title: "Awaiting application invoice", desc: "Your handler is reviewing your school selection and will issue the application invoice shortly." },
	application_invoice: { title: "Pay the application invoice", desc: "Settle the Stage II invoice so tracking can begin." },
	school_tracking: { title: "Application tracking", desc: "Follow each school application through the process." },
	visa_invoice: { title: "Pay the visa invoice", desc: "On admission, settle the Stage III invoice to start visa." },
	visa: { title: "Visa tracking", desc: "Your handler processes your visa after you settle the invoice." },
	payment_execution: { title: "Payment plan & service fees", desc: "Choose your payment plan — settle the agency service fee in full or in installments." },
	travel_assistance: { title: "Travel & pre-departure", desc: "Your handler clears you for travel — pay the ticketing fee and work through the pre-departure checklist." },
	completed: { title: "Journey complete", desc: "Everything is settled - thank you for using Century NIT." },
};

/** Which snapshot stat cell a pending action belongs to (for the hot-link hint). */
function statCellForAction(a: PendingAction | null): "consultation" | "app_invoice" | "visa_invoice" | null {
	if (!a) return null;
	if (a.kind === "appointment") return "consultation";
	if (a.kind === "app_invoice") return "app_invoice";
	if (a.kind === "visa_invoice") return "visa_invoice";
	return null;
}

/** Overview - one glance: what to do next, where you are, and your references. */
export function DashboardHome() {
	const {
		journeyPhase,
		pendingAction,
		application,
		booking,
		schoolApplications,
		authUser,
	} = useAppState();
	const { syncFromServer } = useAppState();
	const current = journeyPhase.stage;
	const cta = currentStageCta(current, application.proceedStatus);
	const meta = STAGE_META[current];
	const stageMeta = PROCESS_STAGES.find((s) => s.id === current);
	const hotCell = statCellForAction(pendingAction);
	const selectionConfirmed = Boolean(application.schoolSelectionDoneAt);

	// Reference ID depends on the stage:
	// consultation ref exists once the consultation is booked+paid,
	// application ID exists once the application invoice is paid.
	const consultationRef = booking.confirmationId;
	const applicationId = application.applicationId;
	const appInvoice = application.applicationInvoice;
	const visaInvoice = application.visaInvoice;

	const consultationStatus =
		booking.paymentStatus === "success" && booking.confirmationId
			? "Booked & paid"
			: booking.consultationType
				? "Draft"
				: "Not started";

	return (
		<div className="portal-page dash-home">
			<header className="dash-home__hero">
				<p className="eyebrow">Overview</p>
				<h1 className="page-title mt-1">
					Welcome{authUser ? `, ${authUser.name.split(" ")[0]}` : ""}
				</h1>
				<p className="lead mt-2">
					One glance at your journey - where you are, your reference, and what happens next.
				</p>
				<div className="dash-refs">
					<span className="dash-ref">
						Application ID · <strong>{applicationId ?? "Not issued"}</strong>
					</span>
					<span className="dash-ref">
						Consultation reference · <strong>{consultationRef ?? "Not booked"}</strong>
					</span>
				</div>
		</header>

			{/* Application consent gate — the applicant must say "continue"
				before the case is sent to Ops for handler assignment. */}
			{current === "proceed" &&
				application.applicationId &&
				(application.applicationConsent?.decision ?? null) !== "continue" &&
				(application.applicationConsent?.decision ?? null) !== "opt_out" && (
					<StageConsentCard
						stage="application"
						currentDecision={application.applicationConsent?.decision ?? null}
						title="Continue with your application?"
						lead="Your consultation is complete and your application is ready to start. Continue so we can assign a handler and begin processing your application."
						continueDetail="A handler will be assigned to your case. They'll guide you through document verification, school submission, and offer review. An application fee invoice will be raised for you to pay."
						holdDetail="You can come back and continue with your application whenever you're ready. Nothing is sent to our team until you continue."
						optOutDetail="Your application will be withdrawn. You'll need to start a new consultation if you change your mind later."
						onDecided={() => syncFromServer()}
					/>
				)}

			{/* Action required OR You are here - unified block to prevent duplicate competing banners */}
			{current !== "proceed" && (pendingAction ? (
				<div className="action-now mt-5">
					<div>
						<p className="eyebrow">Action required</p>
						<p className="display action-now__title">{pendingAction.title}</p>
						<p className="action-now__detail">{pendingAction.detail}</p>
					</div>
					<Button to={pendingAction.to} variant="primary" arrow>
						{pendingAction.label}
					</Button>
				</div>
			) : (
				<div className="journey-now mt-5">
					<div>
						<p className="eyebrow">You are here</p>
						<p className="display journey-now__title">
							{STAGE_SHORT[current] ?? stageMeta?.label ?? journeyPhase.label}
						</p>
						<p className="journey-now__detail">{meta.desc}</p>
						{journeyPhase.nextUnlock ? (
							<p className="journey-now__detail">{journeyPhase.nextUnlock}</p>
						) : null}
					</div>
					<Button to={cta.to} variant="inverted" arrow>
						{cta.label}
					</Button>
				</div>
			))}

			{/* Snapshot - stat cells double as shortcuts; the cell belonging to a
			    pending action is highlighted so the way to resolve it is one click. */}
			{current !== "proceed" && (
				<div className="stat-band mt-5">
					<Link
						to="/portal/consultation"
						className={`stat-cell stat-cell--link${hotCell === "consultation" ? " stat-cell--cta" : ""}`}
					>
						<p className="stat-cell__label">
							{hotCell === "consultation" ? "Action required" : "Consultation"}
						</p>
						<p className="stat-cell__value stat-cell__value--sm">
							{hotCell === "consultation" ? "Confirm →" : consultationStatus}
						</p>
					</Link>
					<Link
						to="/portal/financial"
						className={`stat-cell stat-cell--link${hotCell === "app_invoice" ? " stat-cell--cta" : ""}`}
					>
						<p className="stat-cell__label">
							{hotCell === "app_invoice" ? "Action required" : "Application invoice"}
						</p>
						<p className="stat-cell__value stat-cell__value--sm stat-cell__value--cap">
							{hotCell === "app_invoice" ? "Pay now →" : appInvoice.status}
						</p>
						<p className="stat-cell__sub">
							{schoolApplications.length} school{schoolApplications.length === 1 ? "" : "s"}
							{selectionConfirmed ? " · selection locked" : ""}
						</p>
					</Link>
					<Link
						to="/portal/visa"
						className={`stat-cell stat-cell--link${hotCell === "visa_invoice" ? " stat-cell--cta" : ""}`}
					>
						<p className="stat-cell__label">
							{hotCell === "visa_invoice" ? "Action required" : "Visa invoice"}
						</p>
						<p className="stat-cell__value stat-cell__value--sm stat-cell__value--cap">
							{hotCell === "visa_invoice" ? "Pay now →" : visaInvoice.status}
						</p>
						<p className="stat-cell__sub">
							{application.paymentPlanId ? (
								<>Plan · {application.paymentPlanId}</>
							) : (
								"No payment plan"
							)}
						</p>
					</Link>
				</div>
			)}

			{/* Return to marketing website link */}
			<div className="row mt-5">
				<Link to="/" className="link-arrow">
					← Public website
				</Link>
			</div>
		</div>
	);
}
