import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Money, MoneyInline } from "../../components/ui/Money";
import { Field, Select } from "../../components/ui/Field";
import { StageInvoiceCard } from "../../components/StageInvoiceCard";
import {
	hasAcceptedOffer,
	hasPaymentPlan,
	hasSchoolPackage,
	useAppState,
	type InvoiceLine,
	type SchoolApplicationTrack,
	type StageInvoice,
} from "../../context/AppState";
import {
	APP_INVOICE_BASE,
	APP_INVOICE_PER_SCHOOL,
	destinations,
	formatDualCurrency,
	getDestination,
	getProgram,
	getUniversity,
	programs,
	programsForUniversity,
	SCHOOL_DEGREE_LEVELS,
	PAYMENT_PLANS,
	SCHOOL_FUNDING_TRACKS,
	serviceFeeFor,
	SCHOOL_TRACK_STATUS_LABELS,
	VISA_INVOICE_AMOUNT,
	type SchoolDegreeLevel,
	type PaymentPlanId,
	type SchoolFundingTrack,
	type SchoolTrackStatus,
	universities,
	universitiesForDestination,
	branches,
} from "century-nit-core";
import { meApi, bookingsApi, invoicesApi, schoolsApi, paymentsApi, ApiError } from "century-nit-core/api";
import type { ApiInvoice, AvailabilitySlot, ApiConsultation } from "century-nit-shared";
import { useNotifier } from "../../components/notifier/Notifier";



import { ChapterGate } from "./PortalLayout";

/* ========== Journey ========== */

export function PortalJourney() {
	return <Navigate to="/portal/home" replace />;
}

/* ========== School application package (after eligibility) ========== */

export function PortalPackage() {
	return (
		<ChapterGate chapter="package">
			<SchoolPackageInner />
		</ChapterGate>
	);
}

function SchoolPackageInner() {
	const { application, chooseSchoolPackage, choosePaymentPlan } = useAppState();
	const { toast } = useNotifier();
	const nav = useNavigate();
	const [plan, setPlan] = useState<PaymentPlanId>(application.paymentPlanId || "full");
	const [funding, setFunding] = useState<SchoolFundingTrack | "">(
		application.schoolFundingTrack || "scholarship",
	);
	const [level, setLevel] = useState<SchoolDegreeLevel | "">(
		application.schoolDegreeLevel || "masters",
	);
	const [saving, setSaving] = useState(false);
	const chosen = hasSchoolPackage(application);
	const fundMeta = SCHOOL_FUNDING_TRACKS.find((f) => f.id === (funding || application.schoolFundingTrack));
	const levelMeta = SCHOOL_DEGREE_LEVELS.find((d) => d.id === (level || application.schoolDegreeLevel));

	// The service fee is derived from the funding track, so it is knowable here —
	// this is the honest moment to show it, not after the visa is granted.
	const serviceFee = serviceFeeFor(funding || application.schoolFundingTrack);

	async function confirm() {
		if (!funding || !level || saving) return;
		setSaving(true);
		try {
			// Two commands in sequence: package first, then the payment plan
			// that depends on it. Both target the applicant's latest application,
			// resolved server-side from the session.
			await meApi.choosePackage({ fundingTrack: funding, degreeLevel: level });
			await meApi.choosePaymentPlan({ paymentPlanId: plan });
			// Optimistic local update so the UI reflects the choice immediately;
			// refreshSession re-syncs from the authority in the background.
			chooseSchoolPackage(funding, level);
			choosePaymentPlan(plan);
			toast.success("Package locked. Continue to schools & invoice.");
			nav("/portal/application", { replace: true });
		} catch (err) {
			const msg =
				err instanceof ApiError
					? err.message
					: "Could not save your package. Please try again.";
			toast.error(msg);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">After eligibility · School package</p>
					<h1 className="page-title mt-1">Your school application package</h1>
					<p className="lead mt-2">
						Not a service tier - this is your <strong>academic path package</strong>: how you fund
						study (scholarship / non-scholarship / hybrid) and at which level (BSc, Master&apos;s,
						PhD…). It shapes school targeting on the next screen.
					</p>
				</div>
			</header>

			{chosen ? (
				<div className="alert alert--success mb-4" role="status">
					Package locked:{" "}
					<strong>
						{SCHOOL_FUNDING_TRACKS.find((f) => f.id === application.schoolFundingTrack)?.name} ·{" "}
						{SCHOOL_DEGREE_LEVELS.find((d) => d.id === application.schoolDegreeLevel)?.name}
					</strong>
					. Continue to schools & invoice.
				</div>
			) : null}

			{/* Creative two-axis picker */}
			<section className="mb-5">
				<p className="eyebrow mb-2">1 · Funding track</p>
				<div className="card-grid card-grid--3">
					{SCHOOL_FUNDING_TRACKS.map((f) => (
						<button
							key={f.id}
							type="button"
							className={`card card--pad card--selectable school-pkg-card${funding === f.id ? " card--selected" : ""}`}
							onClick={() => !chosen && setFunding(f.id)}
							disabled={chosen}
							aria-pressed={funding === f.id}
						>
							<span className="school-pkg-card__check" aria-hidden>
								✓
							</span>
							<span className="eyebrow">{f.tagline}</span>
							<span className="school-pkg-card__name display">{f.name}</span>
							<p className="school-pkg-card__blurb muted">{f.blurb}</p>
						</button>
					))}
				</div>
			</section>

			<section className="mb-5">
				<p className="eyebrow mb-2">2 · Degree level</p>
				<div className="degree-chip-grid">
					{SCHOOL_DEGREE_LEVELS.map((d) => (
						<button
							key={d.id}
							type="button"
							className={`degree-chip${level === d.id ? " degree-chip--selected" : ""}`}
							onClick={() => !chosen && setLevel(d.id)}
							disabled={chosen}
							aria-pressed={level === d.id}
						>
							<span className="degree-chip__check" aria-hidden>
								✓
							</span>
							<strong>{d.short}</strong>
							<span className="muted">{d.name}</span>
						</button>
					))}
				</div>
			</section>

			{funding && level ? (
				<div className="card card--pad mb-5 package-compose">
					<div>
						<p className="eyebrow">Your composed package</p>
						<p className="display mt-2" style={{ fontSize: "1.5rem" }}>
							{fundMeta?.name} × {levelMeta?.short}
						</p>
					</div>
					<span className="package-compose__badge mono">
						{chosen ? "Locked" : "Ready to lock"}
					</span>
					<p className="muted package-compose__note">
						Handlers will prioritise schools that match this track and level. You can still add
						multiple institutions on the schools board.
					</p>
				</div>
			) : null}

			{funding && level ? (
				<section className="pkg-cost mb-5">
					<header className="pkg-cost__head">
						<p className="eyebrow">What this package costs</p>
						<p className="pkg-cost__note">
							Shown in full now so nothing appears later as a surprise.
						</p>
					</header>

					<ul className="pkg-cost__lines">
						<li className="pkg-cost__line pkg-cost__line--total">
							<span className="pkg-cost__label">
								Century NIT service fee
								<span className="pkg-cost__when">
									{plan === "full" ? "One payment after visa" : "Three milestones after visa"}
								</span>
							</span>
							<Money usd={serviceFee} className="pkg-cost__amt" />
						</li>
					</ul>

					<div className="pkg-cost__later">
						<p className="pkg-cost__later-item">
							<strong>Application invoice</strong> — raised after you select schools
						</p>
						<p className="pkg-cost__later-item">
							<strong>Visa invoice</strong> — raised on admission
						</p>
					</div>

					<p className="pkg-cost__excl">
						University tuition is <strong>not</strong> included — it is paid to the institution,
						and each school&apos;s figure is shown on the schools board before you apply.
					</p>

					<div className="pkg-plan">
						<p className="eyebrow pkg-plan__q">How would you like to pay the service fee?</p>
						<div className="pkg-plan__opts">
							{PAYMENT_PLANS.map((pl) => (
								<button
									key={pl.id}
									type="button"
									className={`pkg-plan__opt${plan === pl.id ? " pkg-plan__opt--on" : ""}`}
									onClick={() => !chosen && setPlan(pl.id)}
									disabled={chosen}
									aria-pressed={plan === pl.id}
								>
									<span className="pkg-plan__check" aria-hidden>✓</span>
									<span className="pkg-plan__name">{pl.name}</span>
									<span className="pkg-plan__blurb">{pl.blurb}</span>
								</button>
							))}
						</div>
						<p className="pkg-cost__note pkg-plan__foot">
							You can change this later on the Financial page.
						</p>
					</div>
				</section>
			) : null}

			<div className="row mt-4">
				{chosen ? (
					<Button type="button" arrow onClick={() => nav("/portal/application")}>
						Next · Schools & pay
					</Button>
				) : (
					<Button
						type="button"
						onClick={() => void confirm()}
						arrow
						disabled={!funding || !level || saving}
					>
						{saving ? "Locking…" : "Lock package"}
					</Button>
				)}
				<Button to="/portal/consultation" variant="ghost">
					← Consultation
				</Button>
			</div>
		</div>
	);
}

/* ========== Consultation & Assessment ========== */

/**
 * Date and slot picker for the applicant's consultation booking.
 *
 * Replaces a bare `<input type="date">` plus six hard-coded times that checked
 * nothing: an applicant could book a date in the past, a day the branch is
 * closed, or a slot another applicant already had. It now applies the same
 * rules the Operations Center's reschedule panel does, from the same module —
 * when the two drifted, one side offered slots the other considered taken.
 */
function upcomingDates(count = 21): { value: string; label: string }[] {
	const out: { value: string; label: string }[] = [];
	const cursor = new Date();
	cursor.setHours(0, 0, 0, 0);
	cursor.setDate(cursor.getDate() + 1);
	for (let i = 0; i < count; i++) {
		const y = cursor.getFullYear();
		const m = String(cursor.getMonth() + 1).padStart(2, "0");
		const d = String(cursor.getDate()).padStart(2, "0");
		if (cursor.getDay() !== 0) {
			out.push({
				value: `${y}-${m}-${d}`,
				label: cursor.toLocaleDateString(undefined, {
					weekday: "short",
					day: "numeric",
					month: "short",
				}),
			});
		}
		cursor.setDate(cursor.getDate() + 1);
	}
	return out;
}

function browserTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || "Africa/Accra";
	} catch {
		return "Africa/Accra";
	}
}

