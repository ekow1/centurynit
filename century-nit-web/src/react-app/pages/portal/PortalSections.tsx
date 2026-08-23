import { Link } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Field, Input } from "../../components/ui/Field";
import {
	hasAcceptedOffer,
	hasPaymentPlan,
	isAppInvoicePaid,
	isAgencySettled,
	isAgencyDepositPaid,
	isVisaInvoicePaid,
	useAppState,
	type AssessmentData,
	type StageInvoice,
} from "../../context/AppState";
import {
	AGENCY_STAGES,
	AGENCY_DEPOSIT_PORTION,
	POST_ARRIVAL_SCHEDULES,
	APP_INVOICE_BASE,
	APP_INVOICE_PER_SCHOOL,
	CONSULTATION_FEE_AMOUNT,
	formatDualCurrency,
	getDestination,
	getProgram,
	getUniversity,
	GHS_RATE,
	PAYMENT_PLANS,
	PROCESS_STAGES,
	SCHOOL_TRACK_STATUS_LABELS,
	VISA_INVOICE_AMOUNT,
	REQUIRED_DOCUMENTS,
	getBranchName,
} from "century-nit-core";
import { documentsApi, invoicesApi, meApi, ApiError } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import { Avatar } from "../../components/ui/Avatar";
import { AvatarCropModal } from "../../components/portal/AvatarCropModal";
import type { ApplicantDocument, ApiInvoice } from "century-nit-shared";
import { Money, MoneyInline } from "../../components/ui/Money";
import { getMfaEnrollment, type MfaEnrollmentStatus } from "../../lib/api";

/* ========== Profile ========== */

function DataRow({ label, value }: { label: string; value: ReactNode }) {
	return (
		<div className="data-row">
			<span className="data-row__label muted">{label}</span>
			<span className="data-row__value">
				{value === "" || value == null ? <span className="muted">-</span> : value}
			</span>
		</div>
	);
}

const DOC_LABELS: Record<string, string> = {
	passport: "Passport",
	transcript: "Transcript",
	diploma: "Diploma / certificate",
	statement: "Personal statement",
	recommendation: "Recommendation",
	english: "English test",
};

