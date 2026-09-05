import { Link } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select, Textarea } from "../../components/ui/Field";
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
import { FALLBACK_FEE_SCHEDULE } from "../../context/AppState";
import { usdFromCents } from "century-nit-shared";
import {
	AGENCY_STAGES,
	AGENCY_DEPOSIT_PORTION,
	APPLICANT_COUNTRIES,
	POST_ARRIVAL_SCHEDULES,
	formatDualCurrency,
	getDestination,
	getProgram,
	getUniversity,
	GHS_RATE,
	PAYMENT_PLANS,
	PROCESS_STAGES,
	SCHOOL_DEGREE_LEVELS,
	SCHOOL_TRACK_STATUS_LABELS,
	REQUIRED_DOCUMENTS,
	getBranchName,
} from "century-nit-core";
import { documentsApi, meApi, ApiError } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import { Avatar } from "../../components/ui/Avatar";
import { AvatarCropModal } from "../../components/portal/AvatarCropModal";
import { ChangePasswordModal, ChangeEmailModal } from "../../components/portal/SecurityModals";
import type { ApplicantDocument, ApiInvoice } from "century-nit-shared";
import { Money, MoneyInline } from "../../components/ui/Money";
import { getMfaEnrollment, type MfaEnrollmentStatus } from "../../lib/api";

/* ========== Profile ========== */


