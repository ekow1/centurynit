import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { useAppState } from "../../context/AppState";
import { PROCESS_STAGES, type ProcessStageId } from "century-nit-core";
import { STAGE_PATH, STAGE_SHORT } from "../../data/stageLabels";

/**
 * Where "continue" goes for the current stage.
 * The label stays short - the stage is already named in the band above the
 * button, so repeating it there just crowds narrow screens.
 */
function currentStageCta(stage: ProcessStageId): { to: string; label: string } {
	return {
		to: STAGE_PATH[stage] ?? "/portal/home",
		label: stage === "completed" ? "View summary" : "Continue",
	};
}

const STAGE_META: Record<ProcessStageId, { title: string; desc: string }> = {
	new: { title: "Start your journey", desc: "Book your first consultation to begin your application with Century NIT." },
	consultation: { title: "Start your consultation", desc: "Book the first meeting, fill your assessment, and pay the consultation fee." },
	eligibility: { title: "Eligibility check", desc: "Our handler reviews your consultation and assessment." },
	proceed: { title: "Confirm you want to proceed", desc: "Review your recommended route, choose your schools, and confirm you want to start your application." },
	school_package: { title: "Choose your school package", desc: "Pick a funding track and degree level to shape school targeting." },
	school_select: { title: "Select schools & programmes", desc: "Choose where to apply, then pay the application invoice." },
	application_invoice: { title: "Pay the application invoice", desc: "Settle the Stage II invoice so tracking can begin." },
	school_tracking: { title: "Application tracking", desc: "Follow each school application through the process." },
	visa_invoice: { title: "Pay the visa invoice", desc: "On admission, settle the Stage III invoice to start visa." },
	visa: { title: "Visa tracking", desc: "Follow the simulated visa process after payment." },
	pre_departure: { title: "Travel & pre-departure", desc: "Flights, accommodation, insurance and your arrival briefing — we stay with you to the door." },
	completed: { title: "Journey complete", desc: "Everything is settled - thank you for using Century NIT." },
};

/** Overview - one glance: where you are, your reference ID, and what's next. */
export function DashboardHome() {
	const {
		journeyPhase,
		application,
		booking,
		schoolApplications,
		authUser,
	} = useAppState();
	const current = journeyPhase.stage;
	const cta = currentStageCta(current);
	const meta = STAGE_META[current];
	const stageMeta = PROCESS_STAGES.find((s) => s.id === current);

	// Reference ID depends on the stage:
	// consultation ref exists once the consultation is booked+paid,
	// application ID exists once the application invoice is paid.
	const consultationRef = booking.confirmationId;
	const applicationId = application.applicationId;

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

			{/* You are here - dark accent band */}
			<div className="journey-now">
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

			{/* Snapshot - border-free stat cells */}
			<div className="stat-band mt-5">
				<div className="stat-cell">
					<p className="stat-cell__label">Consultation</p>
					<p className="stat-cell__value stat-cell__value--sm">
						{booking.paymentStatus === "success" && booking.confirmationId
							? "Booked & paid"
							: booking.consultationType
								? "Draft"
								: "Not started"}
					</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Application invoice</p>
					<p className="stat-cell__value stat-cell__value--sm stat-cell__value--cap">
						{application.applicationInvoice.status}
					</p>
					<p className="stat-cell__sub">
						{schoolApplications.length} school{schoolApplications.length === 1 ? "" : "s"}
					</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Visa invoice</p>
					<p className="stat-cell__value stat-cell__value--sm stat-cell__value--cap">
						{application.visaInvoice.status}
					</p>
					<p className="stat-cell__sub">
						{application.paymentPlanId ? (
							<>Plan · {application.paymentPlanId}</>
						) : (
							"No payment plan"
						)}
					</p>
				</div>
			</div>

			{/* Return to marketing website link */}
			<div className="row mt-5">
				<Link to="/" className="link-arrow">
					← Public website
				</Link>
			</div>
		</div>
	);
}