/** Profile - the account and everything Century NIT holds about you. */
export function PortalProfile() {
	const {
		authUser,
		application,
		booking,
		interview,
		updateAssessment,
		updateAccount,
		setAvatarImage,
	} = useAppState();
	const a = application;
	const ass = booking.assessment;

	/**
	 * Documents are server-backed (R2 via presigned URLs). The profile shows a
	 * read-only summary, so a light fetch-on-mount is enough — the vault screen
	 * is where uploads happen.
	 */
	const [liveDocs, setLiveDocs] = useState<Map<string, ApplicantDocument> | null>(null);
	useEffect(() => {
		let active = true;
		documentsApi
			.list()
			.then((res) => {
				if (active) setLiveDocs(new Map(res.documents.map((d) => [d.documentType, d])));
			})
			.catch(() => {
				/* leave null — the summary shows "-" until it can load */
			});
		return () => {
			active = false;
		};
	}, []);

	const [mfaStatus, setMfaStatus] = useState<MfaEnrollmentStatus | null>(null);
	useEffect(() => {
		let active = true;
		getMfaEnrollment()
			.then((s) => {
				if (active) setMfaStatus(s);
			})
			.catch(() => {
				/* leave null — section shows "-" until it can load */
			});
		return () => {
			active = false;
		};
	}, []);

	const [editing, setEditing] = useState<null | "account" | "assessment" | "preferences">(null);
	const [draft, setDraft] = useState<Record<string, string>>({});
	const [justSaved, setJustSaved] = useState(false);
	const [avatarOpen, setAvatarOpen] = useState(false);

	useEffect(() => {
		if (!justSaved) return;
		const t = window.setTimeout(() => setJustSaved(false), 3000);
		return () => window.clearTimeout(t);
	}, [justSaved]);

	const dest = a.destinationId ? getDestination(a.destinationId) : null;
	const uni = a.universityId ? getUniversity(a.universityId) : null;
	const prog = a.programId ? getProgram(a.programId) : null;

	const fullName =
		authUser?.name || [a.firstName, a.lastName].filter(Boolean).join(" ") || "Century Applicant";

	const eligibility = booking.eligibilityOutcome.replace("_", " ");
	const uploadedDocs = liveDocs ? liveDocs.size : 0;
	const totalDocs = REQUIRED_DOCUMENTS.length;

	function startEdit(
		section: "account" | "assessment" | "preferences",
		values: Record<string, string>,
	) {
		setDraft(values);
		setEditing(section);
		setJustSaved(false);
	}

	function done() {
		setEditing(null);
		setJustSaved(true);
	}

	async function saveAccount() {
		const name = draft.name?.trim() || fullName;
		const email = draft.email?.trim() || authUser?.email || "";
		updateAccount({ name, email });
		try {
			await meApi.updateProfile({ name });
		} catch (e) {
			console.warn("Could not sync profile to server", e);
		}
		done();
	}

	async function saveAssessment() {
		const patch: Record<string, string> = {};
		for (const f of ASSESSMENT_FIELDS) patch[f.key] = draft[f.key] ?? "";
		updateAssessment(patch);
		try {
			await meApi.updateProfile({
				name: [patch.firstName || ass.firstName, patch.lastName || ass.lastName].filter(Boolean).join(" ") || undefined,
				phone: patch.phone || ass.phone || undefined,
				profile: {
					nationality: patch.nationality || ass.nationality || undefined,
					dob: patch.dateOfBirth || ass.dateOfBirth || undefined,
					degree: patch.highestEducation || ass.highestEducation || undefined,
					institution: patch.institution || ass.institution || undefined,
					gpa: patch.gpa || ass.gpa || undefined,
					gradYear: patch.graduationYear || ass.graduationYear || undefined,
					currentRole: patch.jobTitle || ass.jobTitle || undefined,
					experienceYears: patch.yearsExperience || ass.yearsExperience || undefined,
				},
			});
		} catch (e) {
			console.warn("Could not sync assessment to server", e);
		}
		done();
	}

	async function savePreferences() {
		const patch: Record<string, string> = {};
		for (const f of PREFERENCE_FIELDS) patch[f.key] = draft[f.key] ?? "";
		updateAssessment(patch);
		try {
			await meApi.updateProfile({
				targetCountry: patch.preferredCountries || undefined,
			});
		} catch (e) {
			console.warn("Could not sync preferences to server", e);
		}
		done();
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Account</p>
					<h1 className="page-title mt-1">Your profile</h1>
					<p className="lead mt-2">
						Everything we hold about you - account, consultation, application, and documents.
						You can update your personal details yourself; application records stay managed by your consultant.
					</p>
				</div>
			</header>

			{justSaved ? (
				<div className="profile-saved mt-3" role="status">
					<span aria-hidden>✓</span> Saved - your profile is up to date
				</div>
			) : null}

			{/* Identity hero */}
			<section className="profile-hero-card mt-4">
				<div className="profile-hero">
					<div className="profile-hero__main">
						<div className="profile-avatar">
							<Avatar name={fullName} image={authUser?.image} className="profile-monogram" />
							<button
								type="button"
								className="profile-avatar__edit"
								onClick={() => setAvatarOpen(true)}
							>
								{authUser?.image ? "Change photo" : "Add photo"}
							</button>
						</div>
						<div>
							<p className="display profile-hero__name">{fullName}</p>
							<p className="profile-hero__meta">{authUser?.email || a.email || "No email on file"}</p>
							<p className="mono profile-hero__meta mt-1">
								Signed in via {authUser?.method ?? "-"}
								{authUser?.signedInAt
									? ` · ${new Date(authUser.signedInAt).toLocaleString()}`
									: ""}
							</p>
						</div>
					</div>
					<div className="profile-hero__side">
						<span className="profile-eligibility">Eligibility · {eligibility}</span>
						<button
							type="button"
							className="profile-edit-btn profile-edit-btn--light"
							onClick={() =>
								editing === "account"
									? setEditing(null)
									: startEdit("account", {
											name: fullName,
											email: authUser?.email || a.email || "",
										})
							}
							aria-expanded={editing === "account"}
						>
							{editing === "account" ? "Cancel" : "Edit account"}
						</button>
					</div>
				</div>

				{editing === "account" ? (
					<div className="profile-edit profile-edit--light">
						<ProfileEditForm
							fields={ACCOUNT_FIELDS}
							draft={draft}
							onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
							onCancel={() => setEditing(null)}
							onSave={saveAccount}
						/>
					</div>
				) : null}

				<div className="profile-refs">
					<div className="profile-ref">
						<p className="profile-ref__label">Application ID</p>
						<p className="profile-ref__value mono">
							{a.applicationId ?? <span className="profile-hero__empty">Not issued yet</span>}
						</p>
					</div>
					<div className="profile-ref">
						<p className="profile-ref__label">Consultation reference</p>
						<p className="profile-ref__value mono">
							{booking.confirmationId ?? <span className="profile-hero__empty">Not booked</span>}
						</p>
					</div>
					<div className="profile-ref">
						<p className="profile-ref__label">Documents on file</p>
						<p className="profile-ref__value mono">
							{liveDocs ? `${uploadedDocs}/${totalDocs}` : <span className="profile-hero__empty">-</span>}
						</p>
					</div>
				</div>
			</section>

			{/* Sections */}
			<div className="profile-grid mt-6">
				<section>
					<div className="profile-section__head">
						<span className="profile-section__num">01</span>
						<h2 className="profile-section__title">Consultation</h2>
					</div>
					<div className="profile-block">
						<DataRow
							label="Type"
							value={booking.consultationType ? booking.consultationType.replace("_", " ") : null}
						/>
						<DataRow
							label="Location"
							value={[booking.city, booking.region, booking.country].filter(Boolean).join(", ")}
						/>
						<DataRow label="Branch" value={getBranchName(booking.branchId)} />
						<DataRow label="Date" value={booking.date} />
						<DataRow label="Time" value={booking.time} />
						<DataRow
							label="Consultation fee"
							value={
								booking.paymentStatus === "success"
									? `Paid · ${formatDualCurrency(CONSULTATION_FEE_AMOUNT)}`
									: "Unpaid"
							}
						/>
						<DataRow label="Eligibility" value={eligibility} />
						<DataRow label="Eligibility note" value={booking.eligibilityNote} />
					</div>
				</section>

				<section>
					<div className="profile-section__head profile-section__head--editable">
						<span className="profile-section__num">02</span>
						<h2 className="profile-section__title">Assessment</h2>
						<button
							type="button"
							className="profile-edit-btn"
							onClick={() =>
								editing === "assessment"
									? setEditing(null)
							: startEdit(
									"assessment",
									Object.fromEntries(
										ASSESSMENT_FIELDS.map((f) => [
											f.key,
											(f.key === "phone"
												? ass.phone || a.phone
												: ass[f.key as keyof AssessmentData]) ?? "",
										]),
									),
								)
							}
							aria-expanded={editing === "assessment"}
						>
							{editing === "assessment" ? "Cancel" : "Edit"}
						</button>
					</div>
					{editing === "assessment" ? (
						<div className="profile-block">
							<ProfileEditForm
								fields={ASSESSMENT_FIELDS}
								draft={draft}
								onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
								onCancel={() => setEditing(null)}
								onSave={saveAssessment}
							/>
						</div>
					) : (
						<div className="profile-block">
							<DataRow
								label="Full name"
								value={[ass.firstName, ass.middleName, ass.lastName].filter(Boolean).join(" ")}
							/>
							<DataRow label="Email" value={ass.email} />
							<DataRow label="Phone" value={ass.phone || a.phone} />
							<DataRow label="How did you hear about us?" value={a.referralSource} />
							<DataRow label="Date of birth" value={ass.dateOfBirth} />
							<DataRow label="Nationality" value={ass.nationality} />
							<DataRow label="Address" value={ass.address} />
							<DataRow label="Passport" value={ass.passportNumber} />
							<DataRow label="Education" value={ass.highestEducation} />
							<DataRow label="Institution" value={ass.institution} />
							<DataRow label="Field of study" value={ass.fieldOfStudy} />
							<DataRow label="Graduation year" value={ass.graduationYear} />
							<DataRow label="GPA" value={ass.gpa} />
							<DataRow
								label="English test"
								value={ass.englishTest ? `${ass.englishTest} · ${ass.englishScore}` : null}
							/>
						</div>
					)}
				</section>

				<section>
					<div className="profile-section__head profile-section__head--editable">
						<span className="profile-section__num">03</span>
						<h2 className="profile-section__title">Preferences</h2>
						<button
							type="button"
							className="profile-edit-btn"
							onClick={() =>
								editing === "preferences"
									? setEditing(null)
							: startEdit(
									"preferences",
									Object.fromEntries(
										PREFERENCE_FIELDS.map((f) => [f.key, ass[f.key as keyof AssessmentData] ?? ""]),
									),
								)
							}
							aria-expanded={editing === "preferences"}
						>
							{editing === "preferences" ? "Cancel" : "Edit"}
						</button>
					</div>
					{editing === "preferences" ? (
						<div className="profile-block">
							<ProfileEditForm
								fields={PREFERENCE_FIELDS}
								draft={draft}
								onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
								onCancel={() => setEditing(null)}
								onSave={savePreferences}
							/>
						</div>
					) : (
						<div className="profile-block">
							<DataRow label="Preferred countries" value={ass.preferredCountries} />
							<DataRow label="Preferred level" value={ass.preferredLevel} />
							<DataRow label="Preferred field" value={ass.preferredField} />
							<DataRow label="Intake" value={ass.intakePreference} />
							<DataRow label="Funding source" value={ass.fundingSource} />
							<DataRow label="Budget range" value={ass.budgetRange} />
							<DataRow
								label="Sponsor"
								value={
									ass.sponsorRelationship
										? `${ass.sponsorName} · ${ass.sponsorRelationship}`
										: null
								}
							/>
						</div>
					)}
				</section>

				<section>
					<div className="profile-section__head">
						<span className="profile-section__num">04</span>
						<h2 className="profile-section__title">Application</h2>
					</div>
					<div className="profile-block">
						<DataRow label="Destination" value={dest?.name} />
						<DataRow label="University" value={uni?.name} />
						<DataRow label="Programme" value={prog?.name} />
						<DataRow label="Intake" value={a.intake} />
						<DataRow label="Package" value={a.applicationPackageId} />
						<DataRow label="Payment plan" value={a.paymentPlanId || null} />
						<DataRow
							label="Schools selected"
							value={a.schoolSelectionDoneAt ? "Confirmed" : "Not yet"}
						/>
					</div>
				</section>
			</div>

			<section className="mt-6">
				<div className="profile-section__head">
					<span className="profile-section__num">05</span>
					<h2 className="profile-section__title">Documents & interview</h2>
				</div>
				<div className="profile-block">
					<p className="profile-docs__summary mono">
						{liveDocs ? `${uploadedDocs} of ${totalDocs} on file` : "-"}
					</p>
					<ul className="profile-docs">
						{REQUIRED_DOCUMENTS.map((r) => {
							const live = liveDocs?.get(r.id) ?? null;
							const status = live
								? live.status === "VERIFIED"
									? "verified"
									: live.status === "REJECTED"
										? "rejected"
										: "uploaded"
								: "missing";
							return (
								<li key={r.id} className="profile-doc">
									<span className="profile-doc__name">{DOC_LABELS[r.id] ?? r.id}</span>
									<span className={`portal-pill portal-pill--${docPill(status)}`}>
										{status}
									</span>
								</li>
							);
						})}
					</ul>
					<div className="profile-interview">
						<DataRow
							label="Interview"
							value={
								interview.confirmationCode
									? `${interview.confirmationCode} · ${interview.mode || "video"}`
									: null
							}
						/>
						<DataRow label="Document review" value={a.docReviewStatus} />
					</div>
				</div>
			</section>

			<section className="mt-6">
				<div className="profile-section__head profile-section__head--editable">
					<span className="profile-section__num">06</span>
					<h2 className="profile-section__title">Security</h2>
					<Link
						to="/portal/security"
						className="profile-edit-btn"
						aria-label="Manage two-factor authentication"
					>
						{mfaStatus?.enrolled ? "Manage" : "Set up"}
					</Link>
				</div>
				<div className="profile-block">
					<DataRow
						label="Two-factor authentication"
						value={
							mfaStatus == null ? (
								<span className="muted">-</span>
							) : mfaStatus.enrolled ? (
								<span>
									Active
									{mfaStatus.method
										? ` · ${mfaStatus.method === "totp" ? "Authenticator app" : mfaStatus.method === "email_otp" ? "Email code" : mfaStatus.method}`
										: ""}
								</span>
							) : (
								<span className="muted">Not set — recommended</span>
							)
						}
					/>
					<DataRow
						label="Requirement"
						value={mfaStatus?.required ? "Required for your account" : "Optional (recommended)"}
					/>
					<p className="muted mt-3" style={{ fontSize: "var(--text-sm)", maxWidth: "40rem" }}>
						Add a second step at sign-in to keep your application documents and payment history safe.
						You can enable or manage it anytime from the Security page.
					</p>
				</div>
			</section>

			<AvatarCropModal
				open={avatarOpen}
				onClose={() => setAvatarOpen(false)}
				onSaved={() => {
					setAvatarImage("set");
				}}
			/>
		</div>
	);
}