function DossierField({
	label,
	value,
	className,
}: {
	label: string;
	value?: ReactNode;
	className?: string;
}) {
	if (value === "" || value == null) return null;
	return (
		<div className={`dossier-field ${className || ""}`}>
			<span className="dossier-field__label">{label}</span>
			<span className="dossier-field__value">{value}</span>
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

const HIGHEST_EDUCATION_OPTIONS = ["High school / secondary", "Diploma / HND", "Bachelor's degree", "Master's degree", "PhD / Doctorate", "Professional qualification", "Other"];
const EMPLOYMENT_STATUS_OPTIONS = ["Employed full-time", "Employed part-time", "Self-employed", "Unemployed", "Student", "Other"];
const ENGLISH_TEST_OPTIONS = ["IELTS Academic", "IELTS General", "TOEFL iBT", "PTE Academic", "Duolingo English Test", "Cambridge C1 Advanced", "Cambridge C2 Proficiency", "None yet"];
const INTAKE_OPTIONS = ["January 2026", "May 2026", "September 2026", "January 2027", "May 2027", "September 2027", "Flexible"];
const FUNDING_SOURCE_OPTIONS = ["Self-funded", "Family / sponsor", "Scholarship", "Student loan", "Employer", "Government scholarship", "Other"];
const BUDGET_RANGE_OPTIONS = ["Under $10,000", "$10,000 – $25,000", "$25,000 – $50,000", "$50,000 – $75,000", "$75,000 – $100,000", "Above $100,000"];
const SPONSOR_RELATIONSHIP_OPTIONS = ["Parent", "Spouse", "Sibling", "Other relative", "Employer", "Friend / other"];
const GENDER_OPTIONS = ["Male", "Female", "Non-binary", "Prefer not to say"];

const CURRENT_YEAR = new Date().getFullYear();

function getDegreeLevelName(id: string) {
	return SCHOOL_DEGREE_LEVELS.find((l) => l.id === id)?.name ?? id;
}

function consultationTypeLabel(type?: string) {
	const t = type?.toLowerCase();
	if (t === "online") return "Online";
	if (t === "in_person") return "In person";
	return type ? type.replace(/_/g, " ") : null;
}

function signInMethodLabel(method?: string) {
	if (!method || method === "single_sign_on") return "Single Sign-On";
	if (method === "google") return "Google Account";
	if (method === "microsoft") return "Microsoft Account";
	if (method === "apple") return "Apple ID";
	if (method === "otp" || method === "magic_link") return "Passwordless (OTP / Magic Link)";
	if (method === "phone") return "Phone verification";
	if (method === "email") return "Email & password";
	return method.charAt(0).toUpperCase() + method.slice(1).replace(/_/g, " ");
}

/** Profile - the account and everything Century NIT holds about you. */
export function PortalProfile() {
	const {
		authUser,
		application,
		booking,
		interview,
		updateAssessment,
		updateAccount,
		fees,
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
	const [dossierTab, setDossierTab] = useState<
		"overview" | "assessment" | "preferences" | "consultation" | "security"
	>("overview");
	const [draft, setDraft] = useState<Record<string, string>>({});
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [saving, setSaving] = useState<null | "account" | "assessment" | "preferences">(null);
	const [avatarOpen, setAvatarOpen] = useState(false);
	const [changePasswordOpen, setChangePasswordOpen] = useState(false);
	const [changeEmailOpen, setChangeEmailOpen] = useState(false);
	const { toast } = useNotifier();

	const dest = a.destinationId ? getDestination(a.destinationId) : null;
	const uni = a.universityId ? getUniversity(a.universityId) : null;
	const prog = a.programId ? getProgram(a.programId) : null;

	const fullName =
		authUser?.name || [a.firstName, a.lastName].filter(Boolean).join(" ") || "Century Applicant";

	const eligibility = booking.eligibilityOutcome.replace("_", " ");
	const eligibilityVariant =
		booking.eligibilityOutcome.toLowerCase().includes("eligible") && !booking.eligibilityOutcome.toLowerCase().includes("not")
			? "eligible"
			: booking.eligibilityOutcome.toLowerCase().includes("conditional")
				? "conditional"
					: booking.eligibilityOutcome.toLowerCase().includes("not_eligible")
						? "not_eligible"
						: "pending";
	const uploadedDocs = liveDocs ? liveDocs.size : 0;
	const totalDocs = REQUIRED_DOCUMENTS.length;

	function startEdit(
		section: "account" | "assessment" | "preferences",
		values: Record<string, string>,
	) {
		setDraft(values);
		setErrors({});
		setEditing(section);
	}

	function validateAccount(values: Record<string, string>) {
		const next: Record<string, string> = {};
		if (!values.name?.trim()) next.name = "Enter your full name";
		return next;
	}

	function validateAssessment(values: Record<string, string>) {
		const next: Record<string, string> = {};
		if (!values.dateOfBirth) next.dateOfBirth = "Date of birth is required";
		else {
			const d = new Date(values.dateOfBirth);
			if (isNaN(d.getTime())) next.dateOfBirth = "Enter a valid date";
			else {
				const age = CURRENT_YEAR - d.getFullYear();
				if (age < 12 || age > 100) next.dateOfBirth = "Enter a realistic date of birth";
			}
		}
		if (!values.nationality?.trim()) next.nationality = "Nationality is required";
		if (!values.highestEducation?.trim()) next.highestEducation = "Highest education is required";
		if (values.graduationYear && (Number(values.graduationYear) < 1950 || Number(values.graduationYear) > CURRENT_YEAR + 10)) {
			next.graduationYear = "Enter a valid graduation year";
		}
		if (values.passportExpiry && new Date(values.passportExpiry) <= new Date()) {
			next.passportExpiry = "Passport must not be expired";
		}
		if (values.englishDate && new Date(values.englishDate) > new Date()) {
			next.englishDate = "Test date cannot be in the future";
		}
		return next;
	}

	function mapAssessmentDraftToProfile(values: Record<string, string>) {
		return {
			dob: values.dateOfBirth || undefined,
			nationality: values.nationality || undefined,
			gender: values.gender || undefined,
			address: values.address || undefined,
			passportNumber: values.passportNumber || undefined,
			passportCountry: values.passportCountry || undefined,
			passportIssue: values.passportIssue || undefined,
			passportExpiry: values.passportExpiry || undefined,
			degree: values.highestEducation || undefined,
			institution: values.institution || undefined,
			fieldOfStudy: values.fieldOfStudy || undefined,
			gradYear: values.graduationYear || undefined,
			gpa: values.gpa || undefined,
			employmentStatus: values.employmentStatus || undefined,
			company: values.employer || undefined,
			currentRole: values.jobTitle || undefined,
			experienceYears: values.yearsExperience || undefined,
			englishTest: values.englishTest || undefined,
			englishScore: values.englishScore || undefined,
			englishDate: values.englishDate || undefined,
		};
	}

	function mapPreferencesDraftToProfile(values: Record<string, string>) {
		return {
			preferredCountries: values.preferredCountries || undefined,
			degreeLevel: values.preferredLevel || undefined,
			major: values.preferredField || undefined,
			intake: values.intakePreference || undefined,
			fundingSource: values.fundingSource || undefined,
			budget: values.budgetRange || undefined,
			sponsorName: values.sponsorName || undefined,
			sponsorRelationship: values.sponsorRelationship || undefined,
		};
	}

	async function saveAccount() {
		const validation = validateAccount(draft);
		if (Object.keys(validation).length > 0) {
			setErrors(validation);
			return;
		}
		const name = draft.name.trim();
		const currentEmail = authUser?.email || a.email || "";
		setSaving("account");
		try {
			await meApi.updateProfile({ name });
			updateAccount({ name, email: currentEmail });
			toast.success("Account name updated");
			setEditing(null);
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Could not update your name. Please try again.");
		} finally {
			setSaving(null);
		}
	}

	async function saveAssessment() {
		const validation = validateAssessment(draft);
		if (Object.keys(validation).length > 0) {
			setErrors(validation);
			return;
		}
		const patch: Record<string, string> = {};
		for (const f of ASSESSMENT_FIELDS) patch[f.key] = draft[f.key] ?? "";
		setSaving("assessment");
		try {
			await meApi.updateProfile({
				phone: patch.phone || undefined,
				profile: mapAssessmentDraftToProfile(patch),
			});
			updateAssessment(patch);
			toast.success("Assessment details saved");
			setEditing(null);
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Could not save assessment details.");
		} finally {
			setSaving(null);
		}
	}

	async function savePreferences() {
		const patch: Record<string, string> = {};
		for (const f of PREFERENCE_FIELDS) patch[f.key] = draft[f.key] ?? "";
		setSaving("preferences");
		try {
			await meApi.updateProfile({
				profile: mapPreferencesDraftToProfile(patch),
			});
			updateAssessment(patch);
			toast.success("Preferences saved");
			setEditing(null);
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Could not save preferences.");
		} finally {
			setSaving(null);
		}
	}

	const packageName = (() => {
		if (!a.schoolFundingTrack && !a.schoolDegreeLevel) return a.applicationPackageId || null;
		const funding = a.schoolFundingTrack ? a.schoolFundingTrack.replace("_", " ") : "";
		const level = a.schoolDegreeLevel ? getDegreeLevelName(a.schoolDegreeLevel) : "";
		return [level, funding].filter(Boolean).join(" · ") || a.applicationPackageId || null;
	})();

	const planName = a.paymentPlanId
		? PAYMENT_PLANS.find((p) => p.id === a.paymentPlanId)?.name ?? a.paymentPlanId
		: null;

	const DOSSIER_TABS = [
		{ key: "overview", label: "Overview" },
		{ key: "assessment", label: "Assessment & Background" },
		{ key: "preferences", label: "Study Preferences" },
		{ key: "consultation", label: "Consultation & Target" },
		{ key: "security", label: "Security & Credentials" },
	] as const;

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dossier / Account Record</p>
					<h1 className="page-title mt-1">Applicant Dossier</h1>
					<p className="lead mt-2">
						Comprehensive record holding your identity, assessment qualifications, study aspirations, and verified documents.
					</p>
				</div>
			</header>

			{/* Dossier Cover */}
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
							<div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
								<p className="display profile-hero__name" style={{ margin: 0 }}>{fullName}</p>
								<span className={`profile-eligibility profile-eligibility--${eligibilityVariant}`}>
									{eligibility}
								</span>
							</div>
							<p className="profile-hero__meta">{authUser?.email || a.email || "No email on file"}</p>
							<p className="mono profile-hero__meta mt-1">
								Signed in via {signInMethodLabel(authUser?.method)}
								{authUser?.signedInAt
									? ` · ${new Date(authUser.signedInAt).toLocaleString()}`
									: ""}
							</p>
						</div>
					</div>
					<div className="profile-hero__side">
						<button
							type="button"
							className="profile-edit-btn"
							onClick={() =>
								editing === "account"
									? setEditing(null)
									: startEdit("account", { name: fullName })
							}
							aria-expanded={editing === "account"}
						>
							{editing === "account" ? "Cancel" : "Edit account"}
						</button>
					</div>
				</div>

				{editing === "account" ? (
					<div className="profile-edit mt-4 pt-3" style={{ borderTop: "1px solid var(--border-light)" }}>
						<ProfileEditForm
							fields={ACCOUNT_FIELDS}
							draft={draft}
							errors={errors}
							saving={saving === "account"}
							onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
							onCancel={() => setEditing(null)}
							onSave={saveAccount}
						/>
						<p className="profile-hero__note mt-2">
							To change your email, use the{" "}
							<button
								type="button"
								className="link-arrow"
								onClick={() => {
									setEditing(null);
									setChangeEmailOpen(true);
								}}
							>
								Change email flow
							</button>
							.
						</p>
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
					<div className="profile-ref">
						<p className="profile-ref__label">Target Intake</p>
						<p className="profile-ref__value mono">
							{a.intake || ass.intakePreference || <span className="profile-hero__empty">Not set</span>}
						</p>
					</div>
				</div>
			</section>

			{/* Dossier Tabs */}
			<nav className="dossier-tabs" aria-label="Applicant Dossier Navigation">
				{DOSSIER_TABS.map((t) => (
					<button
						key={t.key}
						type="button"
						className={`dossier-tab-btn ${dossierTab === t.key ? "dossier-tab-btn--active" : ""}`}
						onClick={() => setDossierTab(t.key)}
					>
						{t.label}
					</button>
				))}
			</nav>

			{/* Dossier Panels */}
			<div className="dossier-panel">
				{dossierTab === "overview" && (
					<>
						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Academic Path &amp; Target Application</h2>
								<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
									STATUS: {(a.journeyStage || a.pipelineStatus || "ACTIVE").replace(/_/g, " ").toUpperCase()}
								</span>
							</div>
							<div className="dossier-grid">
								<DossierField label="Target Destination" value={dest?.name || "Pending allocation"} />
								<DossierField label="Target Institution" value={uni?.name || "Pending matching"} />
								<DossierField label="Academic Programme" value={prog?.name || "Under evaluation"} />
								<DossierField label="Target Intake" value={a.intake || ass.intakePreference} />
								<DossierField label="Service Package" value={packageName || "Standard Advisory"} />
								<DossierField label="Payment Plan" value={planName || "Direct / Unassigned"} />
								<DossierField label="Schools Selection" value={a.schoolSelectionDoneAt ? "Confirmed" : "In Progress"} />
							</div>
						</div>

						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Consultation &amp; Advisory Record</h2>
								<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
									REF: {booking.confirmationId || "—"}
								</span>
							</div>
							<div className="dossier-grid">
								<DossierField label="Format" value={consultationTypeLabel(booking.consultationType) || "Scheduled Consultation"} />
								<DossierField label="Scheduled Date" value={booking.date || "Pending schedule"} />
								<DossierField label="Scheduled Time" value={booking.time || "Pending schedule"} />
								<DossierField label="Century Office" value={getBranchName(booking.branchId)} />
								<DossierField label="Location" value={[booking.city, booking.region, booking.country].filter(Boolean).join(", ") || "Virtual / Remote"} />
								<DossierField
									label="Consultation Fee"
									value={
										booking.paymentStatus === "success"
											? `Paid · ${formatDualCurrency(usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents))}`
											: "Unpaid / Pending"
									}
								/>
								<DossierField label="Eligibility Assessment" value={eligibility} />
								<DossierField label="Evaluator Notes" value={booking.eligibilityNote || "Initial profile submitted."} />
							</div>
						</div>

						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Required Documents Status</h2>
								<Link to="/portal/documents" className="profile-edit-btn">
									Open Document Vault →
								</Link>
							</div>
							<p className="mono muted mb-3" style={{ fontSize: "var(--text-xs)" }}>
								{liveDocs ? `${uploadedDocs} of ${totalDocs} required documents uploaded or verified` : "Loading documents..."}
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
											<span className={`portal-pill portal-pill--${status}`}>
												{status}
											</span>
											{live?.id ? (
												<button
													type="button"
													className="profile-doc__action"
													onClick={async () => {
														try {
															const { url } = await documentsApi.downloadUrl(live.id);
															window.open(url, "_blank", "noopener,noreferrer");
														} catch {
															toast.error("Could not open the document. Please try again.");
														}
													}}
												>
													View
												</button>
											) : (
												<Link to="/portal/documents" className="profile-doc__action">
													Upload
												</Link>
											)}
										</li>
									);
								})}
							</ul>
						</div>
					</>
				)}

				{dossierTab === "assessment" && (
					<>
						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Personal &amp; Contact Background</h2>
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
									{editing === "assessment" ? "Cancel" : "Edit Background"}
								</button>
							</div>

							{editing === "assessment" ? (
								<div className="mt-2">
									<ProfileEditForm
										fields={ASSESSMENT_FIELDS}
										draft={draft}
										errors={errors}
										saving={saving === "assessment"}
										onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
										onCancel={() => setEditing(null)}
										onSave={saveAssessment}
									/>
								</div>
							) : (
								<div className="dossier-grid">
									<DossierField
										label="Full Legal Name"
										value={[ass.firstName, ass.middleName, ass.lastName].filter(Boolean).join(" ") || fullName}
									/>
									<DossierField label="Email Address" value={ass.email || authUser?.email || a.email} />
									<DossierField label="Primary Phone" value={ass.phone || a.phone} />
									<DossierField label="Date of Birth" value={ass.dateOfBirth} />
									<DossierField label="Gender" value={ass.gender} />
									<DossierField label="Nationality" value={ass.nationality} />
									<DossierField label="Residential Address" value={ass.address} />
									<DossierField label="Referral Source" value={a.referralSource} />
								</div>
							)}
						</div>

						{editing !== "assessment" && (
							<>
								<div className="dossier-card">
									<div className="dossier-card__head">
										<h2 className="dossier-card__title">Passport &amp; Travel Identification</h2>
									</div>
									<div className="dossier-grid">
										<DossierField label="Passport Number" value={ass.passportNumber} />
										<DossierField label="Issuing Country" value={ass.passportCountry} />
										<DossierField label="Issue Date" value={ass.passportIssue} />
										<DossierField label="Expiry Date" value={ass.passportExpiry} />
									</div>
								</div>

								<div className="dossier-card">
									<div className="dossier-card__head">
										<h2 className="dossier-card__title">Academic Qualifications</h2>
									</div>
									<div className="dossier-grid">
										<DossierField label="Highest Education" value={ass.highestEducation} />
										<DossierField label="Institution Attended" value={ass.institution} />
										<DossierField label="Field of Study" value={ass.fieldOfStudy} />
										<DossierField label="Graduation Year" value={ass.graduationYear} />
										<DossierField label="Grade Point Average (GPA)" value={ass.gpa} />
									</div>
								</div>

								<div className="dossier-card">
									<div className="dossier-card__head">
										<h2 className="dossier-card__title">Professional Background</h2>
									</div>
									<div className="dossier-grid">
										<DossierField label="Employment Status" value={ass.employmentStatus} />
										<DossierField label="Employer / Organization" value={ass.employer} />
										<DossierField label="Position / Title" value={ass.jobTitle} />
										<DossierField label="Years of Experience" value={ass.yearsExperience} />
									</div>
								</div>

								<div className="dossier-card">
									<div className="dossier-card__head">
										<h2 className="dossier-card__title">Language Proficiency</h2>
									</div>
									<div className="dossier-grid">
										<DossierField label="English Examination" value={ass.englishTest} />
										<DossierField label="Score / Band" value={ass.englishScore} />
										<DossierField label="Examination Date" value={ass.englishDate} />
									</div>
								</div>
							</>
						)}
					</>
				)}

				{dossierTab === "preferences" && (
					<>
						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Study Aspirations &amp; Goals</h2>
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
									{editing === "preferences" ? "Cancel" : "Edit Preferences"}
								</button>
							</div>

							{editing === "preferences" ? (
								<div className="mt-2">
									<ProfileEditForm
										fields={PREFERENCE_FIELDS}
										draft={draft}
										errors={errors}
										saving={saving === "preferences"}
										onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
										onCancel={() => setEditing(null)}
										onSave={savePreferences}
									/>
								</div>
							) : (
								<div className="dossier-grid">
									<DossierField label="Preferred Countries" value={ass.preferredCountries} />
									<DossierField label="Target Degree Level" value={getDegreeLevelName(ass.preferredLevel)} />
									<DossierField label="Preferred Major / Field" value={ass.preferredField} />
								</div>
							)}
						</div>

						{editing !== "preferences" && (
							<div className="dossier-card">
								<div className="dossier-card__head">
									<h2 className="dossier-card__title">Funding &amp; Financial Planning</h2>
								</div>
								<div className="dossier-grid">
									<DossierField label="Target Intake" value={ass.intakePreference} />
									<DossierField label="Funding Source" value={ass.fundingSource} />
									<DossierField label="Budget Range" value={ass.budgetRange} />
									<DossierField label="Sponsor Name" value={ass.sponsorName} />
									<DossierField label="Sponsor Relationship" value={ass.sponsorRelationship} />
								</div>
							</div>
						)}
					</>
				)}

				{dossierTab === "consultation" && (
					<>
						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Consultation Session</h2>
								<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
									{booking.confirmationId ? `Ref: ${booking.confirmationId}` : "Unbooked"}
								</span>
							</div>
							<div className="dossier-grid">
								<DossierField label="Consultation Type" value={consultationTypeLabel(booking.consultationType)} />
								<DossierField label="Location" value={[booking.city, booking.region, booking.country].filter(Boolean).join(", ")} />
								<DossierField label="Branch Office" value={getBranchName(booking.branchId)} />
								<DossierField label="Date" value={booking.date} />
								<DossierField label="Time" value={booking.time} />
								<DossierField
									label="Consultation Fee"
									value={
										booking.paymentStatus === "success"
											? `Paid · ${formatDualCurrency(usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents))}`
											: "Unpaid"
									}
								/>
								<DossierField label="Eligibility Outcome" value={eligibility} />
								<DossierField label="Eligibility Note" value={booking.eligibilityNote} />
							</div>
						</div>

						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Application Record</h2>
							</div>
							<div className="dossier-grid">
								<DossierField label="Destination" value={dest?.name} />
								<DossierField label="Target University" value={uni?.name} />
								<DossierField label="Programme" value={prog?.name} />
								<DossierField label="Intake" value={a.intake} />
								<DossierField label="Package Track" value={packageName} />
								<DossierField label="Payment Plan" value={planName} />
								<DossierField label="Schools Selection Status" value={a.schoolSelectionDoneAt ? "Confirmed" : "Not yet finalized"} />
							</div>
						</div>

						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Interview &amp; Verification Audit</h2>
							</div>
							<div className="dossier-grid">
								<DossierField
									label="Interview Confirmation"
									value={
										interview.confirmationCode
											? `${interview.confirmationCode} (${interview.mode || "video"})`
											: "Not scheduled"
									}
								/>
								<DossierField label="Document Review Status" value={a.docReviewStatus} />
								<DossierField label="Application Status" value={(a.journeyStage || a.pipelineStatus || "IN PROGRESS").replace(/_/g, " ").toUpperCase()} />
							</div>
						</div>
					</>
				)}

				{dossierTab === "security" && (
					<>
						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Sign-in Identity &amp; Provider</h2>
							</div>
							<div className="dossier-grid">
								<DossierField label="Sign-in Method" value={signInMethodLabel(authUser?.method)} />
								<DossierField label="Primary Account Email" value={authUser?.email || a.email || "No email on file"} />
								<DossierField
									label="Session Authenticated"
									value={authUser?.signedInAt ? new Date(authUser.signedInAt).toLocaleString() : "Active session"}
								/>
								<DossierField
									label="Password Management"
									value={
										authUser?.method === "email" ? (
											<span>
												Password set ·{" "}
												<button
													type="button"
													className="link-arrow"
													onClick={() => setChangePasswordOpen(true)}
												>
													Change password
												</button>
											</span>
										) : (
											<span className="muted">
												{authUser?.method === "google"
													? "Managed by your Google account — password not required"
													: "Managed by your sign-in provider — password not required"}
											</span>
										)
									}
								/>
							</div>
						</div>

						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Two-Factor Authentication (2FA)</h2>
								{mfaStatus?.applicable !== false && (
									<Link
										to="/portal/security"
										className="profile-edit-btn"
										aria-label="Manage two-factor authentication"
									>
										{mfaStatus?.enrolled ? "Manage 2FA" : "Set up 2FA"}
									</Link>
								)}
							</div>
							<div className="dossier-grid">
								<DossierField
									label="2FA Status"
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
										) : mfaStatus.applicable === false ? (
											<span className="muted">Not applicable</span>
										) : (
											<span className="muted">Not set — recommended</span>
										)
									}
								/>
								{mfaStatus?.applicable !== false && (
									<DossierField
										label="Policy Requirement"
										value={mfaStatus?.required ? "Required for your account" : "Optional (recommended)"}
									/>
								)}
							</div>
							<p className="muted mt-3" style={{ fontSize: "var(--text-sm)", maxWidth: "42rem" }}>
								{authUser?.method === "email"
									? "Add a second step at sign-in to keep your application documents and payment history safe. If you use a password, keep it strong and change it if you ever suspect it has been compromised."
									: "You sign in using a single sign-on provider. Your account password and security settings are managed directly by that provider."}
							</p>
						</div>
					</>
				)}
			</div>

			<AvatarCropModal
				open={avatarOpen}
				onClose={() => setAvatarOpen(false)}
				onSaved={() => {
					setAvatarImage("set");
				}}
			/>
			<ChangePasswordModal
				open={changePasswordOpen}
				currentEmail={authUser?.email || a.email || ""}
				onClose={() => setChangePasswordOpen(false)}
			/>
			<ChangeEmailModal
				open={changeEmailOpen}
				currentEmail={authUser?.email || a.email || ""}
				onSaved={(newEmail) => {
					updateAccount({ name: authUser?.name || fullName, email: newEmail });
				}}
				onClose={() => setChangeEmailOpen(false)}
			/>
		</div>
	);
}