function SlotPickerLive({
	branchId,
	date,
	onDateChange,
	time,
	onTimeChange,
	durationMinutes = 45,
}: {
	branchId: string;
	date: string;
	onDateChange: (d: string) => void;
	time: string;
	onTimeChange: (t: string) => void;
	durationMinutes?: number;
}) {
	const dates = useMemo(() => upcomingDates(), []);
	const requestKey = `${branchId}|${date}|${durationMinutes}`;
	const [result, setResult] = useState<{ key: string; slots: AvailabilitySlot[] } | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!branchId || !date) return;
		let active = true;
		bookingsApi
			.availability({ branchId, date, durationMinutes })
			.then((res) => {
				if (!active) return;
				setResult({ key: requestKey, slots: res.slots });
				setError(null);
			})
			.catch((err: unknown) => {
				if (!active) return;
				setError(err instanceof Error ? err.message : "Could not load branch availability.");
			});
		return () => {
			active = false;
		};
	}, [branchId, date, durationMinutes, requestKey]);

	const slots = result?.key === requestKey ? result.slots : null;

	return (
		<div>
			<div className="field mb-3">
				<label htmlFor="consult-date">Select Appointment Date</label>
				<select
					id="consult-date"
					className="select select--full-border"
					value={date}
					onChange={(e) => {
						onDateChange(e.target.value);
						onTimeChange("");
					}}
				>
					{dates.map((d) => (
						<option key={d.value} value={d.value}>
							{d.label}
						</option>
					))}
				</select>
			</div>

			<div className="field">
				<label>Available Times ({browserTimeZone()})</label>
				{error && <p className="appt-error mt-1" style={{ color: "#dc2626", fontSize: "0.85rem" }}>{error}</p>}
				{!slots && !error && <p className="muted mt-1" style={{ fontSize: "0.85rem" }}>Checking live availability…</p>}
				{slots && (
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fill, minmax(85px, 1fr))",
							gap: "0.5rem",
							marginTop: "0.5rem",
						}}
					>
						{slots.map((s) => (
							<button
								key={s.time}
								type="button"
								className={`btn btn--sm ${time === s.time ? "btn--primary" : "btn--ghost"}`}
								disabled={!s.available}
								style={{
									border: "1px solid var(--border)",
									opacity: s.available ? 1 : 0.4,
									cursor: s.available ? "pointer" : "not-allowed",
								}}
								onClick={() => onTimeChange(s.time)}
							>
								{s.time}
							</button>
						))}
					</div>
				)}
				{slots?.every((s) => !s.available) && (
					<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
						No open slots on this date. Please choose another date above.
					</p>
				)}
			</div>
		</div>
	);
}

/**
 * 100% Server-backed PortalConsultation
 * Sends bookings to Postgres (century-nit-api) and receives live assessment results from Ops Center.
 */