/** Fields the applicant may edit on their account. */
type ProfileField = { key: string; label: string; type?: string };

const ACCOUNT_FIELDS: ProfileField[] = [
	{ key: "name", label: "Full name" },
	{ key: "email", label: "Email", type: "email" },
];

/** Fields the applicant may edit under Assessment (system records stay read-only). */
const ASSESSMENT_FIELDS: ProfileField[] = [
	{ key: "phone", label: "Phone" },
	{ key: "dateOfBirth", label: "Date of birth", type: "date" },
	{ key: "nationality", label: "Nationality" },
	{ key: "address", label: "Address" },
	{ key: "passportNumber", label: "Passport number" },
	{ key: "passportCountry", label: "Passport country" },
	{ key: "highestEducation", label: "Highest education" },
	{ key: "institution", label: "Institution" },
	{ key: "fieldOfStudy", label: "Field of study" },
	{ key: "graduationYear", label: "Graduation year" },
	{ key: "gpa", label: "GPA" },
	{ key: "englishTest", label: "English test" },
	{ key: "englishScore", label: "English score" },
];

/** Fields the applicant may edit under Preferences. */
const PREFERENCE_FIELDS: ProfileField[] = [
	{ key: "preferredCountries", label: "Preferred countries" },
	{ key: "preferredLevel", label: "Preferred level" },
	{ key: "preferredField", label: "Preferred field" },
	{ key: "intakePreference", label: "Intake" },
	{ key: "fundingSource", label: "Funding source" },
	{ key: "budgetRange", label: "Budget range" },
	{ key: "sponsorName", label: "Sponsor name" },
	{ key: "sponsorRelationship", label: "Sponsor relationship" },
];