type FieldType = "text" | "email" | "tel" | "date" | "textarea" | "select";

type FieldDef = {
	key: string;
	label: string;
	type?: FieldType;
	options?: string[];
	placeholder?: string;
};

const ACCOUNT_FIELDS: FieldDef[] = [{ key: "name", label: "Full name", type: "text" }];

const ASSESSMENT_FIELDS: FieldDef[] = [
	{ key: "phone", label: "Phone", type: "tel" },
	{ key: "dateOfBirth", label: "Date of birth", type: "date" },
	{ key: "gender", label: "Gender", type: "select", options: GENDER_OPTIONS },
	{ key: "nationality", label: "Nationality", type: "select", options: APPLICANT_COUNTRIES },
	{ key: "address", label: "Address", type: "textarea" },
	{ key: "passportNumber", label: "Passport number", type: "text" },
	{ key: "passportCountry", label: "Passport country", type: "select", options: APPLICANT_COUNTRIES },
	{ key: "passportIssue", label: "Passport issue date", type: "date" },
	{ key: "passportExpiry", label: "Passport expiry date", type: "date" },
	{ key: "highestEducation", label: "Highest education", type: "select", options: HIGHEST_EDUCATION_OPTIONS },
	{ key: "institution", label: "Institution", type: "text" },
	{ key: "fieldOfStudy", label: "Field of study", type: "text" },
	{ key: "graduationYear", label: "Graduation year", type: "text" },
	{ key: "gpa", label: "GPA", type: "text" },
	{ key: "employmentStatus", label: "Employment status", type: "select", options: EMPLOYMENT_STATUS_OPTIONS },
	{ key: "employer", label: "Employer / company", type: "text" },
	{ key: "jobTitle", label: "Job title / role", type: "text" },
	{ key: "yearsExperience", label: "Years of experience", type: "text" },
	{ key: "englishTest", label: "English test", type: "select", options: ENGLISH_TEST_OPTIONS },
	{ key: "englishScore", label: "English score", type: "text" },
	{ key: "englishDate", label: "English test date", type: "date" },
];

