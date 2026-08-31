import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { apiFetch } from "../../lib/api";
import { API_PREFIX, LookupValue } from "century-nit-shared";
import { Button } from "../../components/ui/Button";
import { Money, MoneyInline } from "../../components/ui/Money";
import { Field, Select } from "../../components/ui/Field";
import { StageInvoiceCard } from "../../components/StageInvoiceCard";
import {
	hasAcceptedOffer,
	hasPaymentPlan,
	hasSchoolPackage,
	useAppState,
	type AssessmentData,
	type AssessmentDoc,
	type BookingData,
	type EligibilityOutcome,
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
	CONSULTATION_FEE_AMOUNT,
	type SchoolDegreeLevel,
	type PaymentPlanId,
	type SchoolFundingTrack,
	type SchoolTrackStatus,
	universities,
	universitiesForDestination,
	CONSULTATION_DURATIONS,
	getBranchName,
} from "century-nit-core";
import { meApi, bookingsApi, schoolsApi, documentsApi, feesApi, ApiError } from "century-nit-core/api";
import type { ApiInvoice, AvailabilitySlot, ApiConsultation, ApiApplication } from "century-nit-shared";
import { useNotifier } from "../../components/notifier/Notifier";



import { ChapterGate } from "./PortalLayout";
import { ConsultationAppointmentCard } from "./ConsultationAppointmentCard";

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
			await meApi.choosePackage({ packageCode: funding, degreeLevel: level });
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
function upcomingDates(count = 21): { value: string; weekday: string; dayMonth: string }[] {
	const out: { value: string; weekday: string; dayMonth: string }[] = [];
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
				weekday: cursor.toLocaleDateString("en-US", { weekday: "short" }),
				dayMonth: cursor.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
			});
		}
		cursor.setDate(cursor.getDate() + 1);
	}
	return out;
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
			<p className="eyebrow">Date &amp; time</p>

			<p className="resched__label mono mt-3">Date</p>
			<div className="resched__days">
				{dates.map((d) => (
					<button
						key={d.value}
						type="button"
						onClick={() => {
							onDateChange(d.value);
							onTimeChange("");
						}}
						className={`resched__day${date === d.value ? " resched__day--on" : ""}`}
					>
						<span className="resched__day-wd">{d.weekday}</span>
						<span className="resched__day-num">{d.dayMonth}</span>
					</button>
				))}
			</div>

			<p className="resched__label mono mt-3">
				Time{" "}
				<span className="muted">
					· {CONSULTATION_DURATIONS.find((d) => d.id === String(durationMinutes))?.label ?? `${durationMinutes} min`} · branch local
				</span>
			</p>
			{error && <p style={{ color: "#dc2626", fontSize: "0.85rem" }}>{error}</p>}
			{!slots && !error && date && <p className="muted" style={{ fontSize: "0.85rem" }}>Checking live availability…</p>}
			{date && slots && (
				<div className="resched__slots">
					{slots.map((s) => (
						<button
							key={s.time}
							type="button"
							disabled={!s.available}
							onClick={() => onTimeChange(s.time)}
							className={`resched__slot${time === s.time ? " resched__slot--on" : ""}`}
							title={!s.available ? "Already booked at this branch" : undefined}
						>
							{s.time}
							{!s.available ? <span className="resched__slot-tag">booked</span> : null}
						</button>
					))}
				</div>
			)}
			{!date && (
				<p className="resched__hint muted">Select a date to see open slots.</p>
			)}
			{slots?.every((s) => !s.available) && (
				<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
					No open slots on this date. Please choose another date above.
				</p>
			)}
		</div>
	);
}

/**
 * 100% Server-backed PortalConsultation
 * Sends bookings to Postgres (century-nit-api) and receives live assessment results from Ops Center.
 */


/* ========== Consultation - fully inside dashboard (mockup) ========== */

const ASSESSMENT_DOC_FIELDS: { id: string; label: string; hint: string }[] = [
	{ id: "passport", label: "Passport bio page", hint: "Clear scan of photo page" },
	{ id: "certificates", label: "Academic certificates", hint: "Degree/diploma certificates" },
	{ id: "transcripts", label: "Academic transcripts", hint: "Official grade transcripts" },
	{ id: "cv", label: "CV / Resume", hint: "Current CV (PDF)" },
	{ id: "english", label: "English test result", hint: "IELTS, TOEFL, or Duolingo score" },
	{ id: "financial", label: "Financial proof", hint: "Bank statements (last 3 months)" },
	{ id: "sponsorship", label: "Sponsorship letter", hint: "If sponsored by a third party" },
	{ id: "additional", label: "Additional documents", hint: "Any other supporting documents" },
];