function ProfileEditForm({
	fields,
	draft,
	onChange,
	onCancel,
	onSave,
}: {
	fields: ProfileField[];
	draft: Record<string, string>;
	onChange: (key: string, value: string) => void;
	onCancel: () => void;
	onSave: () => void;
}) {
	return (
		<div className="profile-edit__form">
			<div className="profile-edit__fields">
				{fields.map((f) => (
					<Field key={f.key} label={f.label} htmlFor={`edit-${f.key}`}>
						<Input
							id={`edit-${f.key}`}
							type={f.type ?? "text"}
							value={draft[f.key] ?? ""}
							onChange={(e) => onChange(f.key, e.target.value)}
							fullBorder
						/>
					</Field>
				))}
			</div>
			<div className="profile-edit__actions">
				<Button size="sm" onClick={onSave}>
					Save changes
				</Button>
				<Button variant="ghost" size="sm" onClick={onCancel}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

function docPill(status: string) {
	return status === "verified"
		? "approved"
		: status === "uploaded"
			? "draft"
			: status === "rejected"
				? "needs_info"
				: "";
}

/* ========== Journey hub ========== */

/** Journey - every stage with its status; the stage pages open below it. */
export function PortalJourney() {
	const { journeyPhase, application, schoolApplications } =
		useAppState();
	const current = journeyPhase.stage;
	const stageMeta = PROCESS_STAGES.find((s) => s.id === current);

	const stageToPath: Record<string, string> = {
		consultation: "/portal/consultation",
		eligibility: "/portal/consultation",
		school_package: "/portal/package",
		school_select: "/portal/application",
		application_invoice: "/portal/application",
		school_tracking: "/portal/tracking",
		visa_invoice: "/portal/visa",
		visa: "/portal/visa",
		payment_plan: "/portal/payment-plan",
		agency: "/portal/agency",
		completed: "/portal/complete",
	};

	const admission = hasAcceptedOffer(schoolApplications);

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Journey</p>
					<h1 className="page-title mt-1">Your application journey</h1>
					<p className="lead mt-2">
						All eleven stages and their tracking, in order. Open the current stage to continue.
					</p>
				</div>
			</header>

			{/* Current stage - accent band, no card border */}
			<div className="journey-now mt-4">
				<div>
					<p className="eyebrow">Current stage</p>
					<p className="display journey-now__title">{stageMeta?.label}</p>
					<p className="journey-now__detail">{stageMeta?.detail}</p>
					{journeyPhase.nextUnlock ? (
						<p className="journey-now__detail">{journeyPhase.nextUnlock}</p>
					) : null}
				</div>
				<Button to={stageToPath[current] ?? "/portal/home"} variant="inverted" arrow>
					Open current stage
				</Button>
			</div>

			<section className="mt-6">
				<div className="portal-grid portal-grid--2 portal-grid--align-start">
					<div>
						<p className="eyebrow mb-3">All stages</p>
						<ol className="process-spine process-spine--compact">
							{PROCESS_STAGES.map((s) => {
								const st =
									s.index < (stageMeta?.index ?? 1)
										? "done"
										: s.index === (stageMeta?.index ?? 1)
											? "current"
											: "locked";
								return (
									<li key={s.id} className={`process-spine__item process-spine__item--${st}`}>
										<div className="process-spine__marker">
											<span className="process-spine__num">{s.index}</span>
										</div>
										<div className="process-spine__body">
											<div className="process-spine__head">
												<strong>{s.label}</strong>
												<span className="process-spine__state mono">
													{st === "done" ? "Done" : st === "current" ? "Now" : "Locked"}
												</span>
											</div>
											<p className="muted">{s.detail}</p>
											<div className="row mt-2">
												{s.path ? (
													<Link to={s.path} className="link-arrow">
														{st === "current" ? "Continue →" : st === "done" ? "View →" : "Open →"}
													</Link>
												) : null}
											</div>
										</div>
									</li>
								);
							})}
						</ol>
					</div>

					<div>
						<p className="eyebrow mb-3">Tracking</p>
						<div className="journey-track journey-track--single">
							<div className="journey-track__cell">
								<p className="journey-track__label">School applications</p>
								<p className="journey-track__value">{schoolApplications.length}</p>
								<ul className="journey-track__list">
									{schoolApplications.map((s) => {
										const uni = getUniversity(s.universityId);
										return (
											<li key={s.id}>
												<span>{uni?.name ?? s.universityId}</span>
												<strong style={{ textTransform: "capitalize" }}>
													{SCHOOL_TRACK_STATUS_LABELS[s.status] ?? s.status.replace("_", " ")}
												</strong>
											</li>
										);
									})}
								</ul>
								<p className="muted mt-3">Admission received: {admission ? "Yes" : "No"}</p>
							</div>
							<div className="journey-track__cell">
								<p className="journey-track__label">Visa tracking</p>
								<p className="journey-track__value" style={{ textTransform: "capitalize" }}>
									{application.visaStatus.replace("_", " ")}
								</p>
								<p className="muted mt-3">
									Updated{" "}
									{application.visaUpdatedAt ? new Date(application.visaUpdatedAt).toLocaleString() : "-"}
								</p>
							</div>
						</div>
					</div>
				</div>
			</section>
		</div>
	);
}

/* ========== Financial ========== */

type InvoiceStatus = "none" | "estimated" | "raised" | "paid";

const STATUS_LABEL: Record<InvoiceStatus, string> = {
	none: "Not raised",
	estimated: "Estimated",
	raised: "Outstanding",
	paid: "Paid",
};

/** Border-free ledger row used across the Financial page. */
function LedgerRow({
	title,
	status,
	amount,
	detail,
}: {
	title: string;
	status: InvoiceStatus | "settled" | "open";
	amount: React.ReactNode;
	detail?: React.ReactNode;
}) {
	return (
		<div className="ledger-item">
			<div className="ledger-item__head">
				<span className="ledger-item__title">{title}</span>
				<span className="ledger-item__amount mono">{amount}</span>
			</div>
			<div className="ledger-item__sub">
				<span className={`ledger-status ledger-status--${status}`}>
					{STATUS_LABEL[status as InvoiceStatus] ?? status}
				</span>
				{detail ? <span className="ledger-item__detail muted">{detail}</span> : null}
			</div>
		</div>
	);
}

function invoiceAmount(inv: StageInvoice) {
	const paid = inv.status === "paid";
	const payable = inv.actualAmount ?? inv.amount;
	return <Money usd={payable} negative={paid} />;
}

function invoiceDetail(inv: StageInvoice) {
	if (inv.status === "estimated") {
		return (
			<>
				Estimate <MoneyInline usd={inv.estimatedAmount} /> - consultant confirming the actual
				invoice
			</>
		);
	}
	if (inv.actualAmount != null) {
		return (
			<>
				Estimate <MoneyInline usd={inv.estimatedAmount} /> → Actual{" "}
				<MoneyInline usd={inv.actualAmount} />
			</>
		);
	}
	return "Invoice not raised yet";
}

/** Financial - every payment, settlement, and what's still outstanding. */
export function PortalFinancial() {
	const { application, booking, schoolApplications, choosePaymentPlan, choosePostArrivalSchedule, payAgencyInstallment, enabledPostArrivalSchedules, customPostArrivalSchedules } = useAppState();
	const { toast } = useNotifier();
	const a = application;

	// ── Invoice fetching from the real API ───────────────────────────────
	const [invoices, setInvoices] = useState<ApiInvoice[]>([]);
	const [invoicesLoaded, setInvoicesLoaded] = useState(false);

	// Agency service-fee payment: redirect to Paystack hosted checkout, with
	// a "Processing…" state while we wait for the redirect and surfaced errors
	// if the API refuses (e.g. "No agency invoice found").
	const [agencyPaying, setAgencyPaying] = useState(false);

	async function handlePayAgency() {
		if (agencyPaying) return;
		setAgencyPaying(true);
		try {
			await payAgencyInstallment();
			// On success the browser is redirected to Paystack; nothing else
			// to do here. If the redirect didn't fire, payAgencyInstallment
			// throws, so we land in the catch below.
		} catch (err) {
			toast.error(
				err instanceof ApiError
					? err.message
					: err instanceof Error && err.message
						? err.message
						: "Could not start the payment. Please try again.",
			);
			setAgencyPaying(false);
		}
	}

	useEffect(() => {
		async function load() {
			try {
				const { invoices: list } = await invoicesApi.list();
				setInvoices(list);
				setInvoicesLoaded(true);
			} catch (err) {
				const msg =
					err instanceof ApiError
						? err.message
						: "Could not load invoices. Please try again.";
				toast.error(msg);
			}
		}
		load();
	}, []);

	// ── Derived from fetched invoices (fallback to AppState + hardcoded) ──
	const consultationPaid = booking.paymentStatus === "success";

	// Find the application‑type and visa‑type invoice from the API list
	const appInvoiceType = invoicesLoaded ? invoices.find((i) => i.type === "application") : null;
	const visaInvoiceType = invoicesLoaded ? invoices.find((i) => i.type === "visa") : null;

	const appPaid = isAppInvoicePaid(a) || (invoicesLoaded && appInvoiceType?.status === "paid");
	const visaPaid = isVisaInvoicePaid(a) || (invoicesLoaded && visaInvoiceType?.status === "paid");

	const settled = isAgencySettled(a);
	const depositPaid = isAgencyDepositPaid(a);
	const plan = hasPaymentPlan(a);

	const appInvoiceAmount = appInvoiceType?.subtotalCents ?? a.applicationInvoice.amount;
	const visaInvoiceAmount = visaInvoiceType?.subtotalCents ?? a.visaInvoice.amount;

	const totalPaid =
		(consultationPaid ? CONSULTATION_FEE_AMOUNT : 0) +
		(appPaid ? appInvoiceAmount : 0) +
		(visaPaid ? visaInvoiceAmount : 0) +
		a.agencyPaid;

	const appOutstanding =
		(a.applicationInvoice.status === "raised" && !appPaid) ? appInvoiceAmount : 0;
	const visaOutstanding =
		(a.visaInvoice.status === "raised" && !visaPaid) ? visaInvoiceAmount : 0;
	const agencyOutstanding = Math.max(0, a.agencyTotal - a.agencyPaid);

	const totalOutstanding = appOutstanding + visaOutstanding + agencyOutstanding;

	async function switchPlan(planId: "full" | "installment") {
		try {
			await meApi.choosePaymentPlan({ paymentPlanId: planId });
			choosePaymentPlan(planId);
			toast.success(`Payment plan switched to ${planId === "full" ? "full" : "installment"}.`);
		} catch (err) {
			const msg =
				err instanceof ApiError ? err.message : "Could not switch payment plan. Please try again.";
			toast.error(msg);
		}
	}

	// Fees the applicant will owe but that have not been raised yet — without
	// these the top band reads GH₵0 / GH₵0 for most of the journey
	const appNotRaised = a.applicationInvoice.status === "none" ? APP_INVOICE_BASE : 0;
	const visaNotRaised = a.visaInvoice.status === "none" ? VISA_INVOICE_AMOUNT : 0;
	const notYetRaised = (consultationPaid ? 0 : CONSULTATION_FEE_AMOUNT) + appNotRaised + visaNotRaised;

	/** Schools that have made an offer carry real institutional figures */
	const offers = schoolApplications
		.filter((t) => t.offerTuitionUsd)
		.map((t) => ({
			id: t.id,
			uni: getUniversity(t.universityId)?.name ?? "University",
			program: getProgram(t.programId)?.name ?? "",
			tuitionUsd: t.offerTuitionUsd ?? 0,
			depositUsd: t.offerDepositUsd,
			depositPaidAt: t.offerDepositPaidAt,
		}));

	return (
		<div className="portal-page">
			{agencyPaying ? (
				<div className="loading-overlay" role="status" aria-live="polite">
					<div className="spinner" aria-hidden />
					<p className="mono">Contacting payment provider…</p>
					<p className="muted">Redirecting you to Paystack to pay your service fee</p>
				</div>
			) : null}
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Financial</p>
					<h1 className="page-title mt-1">Payments & settlements</h1>
					<p className="lead mt-2">
						Every fee, invoice, and balance - what's paid and what's outstanding.
					</p>
				</div>
			</header>

			<section className="mt-4">
				<div className="stat-band">
					<div className="stat-cell">
						<p className="stat-cell__label">Total paid</p>
						<p className="stat-cell__value">
							<Money usd={totalPaid} />
						</p>
					</div>
					<div className="stat-cell">
						<p className="stat-cell__label">Outstanding</p>
						<p className="stat-cell__value">
							<Money usd={totalOutstanding} />
						</p>
					</div>
					<div className="stat-cell stat-cell--accent">
						<p className="stat-cell__label">
							{totalPaid + totalOutstanding > 0 ? "Total committed" : "Expected from here"}
						</p>
						<p className="stat-cell__value">
							<Money usd={totalPaid + totalOutstanding + notYetRaised} />
						</p>
						<p className="stat-cell__sub">
							{settled ? "Service fee settled" : "Century NIT fees only"}
						</p>
					</div>
				</div>
			</section>

			<section className="mt-6">
				<p className="eyebrow mb-3">Fees & invoices</p>
				<div className="ledger">
					<LedgerRow
						title={`Consultation fee · Stage I · ${booking.consultationType.replace("_", " ") || "-"}`}
						status={consultationPaid ? "paid" : "none"}
						amount={<Money usd={CONSULTATION_FEE_AMOUNT} negative={consultationPaid} />}
						detail={consultationPaid ? "Paid at booking" : "Pay when booking the consultation"}
					/>
					<LedgerRow
						title={
							schoolApplications.length
								? `Application invoice · ${schoolApplications.length} school${schoolApplications.length === 1 ? "" : "s"}`
								: "Application invoice"
						}
						status={a.applicationInvoice.status}
						amount={invoiceAmount(a.applicationInvoice)}
						detail={invoiceDetail(a.applicationInvoice)}
					/>
					<LedgerRow
						title="Visa invoice"
						status={a.visaInvoice.status}
						amount={invoiceAmount(a.visaInvoice)}
						detail={invoiceDetail(a.visaInvoice)}
					/>
				</div>
			</section>

			{/* Payment plan — full width */}
			<section className="mt-6">
				<p className="eyebrow mb-3">Payment plan</p>

				{/* Step 1: Deposit — must be paid before plan selection */}
				{!depositPaid && a.agencyTotal > 0 ? (
					<div className="agency-deposit-gate">
						<p className="agency-deposit-gate__title">Pay your service fee deposit first</p>
						<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
							A {Math.round(AGENCY_DEPOSIT_PORTION * 100)}% deposit (<MoneyInline usd={Math.round(a.agencyTotal * AGENCY_DEPOSIT_PORTION)} />) is required before you can choose a payment plan for the remaining balance.
						</p>
					<Button variant="primary" onClick={() => void handlePayAgency()} disabled={agencyPaying} className="mt-3">
						{agencyPaying ? "Processing…" : <>Pay deposit · <MoneyInline usd={Math.round(a.agencyTotal * AGENCY_DEPOSIT_PORTION)} /></>}
					</Button>
					</div>
				) : null}

				{/* Step 2: Plan picker — locked until deposit is paid */}
				{depositPaid ? (
					<>
						<div className="plan-picker plan-picker--row">
							{PAYMENT_PLANS.map((p) => {
								const on = a.paymentPlanId === p.id;
								const isFull = p.id === "full";
								const remaining = a.agencyTotal - a.agencyPaid;
								return (
<button
									key={p.id}
									type="button"
									className={`plan-opt${on ? " plan-opt--on" : ""}`}
									onClick={() => void switchPlan(p.id)}
									aria-pressed={on}
								>
										<span className="plan-opt__check" aria-hidden>✓</span>
										<span className="plan-opt__name">{p.name}</span>
										<span className="plan-opt__blurb">{p.blurb}</span>
										{a.agencyTotal > 0 ? (
											<span className="plan-opt__amt">
												{isFull
													? <><MoneyInline usd={remaining} /> one-time</>
													: <><MoneyInline usd={Math.round(a.agencyTotal * 0.5)} /> · <MoneyInline usd={Math.round(a.agencyTotal * 0.4)} /></>}
											</span>
										) : null}
									</button>
								);
							})}
						</div>
						<p className="muted mt-3" style={{ fontSize: "0.9rem" }}>
							{plan
								? `Chosen ${a.paymentPlanChosenAt ? new Date(a.paymentPlanChosenAt).toLocaleDateString() : ""} — switch any time before the balance falls due.`
								: "Deposit paid! Pick how you'd like to settle the remaining balance."}
						</p>
					</>
				) : null}
			</section>

			{/* Service fee milestones — full width */}
			{a.agencyTotal > 0 ? (
				<section className="mt-6">
					<p className="eyebrow mb-3">Service fee · milestones</p>
					<>
						<div className="agency-progress">
									<div
										className={`agency-progress__step${depositPaid ? " agency-progress__step--done" : " agency-progress__step--current"}`}
									>
										<span className="agency-progress__dot" aria-hidden>{depositPaid ? "✓" : 1}</span>
										<span className="agency-progress__label">Deposit</span>
									</div>
									{a.paymentPlanId === "full" ? (
										<div
											className={`agency-progress__step${settled ? " agency-progress__step--done" : depositPaid && plan ? " agency-progress__step--current" : ""}`}
										>
											<span className="agency-progress__dot" aria-hidden>{settled ? "✓" : 2}</span>
											<span className="agency-progress__label">Balance</span>
										</div>
									) : (
										AGENCY_STAGES.slice(1).map((stg, i) => {
											const realIdx = i + 1;
											const covered = settled || a.agencyStageIndex > i;
											const current = depositPaid && plan && !settled && a.agencyStageIndex === i;
											return (
												<div
													key={stg.id}
													className={`agency-progress__step${covered ? " agency-progress__step--done" : ""}${current ? " agency-progress__step--current" : ""}`}
												>
													<span className="agency-progress__dot" aria-hidden>{covered ? "✓" : realIdx + 1}</span>
													<span className="agency-progress__label">{stg.label.split(" · ")[1] ?? stg.label}</span>
												</div>
											);
										})
									)}
								</div>
								<div className="ledger">
									{/* Deposit row */}
									<div className="ledger-item">
										<div className="ledger-item__head">
											<span className="ledger-item__title">Service fee · deposit</span>
											<span className="ledger-item__amount mono">
												<Money usd={Math.round(a.agencyTotal * AGENCY_DEPOSIT_PORTION)} negative={depositPaid} prefix={depositPaid ? "Paid" : undefined} />
											</span>
										</div>
										<div className="ledger-item__sub">
											<span className={`ledger-status ledger-status--${depositPaid ? "paid" : "raised"}`}>
												{depositPaid ? "Paid" : "Due now"}
											</span>
											<span className="ledger-item__detail muted">Required before choosing your payment plan</span>
										</div>
									</div>

									{/* Remaining balance — only after deposit + plan chosen */}
									{depositPaid && plan ? (
										a.paymentPlanId === "full" ? (
											<div className="ledger-item">
												<div className="ledger-item__head">
													<span className="ledger-item__title">Remaining balance</span>
													<span className="ledger-item__amount mono">
														<Money usd={a.agencyTotal - a.agencyPaid} negative={settled} prefix={settled ? "Paid" : undefined} />
													</span>
												</div>
												<div className="ledger-item__sub">
													<span className={`ledger-status ledger-status--${settled ? "paid" : "raised"}`}>
														{settled ? "Paid" : "Due now"}
													</span>
													<span className="ledger-item__detail muted">Pay the remaining 90% in one payment</span>
												{!settled && (
													<Button size="sm" variant="primary" onClick={() => void handlePayAgency()} disabled={agencyPaying}>
														{agencyPaying ? "Processing…" : "Pay in full"}
													</Button>
												)}
												</div>
											</div>
										) : (
											(() => {
												const preDep = AGENCY_STAGES[1];
												const preDepPortion = Math.round(a.agencyTotal * preDep.portion);
												const preDepCovered = settled || a.agencyStageIndex >= 1;
												const preDepCurrent = !settled && a.agencyStageIndex === 0;
												const postArrivalStage = AGENCY_STAGES[2];
												const postArrivalPortion = Math.round(a.agencyTotal * postArrivalStage.portion);
												const schedule = [...POST_ARRIVAL_SCHEDULES, ...customPostArrivalSchedules].find((s) => s.id === a.postArrivalSchedule);
												const perPayment = schedule ? Math.round(postArrivalPortion / schedule.payments) : 0;
												const postArrivalStarted = a.agencyStageIndex >= 1;
												return (
													<>
														{/* Pre-departure milestone */}
														<div className="ledger-item">
															<div className="ledger-item__head">
																<span className="ledger-item__title">{preDep.label}</span>
																<span className="ledger-item__amount mono">
																	<Money usd={preDepPortion} negative={preDepCovered} prefix={preDepCovered ? "Paid" : undefined} />
																</span>
															</div>
															<div className="ledger-item__sub">
																<span className={`ledger-status ledger-status--${preDepCovered ? "paid" : preDepCurrent ? "raised" : "open"}`}>
																	{preDepCovered ? "Paid" : preDepCurrent ? "Due now" : "Upcoming"}
																</span>
																<span className="ledger-item__detail muted">{preDep.detail}</span>
															{preDepCurrent && (
																<Button size="sm" variant="primary" onClick={() => void handlePayAgency()} disabled={agencyPaying}>
																	{agencyPaying ? "Processing…" : "Pay pre-departure"}
																</Button>
															)}
															</div>
														</div>

														{/* Post-arrival: upcoming, schedule picker, or recurring payments */}
														{!postArrivalStarted ? (
															<div className="ledger-item">
																<div className="ledger-item__head">
																	<span className="ledger-item__title">{postArrivalStage.label}</span>
																	<span className="ledger-item__amount mono">
																		<Money usd={postArrivalPortion} />
																	</span>
																</div>
																<div className="ledger-item__sub">
																	<span className="ledger-status ledger-status--open">Upcoming</span>
																	<span className="ledger-item__detail muted">{postArrivalStage.detail}</span>
																</div>
															</div>
														) : !schedule ? (
															<div className="agency-deposit-gate">
																<p className="agency-deposit-gate__title">Choose your post-arrival payment schedule</p>
																<p className="muted mt-1" style={{ fontSize: "0.9rem" }}>
																	Split the remaining <MoneyInline usd={postArrivalPortion} /> into recurring payments. A grace period applies before the first payment.
																</p>
																<div className="plan-picker plan-picker--row mt-3">
																	{[...POST_ARRIVAL_SCHEDULES, ...customPostArrivalSchedules]
																		.filter((s) => !enabledPostArrivalSchedules || enabledPostArrivalSchedules.includes(s.id))
																		.map((s) => {
																		const on = a.postArrivalSchedule === s.id;
																		return (
																			<button
																				key={s.id}
																				type="button"
																				className={`plan-opt${on ? " plan-opt--on" : ""}`}
																				onClick={() => choosePostArrivalSchedule(s.id)}
																				aria-pressed={on}
																			>
																				<span className="plan-opt__check" aria-hidden>✓</span>
																				<span className="plan-opt__name">{s.label}</span>
																				<span className="plan-opt__blurb">{s.detail}</span>
																				{a.agencyTotal > 0 ? (
																					<span className="plan-opt__amt">
																						<MoneyInline usd={Math.round(postArrivalPortion / s.payments)} /> × {s.payments}
																					</span>
																				) : null}
																			</button>
																		);
																	})}
																</div>
																<p className="muted mt-2" style={{ fontSize: "0.85rem" }}>
																	Grace period: 14–30 days depending on schedule, before the first payment.
																</p>
															</div>
														) : (
															Array.from({ length: schedule.payments }).map((_, i) => {
																const covered = settled || i < a.postArrivalPaymentIndex;
																const current = !settled && i === a.postArrivalPaymentIndex;
																const canPay = current && !covered;
																const isLast = i === schedule.payments - 1;
																return (
																	<div key={i} className="ledger-item">
																		<div className="ledger-item__head">
																			<span className="ledger-item__title">{postArrivalStage.label} · {schedule.label} {i + 1}/{schedule.payments}</span>
																			<span className="ledger-item__amount mono">
																				<Money usd={isLast ? Math.max(0, a.agencyTotal - a.agencyPaid) : perPayment} negative={covered} prefix={covered ? "Paid" : undefined} />
																			</span>
																		</div>
																		<div className="ledger-item__sub">
																			<span className={`ledger-status ledger-status--${covered ? "paid" : current ? "raised" : "open"}`}>
																				{covered ? "Paid" : current ? "Due now" : "Upcoming"}
																			</span>
																			<span className="ledger-item__detail muted">
																				{i === 0 ? `${schedule.graceDays}-day grace, then every ${schedule.intervalDays} days` : `Every ${schedule.intervalDays} days`}
																			</span>
																		{canPay && (
																			<Button size="sm" variant="primary" onClick={() => void handlePayAgency()} disabled={agencyPaying}>
																				{agencyPaying ? "Processing…" : <>Pay {schedule.label} {a.postArrivalPaymentIndex + 1} of {schedule.payments}</>}
																			</Button>
																		)}
																		</div>
																	</div>
																);
															})
														)}
													</>
												);
											})()
										)) : null}
									<div className="ledger-item ledger-item--total">
										<div className="ledger-item__head">
											<span className="ledger-item__title">Total paid</span>
											<span className="ledger-item__amount mono">
												<Money usd={a.agencyPaid} /> <span className="muted">of</span>{" "}
												<Money usd={a.agencyTotal} />
											</span>
										</div>
										<div className="agency-bar">
											<div
												className="agency-bar__fill"
												style={{ width: `${a.agencyTotal > 0 ? Math.round((a.agencyPaid / a.agencyTotal) * 100) : 0}%` }}
											/>
										</div>
										<p className="muted mt-1" style={{ fontSize: "0.85rem" }}>
											{settled
												? "Service fee fully settled."
												: !depositPaid
													? "Pay the deposit to unlock your payment plan."
													: !plan
														? "Choose a payment plan to continue."
														: a.paymentPlanId === "full"
															? "Pay the remaining balance to settle your service fee."
															: a.agencyStageIndex === 0
																? "Pay the pre-departure milestone to continue."
																: !a.postArrivalSchedule
																	? "Choose a post-arrival payment schedule."
																	: (() => {
																			const sched = POST_ARRIVAL_SCHEDULES.find((s) => s.id === a.postArrivalSchedule);
																			const remaining = sched ? sched.payments - a.postArrivalPaymentIndex : 0;
																			return `${Math.round((a.agencyPaid / a.agencyTotal) * 100)}% paid — ${remaining} ${sched?.label ?? ""} payment${remaining === 1 ? "" : "s"} remaining.`;
																		})()
											}
										</p>
								</div>
							</div>
						</>
					</section>
				) : null}

				{/* Second ledger — deliberately never merged with the one above.
				    Century NIT does not collect tuition, and a combined total would
				    imply that it does. */}
				{offers.length > 0 ? (
					<section className="mt-6">
						<div className="uni-ledger">
						<header className="uni-ledger__head">
							<div>
								<p className="eyebrow">University tuition</p>
								<p className="uni-ledger__sub">
									Paid directly to the institution — not to Century NIT
								</p>
							</div>
						</header>

						{offers.map((o) => (
							<div key={o.id} className="uni-ledger__row">
								<div className="uni-ledger__who">
									<span className="uni-ledger__uni">{o.uni}</span>
									<span className="uni-ledger__prog">{o.program}</span>
								</div>
								<div className="uni-ledger__figs">
									<span className="uni-ledger__fig">
										<span className="uni-ledger__fig-label mono">Tuition</span>
										<Money usd={o.tuitionUsd} className="uni-ledger__money" />
									</span>
									{o.depositUsd ? (
										<span className="uni-ledger__fig">
											<span className="uni-ledger__fig-label mono">
												Deposit {o.depositPaidAt ? "· paid" : "· due"}
											</span>
											<Money usd={o.depositUsd} className="uni-ledger__money" />
										</span>
									) : null}
								</div>
							</div>
						))}

						<p className="uni-ledger__note">
							You pay tuition for the <strong>one</strong> institution you take up — these
							figures are not cumulative, and none of them is billed by Century NIT.
						</p>
					</div>
				</section>
			) : null}

			<section className="mt-6">
				<p className="muted" style={{ maxWidth: "36rem" }}>
					Each invoice is itemised by your consultant and may add handling fees, so the
					amounts above are the base figures. The application invoice grows by{" "}
					<MoneyInline usd={APP_INVOICE_PER_SCHOOL} /> for each school you add. Cedi amounts
					convert at GH₵{GHS_RATE} to $1. University tuition is never billed here — it is paid
					directly to the institution.
				</p>
			</section>
		</div>
	);
}