const PREFERENCE_FIELDS: FieldDef[] = [
	{ key: "preferredCountries", label: "Preferred countries", placeholder: "e.g. UK, Canada" },
	{ key: "preferredLevel", label: "Preferred level", type: "select", options: SCHOOL_DEGREE_LEVELS.map((l) => l.id) },
	{ key: "preferredField", label: "Preferred field / major" },
	{ key: "intakePreference", label: "Intake", type: "select", options: INTAKE_OPTIONS },
	{ key: "fundingSource", label: "Funding source", type: "select", options: FUNDING_SOURCE_OPTIONS },
	{ key: "budgetRange", label: "Budget range", type: "select", options: BUDGET_RANGE_OPTIONS },
	{ key: "sponsorName", label: "Sponsor name" },
	{ key: "sponsorRelationship", label: "Sponsor relationship", type: "select", options: SPONSOR_RELATIONSHIP_OPTIONS },
];

function ProfileEditForm({
	fields,
	draft,
	errors,
	saving,
	onChange,
	onCancel,
	onSave,
}: {
	fields: FieldDef[];
	draft: Record<string, string>;
	errors: Record<string, string>;
	saving?: boolean;
	onChange: (key: string, value: string) => void;
	onCancel: () => void;
	onSave: () => void;
}) {
	return (
		<div className="profile-edit__form">
			<div className="profile-edit__fields">
				{fields.map((f) => {
					const id = `edit-${f.key}`;
					const error = errors[f.key];
					const value = draft[f.key] ?? "";
					return (
						<Field key={f.key} label={f.label} htmlFor={id} error={error}>
							{f.type === "textarea" ? (
								<Textarea
									id={id}
									value={value}
									onChange={(e) => onChange(f.key, e.target.value)}
									rows={3}
									aria-invalid={Boolean(error)}
									aria-describedby={error ? `${id}-error` : undefined}
								/>
							) : f.type === "select" ? (
								<Select
									id={id}
									value={value}
									onChange={(e) => onChange(f.key, e.target.value)}
									fullBorder
									aria-invalid={Boolean(error)}
									aria-describedby={error ? `${id}-error` : undefined}
								>
									<option value="">{f.placeholder ?? `Select ${f.label.toLowerCase()}`}</option>
									{f.options!.map((opt) => (
										<option key={opt} value={opt}>
											{f.key === "preferredLevel" ? getDegreeLevelName(opt) : opt}
										</option>
									))}
								</Select>
							) : (
								<Input
									id={id}
									type={f.type ?? "text"}
									value={value}
									placeholder={f.placeholder}
									onChange={(e) => onChange(f.key, e.target.value)}
									fullBorder
									aria-invalid={Boolean(error)}
									aria-describedby={error ? `${id}-error` : undefined}
								/>
							)}
						</Field>
					);
				})}
			</div>
			<div className="profile-edit__actions">
				<Button size="sm" onClick={onSave} disabled={saving}>
					{saving ? "Saving…" : "Save changes"}
				</Button>
				<Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
					Cancel
				</Button>
			</div>
		</div>
	);
}