export function PortalConsultation() {
	const { booking, application } = useAppState();

	const [liveConsultation, setLiveConsultation] = useState<ApiConsultation | null>(null);
	const [loading, setLoading] = useState(true);
	const [submitting, setSubmitting] = useState(false);
	const [bookingError, setBookingError] = useState<string | null>(null);

	// Booking form state
	const [bookingStep, setBookingStep] = useState<1 | 2 | 3>(1);
	const [branchId, setBranchId] = useState(branches[0]?.id ?? "accra-hq");
	const [type, setType] = useState<"online" | "in_person">("online");
	const dates = useMemo(() => upcomingDates(), []);
	const [date, setDate] = useState(dates[0]?.value ?? "");
	const [time, setTime] = useState("");
	const [notes, setNotes] = useState("");
	const [targetCountry, setTargetCountry] = useState(application.destinationId || "Canada");
	const [degreeLevel, setDegreeLevel] = useState("Undergraduate");
	const [currentDegree, setCurrentDegree] = useState(application.highestEducation || "High School");
	const [currentInstitution, setCurrentInstitution] = useState(application.institution || "");
	const [budget, setBudget] = useState("$10,000 - $20,000");
	const [fundingSource, setFundingSource] = useState("Self / Family Funded");

	const refreshLiveCase = useCallback(async () => {
		try {
			const res = await meApi.application();
			setLiveConsultation(res.consultation ?? null);
		} catch {
			/* ignore network drop */
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshLiveCase();
	}, [refreshLiveCase]);

	async function handleCreateBooking(e: React.FormEvent) {
		e.preventDefault();
		if (!time) {
			setBookingError("Please select an appointment time slot.");
			return;
		}
		setSubmitting(true);
		setBookingError(null);

		try {
			// 1. Create real booking row in Postgres & open live consultation case
			await bookingsApi.create({
				serviceId: "consultation",
				branchId,
				type,
				date,
				time,
				durationMinutes: 45,
				timezone: browserTimeZone(),
				notes: notes.trim() || `Interested in studying in ${targetCountry} (${degreeLevel})`,
			});

			// 2. Update real profile in Postgres
			await meApi.updateProfile({
				targetCountry,
				profile: {
					degree: currentDegree,
					institution: currentInstitution,
					degreeLevel,
					budget,
					fundingSource,
				},
			});

			// 3. Reload live consultation case from Postgres
			await refreshLiveCase();
		} catch (err: unknown) {
			setBookingError(
				err instanceof ApiError && err.isSlotTaken
					? "That time slot was just taken by another applicant. Please choose another."
					: err instanceof Error
						? err.message
						: "Could not complete booking. Please try again.",
			);
		} finally {
			setSubmitting(false);
		}
	}

	const hasActiveCase = Boolean(liveConsultation || booking.confirmationId);
	const activeRef = liveConsultation?.reference ?? booking.confirmationId;
	const activeOfficer = liveConsultation?.assignedOfficerName ?? booking.consultantName;
	const activeOutcome = liveConsultation?.assessmentResult?.outcome ?? (booking.consultationPhase === "outcome" ? "Eligible" : null);
	const activeNotes = liveConsultation?.assessmentResult?.notes ?? booking.eligibilityNote;

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · Stage I</p>
					<h1 className="page-title mt-1">Consultation &amp; Assessment</h1>
					<p className="lead mt-2">
						{hasActiveCase
							? "Your consultation appointment and official assessment file with Century NIT."
							: "Schedule your one-on-one advisory consultation with a licensed study abroad counselor."}
					</p>
				</div>
			</header>

			{loading ? (
				<div className="card card--pad text-center py-5">
					<p className="muted">Loading consultation case details…</p>
				</div>
			) : !hasActiveCase ? (
				/* ── Live Booking Form ── */
				<div className="card card--pad mt-4" style={{ maxWidth: "720px" }}>
					<div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem" }}>
						{[
							{ num: 1, label: "Format & Branch" },
							{ num: 2, label: "Date & Time" },
							{ num: 3, label: "Academic Profile" },
						].map((s) => (
							<div
								key={s.num}
								style={{
									flex: 1,
									padding: "0.5rem",
									borderBottom: `3px solid ${bookingStep === s.num ? "var(--primary, #2563eb)" : "var(--border)"}`,
									color: bookingStep === s.num ? "var(--primary, #2563eb)" : "var(--muted)",
									fontWeight: 600,
									fontSize: "0.85rem",
								}}
							>
								{s.num}. {s.label}
							</div>
						))}
					</div>

					<form onSubmit={handleCreateBooking}>
						{bookingStep === 1 && (
							<div>
								<h2 className="section-title mb-2">Select Format &amp; Branch</h2>
								<p className="muted mb-4" style={{ fontSize: "0.9rem" }}>
									Choose whether you would like to meet online via Google Meet or in person at one of our branches.
								</p>

								<div className="card-grid card-grid--2 mb-4">
									{[
										{ id: "online" as const, title: "Online Video Call", sub: "Google Meet · Join from anywhere" },
										{ id: "in_person" as const, title: "In-Person Meeting", sub: "Visit our physical branch office" },
									].map((fmt) => (
										<label
											key={fmt.id}
											style={{
												display: "flex",
												flexDirection: "column",
												gap: "0.35rem",
												padding: "1rem",
												borderRadius: "8px",
												border: `2px solid ${type === fmt.id ? "var(--primary, #2563eb)" : "var(--border)"}`,
												background: type === fmt.id ? "rgba(37, 99, 235, 0.05)" : "transparent",
												cursor: "pointer",
											}}
										>
											<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
												<input
													type="radio"
													name="consult_format"
													checked={type === fmt.id}
													onChange={() => setType(fmt.id)}
												/>
												<strong style={{ fontSize: "1rem" }}>{fmt.title}</strong>
											</div>
											<span className="muted" style={{ fontSize: "0.8rem", paddingLeft: "1.5rem" }}>
												{fmt.sub}
											</span>
										</label>
									))}
								</div>

								<div className="field mb-4">
									<label htmlFor="branch-select">Century NIT Branch</label>
									<select
										id="branch-select"
										className="select select--full-border"
										value={branchId}
										onChange={(e) => {
											setBranchId(e.target.value);
											setTime("");
										}}
									>
										{branches.map((b) => (
											<option key={b.id} value={b.id}>
												{b.name} ({b.city})
											</option>
										))}
									</select>
								</div>

								<div className="row mt-4" style={{ justifyContent: "flex-end" }}>
									<Button type="button" onClick={() => setBookingStep(2)} arrow>
										Continue to Date &amp; Time →
									</Button>
								</div>
							</div>
						)}

						{bookingStep === 2 && (
							<div>
								<h2 className="section-title mb-2">Choose Date &amp; Slot</h2>
								<p className="muted mb-4" style={{ fontSize: "0.9rem" }}>
									Live appointment slots are fetched in real-time for your selected branch.
								</p>

								<SlotPickerLive
									branchId={branchId}
									date={date}
									onDateChange={setDate}
									time={time}
									onTimeChange={setTime}
								/>

								<div className="row mt-4" style={{ justifyContent: "space-between" }}>
									<Button type="button" variant="ghost" onClick={() => setBookingStep(1)}>
										← Back
									</Button>
									<Button
										type="button"
										disabled={!time}
										onClick={() => setBookingStep(3)}
										arrow
									>
										Continue to Background Details →
									</Button>
								</div>
							</div>
						)}

						{bookingStep === 3 && (
							<div>
								<h2 className="section-title mb-2">Academic Profile &amp; Goals</h2>
								<p className="muted mb-4" style={{ fontSize: "0.9rem" }}>
									Help your assigned counselor prepare recommendations prior to your session.
								</p>

								<div className="form-grid form-grid--2 mb-3">
									<div className="field">
										<label htmlFor="target-country">Target Study Destination</label>
										<select
											id="target-country"
											className="select select--full-border"
											value={targetCountry}
											onChange={(e) => setTargetCountry(e.target.value)}
										>
											{destinations.map((d) => (
												<option key={d.id} value={d.name}>
													{d.name}
												</option>
											))}
										</select>
									</div>

									<div className="field">
										<label htmlFor="degree-level">Desired Program Level</label>
										<select
											id="degree-level"
											className="select select--full-border"
											value={degreeLevel}
											onChange={(e) => setDegreeLevel(e.target.value)}
										>
											<option value="Undergraduate">Undergraduate (Bachelor's)</option>
											<option value="Postgraduate">Postgraduate (Master's / MBA)</option>
											<option value="Doctorate">Doctorate (PhD)</option>
											<option value="Diploma">Diploma / Pathway</option>
										</select>
									</div>
								</div>

								<div className="form-grid form-grid--2 mb-3">
									<div className="field">
										<label htmlFor="highest-degree">Current Highest Qualification</label>
										<input
											id="highest-degree"
											className="input input--full-border"
											placeholder="e.g. WASSCE / BSc Economics"
											value={currentDegree}
											onChange={(e) => setCurrentDegree(e.target.value)}
										/>
									</div>

									<div className="field">
										<label htmlFor="institution">Current / Previous School</label>
										<input
											id="institution"
											className="input input--full-border"
											placeholder="e.g. University of Ghana"
											value={currentInstitution}
											onChange={(e) => setCurrentInstitution(e.target.value)}
										/>
									</div>
								</div>

								<div className="form-grid form-grid--2 mb-3">
									<div className="field">
										<label htmlFor="funding-source">Primary Funding Source</label>
										<select
											id="funding-source"
											className="select select--full-border"
											value={fundingSource}
											onChange={(e) => setFundingSource(e.target.value)}
										>
											<option value="Self / Family Funded">Self / Family Funded</option>
											<option value="Seeking Scholarship / Aid">Seeking Scholarship / Partial Aid</option>
											<option value="Corporate / Government Sponsor">Corporate / Government Sponsor</option>
										</select>
									</div>

									<div className="field">
										<label htmlFor="est-budget">Estimated Annual Budget (Tuition + Living)</label>
										<select
											id="est-budget"
											className="select select--full-border"
											value={budget}
											onChange={(e) => setBudget(e.target.value)}
										>
											<option value="Under $10,000">Under $10,000 / year</option>
											<option value="$10,000 - $20,000">$10,000 - $20,000 / year</option>
											<option value="$20,000 - $35,000">$20,000 - $35,000 / year</option>
											<option value="$35,000+">$35,000+ / year</option>
										</select>
									</div>
								</div>

								<div className="field mb-4">
									<label htmlFor="consult-notes">Questions / Specific Goals for Counselor</label>
									<textarea
										id="consult-notes"
										className="input input--full-border"
										rows={2}
										placeholder="Mention any specific programs, scholarship goals, or visa questions you'd like covered."
										value={notes}
										onChange={(e) => setNotes(e.target.value)}
									/>
								</div>

								{bookingError && (
									<div
										style={{
											padding: "0.75rem 1rem",
											background: "#fef2f2",
											border: "1px solid #fecaca",
											borderRadius: "6px",
											color: "#dc2626",
											fontSize: "0.875rem",
											marginBottom: "1rem",
										}}
									>
										{bookingError}
									</div>
								)}

								<div className="row mt-4" style={{ justifyContent: "space-between" }}>
									<Button type="button" variant="ghost" onClick={() => setBookingStep(2)}>
										← Back
									</Button>
									<Button type="submit" disabled={submitting} arrow>
										{submitting ? "Confirming Booking…" : "Confirm & Schedule Consultation ✓"}
									</Button>
								</div>
							</div>
						)}
					</form>
				</div>
			) : (
				/* ── Live Consultation File Dashboard ── */
				<div style={{ display: "flex", flexDirection: "column", gap: "1.5rem", marginTop: "1rem" }}>
					{/* Status Header Card */}
					<div
						className="card card--pad"
						style={{
							borderLeft: "4px solid var(--primary, #2563eb)",
							display: "flex",
							justifyContent: "space-between",
							alignItems: "flex-start",
							flexWrap: "wrap",
							gap: "1rem",
						}}
					>
						<div>
							<div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
								<span className="portal-pill portal-pill--active" style={{ fontWeight: 600 }}>
									Case Ref: {activeRef}
								</span>
								<span
									className="portal-pill"
									style={{
										background:
											liveConsultation?.status === "COMPLETED"
												? "#dcfce7"
												: liveConsultation?.status === "IN_ASSESSMENT"
													? "#e0e7ff"
													: "#fef3c7",
										color:
											liveConsultation?.status === "COMPLETED"
												? "#166534"
												: liveConsultation?.status === "IN_ASSESSMENT"
													? "#3730a3"
													: "#92400e",
										fontWeight: 600,
									}}
								>
									{liveConsultation?.status === "COMPLETED"
										? "✓ Assessment Completed"
										: liveConsultation?.status === "IN_ASSESSMENT"
											? "In Assessment"
											: liveConsultation?.status === "ASSIGNED"
												? "Consultant Assigned"
												: "Awaiting Staff Assignment"}
								</span>
							</div>

							<h2 className="section-title mt-2 mb-1">
								{liveConsultation?.type === "in_person" ? "In-Person Consultation" : "Online Advisory Session"}
							</h2>
							<p className="muted" style={{ fontSize: "0.9rem" }}>
								Branch: <strong>{liveConsultation?.branch ?? booking.branchId}</strong> ·{" "}
								{liveConsultation?.startsAt
									? new Date(liveConsultation.startsAt).toLocaleString(undefined, {
											weekday: "short",
											year: "numeric",
											month: "short",
											day: "numeric",
											hour: "2-digit",
											minute: "2-digit",
										})
									: booking.date
										? `${booking.date} at ${booking.time}`
										: "Scheduled"}
							</p>
						</div>

						{liveConsultation?.meetingUrl && (
							<a
								href={liveConsultation.meetingUrl}
								target="_blank"
								rel="noopener noreferrer"
								className="btn btn--primary btn--sm"
								style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem" }}
							>
								📹 Join Google Meet
							</a>
						)}
					</div>

					{/* Assigned Advisor Info */}
					<div className="card card--pad">
						<h3 className="section-title mb-2" style={{ fontSize: "1.1rem" }}>
							Assigned Academic Counselor
						</h3>
						{activeOfficer ? (
							<div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
								<div
									style={{
										width: "44px",
										height: "44px",
										borderRadius: "50%",
										background: "var(--primary, #2563eb)",
										color: "#fff",
										display: "flex",
										alignItems: "center",
										justifyContent: "center",
										fontWeight: 700,
										fontSize: "1.1rem",
									}}
								>
									{activeOfficer.slice(0, 1)}
								</div>
								<div>
									<p style={{ fontWeight: 600, margin: 0 }}>{activeOfficer}</p>
									<p className="muted" style={{ fontSize: "0.85rem", margin: "0.15rem 0 0" }}>
										{liveConsultation?.assignedOfficerEmail ?? "Senior Admissions & Visa Specialist"}
									</p>
								</div>
							</div>
						) : (
							<p className="muted" style={{ fontSize: "0.9rem", margin: 0 }}>
								Your file is currently in the intake queue. A designated advisor at the{" "}
								<strong>{liveConsultation?.branch ?? booking.branchId}</strong> branch is being assigned.
							</p>
						)}
					</div>

					{/* Assessment Outcome & Recommendations */}
					{activeOutcome && (
						<div
							className="card card--pad"
							style={{
								background: activeOutcome === "Eligible" ? "rgba(22, 101, 52, 0.04)" : "#fff",
								border: `1px solid ${activeOutcome === "Eligible" ? "#86efac" : "var(--border)"}`,
							}}
						>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.5rem" }}>
								<span className="eyebrow" style={{ color: "#166534", fontWeight: 700 }}>
									Official Counselor Assessment Result
								</span>
								<span
									className="portal-pill"
									style={{
										background: activeOutcome === "Eligible" ? "#dcfce7" : "#fef3c7",
										color: activeOutcome === "Eligible" ? "#166534" : "#92400e",
										fontWeight: 700,
										fontSize: "0.9rem",
									}}
								>
									{activeOutcome}
								</span>
							</div>

							{activeNotes && (
								<div className="mt-3">
									<p className="eyebrow mb-1" style={{ fontSize: "0.75rem", color: "#64748b" }}>
										Counselor Assessment Notes
									</p>
									<p style={{ fontSize: "0.95rem", lineHeight: 1.6, margin: 0 }}>{activeNotes}</p>
								</div>
							)}

							{liveConsultation?.assessmentResult && (
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
										gap: "1rem",
										marginTop: "1.25rem",
										paddingTop: "1rem",
										borderTop: "1px dashed var(--border)",
									}}
								>
									{liveConsultation.assessmentResult.recCountry && (
										<div>
											<span className="muted" style={{ fontSize: "0.75rem", display: "block" }}>Recommended Destination</span>
											<strong style={{ fontSize: "0.95rem" }}>{liveConsultation.assessmentResult.recCountry}</strong>
										</div>
									)}
									{liveConsultation.assessmentResult.recUniversity && (
										<div>
											<span className="muted" style={{ fontSize: "0.75rem", display: "block" }}>Recommended Institution</span>
											<strong style={{ fontSize: "0.95rem" }}>{liveConsultation.assessmentResult.recUniversity}</strong>
										</div>
									)}
									{liveConsultation.assessmentResult.recProgram && (
										<div>
											<span className="muted" style={{ fontSize: "0.75rem", display: "block" }}>Recommended Program</span>
											<strong style={{ fontSize: "0.95rem" }}>{liveConsultation.assessmentResult.recProgram}</strong>
										</div>
									)}
									{liveConsultation.assessmentResult.recPackage && (
										<div>
											<span className="muted" style={{ fontSize: "0.75rem", display: "block" }}>Recommended Package</span>
											<strong style={{ fontSize: "0.95rem", color: "var(--primary, #2563eb)" }}>
												{liveConsultation.assessmentResult.recPackage}
											</strong>
										</div>
									)}
								</div>
							)}

							<div className="row mt-4" style={{ justifyContent: "flex-end" }}>
								<Button to="/portal/package" arrow>
									Proceed to Stage II: School Package Selection →
								</Button>
							</div>
						</div>
					)}

					{/* Requested Documents from Consultant */}
					{liveConsultation?.requestedDocuments && liveConsultation.requestedDocuments.length > 0 && (
						<div
							className="card card--pad"
							style={{ background: "#fffbeb", border: "1px solid #fde68a" }}
						>
							<h3 className="section-title mb-1" style={{ color: "#92400e", fontSize: "1.05rem" }}>
								Action Required: Documents Requested by Counselor
							</h3>
							<p className="muted mb-3" style={{ fontSize: "0.85rem", color: "#b45309" }}>
								Please upload these items to your document vault for verification:
							</p>
							<ul style={{ paddingLeft: "1.2rem", margin: "0 0 1rem 0", color: "#92400e" }}>
								{liveConsultation.requestedDocuments.map((doc) => (
									<li key={doc} style={{ marginBottom: "0.25rem" }}>{doc}</li>
								))}
							</ul>
							<Button to="/portal/documents" variant="secondary">
								Upload Documents in Vault →
							</Button>
						</div>
					)}

					{/* Live Messages / Comments from Advisor */}
					{liveConsultation?.comments && liveConsultation.comments.length > 0 && (
						<div className="card card--pad">
							<h3 className="section-title mb-3" style={{ fontSize: "1.05rem" }}>
								Counselor Communications
							</h3>
							<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
								{liveConsultation.comments.map((cm) => (
									<div
										key={cm.id}
										style={{
											padding: "0.75rem",
											borderRadius: "6px",
											background: "var(--surface-muted, #f8fafc)",
											border: "1px solid var(--border)",
										}}
									>
										<div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.25rem" }}>
											<strong style={{ fontSize: "0.85rem" }}>{cm.author}</strong>
											<span className="muted" style={{ fontSize: "0.75rem" }}>
												{new Date(cm.at).toLocaleDateString()}
											</span>
										</div>
										<p style={{ margin: 0, fontSize: "0.9rem" }}>{cm.text}</p>
									</div>
								))}
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/* ========== Payment plan ==========
   No longer a journey stage. The plan is chosen with the school package and
   managed from Financial; this route only exists so old links still land
   somewhere sensible. */

export function PortalPaymentPlan() {
	return <Navigate to="/portal/financial" replace />;
}


/* ========== Service fee ==========
   Settlement moved to Financial alongside the invoices — one money surface. */

export function PortalAgency() {
	return <Navigate to="/portal/financial" replace />;
}


/* ========== Application stage: invoice + school select + tracking ========== */

export function PortalApplicationHub() {
	return (
		<ChapterGate chapter="application">
			<ApplicationHubInner />
		</ChapterGate>
	);
}

function ApplicationHubInner() {
	const {
		application,
		payApplicationInvoice,
		schoolApplications,
		addSchoolApplication,
		removeSchoolApplication,
		lockSchoolSelection,
		booking,
	} = useAppState();
	const nav = useNavigate();

	const [serverInvoice, setServerInvoice] = useState<ApiInvoice | null>(null);

	const fetchInvoice = useCallback(() => {
		invoicesApi
			.list()
			.then((res) => {
				const found = res.invoices.find((i) => i.type === "application");
				if (found) setServerInvoice(found);
			})
			.catch(() => {});
	}, []);

	useEffect(() => {
		fetchInvoice();
	}, [fetchInvoice]);

	const inv = application.applicationInvoice;

	const effectiveInv: StageInvoice = useMemo(() => {
		if (!serverInvoice) return inv;
		const isProforma = serverInvoice.status === "proforma";
		const isPaid = serverInvoice.status === "paid";
		const isRaised =
			serverInvoice.status === "issued" ||
			serverInvoice.status === "partial" ||
			serverInvoice.status === "overdue";

		const lines: InvoiceLine[] = serverInvoice.lines.map((l) => ({
			id: l.id,
			label: l.label,
			detail: l.detail || "",
			amount: l.amountCents / 100,
		}));

		return {
			id: serverInvoice.invoiceNumber,
			amount:
				serverInvoice.balanceCents > 0
					? serverInvoice.balanceCents / 100
					: serverInvoice.subtotalCents / 100,
			status: isPaid ? "paid" : isRaised ? "raised" : isProforma ? "estimated" : "none",
			raisedAt: serverInvoice.createdAt,
			paidAt: isPaid ? serverInvoice.updatedAt : null,
			description: isProforma
				? "Proforma estimate — your consultant is reviewing and will confirm the final figures."
				: isRaised
					? `Official invoice ${serverInvoice.invoiceNumber} issued by ${serverInvoice.issuedByName}`
					: isPaid
						? `Settled in full (${serverInvoice.invoiceNumber})`
						: inv.description,
			estimatedAmount: serverInvoice.subtotalCents / 100,
			estimateLines: lines,
			actualAmount: isRaised || isPaid ? serverInvoice.subtotalCents / 100 : null,
			actualLines: isRaised || isPaid ? lines : [],
			consultantNote: serverInvoice.note,
		};
	}, [serverInvoice, inv]);

	// Sum in USD — `tuition` is a display string in each university's own currency
	const tuitionTotal = schoolApplications.reduce(
		(n, s) => n + (getProgram(s.programId)?.tuitionUsd ?? 0),
		0,
	);
	const selectionDone = Boolean(application.schoolSelectionDoneAt) || Boolean(serverInvoice);
	const paid = effectiveInv.status === "paid" || inv.status === "paid";
	const [destId, setDestId] = useState("");
	const [uniId, setUniId] = useState("");
	const [progId, setProgId] = useState("");
	const [intake, setIntake] = useState("");
	const [payPhase, setPayPhase] = useState<"idle" | "loading">("idle");
	const { toast } = useNotifier();

	const uniList = destId ? universitiesForDestination(destId) : universities;
	const progList = uniId ? programsForUniversity(uniId) : programs;
	const program = getProgram(progId);
	const intakes = program?.intake ?? ["September 2026", "January 2027"];
	const previewAmount =
		APP_INVOICE_BASE + Math.max(0, schoolApplications.length) * APP_INVOICE_PER_SCHOOL;

	async function payInvoice() {
		setPayPhase("loading");
		try {
			const { invoices } = await invoicesApi.list();
			const backend = invoices.find((i) => i.type === "application" && i.balanceCents > 0);
			if (!backend) {
				toast.error(
					"Your application invoice has not been issued on the server yet. Ask your consultant to raise it.",
				);
				return;
			}
			if (backend.status === "proforma") {
				toast.error(
					"This invoice is currently in review as a proforma estimate. Your consultant will issue the final invoice shortly.",
				);
				return;
			}
			try {
				// Real Paystack checkout via paymentsApi
				const checkout = await paymentsApi.initialize({
					invoiceId: backend.id,
					gateway: "paystack",
				});
				if (checkout.authorizationUrl && checkout.authorizationUrl.startsWith("http")) {
					window.location.href = checkout.authorizationUrl;
					return;
				}
			} catch (err) {
				// Fallback to server-side record path if payment gateway offline
				if (!(err instanceof ApiError && err.code === "PAYMENT_GATEWAY_UNCONFIGURED")) {
					console.warn("Gateway init fallback:", err);
				}
			}
			await meApi.payInvoice(backend.id, {
				amountCents: backend.balanceCents,
				method: "card",
				gateway: "manual",
				reference: `PAY-${Date.now()}`,
			});
			payApplicationInvoice();
			fetchInvoice();
			toast.success("Payment recorded. Tracking is now unlocked.");
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Payment could not be processed. Please try again.",
			);
		} finally {
			setPayPhase("idle");
		}
	}

	function addSchool(e: FormEvent) {
		e.preventDefault();
		const d = destId || destinations[0]?.id || "uk";
		const uList = universitiesForDestination(d);
		const u = uniId || uList[0]?.id || universities[0]?.id || "";
		const pList = programsForUniversity(u);
		const p = progId || pList[0]?.id || programs[0]?.id || "";
		const i = intake || "September 2026";
		addSchoolApplication({
			destinationId: d,
			universityId: u,
			programId: p,
			intake: i,
		});
		schoolsApi
			.add({
				destinationId: d,
				universityId: u,
				programId: p,
				intake: i,
			})
			.catch((err) => console.warn("Failed to sync school to server", err));
		setProgId("");
		setIntake("");
	}

	function handleRemoveSchool(schoolId: string) {
		removeSchoolApplication(schoolId);
		schoolsApi.remove(schoolId).catch((err) => console.warn("Failed to remove school from server", err));
	}

	async function handleLockSelection() {
		try {
			await schoolsApi.lock();
			fetchInvoice();
		} catch (err) {
			console.warn("Failed to sync lock to server", err);
		}
		lockSchoolSelection();
	}



	if (payPhase === "loading") {
		return (
			<div className="loading-overlay">
				<div className="spinner" aria-hidden />
				<p className="mono">Contacting payment provider…</p>
				<p className="muted">Charging {formatDualCurrency(inv.amount || previewAmount)}</p>
			</div>
		);
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · Schools & pay</p>
					<h1 className="page-title mt-1">Select schools · pay invoice</h1>
					<p className="lead mt-2">
						Pick schools, confirm the list, pay the invoice. Tracking is a{" "}
						<strong>separate next stage</strong> - after payment, click Next to open it (sidebar
						unlocks).
						{booking.assessment.firstName ? ` · ${booking.assessment.firstName}` : ""}
					</p>
				</div>
			</header>

			<ol className="mini-steps mb-4">
				<li className={schoolApplications.length || selectionDone ? "is-done" : "is-current"}>
					1 · Select
				</li>
				<li className={selectionDone ? (paid ? "is-done" : "is-current") : ""}>
					2 · Invoice & pay
				</li>
				<li className={paid ? "is-done" : ""}>3 · Next → Tracking</li>
			</ol>

			{/* 1 · Selection */}
			{!selectionDone ? (
				<section className="mb-5">
					<p className="eyebrow mb-2">Select schools & programmes</p>
					<div className="application-select">
						<form className="form-shell card card--pad" onSubmit={addSchool}>
							<div className="form-grid form-grid--2">
								<Field label="Destination" htmlFor="s-dest">
									<Select
										id="s-dest"
										value={destId}
										onChange={(e) => {
											setDestId(e.target.value);
											setUniId("");
											setProgId("");
											setIntake("");
										}}
										fullBorder
									>
										<option value="">Any / pick</option>
										{destinations.map((d) => (
											<option key={d.id} value={d.id}>
												{d.flag} {d.name}
											</option>
										))}
									</Select>
								</Field>
								<Field label="University" htmlFor="s-uni">
									<Select
										id="s-uni"
										value={uniId}
										onChange={(e) => {
											setUniId(e.target.value);
											setProgId("");
											setIntake("");
										}}
										fullBorder
									>
										<option value="">Any / pick</option>
										{uniList.map((u) => (
											<option key={u.id} value={u.id}>
												{u.name}
											</option>
										))}
									</Select>
								</Field>
								<Field label="Programme" htmlFor="s-prog">
									<Select
										id="s-prog"
									value={progId}
									onChange={(e) => {
										setProgId(e.target.value);
										setIntake("");
									}}
									fullBorder
								>
									<option value="">Any / pick</option>
									{(progList.length ? progList : programs).map((p) => (
										<option key={p.id} value={p.id}>
											{p.name}
										</option>
									))}
								</Select>
							</Field>
							<Field label="Intake" htmlFor="s-int">
								<Select
									id="s-int"
									value={intake}
									onChange={(e) => setIntake(e.target.value)}
									fullBorder
								>
									<option value="">Any / pick</option>
									{intakes.map((i) => (
										<option key={i} value={i}>
											{i}
										</option>
									))}
								</Select>
							</Field>
						</div>
						{/* The figure that should influence the choice, shown before it is made */}
						{program ? (
							<p className="tuition-peek mt-2">
								<span className="tuition-peek__label mono">Tuition</span>
								<span className="tuition-peek__fig">{program.tuition}</span>
								<span className="tuition-peek__usd mono">
									≈ {formatDualCurrency(program.tuitionUsd)} · paid to the university
								</span>
							</p>
						) : null}

						<div className="row mt-3">
							<Button type="submit" variant="secondary">
								Add school
							</Button>

							{schoolApplications.length > 0 ? (
								<>
									<ul className="school-track-list mt-3">
										{schoolApplications.map((s) => {
											const prog = getProgram(s.programId);
											return (
												<li key={s.id} className="school-track-card">
													<div className="school-track-card__main">
														<strong>
															{getUniversity(s.universityId)?.name} · {prog?.name}
														</strong>
														<p className="muted">{s.intake}</p>
														{prog ? (
															<p className="school-tuition">
																<span className="school-tuition__fig">{prog.tuition}</span>
																<span className="school-tuition__note">
																	tuition · paid to the university
																</span>
															</p>
														) : null}
													</div>
													<button
														type="button"
														className="btn btn--ghost btn--sm"
														onClick={() => handleRemoveSchool(s.id)}
													>
														Remove
													</button>
												</li>
											);
										})}
									</ul>

									{/* Makes the shortlist a financial decision, not only an academic one */}
									<div className="tuition-tally mt-3">
										<div className="tuition-tally__row">
											<span className="tuition-tally__label">
												Estimated tuition across {schoolApplications.length} school
												{schoolApplications.length === 1 ? "" : "s"}
												<span className="tuition-tally__sub">
													Indicative first-year figures, converted from each
													university&apos;s own currency
												</span>
											</span>
											<Money usd={tuitionTotal} className="tuition-tally__amt" />
										</div>
										<p className="tuition-tally__note">
											You will not be charged this by Century NIT — it is paid to whichever
											institution you accept. You only pay tuition for the{" "}
											<strong>one</strong> school you take up.
										</p>
									</div>
								</>
							) : null}
						</div>
					</form>
					</div>

					{schoolApplications.length > 0 ? (
						<div className="row mt-4">
							<Button type="button" onClick={handleLockSelection}>
								Confirm school list & raise invoice
							</Button>
						</div>
					) : (
						<p className="mono muted mt-3">Add at least one school to continue.</p>
					)}

				</section>
			) : null}

			{/* 2 · Invoice only on this page */}
			{selectionDone ? (
				<StageInvoiceCard
					invoice={effectiveInv}
					title="Application invoice"
					onPay={payInvoice}
					meta={
						<ul className="portal-snapshot" style={{ maxWidth: "20rem" }}>
							<li>
								<span>Schools</span>
								<strong>{schoolApplications.length}</strong>
							</li>
							<li>
								<span>Base</span>
								<strong>{formatDualCurrency(APP_INVOICE_BASE)}</strong>
							</li>
							<li>
								<span>Per school</span>
								<strong>{formatDualCurrency(APP_INVOICE_PER_SCHOOL)}</strong>
							</li>
						</ul>
					}
				/>
			) : (
				<p className="mono muted mb-4">Confirm your school list to raise the invoice.</p>
			)}


			{/* After pay: Next → Tracking page (not embedded here) */}
			{paid ? (
				<div className="card card--pad next-action">
					<p className="eyebrow">Payment complete</p>
					<p className="display mt-1" style={{ fontSize: "1.35rem" }}>
						Tracking is unlocked in the sidebar
					</p>
					<p className="muted mt-2">
						Process / track is a separate stage. Click Next to open it.
					</p>
					<div className="row mt-4">
						<Button
							type="button"
							arrow
							onClick={() => nav("/portal/tracking")}
						>
							Next · Open tracking
						</Button>
						<Button to="/portal/home" variant="ghost">
							Dashboard home
						</Button>
					</div>
				</div>
			) : null}
		</div>
	);
}

/* ========== Tracking - own dashboard stage after payment ========== */

export function PortalTrackingPage() {
	return (
		<ChapterGate chapter="tracking">
			<TrackingPageInner />
		</ChapterGate>
	);
}

function TrackingPageInner() {
	const { schoolApplications, application } = useAppState();
	const paid = application.applicationInvoice.status === "paid";
	const acceptedCount = schoolApplications.filter((s) => s.status === "accepted").length;

	if (!paid) {
		return (
			<div className="portal-page">
				<p className="eyebrow">Tracking</p>
				<h1 className="page-title mt-1">Pay first</h1>
				<p className="lead mt-2">Tracking unlocks after the application invoice is paid.</p>
				<Button to="/portal/application" arrow>
					Back to schools & pay
				</Button>
			</div>
		);
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · Tracking</p>
					<h1 className="page-title mt-1">Application process</h1>
					<p className="lead mt-2">
						Watch your school applications move through the review pipeline. Your consultant posts
						updates as institutions respond.
					</p>
				</div>
			</header>

			<div className="stat-band mt-4">
				<div className="stat-cell">
					<p className="stat-cell__label">Schools</p>
					<p className="stat-cell__value">{schoolApplications.length}</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Offers</p>
					<p className="stat-cell__value">
						{schoolApplications.filter((s) => s.status === "offer" || s.status === "accepted").length}
					</p>
				</div>
				<div className="stat-cell stat-cell--accent">
					<p className="stat-cell__label">Admitted</p>
					<p className="stat-cell__value">{acceptedCount}</p>
				</div>
				<div className="stat-cell">
					<p className="stat-cell__label">Payment</p>
					<p className="stat-cell__value">
						<Money usd={application.applicationInvoice.amount} />
					</p>
				</div>
			</div>

			<div className="card card--pad mt-5" style={{ background: "var(--foreground)", color: "var(--background)" }}>
				<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
					<span style={{ fontSize: "1.5rem" }}>✓</span>
					<div>
						<p style={{ fontWeight: 600 }}>Application invoice paid</p>
						<p className="muted" style={{ color: "rgba(255,255,255,0.75)" }}>
							<MoneyInline usd={application.applicationInvoice.amount} /> received · processing
							started
						</p>
					</div>
				</div>
			</div>

			<div className="mt-6">
				<div className="between" style={{ marginBottom: "1rem" }}>
					<p className="eyebrow">Schools · {schoolApplications.length} selected</p>
				</div>
				<ul className="school-track-list school-track-list--grid" style={{ gap: "1.5rem" }}>
					{schoolApplications.map((s) => (
						<SchoolTrackCard key={s.id} row={s} canRemove={false} onRemove={() => undefined} />
					))}
				</ul>
			</div>

			{acceptedCount > 0 ? (
				<div className="card card--pad mt-6 next-action" style={{ border: "2px solid var(--foreground)" }}>
					<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
						<div>
							<p className="eyebrow">Admitted · {acceptedCount} school(s)</p>
							<p className="display mt-1" style={{ fontSize: "1.35rem" }}>
								Ready for the visa stage
							</p>
							<p className="muted mt-2">
								Pay the visa invoice, then visa processing begins.
							</p>
						</div>
						<Button to="/portal/visa" arrow>
							Next · Visa & travel
						</Button>
					</div>
				</div>
			) : (
				<div className="card card--pad mt-6">
					<p className="eyebrow">In progress</p>
					<p className="muted mt-2">
						First school reaches <strong>Accepted</strong> to unlock the visa stage. This is
						automated in the simulation.
					</p>
				</div>
			)}
		</div>
	);
}

/**
 * What the university is asking for, once an offer exists.
 *
 * Deliberately styled apart from every Century NIT money surface — this is
 * paid to the institution. The deposit deadline is given the most weight
 * because missing it forfeits the place.
 */
function OfferTerms({ row }: { row: SchoolApplicationTrack }) {
	const due = row.offerDepositDueAt ? new Date(row.offerDepositDueAt) : null;
	const paid = Boolean(row.offerDepositPaidAt);

	// The clock is external state, so it is read after paint rather than during
	// render. The deadline itself shows immediately; only the countdown waits.
	const [daysLeft, setDaysLeft] = useState<number | null>(null);
	useEffect(() => {
		if (!row.offerDepositDueAt) return;
		const target = new Date(row.offerDepositDueAt).getTime();
		const tick = () => setDaysLeft(Math.ceil((target - Date.now()) / 86_400_000));
		tick();
		const id = window.setInterval(tick, 60_000);
		return () => window.clearInterval(id);
	}, [row.offerDepositDueAt]);

	const urgent = daysLeft !== null && daysLeft <= 14;

	return (
		<div className="offer-terms">
			<p className="offer-terms__head mono">Offer terms · payable to {"the university"}</p>

			<div className="offer-terms__grid">
				<div className="offer-terms__cell">
					<span className="offer-terms__label mono">Tuition</span>
					<span className="offer-terms__native">{row.offerTuitionLabel}</span>
					<Money usd={row.offerTuitionUsd ?? 0} className="offer-terms__money" />
				</div>

				{row.offerDepositUsd ? (
					<div className="offer-terms__cell">
						<span className="offer-terms__label mono">Deposit to hold your place</span>
						<Money usd={row.offerDepositUsd} className="offer-terms__money" />
					</div>
				) : null}
			</div>

			{due ? (
				<p
					className={`offer-terms__due${urgent && !paid ? " offer-terms__due--urgent" : ""}${paid ? " offer-terms__due--paid" : ""}`}
				>
					{paid ? (
						<>Deposit paid {new Date(row.offerDepositPaidAt!).toLocaleDateString()}</>
					) : (
						<>
							<strong>
								Deposit due {due.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}
							</strong>
							{daysLeft !== null ? (
								<span className="offer-terms__countdown">
									{daysLeft > 0
										? ` · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left`
										: " · overdue"}
								</span>
							) : null}
							<span className="offer-terms__warn">
								The place is not held until the university receives this.
							</span>
						</>
					)}
				</p>
			) : null}
		</div>
	);
}

const TRACK_PIPELINE: SchoolTrackStatus[] = [
	"queued",
	"submitted",
	"under_review",
	"offer",
	"accepted",
];

/** Read-only school card - applicant sees handler updates, cannot edit them */
function SchoolTrackCard({
	row,
	canRemove,
	onRemove,
}: {
	row: SchoolApplicationTrack;
	canRemove: boolean;
	onRemove: () => void;
}) {
	const dest = getDestination(row.destinationId);
	const uni = getUniversity(row.universityId);
	const program = getProgram(row.programId);
	const curIdx = Math.max(0, TRACK_PIPELINE.indexOf(row.status));
	const events = [...(row.events ?? [])].reverse();

	return (
		<li className={`school-track-card school-track-card--${row.status}`}>
			<div className="school-track-card__main">
				<div className="between" style={{ gap: "1rem", flexWrap: "wrap", alignItems: "flex-start" }}>
					<div>
						<p className="eyebrow" style={{ fontSize: "0.7rem" }}>
							{dest?.flag} {dest?.name}
						</p>
						<strong className="display mt-1" style={{ fontSize: "1.4rem", display: "block" }}>
							{uni?.name}
						</strong>
						<p className="muted" style={{ fontSize: "0.9rem" }}>
							{program?.name} · {row.intake}
						</p>
					</div>
					<span className={`track-status-pill track-status-pill--${row.status}`}>
						{SCHOOL_TRACK_STATUS_LABELS[row.status]}
					</span>
				</div>

				{/* Offer terms — the institution's money, and the date that matters most */}
				{row.offerTuitionUsd ? <OfferTerms row={row} /> : null}

				{/* Compact progress bar */}
				<div style={{ marginTop: "1.25rem" }}>
					<div
						style={{
							display: "flex",
							justifyContent: "space-between",
							fontSize: "0.7rem",
							marginBottom: "0.4rem",
							textTransform: "uppercase",
							letterSpacing: "0.05em",
						}}
					>
						<span>Progress</span>
						<span>
							{curIdx + 1} / {TRACK_PIPELINE.length}
						</span>
					</div>
					<div
						style={{
							height: "6px",
							background: "var(--border-light)",
							borderRadius: "999px",
							overflow: "hidden",
						}}
					>
						<div
							style={{
								width: `${((curIdx + 1) / TRACK_PIPELINE.length) * 100}%`,
								height: "100%",
								background: "var(--foreground)",
								transition: "width 600ms ease",
							}}
						/>
					</div>
				</div>

				{/* Pipeline steps as compact chips */}
				<ol className="track-pipeline" aria-label="Application status pipeline" style={{ marginTop: "1rem" }}>
					{TRACK_PIPELINE.map((step, i) => (
						<li
							key={step}
							className={`track-pipeline__step${i <= curIdx ? " track-pipeline__step--done" : ""}${i === curIdx ? " track-pipeline__step--current" : ""}`}
						>
							<span className="track-pipeline__dot" aria-hidden>
								{i < curIdx ? "✓" : i + 1}
							</span>
							<span className="track-pipeline__label">
								{SCHOOL_TRACK_STATUS_LABELS[step]}
							</span>
						</li>
					))}
				</ol>

				{/* Latest update */}
				<div
					className="card card--pad"
					style={{
						marginTop: "1.25rem",
						background: "var(--background)",
						border: "1px solid var(--border-light)",
					}}
				>
					<div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
						<div style={{ flex: "1 1 240px" }}>
							<p className="eyebrow" style={{ fontSize: "0.65rem" }}>
								Latest update
							</p>
							<p className="mt-2" style={{ fontSize: "0.95rem", fontWeight: 500 }}>
								{row.handlerNote ?? "Waiting for first handler update…"}
							</p>
							{row.updatedAt ? (
								<p className="mono muted mt-2" style={{ fontSize: "0.7rem" }}>
									{new Date(row.updatedAt).toLocaleString()}
								</p>
							) : null}
						</div>
						{row.financialNote ? (
							<div
								style={{
									flex: "1 1 200px",
									paddingLeft: "1rem",
									borderLeft: "1px solid var(--border-light)",
								}}
							>
								<p className="eyebrow" style={{ fontSize: "0.65rem" }}>
									From the university
								</p>
								{/* Not .mono — that uppercases, and this is a sentence, not a code */}
								<p className="mt-2" style={{ fontSize: "0.85rem", lineHeight: 1.55 }}>
									{row.financialNote}
								</p>
							</div>
						) : null}
					</div>
				</div>

				{/* Timeline log */}
				{events.length > 0 ? (
					<div className="handler-feed" style={{ marginTop: "1.25rem" }}>
						<p className="eyebrow" style={{ fontSize: "0.7rem" }}>
							Activity log
						</p>
						<ul className="handler-feed__log" style={{ marginTop: "0.75rem" }}>
							{/* Direct grid children — a wrapper here collapses all three
							    columns into the 5rem time slot */}
							{events.slice(0, 5).map((e, idx) => (
								<li key={`${e.at}-${e.status}-${idx}`}>
									<span className="mono handler-feed__time">
										{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
									</span>
									<span className="handler-feed__status">
										{SCHOOL_TRACK_STATUS_LABELS[e.status]}
									</span>
									<span className="handler-feed__note">{e.note}</span>
								</li>
							))}
						</ul>
					</div>
				) : null}
			</div>
			{canRemove ? (
				<div className="school-track-card__actions">
					<button type="button" className="btn btn--ghost btn--sm" onClick={onRemove}>
						Remove
					</button>
				</div>
			) : null}
		</li>
	);
}

/* ========== Visa stage: invoice + processing ========== */

export function PortalVisa() {
	return (
		<ChapterGate chapter="visa">
			<VisaHubInner />
		</ChapterGate>
	);
}

function VisaHubInner() {
	const { application, payVisaInvoice, schoolApplications } = useAppState();
	const inv = application.visaInvoice;
	const [payPhase, setPayPhase] = useState<"idle" | "loading">("idle");
	const accepted = schoolApplications.filter((s) => s.status === "accepted" || s.status === "offer");
	const hasAdmit = hasAcceptedOffer(schoolApplications);
	const paid = inv.status === "paid";
	const amount = inv.amount || VISA_INVOICE_AMOUNT;

	const nav = useNavigate();
	const { toast } = useNotifier();

	async function pay() {
		setPayPhase("loading");
		try {
			const { invoices } = await invoicesApi.list();
			const backend = invoices.find((i) => i.type === "visa" && i.balanceCents > 0);
			if (!backend) {
				toast.error(
					"Your visa invoice has not been issued on the server yet. Ask your consultant to raise it.",
				);
				return;
			}
			try {
				// Real Paystack checkout — the page redirects to the hosted page.
				const checkout = await meApi.paystackCheckout(backend.id);
				window.location.href = checkout.authorizationUrl;
				return;
			} catch (err) {
				// No gateway configured → fall back to the server-side record path.
				if (!(err instanceof ApiError && err.code === "PAYMENT_GATEWAY_UNCONFIGURED")) {
					throw err;
				}
			}
			await meApi.payInvoice(backend.id, {
				amountCents: backend.balanceCents,
				method: "card",
				gateway: "manual",
				reference: `PAY-${Date.now()}`,
			});
			payVisaInvoice();
			toast.success("Payment recorded. The visa case will be opened.");
		} catch (err) {
			toast.error(
				err instanceof ApiError ? err.message : "Payment could not be processed. Please try again.",
			);
		} finally {
			setPayPhase("idle");
		}
	}

	if (payPhase === "loading") {
		return (
			<div className="loading-overlay">
				<div className="spinner" aria-hidden />
				<p className="mono">Contacting payment provider…</p>
				<p className="muted">Charging {formatDualCurrency(amount)} visa fee</p>
			</div>
		);
	}

	const steps = [
		{ id: "pending", label: "Case opened", detail: "After payment - handler opens file" },
		{ id: "biometrics", label: "Biometrics / appointment", detail: "Simulated window" },
		{ id: "decision", label: "Authority decision", detail: "In progress" },
		{ id: "complete", label: "Visa complete", detail: "Ready for payment plan" },
	] as const;
	const order = ["locked", "pending", "biometrics", "decision", "complete"] as const;
	const cur = order.indexOf(application.visaStatus);

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · Visa</p>
					<h1 className="page-title mt-1">Visa invoice → then process</h1>
					<p className="lead mt-2">
						On admission an invoice is raised <strong>before</strong> the visa process starts. Pay
						(simulated) → tracking runs. Handler posts are view-only.
					</p>
				</div>
			</header>

			<ol className="mini-steps mb-4">
				<li className={hasAdmit ? "is-done" : "is-current"}>1 · Admitted</li>
				<li className={hasAdmit ? (paid ? "is-done" : "is-current") : ""}>2 · Visa invoice</li>
				<li className={paid ? "is-current" : ""}>3 · Visa tracking</li>
			</ol>

			<div className="portal-grid portal-grid--2 portal-grid--align-start mb-2">
				{!hasAdmit ? (
					<div className="card card--pad">
						<p className="display" style={{ fontSize: "1.25rem" }}>
							No admission yet
						</p>
						<p className="muted mt-2">
							Pay the application invoice on Schools, then wait for handler tracking to reach{" "}
							<strong>Accepted</strong> (simulated automatically on your first school).
						</p>
						<div className="row mt-3">
							<Button to="/portal/application" arrow>
								Back to schools tracking
							</Button>
						</div>
					</div>
				) : (
					<div className="card card--pad">
						<p className="eyebrow">Accepted / offer</p>
						<ul className="portal-snapshot mt-2">
							{accepted.map((s) => (
								<li key={s.id}>
									<span>{getUniversity(s.universityId)?.name}</span>
									<strong>
										{getProgram(s.programId)?.name} · {SCHOOL_TRACK_STATUS_LABELS[s.status]}
									</strong>
								</li>
							))}
						</ul>
					</div>
				)}

				{/* Invoice first - process blocked until paid */}
				<StageInvoiceCard
					invoice={inv}
					title="Visa invoice · pay before process starts"
					onPay={pay}
				/>
			</div>

			{/* Tracking only after pay - stays on this stage page but after payment */}
			{paid ? (
				<>
					<div className="card card--pad mb-4">
						<p className="eyebrow">Visa tracking (simulated · view only)</p>
						<p className="display mt-2" style={{ fontSize: "1.2rem" }}>
							{application.counselorNote ?? "Visa case updating…"}
						</p>
					</div>
					<ol className="visa-track">
						{steps.map((s, i) => {
							const idx = order.indexOf(s.id);
							const done = cur >= idx && application.visaStatus !== "locked";
							const current = application.visaStatus === s.id;
							return (
								<li
									key={s.id}
									className={`visa-track__item${done ? " visa-track__item--done" : ""}${current ? " visa-track__item--current" : ""}`}
								>
									<span className="visa-track__dot">{done ? "✓" : i + 1}</span>
									<div>
										<strong>{s.label}</strong>
										<p className="muted">{s.detail}</p>
									</div>
								</li>
							);
						})}
					</ol>
					<div className="card card--pad mt-5 next-action">
						<p className="eyebrow">Continue</p>
						{application.visaStatus === "complete" ? (
							<>
								<p className="muted mt-1">Visa complete. Choose your payment plan next.</p>
								<div className="row mt-3">
									<Button
										type="button"
										arrow
										onClick={() =>
											nav(
												hasPaymentPlan(application)
													? "/portal/agency"
													: "/portal/payment-plan",
											)
										}
									>
										Next · {hasPaymentPlan(application) ? "Agency" : "Payment plan"}
									</Button>
								</div>
							</>
						) : (
							<p className="muted mt-1">
								Visa tracking in progress ({application.visaStatus}). Payment plan unlocks
								once visa is complete.
							</p>
						)}
					</div>
				</>
			) : hasAdmit ? (
				<p className="mono muted">Pay the visa invoice first - then tracking appears here.</p>
			) : null}
		</div>
	);
}

/* ========== Complete ========== */

export function PortalComplete() {
	return (
		<ChapterGate chapter="complete">
			<CompleteInner />
		</ChapterGate>
	);
}

function CompleteInner() {
	const { application, booking, schoolApplications } = useAppState();
	const finished =
		Boolean(application.completedAt) ||
		(Boolean(application.agencySettledAt) && application.visaStatus === "complete");
	const accepted = schoolApplications.filter((s) => s.status === "accepted");
	const fund = SCHOOL_FUNDING_TRACKS.find((f) => f.id === application.schoolFundingTrack);
	const deg = SCHOOL_DEGREE_LEVELS.find((d) => d.id === application.schoolDegreeLevel);

	if (!finished) {
		return (
			<div className="portal-page">
				<header className="portal-page__header">
					<div>
						<p className="eyebrow">Complete · last step</p>
						<h1 className="page-title mt-1">Almost there</h1>
						<p className="lead mt-2">
							Finish visa, payment plan, and agency settlement. Completion unlocks last.
						</p>
					</div>
				</header>
				<div className="row">
					<Button to="/portal/visa" arrow>
						Visa & travel
					</Button>
					<Button to="/portal/payment-plan" variant="secondary">
						Payment plan
					</Button>
					<Button to="/portal/agency" variant="ghost">
						Agency
					</Button>
				</div>
			</div>
		);
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Complete · last step</p>
					<h1 className="page-title mt-1">Application complete</h1>
					<p className="lead mt-2">
						Consultation → school package → schools → visa → payment plan → agency → done.
					</p>
				</div>
				<div className="success-check" aria-hidden>
					✓
				</div>
			</header>
			<div className="card card--pad mb-4">
				<ul className="status-list">
					<li>Stage I · Consultation {booking.confirmationId}</li>
					<li>
						School package · {fund?.name ?? "-"} · {deg?.name ?? "-"}
					</li>
					<li>{schoolApplications.length} school(s) tracked</li>
					<li>Visa & travel</li>
					<li>
						Payment plan ·{" "}
						{application.paymentPlanId === "installment" ? "Installments" : "Full payment"}
					</li>
					<li>Agency settled</li>
				</ul>
			</div>
			{accepted.length ? (
				<div className="card card--pad">
					<p className="eyebrow">Accepted</p>
					{accepted.map((s) => (
						<p key={s.id} className="display mt-2" style={{ fontSize: "1.25rem" }}>
							{getUniversity(s.universityId)?.name} · {getProgram(s.programId)?.name}
						</p>
					))}
				</div>
			) : null}
			<div className="row mt-5">
				<Button to="/portal/pre-departure" arrow>
					Pre-departure checklist
				</Button>
				<Button to="/portal/journey" variant="secondary">
					Journey map
				</Button>
				<Button to="/" variant="ghost">
					Home
				</Button>
			</div>
		</div>
	);
}

/* ========== Paystack return ========== */

/**
 * Paystack redirects the browser back to `/portal/pay?invoice=…&paystack=1&reference=…`
 * after the hosted checkout. This route verifies the transaction server-side,
 * marks the matching local invoice paid, and routes to the right stage page.
 */
export function PortalPayCallback() {
	const { payApplicationInvoice, payVisaInvoice } = useAppState();
	const { toast } = useNotifier();
	const nav = useNavigate();
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const invoiceId = params.get("invoice");
		const reference = params.get("reference");
		let cancelled = false;
		(async () => {
			try {
				if (params.get("paystack") !== "1" || !invoiceId || !reference) {
					nav("/portal/application", { replace: true });
					return;
				}
				const { invoice } = await meApi.paystackVerify(invoiceId, reference);
				if (cancelled) return;
				const settled = invoice.balanceCents === 0;
				if (settled) {
					if (invoice.type === "visa") payVisaInvoice();
					else payApplicationInvoice();
				}
				nav(invoice.type === "visa" ? "/portal/visa" : "/portal/application", {
					replace: true,
				});
				if (settled) toast.success("Payment confirmed.");
				else toast.error("Payment was not completed.");
			} catch (err) {
				if (cancelled) return;
				setFailed(true);
				toast.error(
					err instanceof ApiError ? err.message : "Could not confirm the payment.",
				);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [nav, payApplicationInvoice, payVisaInvoice, toast]);

	if (failed) {
		return (
			<div className="portal-page">
				<div className="card card--pad">
					<p className="eyebrow">Payment confirmation</p>
					<h1 className="page-title mt-1">Could not confirm the payment</h1>
					<p className="muted mt-2">
						If you were charged, the payment will still be recorded via the webhook.
						Go back and try again.
					</p>
					<div className="row mt-4">
						<Button to="/portal/application" arrow>
							Back to dashboard
						</Button>
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="portal-page">
			<div className="loading-overlay">
				<div className="spinner" aria-hidden />
				<p className="mono">Confirming payment…</p>
			</div>
		</div>
	);
}

/* ========== Redirects / legacy ========== */

export function PortalIndex() {
	return <Navigate to="/portal/home" replace />;
}

export function PortalApplication() {
	return <Navigate to="/portal/application" replace />;
}

export function PortalTracking() {
	return <Navigate to="/portal/journey" replace />;
}

export function PortalAgreement() {
	return <Navigate to="/portal/consultation" replace />;
}

export function PortalPayment() {
	return <Navigate to="/portal/application" replace />;
}

export function PortalProfile() {
	return <Navigate to="/portal/consultation" replace />;
}

export function PortalDocuments() {
	return <Navigate to="/portal/documents" replace />;
}

export function PortalSchool() {
	return <Navigate to="/portal/application" replace />;
}

export function PortalInterview() {
	return <Navigate to="/portal/application" replace />;
}