function AssessmentForm({
	assessment,
	assessmentDocs,
	onUpdate,
	onDocUpdate,
}: {
	assessment: AssessmentData;
	assessmentDocs: Record<string, AssessmentDoc>;
	onUpdate: (patch: Partial<AssessmentData>) => void;
	onDocUpdate: (id: string, fileName: string | null, documentId?: string | null) => void;
}) {
	const [section, setSection] = useState(0);
	const [lookups, setLookups] = useState<LookupValue[]>([]);
	const [catalogUnis, setCatalogUnis] = useState<any[]>([]);
	const [catalogDestinations, setCatalogDestinations] = useState<any[]>([]);
	const [catalogPrograms, setCatalogPrograms] = useState<any[]>([]);
	
	useEffect(() => {
		apiFetch<{ lookups: LookupValue[] }>(`${API_PREFIX}/lookups`)
			.then((res) => {
				if (res && res.lookups) setLookups(res.lookups);
			})
			.catch(console.error);

		apiFetch<{ universities: any[] }>(`${API_PREFIX}/catalog/universities`)
			.then(res => setCatalogUnis(res.universities))
			.catch(console.error);

		apiFetch<{ destinations: any[] }>(`${API_PREFIX}/catalog/destinations`)
			.then(res => setCatalogDestinations(res.destinations))
			.catch(console.error);

		apiFetch<{ programs: any[] }>(`${API_PREFIX}/catalog/programs`)
			.then(res => setCatalogPrograms(res.programs))
			.catch(console.error);
	}, []);

	const getLookupOptions = (category: string) => {
		return lookups.filter(l => l.category === category).map(l => (
			<option key={l.id} value={l.value}>{l.label}</option>
		));
	};
	const [uploading, setUploading] = useState<Record<string, number>>({});
	const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

	const sections = [
		{ label: "Personal", icon: "◎" },
		{ label: "Passport", icon: "≡" },
		{ label: "Education", icon: "◈" },
		{ label: "Employment", icon: "◴" },
		{ label: "English", icon: "✦" },
		{ label: "Preferences", icon: "❖" },
		{ label: "Financial", icon: "¤" },
		{ label: "Documents", icon: "📎" },
	];

	function handleDocUpload(id: string) {
		const input = fileInputRefs.current[id];
		if (input) {
			input.value = "";
			input.click();
		}
	}

	async function handleFileSelected(id: string, e: ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		if (!file) return;
		setUploading((prev) => ({ ...prev, [id]: 0 }));
		try {
			const doc = await documentsApi.upload(file, id, {
				onProgress: (pct) => setUploading((prev) => ({ ...prev, [id]: pct })),
			});
			onDocUpdate(id, doc.fileName, doc.id);
		} catch {
			alert("Upload failed. Please try again.");
		} finally {
			setUploading((prev) => { const n = { ...prev }; delete n[id]; return n; });
		}
	}

	return (
		<>
			<p className="eyebrow">Assessment form</p>
			<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
				Complete all sections. Your consultant will review this before your meeting.
			</p>

			<div className="dash-tabs mt-3" role="tablist">
				{sections.map((s, i) => (
					<button
						key={s.label}
						type="button"
						role="tab"
						aria-selected={section === i}
						className={`dash-tabs__btn${section === i ? " dash-tabs__btn--active" : ""}`}
						onClick={() => setSection(i)}
					>
						<span>{s.icon}</span> {s.label}
					</button>
				))}
			</div>

			<div className="mt-4">
				{section === 0 && (
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-fn">First name *</label>
							<input id="a-fn" className="input input--full-border" value={assessment.firstName} onChange={(e) => onUpdate({ firstName: e.target.value })} placeholder="Kwame" />
						</div>
						<div className="field">
							<label htmlFor="a-mn">Middle name</label>
							<input id="a-mn" className="input input--full-border" value={assessment.middleName} onChange={(e) => onUpdate({ middleName: e.target.value })} />
						</div>
						<div className="field">
							<label htmlFor="a-ln">Last name *</label>
							<input id="a-ln" className="input input--full-border" value={assessment.lastName} onChange={(e) => onUpdate({ lastName: e.target.value })} placeholder="Mensah" />
						</div>
						<div className="field">
							<label htmlFor="a-em">Email *</label>
							<input id="a-em" type="email" className="input input--full-border" value={assessment.email} onChange={(e) => onUpdate({ email: e.target.value })} placeholder="you@example.com" />
						</div>
						<div className="field">
							<label htmlFor="a-ph">Phone *</label>
							<input id="a-ph" className="input input--full-border" value={assessment.phone} onChange={(e) => onUpdate({ phone: e.target.value })} placeholder="+233 24 000 0000" />
						</div>
						<div className="field">
							<label htmlFor="a-dob">Date of birth</label>
							<input id="a-dob" type="date" className="input input--full-border" value={assessment.dateOfBirth} onChange={(e) => onUpdate({ dateOfBirth: e.target.value })} />
						</div>
						<div className="field">
							<label htmlFor="a-gender">Gender</label>
							<select id="a-gender" className="select select--full-border" value={assessment.gender} onChange={(e) => onUpdate({ gender: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('gender')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-nat">Nationality</label>
							<input id="a-nat" className="input input--full-border" value={assessment.nationality} onChange={(e) => onUpdate({ nationality: e.target.value })} placeholder="Ghanaian" />
						</div>
						<div className="field">
							<label htmlFor="a-addr">Residential address</label>
							<input id="a-addr" className="input input--full-border" value={assessment.address} onChange={(e) => onUpdate({ address: e.target.value })} placeholder="Street, city, country" />
						</div>
					</div>
				)}

				{section === 1 && (
					<div className="form-grid form-grid--2">
						<div className="field">
							<label htmlFor="a-pn">Passport number</label>
							<input id="a-pn" className="input input--full-border" value={assessment.passportNumber} onChange={(e) => onUpdate({ passportNumber: e.target.value })} placeholder="G1234567" />
						</div>
						<div className="field">
							<label htmlFor="a-pc">Passport country</label>
							<input id="a-pc" className="input input--full-border" value={assessment.passportCountry} onChange={(e) => onUpdate({ passportCountry: e.target.value })} placeholder="Ghana" />
						</div>
						<div className="field">
							<label htmlFor="a-pi">Issue date</label>
							<input id="a-pi" type="date" className="input input--full-border" value={assessment.passportIssue} onChange={(e) => onUpdate({ passportIssue: e.target.value })} />
						</div>
						<div className="field">
							<label htmlFor="a-pe">Expiry date</label>
							<input id="a-pe" type="date" className="input input--full-border" value={assessment.passportExpiry} onChange={(e) => onUpdate({ passportExpiry: e.target.value })} />
						</div>
					</div>
				)}

				{section === 2 && (
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-edu">Highest education</label>
							<select id="a-edu" className="select select--full-border" value={assessment.highestEducation} onChange={(e) => onUpdate({ highestEducation: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('highestEducation')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-inst">Institution</label>
							<select id="a-inst" className="select select--full-border" value={assessment.institution} onChange={(e) => onUpdate({ institution: e.target.value })}>
		<option value="">Select</option>
		{catalogUnis.map(u => (<option key={u.id} value={u.name}>{u.name}</option>))}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-fos">Field of study</label>
							<select id="a-fos" className="select select--full-border" value={assessment.fieldOfStudy} onChange={(e) => onUpdate({ fieldOfStudy: e.target.value })}>
		<option value="">Select</option>
		{Array.from(new Set(catalogPrograms.map(p => p.field).filter(Boolean))).map(f => (<option key={f} value={f}>{f}</option>))}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-gy">Graduation year</label>
							<input id="a-gy" className="input input--full-border" value={assessment.graduationYear} onChange={(e) => onUpdate({ graduationYear: e.target.value })} placeholder="2024" />
						</div>
						<div className="field">
							<label htmlFor="a-gpa">GPA / Grade</label>
							<input id="a-gpa" className="input input--full-border" value={assessment.gpa} onChange={(e) => onUpdate({ gpa: e.target.value })} placeholder="3.6 / 4.0" />
						</div>
					</div>
				)}

				{section === 3 && (
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-es">Employment status</label>
							<select id="a-es" className="select select--full-border" value={assessment.employmentStatus} onChange={(e) => onUpdate({ employmentStatus: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('employmentStatus')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-emp">Employer</label>
							<input id="a-emp" className="input input--full-border" value={assessment.employer} onChange={(e) => onUpdate({ employer: e.target.value })} placeholder="Company name" />
						</div>
						<div className="field">
							<label htmlFor="a-jt">Job title</label>
							<input id="a-jt" className="input input--full-border" value={assessment.jobTitle} onChange={(e) => onUpdate({ jobTitle: e.target.value })} placeholder="Software Engineer" />
						</div>
						<div className="field">
							<label htmlFor="a-yexp">Years of experience</label>
							<input id="a-yexp" className="input input--full-border" value={assessment.yearsExperience} onChange={(e) => onUpdate({ yearsExperience: e.target.value })} placeholder="3" />
						</div>
					</div>
				)}

				{section === 4 && (
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-et">English test taken</label>
							<select id="a-et" className="select select--full-border" value={assessment.englishTest} onChange={(e) => onUpdate({ englishTest: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('englishTest')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-es-score">Score</label>
							<input id="a-es-score" className="input input--full-border" value={assessment.englishScore} onChange={(e) => onUpdate({ englishScore: e.target.value })} placeholder="7.5" />
						</div>
						<div className="field">
							<label htmlFor="a-ed">Test date</label>
							<input id="a-ed" type="date" className="input input--full-border" value={assessment.englishDate} onChange={(e) => onUpdate({ englishDate: e.target.value })} />
						</div>
					</div>
				)}

				{section === 5 && (
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-pc2">Preferred countries</label>
							<select id="a-pc2" className="select select--full-border" value={assessment.preferredCountries} onChange={(e) => onUpdate({ preferredCountries: e.target.value })}>
		<option value="">Select</option>
		{catalogDestinations.map(d => (<option key={d.id} value={d.name}>{d.name}</option>))}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-pl">Preferred level</label>
							<select id="a-pl" className="select select--full-border" value={assessment.preferredLevel} onChange={(e) => onUpdate({ preferredLevel: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('preferredLevel')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-pf">Preferred field</label>
							<select id="a-pf" className="select select--full-border" value={assessment.preferredField} onChange={(e) => onUpdate({ preferredField: e.target.value })}>
		<option value="">Select</option>
		{Array.from(new Set(catalogPrograms.map(p => p.field).filter(Boolean))).map(f => (<option key={f} value={f}>{f}</option>))}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-intake">Intake preference</label>
							<select id="a-intake" className="select select--full-border" value={assessment.intakePreference} onChange={(e) => onUpdate({ intakePreference: e.target.value })}>
								<option value="">Select</option>
								<option value="spring">Spring (Jan/Feb)</option>
								<option value="fall">Fall (Sep/Oct)</option>
								<option value="summer">Summer (May/Jun)</option>
								<option value="flexible">Flexible</option>
							</select>
						</div>
					</div>
				)}

				{section === 6 && (
					<div className="form-grid form-grid--3">
						<div className="field">
							<label htmlFor="a-fs">Funding source</label>
							<select id="a-fs" className="select select--full-border" value={assessment.fundingSource} onChange={(e) => onUpdate({ fundingSource: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('fundingSource')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-br">Budget range (GHS / USD per year)</label>
							<select id="a-br" className="select select--full-border" value={assessment.budgetRange} onChange={(e) => onUpdate({ budgetRange: e.target.value })}>
		<option value="">Select</option>
		{getLookupOptions('budgetRange')}
	</select>
						</div>
						<div className="field">
							<label htmlFor="a-sn">Sponsor name</label>
							<input id="a-sn" className="input input--full-border" value={assessment.sponsorName} onChange={(e) => onUpdate({ sponsorName: e.target.value })} placeholder="If applicable" />
						</div>
						<div className="field">
							<label htmlFor="a-sr">Sponsor relationship</label>
							<input id="a-sr" className="input input--full-border" value={assessment.sponsorRelationship} onChange={(e) => onUpdate({ sponsorRelationship: e.target.value })} placeholder="Parent, Guardian, etc." />
						</div>
					</div>
				)}

			{section === 7 && (
				<div>
					<p className="muted mb-3" style={{ fontSize: "0.85rem" }}>
						Upload scanned copies of your documents. Accepted: PDF, JPEG, PNG, DOC, DOCX (max 15 MB each).
					</p>
					<div className="form-grid form-grid--2">
						{ASSESSMENT_DOC_FIELDS.map((doc) => {
							const uploaded = assessmentDocs[doc.id];
							const pct = uploading[doc.id];
							const isUploading = pct !== undefined;
							return (
								<div key={doc.id} className="card card--pad">
									<input
										type="file"
										accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
										style={{ display: "none" }}
										ref={(el) => { fileInputRefs.current[doc.id] = el; }}
										onChange={(e) => void handleFileSelected(doc.id, e)}
									/>
									<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
										<div>
											<p style={{ fontWeight: 600, fontSize: "0.9rem" }}>{doc.label}</p>
											<p className="muted" style={{ fontSize: "0.75rem", marginTop: "0.2rem" }}>{doc.hint}</p>
										</div>
										{isUploading ? (
											<span className="portal-pill portal-pill--draft">Uploading {pct}%</span>
										) : uploaded?.fileName ? (
											<span className="portal-pill portal-pill--approved">Uploaded</span>
										) : (
											<span className="portal-pill portal-pill--needs_info">Pending</span>
										)}
									</div>
									{isUploading ? (
										<div style={{ marginTop: "0.75rem" }}>
											<div style={{ height: "4px", background: "var(--border-light)", borderRadius: "2px", overflow: "hidden" }}>
												<div style={{ height: "100%", width: `${pct}%`, background: "var(--foreground)", transition: "width 0.2s" }} />
											</div>
										</div>
									) : uploaded?.fileName ? (
										<div style={{ marginTop: "0.75rem", display: "flex", alignItems: "center", gap: "0.75rem" }}>
											<span className="mono" style={{ fontSize: "0.75rem" }}>{uploaded.fileName}</span>
											{uploaded.uploadedAt ? (
												<span className="muted" style={{ fontSize: "0.7rem" }}>{new Date(uploaded.uploadedAt).toLocaleDateString()}</span>
											) : null}
											<div style={{ marginLeft: "auto", display: "flex", gap: "0.5rem" }}>
												<button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDocUpload(doc.id)}>Replace</button>
												<button type="button" className="btn btn--ghost btn--sm" onClick={() => onDocUpdate(doc.id, null)}>Remove</button>
											</div>
										</div>
									) : (
										<div style={{ marginTop: "0.75rem" }}>
											<button type="button" className="btn btn--secondary btn--sm" onClick={() => handleDocUpload(doc.id)}>Upload file</button>
										</div>
									)}
								</div>
							);
						})}
					</div>
				</div>
			)}
			</div>

			<div className="row mt-4" style={{ borderTop: "1px solid var(--border-light)", paddingTop: "1rem" }}>
				<Button type="button" variant="ghost" disabled={section === 0} onClick={() => setSection((s) => Math.max(0, s - 1))}>
					← Prev section
				</Button>
				<Button type="button" variant="secondary" disabled={section >= sections.length - 1} onClick={() => setSection((s) => Math.min(sections.length - 1, s + 1))}>
					Next section →
				</Button>
			</div>
		</>
	);
}

const CONSULT_TABS = [
	"Type",
	"Location",
	"Branch",
	"Schedule",
	"Assessment",
	"Pay",
	"Review",
	"Outcome",
] as const;

const OUTCOME_LABELS: Record<EligibilityOutcome, string> = {
	pending: "Awaiting consultant feedback",
	eligible: "Eligible",
	conditional: "Conditionally Eligible",
	needs_info: "Additional Information Required",
	not_eligible: "Not Eligible",
};

const OUTCOME_PILLS: Record<EligibilityOutcome, string> = {
	pending: "portal-pill--draft",
	eligible: "portal-pill--approved",
	conditional: "portal-pill--draft",
	needs_info: "portal-pill--needs_info",
	not_eligible: "portal-pill--needs_info",
};

function ConsultationOutcome({
	booking,
	onMockOutcome,
	onRevealOutcome,
	autopilot,
}: {
	booking: BookingData;
	onMockOutcome: (outcome: EligibilityOutcome, note?: string) => void;
	onRevealOutcome: () => void;
	autopilot: boolean;
}) {
	const outcome = booking.eligibilityOutcome;
	const isPending = outcome === "pending" || (booking.consultationPhase !== "outcome" && booking.consultationPhase !== "assessment_complete" && booking.consultationPhase !== "cancelled");
	const { toast } = useNotifier();
	// Recommendations live on the server consultation record, not in a
	// hardcoded lookup table. Fetch them when an outcome is shown so the
	// applicant sees what their consultant actually recommended.
	const [recs, setRecs] = useState<{ countries: string[]; programs: string[]; university: string | null; notes: string | null }>({
		countries: [],
		programs: [],
		university: null,
		notes: null,
	});
	useEffect(() => {
		if (isPending) return;
		let active = true;
		(async () => {
			try {
				const res = await meApi.application();
				if (!active) return;
				const r = res.consultation?.assessmentResult;
				if (!r) return;
				setRecs({
					countries: r.recCountry ? [r.recCountry] : [],
					programs: r.recProgram ? [r.recProgram] : [],
					university: r.recUniversity || null,
					notes: r.notes || null,
				});
			} catch {
				/* keep defaults — server may be unreachable */
			}
		})();
		return () => {
			active = false;
		};
	}, [isPending]);

	const [respondState, setRespondState] = useState<"idle" | "loading" | "done">("idle");
	const [respondAction, setRespondAction] = useState<"accept" | "request_info" | null>(null);

	async function handleRespond(action: "accept" | "request_info") {
		setRespondState("loading");
		setRespondAction(action);
		try {
			await meApi.respondToOutcome({ action });
			setRespondState("done");
		} catch (err) {
			setRespondState("idle");
			setRespondAction(null);
			toast.error(
				err instanceof ApiError
					? err.message
					: "Could not submit your response. Please try again.",
			);
		}
	}

	if (!booking.confirmationId) {
		return (
			<>
				<p className="eyebrow">Outcome</p>
				<p className="muted mt-2">Complete payment in the Pay tab to receive your consultation outcome.</p>
			</>
		);
	}

	if (booking.consultationPhase === "assessment_complete") {
		return (
			<>
				<p className="eyebrow">Outcome</p>
				<div className="card card--pad mt-3" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
					<p className="display" style={{ fontSize: "1.3rem" }}>Assessment complete</p>
					<p className="muted mt-2" style={{ maxWidth: "28rem", margin: "0.5rem auto 0" }}>
						Your consultant has finished reviewing your file. Your eligibility outcome is ready to view.
					</p>
					<div className="row mt-4" style={{ justifyContent: "center" }}>
						<Button type="button" onClick={onRevealOutcome} arrow>
							View your outcome →
						</Button>
					</div>
					<p className="mono muted mt-4" style={{ fontSize: "0.75rem" }}>
						Booking ref: {booking.confirmationId}
					</p>
				</div>
			</>
		);
	}

	if (booking.consultationPhase === "cancelled") {
		return (
			<>
				<p className="eyebrow">Outcome</p>
				<div className="card card--pad mt-3" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
					<p className="display" style={{ fontSize: "1.3rem" }}>Consultation cancelled</p>
					<p className="muted mt-2" style={{ maxWidth: "28rem", margin: "0.5rem auto 0" }}>
						Your consultation has been cancelled. If you'd like to continue, you can book a new appointment from the Appointments tab.
					</p>
					<div className="row mt-4" style={{ justifyContent: "center" }}>
						<Button to="/portal/appointments" arrow>
							Book a new appointment →
						</Button>
					</div>
					<p className="mono muted mt-4" style={{ fontSize: "0.75rem" }}>
						Case ref: {booking.confirmationId}
					</p>
				</div>
			</>
		);
	}

	if (isPending) {
		const phaseLabels: Record<string, string> = {
			awaiting_confirmation: "Awaiting booking confirmation",
			confirmed: "Booking confirmed - awaiting consultant assignment",
			awaiting_assignment: "Awaiting consultant assignment",
			assigned: booking.consultantName ? `Assigned to ${booking.consultantName}` : "Consultant assigned",
			awaiting_assignment_confirmation: "Awaiting assignment confirmation",
			assessment: "Assessment in progress",
			booked: "Booking confirmed",
			draft: "Awaiting payment",
		};
		const phaseLabel = phaseLabels[booking.consultationPhase] ?? "In progress";
		return (
			<>
				<p className="eyebrow">Outcome</p>
				<div className="card card--pad mt-3" style={{ textAlign: "center", padding: "3rem 1.5rem" }}>
					<div style={{ marginBottom: "1.5rem" }}>
						<span
							style={{
								display: "inline-flex",
								width: "48px",
								height: "48px",
								border: "2px solid var(--border)",
								borderTopColor: "var(--foreground)",
								borderRadius: "50%",
								animation: "spin 1s linear infinite",
							}}
						/>
					</div>
					<p className="display" style={{ fontSize: "1.2rem" }}>{phaseLabel}</p>
					<p className="muted mt-2" style={{ maxWidth: "28rem", margin: "0.5rem auto 0" }}>
						Your consultant is reviewing your assessment details and uploaded documents. This typically takes a few minutes in the prototype. You'll see the outcome here once it's ready.
					</p>
					<p className="mono muted mt-4" style={{ fontSize: "0.75rem" }}>
						Booking ref: {booking.confirmationId}
					</p>
				</div>
				<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
			</>
		);
	}

	return (
		<>
				<p className="eyebrow">Consultation outcome</p>
				<div className="mt-3" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
					<span className={`portal-pill ${OUTCOME_PILLS[outcome]}`} style={{ fontSize: "0.85rem" }}>
						{OUTCOME_LABELS[outcome]}
					</span>
					{booking.outcomeAt ? (
						<span className="mono muted" style={{ fontSize: "0.75rem" }}>
							{new Date(booking.outcomeAt).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
						</span>
					) : null}
				</div>

			<div className="card card--pad mt-4">
				<p className="eyebrow">Consultant's feedback</p>
				<p className="mt-2" style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>
					{booking.eligibilityNote}
				</p>
			</div>

			{recs.notes ? (
				<div className="card card--pad mt-3">
					<p className="eyebrow">Recommendations</p>
					<p className="mt-2" style={{ fontSize: "0.9rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
						{recs.notes}
					</p>
				</div>
			) : null}

			{recs.university ? (
				<div className="card card--pad mt-3">
					<p className="eyebrow">Recommended institution</p>
					<p className="mt-2" style={{ fontSize: "0.95rem", fontWeight: 600 }}>{recs.university}</p>
				</div>
			) : null}

			{recs.countries.length > 0 ? (
				<div className="card card--pad mt-3">
					<p className="eyebrow">Recommended destinations</p>
					<div className="row mt-2" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
						{recs.countries.map((c) => (
							<span key={c} className="portal-pill" style={{ fontSize: "0.8rem" }}>{c}</span>
						))}
					</div>
				</div>
			) : null}

			{recs.programs.length > 0 ? (
				<div className="card card--pad mt-3">
					<p className="eyebrow">Suggested programmes</p>
					<div className="row mt-2" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
						{recs.programs.map((p) => (
							<span key={p} className="portal-pill" style={{ fontSize: "0.8rem" }}>{p}</span>
						))}
					</div>
				</div>
			) : null}

			{(outcome === "eligible" || outcome === "conditional") ? (
				<div className="card card--pad mt-4 next-action">
					<p className="eyebrow">Next step</p>
					{respondState === "done" ? (
						<>
							<p className="mt-2" style={{ fontSize: "0.95rem" }}>
								{respondAction === "accept"
									? "Outcome accepted. You can now choose your school application package."
									: "Your request has been sent. Your consultant will follow up with additional information."}
							</p>
							{respondAction === "accept" ? (
								<div className="row mt-3">
									<Button to="/portal/package" arrow>
										Next · School package
									</Button>
								</div>
							) : null}
						</>
					) : (
						<>
							<p className="mt-2" style={{ fontSize: "0.95rem" }}>
								{outcome === "eligible"
									? "You're cleared to proceed. Choose your school application package to begin applying."
									: "Address the recommendations above, then proceed to choose your school application package."}
							</p>
							<div className="row mt-3" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
								<Button type="button" onClick={() => handleRespond("accept")} arrow disabled={respondState === "loading"}>
									Accept & proceed →
								</Button>
								<Button type="button" variant="secondary" onClick={() => handleRespond("request_info")} disabled={respondState === "loading"}>
									I need more information
								</Button>
							</div>
						</>
					)}
				</div>
			) : null}

			{outcome === "not_eligible" ? (
				<div className="card card--pad mt-4 next-action">
					<p className="eyebrow">Next step</p>
					{respondState === "done" ? (
						<p className="mt-2" style={{ fontSize: "0.95rem" }}>
							Your consultant will review your request and follow up with alternative pathways or preparatory steps.
						</p>
					) : (
						<>
							<p className="mt-2" style={{ fontSize: "0.95rem" }}>
								You may request more information or explore alternative pathways with your consultant.
							</p>
							<div className="row mt-3" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
								<Button type="button" variant="secondary" onClick={() => handleRespond("request_info")} disabled={respondState === "loading"}>
									Request more information
								</Button>
							</div>
						</>
					)}
				</div>
			) : null}

				{/* Hidden when the Operations Center is driving - the consultant owns this call.
    Further gated behind the build-time dev flag: a production build must not
    let an applicant self-approve their own eligibility, which is the gate for
    the entire downstream journey. This is a demo affordance only, so Vite
    tree-shakes the whole block out of a production bundle. */}
				{import.meta.env.DEV && autopilot ? (
					<details style={{ marginTop: "1rem" }}>
						<summary className="mono muted" style={{ fontSize: "0.75rem", cursor: "pointer", textTransform: "uppercase", letterSpacing: "0.08em" }}>
							Simulate other outcomes
						</summary>
						<div className="row mt-2" style={{ flexWrap: "wrap", gap: "0.5rem" }}>
							<Button type="button" variant="secondary" size="sm" onClick={() => onMockOutcome("eligible")}>
								Eligible
							</Button>
							<Button type="button" variant="secondary" size="sm" onClick={() => onMockOutcome("conditional")}>
								Conditional
							</Button>
							<Button type="button" variant="ghost" size="sm" onClick={() => onMockOutcome("needs_info")}>
								Needs Info
							</Button>
							<Button type="button" variant="ghost" size="sm" onClick={() => onMockOutcome("not_eligible")}>
								Not Eligible
							</Button>
						</div>
					</details>
				) : null}
		</>
	);
}

/* ========== Consultation review - awaiting approval & assessment ========== */

function ConsultationReview({
	booking,
	onProceed,
	onRevealOutcome,
}: {
	booking: BookingData;
	onProceed: () => void;
	onRevealOutcome: () => void;
}) {
	const phase = booking.consultationPhase;

	if (!booking.confirmationId) {
		return (
			<>
				<p className="eyebrow">Review</p>
				<p className="muted mt-2">Complete payment in the Pay tab first. Your consultant review begins after confirmation.</p>
			</>
		);
	}

	const isPast = (p: string) => {
		const order = ["draft", "awaiting_confirmation", "confirmed", "awaiting_assignment", "assigned", "awaiting_assignment_confirmation", "assessment", "assessment_complete", "outcome"];
		return order.indexOf(phase) > order.indexOf(p);
	};
	const isActive = (p: string) => phase === p;
	const isDone = (p: string) => isPast(p) || phase === "outcome";

	const steps = [
		{
			id: "paid",
			label: "Payment received",
			detail: `Reference ${booking.confirmationId} · ${formatDualCurrency(75)}`,
			done: true,
		},
		{
			id: "awaiting_confirmation",
			label: "Awaiting booking confirmation",
			detail: "The branch reviews your payment and confirms your consultation slot.",
			active: isActive("awaiting_confirmation"),
			done: isDone("awaiting_confirmation"),
		},
		{
			id: "confirmed",
			label: "Booking confirmed",
			detail: "Your consultation slot has been confirmed. Waiting for a consultant to be assigned.",
			active: isActive("confirmed"),
			done: isDone("confirmed"),
		},
		{
			id: "awaiting_assignment",
			label: "Awaiting consultant assignment",
			detail: "The branch is assigning a consultant to your case.",
			active: isActive("awaiting_assignment"),
			done: isDone("awaiting_assignment"),
		},
		{
			id: "assigned",
			label: "Consultant assigned",
			detail: booking.consultantName
				? `Your case has been assigned to ${booking.consultantName}. Waiting for the consultant to confirm the assignment.`
				: "A consultant has been assigned to your case. Waiting for confirmation.",
			active: isActive("assigned"),
			done: isDone("assigned"),
		},
		{
			id: "awaiting_assignment_confirmation",
			label: "Awaiting assignment confirmation",
			detail: booking.consultantName
				? `${booking.consultantName} is reviewing and accepting the assignment before assessment begins.`
				: "The consultant is confirming the assignment before assessment begins.",
			active: isActive("awaiting_assignment_confirmation"),
			done: isDone("awaiting_assignment_confirmation"),
		},
		{
			id: "assessment",
			label: "Assessment in progress",
			detail: booking.consultantName
				? `${booking.consultantName} is reviewing your academic background, documents, and study goals.`
				: "Your consultant evaluates your academic background, documents, and study goals.",
			active: isActive("assessment"),
			done: isDone("assessment"),
		},
		{
			id: "assessment_complete",
			label: "Assessment complete",
			detail: "Your consultant has finished the assessment. Click to view your eligibility outcome.",
			active: isActive("assessment_complete"),
			done: phase === "outcome",
		},
		{
			id: "outcome",
			label: "Eligibility outcome",
			detail: "The consultant determines your eligibility and recommends next steps.",
			active: isActive("outcome"),
			done: phase === "outcome",
		},
	];

	const phaseLabels: Record<string, string> = {
		awaiting_confirmation: "Awaiting booking confirmation",
		confirmed: "Booking confirmed",
		awaiting_assignment: "Awaiting consultant assignment",
		assigned: booking.consultantName ? `Assigned to ${booking.consultantName}` : "Consultant assigned",
		awaiting_assignment_confirmation: "Awaiting assignment confirmation",
		assessment: "Assessment in progress",
		assessment_complete: "Assessment complete",
		outcome: "Review complete",
		draft: "Awaiting payment",
		booked: "Booking confirmed",
	};

	return (
		<>
			<p className="eyebrow">Consultant review</p>
			<p className="display mt-2" style={{ fontSize: "1.3rem" }}>
				{phaseLabels[phase] ?? "In progress"}
			</p>
			<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
				{booking.eligibilityNote ??
					"Your file has been submitted. The consultant at your branch will review and assess before producing an outcome."}
			</p>

			{/* Assessment complete - prominent call to action */}
			{phase === "assessment_complete" ? (
				<div className="card card--pad mt-3" style={{ textAlign: "center", padding: "2rem 1.5rem", border: "2px solid var(--foreground)" }}>
					<p className="display" style={{ fontSize: "1.3rem" }}>Assessment complete</p>
					<p className="muted mt-2" style={{ maxWidth: "28rem", margin: "0.5rem auto 0" }}>
						Your consultant has finished reviewing your file. Your eligibility outcome is ready.
					</p>
					<div className="row mt-3" style={{ justifyContent: "center" }}>
						<Button type="button" onClick={onRevealOutcome} arrow>
							View your outcome →
						</Button>
					</div>
				</div>
			) : null}

			{/* Appointment - consultant, when, and a mode-aware where + actions */}
			<ConsultationAppointmentCard />

			{/* The consultant now leads the appointment card above, so no separate tile */}

			<div className="mt-4" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
				{steps.map((s, i) => (
					<div
						key={s.id}
						style={{
							display: "flex",
							gap: "1rem",
							paddingBottom: i < steps.length - 1 ? "1.5rem" : 0,
							position: "relative",
						}}
					>
						<div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
							<span
								style={{
									width: "32px",
									height: "32px",
									borderRadius: "50%",
									display: "flex",
									alignItems: "center",
									justifyContent: "center",
									fontSize: "0.75rem",
									fontWeight: 600,
									border: s.done
										? "2px solid var(--foreground)"
										: s.active
											? "2px solid var(--foreground)"
											: "2px solid var(--border)",
									background: s.done ? "var(--foreground)" : "transparent",
									color: s.done ? "var(--background)" : s.active ? "var(--foreground)" : "var(--muted-foreground)",
								}}
							>
								{s.done ? "✓" : s.active ? (
									<span
										style={{
											display: "inline-block",
											width: "14px",
											height: "14px",
											border: "2px solid var(--foreground)",
											borderTopColor: "transparent",
											borderRadius: "50%",
											animation: "spin 1s linear infinite",
										}}
									/>
								) : i + 1}
							</span>
							{i < steps.length - 1 ? (
								<span
									style={{
										width: "2px",
										flex: 1,
										minHeight: "2rem",
										marginTop: "0.25rem",
										background: s.done ? "var(--foreground)" : "var(--border)",
									}}
								/>
							) : null}
						</div>
						<div style={{ paddingBottom: "0.5rem" }}>
							<p
								style={{
									fontSize: "0.95rem",
									fontWeight: s.active || s.done ? 600 : 400,
									color: s.done || s.active ? "var(--foreground)" : "var(--muted-foreground)",
								}}
							>
								{s.label}
							</p>
							<p className="muted" style={{ fontSize: "0.85rem", marginTop: "0.2rem" }}>
								{s.detail}
							</p>
							{s.active ? (
								<p className="mono" style={{ fontSize: "0.7rem", marginTop: "0.4rem", color: "var(--muted-foreground)" }}>
									In progress…
								</p>
							) : null}
						</div>
					</div>
				))}
			</div>

			<style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

			{phase === "outcome" ? (
				<div className="row mt-4">
					<Button type="button" onClick={onProceed} arrow>
						View outcome →
					</Button>
				</div>
			) : phase === "cancelled" ? (
				<div className="card card--pad mt-4" style={{ textAlign: "center" }}>
					<p className="mono muted" style={{ fontSize: "0.75rem" }}>
						Booking ref: {booking.confirmationId}
					</p>
					<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
						This consultation was cancelled. Book a new appointment from the Appointments tab to continue.
					</p>
					<div className="row mt-3" style={{ justifyContent: "center" }}>
						<Button to="/portal/appointments" variant="secondary" arrow>
							Book a new appointment →
						</Button>
					</div>
				</div>
			) : phase !== "assessment_complete" ? (
				<div className="card card--pad mt-4" style={{ textAlign: "center" }}>
					<p className="mono muted" style={{ fontSize: "0.75rem" }}>
						Booking ref: {booking.confirmationId}
					</p>
					<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
						This typically takes a few minutes in the prototype. The outcome will appear automatically - you can stay on this page or check the Outcome tab.
					</p>
				</div>
			) : null}
		</>
	);
}

export function PortalConsultationBookingFlow() {
	const {
		booking,
		updateBooking,
		updateAssessment,
		updateAssessmentDoc,

		setEligibilityOutcome,
		revealOutcome,

	} = useAppState();
	const { toast } = useNotifier();
	const [selectedTab, setSelectedTab] = useState(0);

	// Live consultation fee (USD) from platform_settings — what ops configured,
	// not the hardcoded default. Falls back to CONSULTATION_FEE_AMOUNT on error.
	const [consultationFeeUsd, setConsultationFeeUsd] = useState<number>(CONSULTATION_FEE_AMOUNT);
	useEffect(() => {
		let active = true;
		(async () => {
			try {
				const fees = await feesApi.schedule();
				if (active) setConsultationFeeUsd(fees.consultationCents / 100);
			} catch {
				/* keep default */
			}
		})();
		return () => { active = false; };
	}, []);
	const tab = useMemo(() => {
		if (booking.consultationPhase === "outcome" || booking.consultationPhase === "assessment_complete" || booking.consultationPhase === "cancelled") {
			return CONSULT_TABS.length - 1;
		}
		return selectedTab;
	}, [booking.consultationPhase, selectedTab]);
	const [payState, setPayState] = useState<"method" | "card" | "momo" | "processing" | "success" | "paid">(
		booking.confirmationId ? "paid" : "method",
	);

	async function startPayment() {
		if (payState === "paid" || payState === "processing" || payState === "success") return;
		// Gate payment on the required booking fields — Paystack will reject
		// an incomplete booking anyway, so fail fast with a clear message.
		const missing: string[] = [];
		if (!booking.branchId) missing.push("a branch");
		if (!booking.date) missing.push("a date");
		if (!booking.time) missing.push("a time");
		if (missing.length > 0) {
			toast.error(`Please select ${missing.join(", ")} before paying.`);
			return;
		}
		setPayState("processing");

		try {
			const res = await bookingsApi.checkout({
				serviceId: "consultation",
				branchId: booking.branchId,
				type: booking.consultationType || "online",
				date: booking.date,
				time: booking.time,
				durationMinutes: 45,
				timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				notes: "Preferred: " + booking.assessment.preferredCountries + ", " + booking.assessment.preferredLevel,
			});

			await meApi.updateProfile({
				name: [booking.assessment.firstName, booking.assessment.middleName, booking.assessment.lastName].filter(Boolean).join(" "),
				phone: booking.assessment.phone,
				targetCountry: booking.assessment.preferredCountries,
				profile: {
					nationality: booking.assessment.nationality,
					dob: booking.assessment.dateOfBirth,
					passportNumber: booking.assessment.passportNumber,
					passportExpiry: booking.assessment.passportExpiry,
					previousRefusals: "",
					degree: booking.assessment.highestEducation,
					institution: booking.assessment.institution,
					gpa: booking.assessment.gpa,
					gradYear: booking.assessment.graduationYear,
					currentRole: booking.assessment.jobTitle,
					company: booking.assessment.employer,
					experienceYears: booking.assessment.yearsExperience,
					fundingSource: booking.assessment.fundingSource,
					budget: booking.assessment.budgetRange,
					degreeLevel: booking.assessment.preferredLevel,
					intake: booking.assessment.intakePreference,
					major: booking.assessment.preferredField,
					referralSource: "",
				},
			});

			window.location.href = res.authorizationUrl;
		} catch (err) {
			setPayState("method");
			toast.error("Error creating booking: " + String(err));
		}
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · Stage I</p>
					<h1 className="page-title mt-1">Consultation</h1>
					<p className="lead mt-2">
						All consultation steps stay <strong>inside this dashboard</strong> - not a separate app.
						Mockup: skip freely between tabs.
					</p>
				</div>
			</header>

			<div className="dash-tabs" role="tablist">
				{CONSULT_TABS.map((label, i) => {
					const isOutcomeTab = i === CONSULT_TABS.length - 1;
					const outcomeUnlocked =
						booking.consultationPhase === "assessment_complete" ||
						booking.consultationPhase === "outcome";
					const isLocked = isOutcomeTab && !outcomeUnlocked;
					return (
						<button
							key={label}
							type="button"
							role="tab"
							aria-selected={tab === i}
							aria-disabled={isLocked}
							className={`dash-tabs__btn${tab === i ? " dash-tabs__btn--active" : ""}${isLocked ? " dash-tabs__btn--locked" : ""}`}
							onClick={() => !isLocked && setSelectedTab(i)}
						>
							<span className="mono">{i + 1}</span> {label}
							{isLocked ? <span className="dash-tabs__lock">🔒</span> : null}
						</button>
					);
				})}
			</div>

			<div className="card card--pad mt-3">
				{tab === 0 && (
					<>
						<p className="eyebrow">Meeting type</p>
						<div className="card-grid card-grid--2 mt-3">
							{(
								[
									["online", "Online Consultation"],
									["in_person", "In-Person Consultation"],
								] as const
							).map(([id, name]) => (
								<button
									key={id}
									type="button"
									className={`card card--pad card--selectable${booking.consultationType === id ? " card--selected" : ""}`}
									onClick={() => updateBooking({ consultationType: id })}
								>
									<span className="display" style={{ fontSize: "1.25rem" }}>
										{name}
									</span>
								</button>
							))}
						</div>
					</>
				)}
				{tab === 1 && (
					<>
						<p className="eyebrow">Your location</p>
						<div className="form-grid form-grid--3 mt-3">
							<div className="field">
								<label htmlFor="c-country">Country</label>
								<input
									id="c-country"
									className="input input--full-border"
									value={booking.country}
									onChange={(e) => updateBooking({ country: e.target.value })}
									placeholder="Ghana"
								/>
							</div>
							<div className="field">
								<label htmlFor="c-region">Region</label>
								<input
									id="c-region"
									className="input input--full-border"
									value={booking.region}
									onChange={(e) => updateBooking({ region: e.target.value })}
									placeholder="Greater Accra"
								/>
							</div>
							<div className="field">
								<label htmlFor="c-city">City</label>
								<input
									id="c-city"
									className="input input--full-border"
									value={booking.city}
									onChange={(e) => updateBooking({ city: e.target.value })}
									placeholder="Accra"
								/>
							</div>
						</div>
					</>
				)}
				{tab === 2 && (
					<>
						<p className="eyebrow">Branch</p>
						<div className="card-grid card-grid--2 mt-3">
							{[
								{ id: "accra-hq", name: "Accra Headquarters" },
								{ id: "kumasi", name: "Kumasi Branch" },
								{ id: "takoradi", name: "Takoradi Branch" },
							].map((b) => (
								<button
									key={b.id}
									type="button"
									className={`card card--pad card--selectable${booking.branchId === b.id ? " card--selected" : ""}`}
									onClick={() => updateBooking({ branchId: b.id })}
								>
									<span className="display" style={{ fontSize: "1.2rem" }}>
										{b.name}
									</span>
								</button>
							))}
						</div>
					</>
				)}
				{tab === 3 && (
					<SlotPickerLive
						branchId={booking.branchId}
						date={booking.date}
						onDateChange={(d) => updateBooking({ date: d })}
						time={booking.time}
						onTimeChange={(t) => updateBooking({ time: t })}
						durationMinutes={45}
					/>
				)}
				{tab === 4 && (
					<AssessmentForm
						assessment={booking.assessment}
						assessmentDocs={booking.assessmentDocs}
						onUpdate={updateAssessment}
						onDocUpdate={updateAssessmentDoc}
					/>
				)}
				{tab === 5 && (					<>
						<p className="eyebrow">Consultation fee</p>
						<p className="display mt-2" style={{ fontSize: "2rem" }}>
							{formatDualCurrency(consultationFeeUsd)}
						</p>
						<p className="muted mt-1">Confirm your booking details below. Payment will be collected at the branch.</p>

						{payState === "paid" && booking.confirmationId ? (
							<div className="card card--pad mt-3" style={{ background: "var(--foreground)", color: "var(--accent-foreground)" }}>
								<p className="eyebrow">Booking confirmed</p>
								<p className="mono mt-2">Ref: {booking.confirmationId}</p>
								<p className="mt-2" style={{ opacity: 0.85 }}>
									Your consultation has been booked. A branch coordinator will review and assign your consultant shortly.
								</p>
							</div>
						) : null}

						{payState === "method" ? (
							<div className="card card--pad mt-3" style={{ border: "1px solid var(--border-light)" }}>
								<p className="eyebrow mb-2">Booking summary</p>
								<div style={{ display: "grid", gap: "0.5rem", fontSize: "var(--text-sm)" }}>
									<div style={{ display: "flex", justifyContent: "space-between" }}>
										<span className="muted">Branch</span>
										<span>{getBranchName(booking.branchId)}</span>
									</div>
									<div style={{ display: "flex", justifyContent: "space-between" }}>
										<span className="muted">Date</span>
										<span>{booking.date || "—"}</span>
									</div>
									<div style={{ display: "flex", justifyContent: "space-between" }}>
										<span className="muted">Time</span>
										<span>{booking.time || "—"}</span>
									</div>
									<div style={{ display: "flex", justifyContent: "space-between" }}>
										<span className="muted">Type</span>
										<span>{booking.consultationType === "online" ? "Online" : "In-person"}</span>
									</div>
									<div style={{ display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--border-light)", paddingTop: "0.5rem", marginTop: "0.25rem" }}>
										<span className="muted">Fee</span>
										<span style={{ fontWeight: 600 }}>{formatDualCurrency(consultationFeeUsd)}</span>
									</div>
								</div>
								<div className="row mt-4">
									<Button type="button" onClick={startPayment} arrow>
										Confirm Booking — {formatDualCurrency(consultationFeeUsd)}
									</Button>
								</div>
							</div>
						) : null}

						{payState === "processing" ? (
							<div className="card card--pad mt-3" style={{ textAlign: "center", border: "1px solid var(--border-light)" }}>
								<p className="eyebrow">Creating your booking…</p>
								<p className="mono mt-2" style={{ fontSize: "0.85rem" }}>
									Submitting to server
								</p>
								<div
									style={{
										width: "100%",
										height: "4px",
										background: "var(--border-light)",
										marginTop: "1rem",
										overflow: "hidden",
									}}
								>
									<div
										style={{
											width: "30%",
											height: "100%",
											background: "var(--foreground)",
											animation: "pulse 1s infinite ease-in-out",
										}}
									/>
								</div>
							</div>
						) : null}

						{payState === "success" ? (
							<div className="card card--pad mt-3" style={{ textAlign: "center", background: "var(--foreground)", color: "var(--accent-foreground)" }}>
								<p className="eyebrow">Booking confirmed</p>
								<p className="display mt-2" style={{ fontSize: "1.35rem" }}>
									✓ {formatDualCurrency(consultationFeeUsd)} consultation booked
								</p>
								<p className="mono mt-2" style={{ opacity: 0.85 }}>
									Redirecting to booking confirmation…
								</p>
							</div>
						) : null}
					</>
				)}
				{tab === 6 && (
					<ConsultationReview
						booking={booking}
						onProceed={() => setSelectedTab(7)}
						onRevealOutcome={revealOutcome}
					/>
				)}
				{tab === 7 && (
					<ConsultationOutcome
						booking={booking}
						onMockOutcome={setEligibilityOutcome}
						onRevealOutcome={revealOutcome}
						autopilot={false}
					/>
				)}

				<div className="row mt-4" style={{ borderTop: "1px solid var(--border-light)", paddingTop: "1rem" }}>
					<Button
						type="button"
						variant="ghost"
						disabled={tab === 0}
						onClick={() => setSelectedTab((t) => Math.max(0, t - 1))}
					>
						← Prev tab
					</Button>
					<Button
						type="button"
						variant="secondary"
						disabled={tab >= CONSULT_TABS.length - 1 || (tab === CONSULT_TABS.length - 2 && !(booking.consultationPhase === "assessment_complete" || booking.consultationPhase === "outcome"))}
						onClick={() => setSelectedTab((t) => Math.min(CONSULT_TABS.length - 1, t + 1))}
					>
						Next tab →
					</Button>
				</div>
			</div>
		</div>
	);
}



export function PortalConsultation() {
	const { booking } = useAppState();

	const [liveConsultation, setLiveConsultation] = useState<ApiConsultation | null>(null);
	const [liveApplication, setLiveApplication] = useState<ApiApplication | null>(null);
	const [loading, setLoading] = useState(true);
	const refreshLiveCase = useCallback(async () => {
		try {
			const res = await meApi.application();
			setLiveConsultation(res.consultation ?? null);
			setLiveApplication(res.application ?? null);
		} catch {
			/* ignore network drop */
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void refreshLiveCase();
	}, [refreshLiveCase]);

	// An active case exists if there's a consultation OR an application. Ops
	// can create the application directly (bypassing consultation), and a
	// silent consultation-creation failure after payment shouldn't strand the
	// applicant on the fee page when their application is already in flight.
	const hasActiveCase = Boolean(liveConsultation || liveApplication || booking.confirmationId);
	const activeRef = liveConsultation?.reference ?? booking.confirmationId;
	const activeOfficer = liveConsultation?.assignedOfficerName;
	const workflow = liveConsultation?.workflow;
	const workflowStatus = workflow?.status ?? "AWAITING_ASSIGNMENT";
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
				<PortalConsultationBookingFlow />
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
											workflowStatus === "CLOSED"
												? "#fee2e2"
												: workflowStatus === "COMPLETED"
													? "#dcfce7"
													: workflowStatus === "IN_PROGRESS"
														? "#e0e7ff"
														: "#fef3c7",
										color:
											workflowStatus === "CLOSED"
												? "#991b1b"
												: workflowStatus === "COMPLETED"
													? "#166534"
													: workflowStatus === "IN_PROGRESS"
														? "#3730a3"
														: "#92400e",
										fontWeight: 600,
									}}
								>
									{workflowStatus === "CLOSED"
										? "Appointment Closed"
										: workflowStatus === "COMPLETED"
											? "✓ Assessment Completed"
											: workflowStatus === "IN_PROGRESS"
												? "In Progress"
												: "Awaiting Staff Assignment"}
								</span>
							</div>

							<h2 className="section-title mt-2 mb-1">
								{liveConsultation?.type === "in_person" ? "In-Person Consultation" : "Online Advisory Session"}
							</h2>
							<p className="muted" style={{ fontSize: "0.9rem" }}>
								Branch: <strong>{getBranchName(liveConsultation?.branch ?? booking.branchId)}</strong> ·{" "}
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
					{workflowStatus === "CLOSED" ? (
						<div>
							<h4 style={{ margin: "0 0 0.5rem 0" }}>Appointment Closed</h4>
							<p className="muted" style={{ fontSize: "0.9rem", margin: "0 0 0.75rem 0" }}>
								This appointment was cancelled. You can rebook if you would like to continue.
							</p>
							<Button to="/portal/appointments" variant="secondary" arrow>
								Rebook Appointment →
							</Button>
						</div>
					) : activeOfficer ? (
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
								<strong>{getBranchName(liveConsultation?.branch ?? booking.branchId)}</strong> is being assigned.
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
		schoolApplications,
		addSchoolApplication,
		removeSchoolApplication,
		lockSchoolSelection,
		booking,
	} = useAppState();
	const nav = useNavigate();

	const [serverInvoice, setServerInvoice] = useState<ApiInvoice | null>(null);

	const fetchInvoice = useCallback(() => {
		meApi
			.invoices()
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
			const { invoices } = await meApi.invoices();
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
			// Real Paystack hosted checkout session
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
	const { schoolApplications, application, setSchoolApplications } = useAppState();
	const paid = application.applicationInvoice.status === "paid";
	const acceptedCount = schoolApplications.filter((s) => s.status === "accepted").length;

	// Poll the server for the authoritative school application statuses. The
	// local state is the seed; the server is the source of truth once the
	// invoice is paid and handlers start posting updates.
	useEffect(() => {
		if (!paid) return;
		let active = true;
		const sync = async () => {
			try {
				const res = await schoolsApi.list();
				if (!active) return;
				const mapped: SchoolApplicationTrack[] = res.schools.map((s) => ({
					id: s.id,
					destinationId: s.destinationId,
					universityId: s.universityId,
					programId: s.programId,
					intake: s.intake,
					status: mapServerStatusToLocal(s.status),
					handlerNote: s.handlerNote,
					financialNote: s.financialNote,
					events: (s.events ?? []).map((e) => ({
						at: e.at,
						status: mapServerStatusToLocal(e.status),
						note: e.note,
						financialNote: e.financialNote ?? undefined,
					})),
					createdAt: s.createdAt,
					updatedAt: s.updatedAt,
					trackStartedAt: null,
					offerTuitionUsd: null,
					offerTuitionLabel: null,
					offerDepositUsd: null,
					offerDepositDueAt: null,
					offerDepositPaidAt: null,
				}));
				setSchoolApplications(mapped);
			} catch {
				/* keep local state on network drop */
			}
		};
		void sync();
		const id = window.setInterval(() => void sync(), 30_000);
		return () => {
			active = false;
			window.clearInterval(id);
		};
	}, [paid, setSchoolApplications]);

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

/**
 * Map the server's human-readable SchoolTrackStatus (e.g. "Offer Accepted")
 * to the local lowercase enum the portal UI is built against. The two sides
 * drifted when the API switched to title-case strings; this keeps the
 * tracking page in sync without rewriting every status check in the UI.
 */
function mapServerStatusToLocal(status: string): SchoolTrackStatus {
	const s = status.toLowerCase();
	if (s.includes("accepted")) return "accepted";
	if (s.includes("unconditional") || s.includes("offer received") || s === "conditional offer received") return "offer";
	if (s.includes("rejected")) return "rejected";
	if (s.includes("withdrawn") || s.includes("declined")) return "withdrawn";
	if (s.includes("under review") || s.includes("documents under")) return "under_review";
	if (s.includes("submitted")) return "submitted";
	if (s.includes("preparing") || s === "draft") return "queued";
	if (s.includes("waitlist") || s.includes("additional")) return "additional_info";
	return "queued";
}

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
	const { application, schoolApplications } = useAppState();
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
			const { invoices } = await meApi.invoices();
			const backend = invoices.find((i) => i.type === "visa" && i.balanceCents > 0);
			if (!backend) {
				toast.error(
					"Your visa invoice has not been issued on the server yet. Ask your consultant to raise it.",
				);
				return;
			}
			// Real Paystack checkout — redirect to hosted checkout
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

/**
 * Paystack redirects the browser back to `/portal/pay?invoice=…&paystack=1&reference=…`
 * after the hosted checkout. This route verifies the transaction server-side,
 * then re-syncs the authoritative invoice/application state from the API
 * before routing to the right stage page.
 */
export function PortalPayCallback() {
	const { payApplicationInvoice, payVisaInvoice, syncFromServer } = useAppState();
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
				if (params.get("paystack") !== "1" || !reference) {
					nav("/portal/application", { replace: true });
					return;
				}
				
				if (params.get("booking") === "consultation") {
					await bookingsApi.verifyPayment(reference);
					if (cancelled) return;

					// Force a sync to get the new booking into AppState
					// or we can optimistically update booking here, but a reload is safer.
					nav("/portal/appointments", { replace: true });
					toast.success("Payment confirmed. Your booking is now complete.");
					return;
				}

				// Agency service-fee payment (Stage IV). There is no invoice id
				// in the URL — the server resolved it from the session. Re-sync
				// the authoritative agency invoice state, which syncFromServer
				// maps onto agencyPaid / agencyDepositPaid / agencyStageIndex /
				// agencySettledAt, then route back to the Financial page.
				if (params.get("type") === "agency" || params.get("booking") === "agency") {
					await syncFromServer();
					if (cancelled) return;
					nav("/portal/financial", { replace: true });
					toast.success("Payment confirmed. Your service fee has been updated.");
					return;
				}

				if (!invoiceId) {
					nav("/portal/application", { replace: true });
					return;
				}

				const { invoice } = await meApi.paystackVerify(invoiceId, reference);
				if (cancelled) return;
				const settled = invoice.balanceCents === 0;
				if (settled) {
					// Update local AppState optimistically so the portal unlocks immediately.
					// The 30s background poll will also overwrite with fresh server state.
					if (invoice.type === "visa") payVisaInvoice();
					else payApplicationInvoice();
				}
				nav(invoice.type === "visa" ? "/portal/visa" : "/portal/application", {
					replace: true,
				});
				if (settled) toast.success("Payment confirmed. Your stage is now unlocked.");
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
	}, [nav, payApplicationInvoice, payVisaInvoice, syncFromServer, toast]);

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