/* ========== Journey hub ========== */

/** Journey - every stage with its status; the stage pages open below it. */
export function PortalJourney() {
	const { journeyPhase, application, schoolApplications, stageStatuses } = useAppState();
	const current = journeyPhase.stage;
	const stageMeta = PROCESS_STAGES.find((s) => s.id === current);

	// Document vault status — fetched live so the journey reflects the same
	// server-backed verification state the vault page shows.
	const [liveDocs, setLiveDocs] = useState<Map<string, ApplicantDocument> | null>(null);
	useEffect(() => {
		let active = true;
		void (async () => {
			try {
				const res = await documentsApi.list();
				if (active) setLiveDocs(new Map(res.documents.map((d) => [d.documentType, d])));
			} catch {
				if (active) setLiveDocs(null);
			}
		})();
		return () => {
			active = false;
		};
	}, []);

	const totalDocs = REQUIRED_DOCUMENTS.length;
	const uploadedDocs = liveDocs ? REQUIRED_DOCUMENTS.filter((r) => liveDocs.has(r.id)).length : 0;
	const verifiedDocs = liveDocs
		? REQUIRED_DOCUMENTS.filter((r) => liveDocs.get(r.id)?.status === "VERIFIED").length
		: 0;
	const rejectedDocs = liveDocs
		? REQUIRED_DOCUMENTS.filter((r) => liveDocs.get(r.id)?.status === "REJECTED").length
		: 0;
	const docsLoaded = liveDocs !== null;
	const allDocsVerified = docsLoaded && verifiedDocs === totalDocs;

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
								// Drive Done from real signals via stageStatuses
								// (/me/journey), not index comparison — a stage
								// advanced past without its signal met shows
								// 'skipped', not 'done'.
								const ss = stageStatuses?.[s.id];
								const st =
									ss === "done"
										? "done"
										: ss === "current" || s.id === current
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
							<div className="journey-track__cell">
								<p className="journey-track__label">Document vault</p>
								<p className="journey-track__value">
									{docsLoaded ? `${uploadedDocs}/${totalDocs}` : "—"}
								</p>
								<p className="muted mt-1">
									{!docsLoaded
										? "Loading…"
										: allDocsVerified
											? "All verified ✓"
											: `${verifiedDocs} verified${rejectedDocs > 0 ? ` · ${rejectedDocs} to resubmit` : ""}`}
								</p>
								<div className="row mt-3">
									<Link to="/portal/documents" className="link-arrow">
										{allDocsVerified ? "View vault →" : uploadedDocs < totalDocs ? "Upload documents →" : "Check status →"}
									</Link>
								</div>
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
	const { application, booking, schoolApplications, choosePaymentPlan, choosePostArrivalSchedule, payAgencyInstallment, enabledPostArrivalSchedules, customPostArrivalSchedules, fees } = useAppState();
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
				const { invoices: list } = await meApi.invoices();
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
		(consultationPaid ? usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents) : 0) +
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
	const appNotRaised = a.applicationInvoice.status === "none" ? usdFromCents((fees || FALLBACK_FEE_SCHEDULE).appBaseCents) : 0;
	const visaNotRaised = a.visaInvoice.status === "none" ? usdFromCents((fees || FALLBACK_FEE_SCHEDULE).visaBaseCents) : 0;
	const notYetRaised = (consultationPaid ? 0 : usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents)) + appNotRaised + visaNotRaised;

	// Every recorded payment across all invoices, newest first — shown as the
	// "Payment receipts" section so the applicant can see what they've paid.
	const receipts = invoicesLoaded
		? invoices
				.flatMap((inv) =>
					(inv.payments ?? []).map((p) => ({
						id: p.id,
						invoiceNumber: inv.invoiceNumber,
						amountCents: p.amountCents,
						method: p.method,
						reference: p.reference,
						recordedByName: p.recordedByName,
						at: p.at,
					})),
				)
				.sort((a, b) => (a.at < b.at ? 1 : -1))
		: [];

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
						amount={<Money usd={usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents)} negative={consultationPaid} />}
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
					{(() => {
						const travelInvoice = invoicesLoaded ? invoices.find((i) => i.type === "travel") : null;
						if (!travelInvoice) return null;
						const travelStatus = travelInvoice.status === "paid" ? "paid" : travelInvoice.status === "partial" ? "raised" : "raised";
						const travelAmount = travelInvoice.subtotalCents;
						return (
							<LedgerRow
								title="Travel invoice · flights &amp; transfers"
								status={travelStatus}
								amount={<Money usd={travelAmount / 100} negative={travelStatus === "paid"} />}
								detail={travelInvoice.status === "paid" ? "Paid" : travelInvoice.status === "partial" ? "Partially paid — balance outstanding" : "Awaiting payment"}
							/>
						);
					})()}
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
					<MoneyInline usd={usdFromCents((fees || FALLBACK_FEE_SCHEDULE).appPerSchoolCents)} /> for each school you add. Cedi amounts
					convert at GH₵{GHS_RATE} to $1. University tuition is never billed here — it is paid
					directly to the institution.
				</p>
			</section>

			{/* Payment receipts — every recorded payment across all invoices */}
			{receipts.length > 0 ? (
				<section className="mt-6">
					<p className="eyebrow mb-3">Payment receipts</p>
					<div className="ledger">
						{receipts.map((r) => (
							<div key={r.id} className="ledger-item">
								<div className="ledger-item__head">
									<span className="ledger-item__title">
										{r.invoiceNumber} · {r.method}
									</span>
									<span className="ledger-item__amount mono">
										<Money usd={r.amountCents / 100} negative />
									</span>
								</div>
								<div className="ledger-item__sub">
									<span className="ledger-status ledger-status--paid">Paid</span>
									<span className="ledger-item__detail muted">
										{new Date(r.at).toLocaleDateString(undefined, {
											year: "numeric",
											month: "short",
											day: "numeric",
										})}
										{r.reference ? ` · Ref ${r.reference}` : ""}
										{r.recordedByName ? ` · by ${r.recordedByName}` : ""}
									</span>
								</div>
							</div>
						))}
					</div>
				</section>
			) : null}
		</div>
	);
}
