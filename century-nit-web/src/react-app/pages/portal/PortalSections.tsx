import { Link, useNavigate } from "react-router-dom";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select, Textarea } from "../../components/ui/Field";
import {
	hasPaymentPlan,
	hasSettledPlan,
	isAppInvoicePaid,
	isAgencySettled,
	isAgencyDepositPaid,
	isVisaInvoicePaid,
	milestoneLockReasonFor,
	milestoneUnlockedFor,
	useAppState,
	type AssessmentData,
} from "../../context/AppState";
import { FALLBACK_FEE_SCHEDULE } from "../../context/AppState";
import {
	usdFromCents,
	titleCase,
	CHAPTERS,
	PORTAL_STEP,
	PORTAL_STEP_CHAPTER,
	PORTAL_STAGE_ORDER,
	INVOICE_TYPE_LABELS,
	PAYMENT_PLAN_LABELS,
	type ChapterId,
	type PortalStepId,
	type JourneyChapterUnlocks,
} from "century-nit-shared";
import {
	AGENCY_STAGES,
	AGENCY_DEPOSIT_PORTION,
	APPLICANT_COUNTRIES,
	POST_ARRIVAL_SCHEDULES,
	getDestination,
	getProgram,
	getUniversity,
	GHS_RATE,
	PAYMENT_PLANS,
	SCHOOL_DEGREE_LEVELS,
	REQUIRED_DOCUMENTS,
	getBranchName,
} from "century-nit-core";
import { openInNewTab } from "century-nit-core";
import { documentsApi, meApi, ApiError, visaCostsCentsFor } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import { Avatar } from "../../components/ui/Avatar";
import { AvatarCropModal } from "../../components/portal/AvatarCropModal";
import { usePaySheet } from "../../components/portal/PaySheet";
import { ChangePasswordModal, ChangeEmailModal } from "../../components/portal/SecurityModals";
import type { ApplicantDocument, ApiInvoice } from "century-nit-shared";
import { Money, MoneyInline } from "../../components/ui/Money";
import { getMfaEnrollment, type MfaEnrollmentStatus } from "../../lib/api";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "century-nit-shared";
import { prepareDocumentForUpload } from "../../lib/upload";
import { downloadReceipt, openInvoiceDocument } from "../../lib/receipt";
import { useConsultationInvoice } from "../../hooks/useConsultationInvoice";
import { useMediaQuery } from "../../hooks/useMediaQuery";

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
		setAvatarImage,
		schoolApplications,
	} = useAppState();
	const a = application;
	const ass = booking.assessment;

	/**
	 * Documents are server-backed (R2 via presigned URLs). The profile shows a
	 * read-only summary, so a light fetch-on-mount is enough. The vault screen
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
				/* leave null. The summary shows "-" until it can load */
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
				/* leave null. Section shows "-" until it can load */
			});
		return () => {
			active = false;
		};
	}, []);

	const [editing, setEditing] = useState<null | "account" | "assessment" | "preferences">(null);
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

	const hasSchools = schoolApplications && schoolApplications.length > 0;
	
	const targetInstitution = hasSchools 
		? schoolApplications.map(s => getUniversity(s.universityId)?.name).join(", ")
		: (uni?.name || "Pending matching");
		
	const targetProgram = hasSchools
		? schoolApplications.map(s => getProgram(s.programId)?.name).join(", ")
		: (prog?.name || "Under evaluation");

	const targetDestination = hasSchools
		? Array.from(new Set(schoolApplications.map(s => getDestination(s.destinationId)?.name))).join(", ")
		: (dest?.name || "Pending allocation");

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

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Profile</p>
					<h1 className="page-title mt-1">Your file</h1>
					<p className="lead mt-2">
						What Century NIT holds on you. Identity, qualifications, aspirations, documents.
						Edit in place; your consultant sees the same record.
					</p>
				</div>
			</header>

			{/* The cover. Who this file is, references at a glance */}
			<section className="pcover mt-4">
				<div className="profile-avatar" style={{ position: "relative" }}>
					<Avatar name={fullName} image={authUser?.image} className="profile-monogram" />
					<button
						type="button"
						className="profile-avatar__overlay-btn"
						onClick={() => setAvatarOpen(true)}
						title="Change photo"
					>
						<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
							<path d="M4 4h3l2-2h6l2 2h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm8 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm0 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6z"/>
						</svg>
					</button>
				</div>
				<div>
					<p className="eyebrow">Applicant · {eligibility}</p>
					<p className="pcover__name">{fullName}</p>
					<p className="pcover__meta">
						{authUser?.email || a.email || "No email on file"} · signed in via {signInMethodLabel(authUser?.method)}
						{authUser?.signedInAt ? ` · since ${new Date(authUser.signedInAt).toLocaleString()}` : ""}
					</p>
					<button
						type="button"
						className="jlink mt-2"
						style={{ color: "rgba(255,255,255,0.85)" }}
						onClick={() =>
							editing === "account"
								? setEditing(null)
								: startEdit("account", { name: fullName })
						}
						aria-expanded={editing === "account"}
					>
						{editing === "account" ? "Cancel edit" : "Edit account →"}
					</button>
				</div>
				<div className="pcover__refs">
					<div><p className="pcover__k">Application</p><p className="pcover__v">{a.appNumber ?? "Not issued"}</p></div>
					<div><p className="pcover__k">Consultation</p><p className="pcover__v">{booking.confirmationId ?? "Not booked"}</p></div>
					<div><p className="pcover__k">Documents</p><p className="pcover__v">{liveDocs ? `${uploadedDocs}/${totalDocs}` : "N/A"}</p></div>
					<div><p className="pcover__k">Intake</p><p className="pcover__v">{titleCase(a.intake || ass.intakePreference) || "N/A"}</p></div>
				</div>
			</section>

			{editing === "account" ? (
				<div className="sharp-card mt-3">
					<ProfileEditForm
						fields={ACCOUNT_FIELDS}
						draft={draft}
						errors={errors}
						saving={saving === "account"}
						onChange={(key, value) => setDraft((prev) => ({ ...prev, [key]: value }))}
						onCancel={() => setEditing(null)}
						onSave={saveAccount}
					/>
					<p className="muted mt-2" style={{ fontSize: "var(--text-xs)" }}>
						To change your email, use the{" "}
						<button
							type="button"
							className="jlink"
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

			<div className="psplit psplit--profile mt-4">
				{/* The index. Jump, don't scroll */}
				<nav className="pindex" aria-label="File sections">
					<a href="#p-identity"><span>Identity</span><span className="pindex__n">01</span></a>
					<a href="#p-passport"><span>Passport</span><span className="pindex__n">02</span></a>
					<a href="#p-academics"><span>Academics &amp; work</span><span className="pindex__n">03</span></a>
					<a href="#p-aspirations"><span>Aspirations</span><span className="pindex__n">04</span></a>
					<a href="#p-record"><span>On record</span><span className="pindex__n">05</span></a>
					<a href="#p-documents"><span>Documents</span><span className="pindex__n">06</span></a>
					<a href="#p-security"><span>Security</span><span className="pindex__n">07</span></a>
				</nav>

				<div>
					{editing === "assessment" ? (
						<div className="dossier-card" id="p-identity">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Editing your background</h2>
								<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>IDENTITY · PASSPORT · ACADEMICS</span>
							</div>
							<div className="mt-2" style={{ padding: "0 1.25rem 1.25rem" }}>
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
						</div>
					) : (
						<>
							{/* 01. Identity & contact */}
							<div className="dossier-card" id="p-identity">
								<div className="dossier-card__head">
									<h2 className="dossier-card__title">Identity &amp; contact</h2>
									<button
										type="button"
										className="profile-edit-btn"
										onClick={() =>
											startEdit(
												"assessment",
												Object.fromEntries(
													ASSESSMENT_FIELDS.map((f) => [
														f.key,
														(f.key === "phone" ? ass.phone || a.phone : scalar(ass, f.key)) ?? "",
													]),
												),
											)
										}
									>
										Edit →
									</button>
								</div>
								<div className="dossier-grid">
									<DossierField label="Full Legal Name" value={[ass.firstName, ass.middleName, ass.lastName].filter(Boolean).join(" ") || fullName} />
									<DossierField label="Email Address" value={ass.email || authUser?.email || a.email} />
									<DossierField label="Primary Phone" value={ass.phone || a.phone} />
									<DossierField label="Date of Birth" value={ass.dateOfBirth} />
									<DossierField label="Gender" value={ass.gender} />
									<DossierField label="Nationality" value={ass.nationality} />
									<DossierField label="Residential Address" value={ass.address} />
									<DossierField label="Referral Source" value={a.referralSource} />
								</div>
							</div>

							{/* 02. Passport */}
							<div className="dossier-card" id="p-passport">
								<div className="dossier-card__head">
									<h2 className="dossier-card__title">Passport &amp; travel ID</h2>
									<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>EDIT UNDER IDENTITY</span>
								</div>
								<div className="dossier-grid">
									<DossierField label="Passport Number" value={ass.passportNumber} />
									<DossierField label="Issuing Country" value={ass.passportCountry} />
									<DossierField label="Issue Date" value={ass.passportIssue} />
									<DossierField label="Expiry Date" value={ass.passportExpiry} />
								</div>
							</div>

							{/* 03. Academics & work */}
							<div className="dossier-card" id="p-academics">
								<div className="dossier-card__head">
									<h2 className="dossier-card__title">Academics &amp; work</h2>
									<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>EDIT UNDER IDENTITY</span>
								</div>
								<div className="dossier-grid">
									<DossierField label="Highest Education" value={ass.highestEducation} />
									<DossierField label="Institution Attended" value={ass.institution} />
									<DossierField label="Field of Study" value={ass.fieldOfStudy} />
									<DossierField label="Graduation Year" value={ass.graduationYear} />
									<DossierField label="Grade Point Average (GPA)" value={ass.gpa} />
									<DossierField label="Employment Status" value={ass.employmentStatus} />
									<DossierField label="Employer / Organization" value={ass.employer} />
									<DossierField label="Position / Title" value={ass.jobTitle} />
									<DossierField label="Years of Experience" value={ass.yearsExperience} />
									<DossierField label="English Examination" value={ass.englishTest} />
									<DossierField label="Score / Band" value={ass.englishScore} />
									<DossierField label="Examination Date" value={ass.englishDate} />
								</div>
							</div>
						</>
					)}

					{/* 04. Aspirations & funding */}
					<div className="dossier-card" id="p-aspirations">
						<div className="dossier-card__head">
							<h2 className="dossier-card__title">Aspirations &amp; funding</h2>
							<button
								type="button"
								className="profile-edit-btn"
								onClick={() =>
									editing === "preferences"
										? setEditing(null)
										: startEdit(
												"preferences",
												Object.fromEntries(
													PREFERENCE_FIELDS.map((f) => [f.key, scalar(ass, f.key) ?? ""]),
												),
											)
								}
								aria-expanded={editing === "preferences"}
							>
								{editing === "preferences" ? "Cancel" : "Edit →"}
							</button>
						</div>

						{editing === "preferences" ? (
							<div className="mt-2" style={{ padding: "0 1.25rem 1.25rem" }}>
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
							<>
								<div className="dossier-grid">
									<DossierField label="Target Degree Level" value={getDegreeLevelName(ass.preferredLevel)} />
									<DossierField label="Preferred Countries" value={ass.preferredCountries} />
									<DossierField label="Preferred Major / Field" value={ass.preferredField} />
									<DossierField label="Target Intake" value={ass.intakePreference} />
									<DossierField label="Funding Source" value={ass.fundingSource} />
									<DossierField label="Budget Range" value={ass.budgetRange} />
									<DossierField label="Sponsor Name" value={ass.sponsorName} />
									<DossierField label="Sponsor Relationship" value={ass.sponsorRelationship} />
								</div>
								{ass.studyChoices.some((c) => c.country || c.university || c.program) ? (
									<ol className="choice-list mt-3" style={{ padding: "0 1.25rem 1rem" }}>
										{ass.studyChoices
											.filter((c) => c.country || c.university || c.program)
											.map((c, i) => (
												<li key={i}>
													<span className="mono">{i + 1}.</span>{" "}
													{[c.country, c.university, c.program || c.field, c.intake && titleCase(c.intake)].filter(Boolean).join(" · ")}
												</li>
											))}
									</ol>
								) : null}
							</>
						)}
					</div>

					{/* 05. On record: the merged read-only card (was four repeating cards) */}
					<div className="dossier-card" id="p-record">
						<div className="dossier-card__head">
							<h2 className="dossier-card__title">On record</h2>
							<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>SET BY YOUR FILE. READ ONLY</span>
						</div>
						<div className="dossier-grid">
							<DossierField label="Service Package" value={packageName || "Standard Advisory"} />
							<DossierField label="Payment Plan" value={planName || "Direct / unassigned"} />
							<DossierField label="Schools Selection" value={a.schoolSelectionDoneAt ? "Confirmed" : "In progress"} />
							<DossierField label="Target Institution" value={targetInstitution} />
							<DossierField label="Academic Programme" value={targetProgram} />
							<DossierField label="Target Destination" value={targetDestination} />
							<DossierField
								label="Consultation"
								value={
									booking.paymentStatus === "success"
										? `${consultationTypeLabel(booking.consultationType) || "Session"} · paid · ${[booking.date, getBranchName(booking.branchId)].filter(Boolean).join(" · ") || "held"}`
										: "Unpaid / pending"
								}
							/>
							<DossierField label="Eligibility" value={eligibility} />
							<DossierField label="Evaluator Notes" value={booking.eligibilityNote} />
							<DossierField label="Interview" value={interview.confirmationCode ? `${interview.confirmationCode} (${interview.mode || "video"})` : "Not scheduled"} />
							<DossierField label="Document Review" value={a.docReviewStatus} />
							<DossierField label="Application Status" value={(a.journeyStage || a.pipelineStatus || "IN PROGRESS").replace(/_/g, " ").toUpperCase()} />
						</div>
					</div>

					{/* 06. Documents */}
					<div className="dossier-card" id="p-documents">
						<div className="dossier-card__head">
							<h2 className="dossier-card__title">Documents</h2>
							<Link to="/portal/documents" className="profile-edit-btn">
								Open Document Vault →
							</Link>
						</div>
						<p className="mono muted mb-3" style={{ fontSize: "var(--text-xs)", padding: "0 1.25rem" }}>
							{liveDocs ? `${uploadedDocs} of ${totalDocs} required documents uploaded or verified` : "Loading documents..."}
						</p>
						<ul className="profile-docs" style={{ padding: "0 1.25rem 1.25rem" }}>
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
														await openInNewTab(documentsApi.downloadUrl(live.id));
													} catch {
														toast.error("Could not open the document. Please try again.");
													}
												}}
											>
												View
											</button>
										) : (
											<label className="profile-doc__action" style={{ cursor: "pointer", display: "inline-block" }}>
												Upload
												<input
													type="file"
													hidden
													accept={ALLOWED_DOCUMENT_TYPES.join(",")}
													onChange={async (e) => {
														const file = e.target.files?.[0];
														if (!file) return;
														if (file.size > MAX_DOCUMENT_BYTES) {
															toast.error(`${file.name} is larger than 15 MB.`);
															return;
														}
														try {
															toast.info(`Uploading ${file.name}...`);
															const ready = await prepareDocumentForUpload(file, () => {});
															const saved = await documentsApi.upload(ready, r.id, { onProgress: () => {} });
															setLiveDocs(prev => new Map(prev ?? []).set(saved.documentType, saved));
															toast.success(`${file.name} uploaded successfully.`);
														} catch {
															toast.error("Could not upload. Please try again.");
														}
														e.target.value = "";
													}}
												/>
											</label>
										)}
									</li>
								);
							})}
						</ul>
					</div>

					{/* 07. Security */}
					<div className="dossier-card" id="p-security">
						<div className="dossier-card__head">
							<h2 className="dossier-card__title">Security</h2>
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
												className="jlink"
												onClick={() => setChangePasswordOpen(true)}
											>
												Change password
											</button>
										</span>
									) : (
										<span className="muted">
											{authUser?.method === "google"
												? "Managed by your Google account. Password not required"
												: "Managed by your sign-in provider. Password not required"}
										</span>
									)
								}
							/>
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
										<span className="muted">Unavailable. Email codes are switched off</span>
									) : (
										<span className="muted">Not set. Recommended</span>
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
						<p className="muted mt-3" style={{ fontSize: "var(--text-sm)", maxWidth: "42rem", padding: "0 1.25rem 1.25rem" }}>
							{authUser?.method === "email"
								? "Add a second step at sign-in to keep your application documents and payment history safe. If you use a password, keep it strong and change it if you ever suspect it has been compromised."
								: "You sign in with a provider. Protect this account with an email code at each sign-in. Setting a password also unlocks the authenticator-app option."}
						</p>
					</div>

					{/* Danger zone */}
					<div className="dossier-card">
						<div className="dossier-card__head">
							<h2 className="dossier-card__title">Danger zone</h2>
						</div>
						<div className="dossier-grid">
							<div style={{ gridColumn: "1 / -1" }}>
								<p className="muted" style={{ marginBottom: "1rem" }}>
									Permanently delete your Century NIT student portal account. If you have paid invoices or ongoing applications, your data may be retained for compliance, otherwise it will be purged immediately. This action cannot be undone.
								</p>
								<button
									type="button"
									className="btn btn--danger btn--sm"
									onClick={() => {
										if (window.confirm("Are you absolutely sure you want to delete your account? This action cannot be undone.")) {
											meApi.deleteAccount("archive")
												.then((res) => {
													alert(res.action === "archive"
														? "Your account has been deleted and archived for compliance."
														: "Your account has been permanently deleted.");
													window.location.href = "/";
												})
												.catch(err => {
													toast.error(err instanceof Error ? err.message : "Failed to delete account");
												});
										}
									}}
								>
									Delete Account
								</button>
							</div>
						</div>
					</div>
				</div>
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

/** The generic edit form holds strings; the assessment's one list field never appears in it. */
function scalar(ass: AssessmentData, key: string): string | undefined {
	const v = ass[key as keyof AssessmentData];
	return typeof v === "string" ? v : undefined;
}

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

/** Which unlock flag gates each chapter's page. */
const JMAP_UNLOCK: Record<ChapterId, keyof JourneyChapterUnlocks> = {
	consult: "consultation",
	enrol: "package",
	apply: "application",
	visa: "visa",
	depart: "payment_execution",
	done: "complete",
};

/** What opens a locked chapter. The hint under its blurb. */
const JMAP_HINT: Record<ChapterId, string> = {
	consult: "Book your consultation to begin.",
	enrol: "Opens once your assessment says you can proceed.",
	apply: "Opens once your enrolment is confirmed and the deposit is paid.",
	visa: "Opens when a school admits you. The visa fee is paid here, then your file goes to the visa officer.",
	depart: "Your flight is booked first. The pre-departure milestone follows it and releases your documents.",
	done: "The last chapter. Reached when the flight is booked and the checklist is done.",
};

/**
 * Journey. Six chapters with the fine steps nested inside the live one.
 * Done chapters collapse to one mono line of facts; locked chapters explain
 * what opens them. Everything is derived from `stageStatuses` /
 * `chapterUnlocks` (`/me/journey`). The page never guesses.
 */
export function PortalJourney() {
	const { journeyPhase, application, schoolApplications, stageStatuses, chapterUnlocks, booking } = useAppState();
	const { invoice: consultInvoice } = useConsultationInvoice();
	const current = journeyPhase.stage;

	const currentIdx = PORTAL_STAGE_ORDER.indexOf(current);
	const statusOf = (step: string): "done" | "current" | "locked" | "skipped" => {
		const ss = stageStatuses?.[step];
		if (ss) return ss;
		const i = PORTAL_STAGE_ORDER.indexOf(step);
		return i < currentIdx ? "done" : i === currentIdx ? "current" : "locked";
	};

	const chapterOfCurrent = PORTAL_STEP[current as PortalStepId]?.chapter ?? "consult";
	const chapterMeta = CHAPTERS.find((c) => c.id === chapterOfCurrent);

	const stepsFor = (ch: ChapterId) =>
		PORTAL_STAGE_ORDER.filter((s) => PORTAL_STEP_CHAPTER[s as PortalStepId] === ch);

	const chapterPath = (ch: ChapterId): string => {
		switch (ch) {
			case "consult":
				return "/portal/consultation";
			case "enrol":
				return current === "awaiting_handler" ? "/portal/awaiting-handler" : "/portal/package";
			case "apply":
				return "/portal/application";
			case "visa":
				return "/portal/visa";
			case "depart":
				return chapterUnlocks.travel_assistance && current === "travel_assistance"
					? "/portal/pre-departure"
					: "/portal/payment-execution";
			case "done":
				return "/portal/complete";
		}
	};

	// A chapter is done when every step in it passed (done or skipped),
	// current when it holds the live step, locked otherwise.
	const chapterState = (ch: ChapterId): "done" | "current" | "locked" => {
		const sts = stepsFor(ch).map(statusOf);
		if (sts.includes("current")) return "current";
		return sts.every((s) => s === "done" || s === "skipped") ? "done" : "locked";
	};

	// Done chapters collapse to one mono line. The facts, not the steps.
	const doneLine = (ch: ChapterId): ReactNode => {
		const parts = stepsFor(ch).map((s) => `${PORTAL_STEP[s as PortalStepId].short} ✓`);
		let tail: string | null = null;
		if (ch === "consult" && booking.eligibilityOutcome) tail = booking.eligibilityOutcome;
		if (ch === "enrol" && application.assignedStaffName) tail = application.assignedStaffName;
		if (ch === "apply" && schoolApplications.length)
			tail = `${schoolApplications.length} school${schoolApplications.length === 1 ? "" : "s"}`;
		return (
			<>
				{parts.join(" · ")}
				{tail ? <>. <b>{tail}</b></> : null}
			</>
		);
	};

	// Money snapshot for the rail. From the case record, no extra fetch.
	const depositState = application.agencyDepositPaid
		? "Paid ✓"
		: application.agencyTotal > 0
			? "Due"
			: "N/A";
	const appFeeState = isAppInvoicePaid(application)
		? "Paid ✓"
		: application.applicationInvoice.status === "raised"
			? "Due"
			: "Not yet";
	const visaFeeState = isVisaInvoicePaid(application)
		? "Paid ✓"
		: application.visaInvoice.status === "raised"
			? "Due"
			: "Not yet";
	const milestoneState = isAgencySettled(application) ? "Paid ✓" : "After the visa";

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Dashboard · Journey</p>
					<h1 className="page-title mt-1">Your journey</h1>
					<p className="lead mt-2">
						Six chapters, start to departure. This is the map. Every card opens its page.
					</p>
				</div>
			</header>

			{/* You are here */}
			<div className="journey-now mt-4">
				<div>
					<p className="eyebrow">
						Chapter {chapterMeta?.numeral} · {chapterMeta?.label}. You are here
					</p>
					<p className="display journey-now__title">{journeyPhase.label}</p>
					{journeyPhase.nextUnlock ? (
						<p className="journey-now__detail">Next · {journeyPhase.nextUnlock}</p>
					) : null}
				</div>
				<Button to={chapterPath(chapterOfCurrent)} variant="inverted" arrow>
					Open {chapterMeta?.short ?? "stage"}
				</Button>
			</div>

			<div className="psplit mt-6">
				{/* the chapter map */}
				<div>
					{CHAPTERS.map((ch) => {
						const state = chapterState(ch.id);
						const unlocked = chapterUnlocks[JMAP_UNLOCK[ch.id]];
						return (
							<div key={ch.id} className={`jmap__chapter jmap__chapter--${state}`}>
								<div className="jmap__seal">{state === "done" ? "✓" : ch.numeral}</div>
								<div className="jmap__body">
									<div className="jmap__head">
										<span className="jmap__name">
											<span className="mono">{ch.numeral}</span>
											{ch.label}
										</span>
										<span className="jmap__state">
											{state === "done"
												? "Done"
												: state === "current"
													? "You are here"
													: unlocked
														? "Open"
														: "Locked"}
										</span>
									</div>
									<p className="jmap__blurb">{ch.blurb}</p>
									{state === "current" && (
										<ul className="jmap__steps">
											{stepsFor(ch.id).map((s, i) => {
												const st = statusOf(s);
												const meta = PORTAL_STEP[s as PortalStepId];
												return (
													<li key={s} className={`jmap__step jmap__step--${st}`}>
														<span className="jmap__mark">
															{st === "done" ? "✓" : st === "skipped" ? "↷" : st === "current" ? "●" : i + 1}
														</span>
														<span className="jmap__stepname">{meta.label}</span>
														<span className="jmap__note">
															{st === "current" ? "now" : st === "skipped" ? "already covered" : ""}
														</span>
													</li>
												);
											})}
										</ul>
									)}
									{state === "done" && <p className="jmap__doneline">{doneLine(ch.id)}</p>}
									{state === "locked" && <p className="jmap__hint">{JMAP_HINT[ch.id]}</p>}
									{(state === "current" || unlocked) && (
										<div className="jmap__go">
											<Button
												to={chapterPath(ch.id)}
												variant={state === "current" ? "primary" : "ghost"}
												size="sm"
												arrow
											>
												Open {ch.label} →
											</Button>
										</div>
									)}
								</div>
							</div>
						);
					})}
					<div className="jmap__legend">
						<span>✓ done</span>
						<span>● current</span>
						<span>↷ skipped (already covered)</span>
						<span>1–4 locked</span>
					</div>
				</div>

				{/* the rail. Consultant, money, the release terms */}
				<div className="prail">
					<div className="sharp-card">
						<p className="eyebrow">Your consultant</p>
						{application.assignedStaffName ? (
							<>
								<p style={{ fontWeight: 700, marginTop: "0.5rem" }}>{application.assignedStaffName}</p>
								<div style={{ marginTop: "0.8rem", display: "flex", gap: "0.5rem" }}>
									<Button to="/portal/home" variant="ghost" size="sm">
										Message
									</Button>
									<Button to="/portal/appointments" variant="ghost" size="sm">
										Book call
									</Button>
								</div>
							</>
						) : (
							<p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: "0.5rem" }}>
								Assigned after your enrolment deposit. Usually within 1–2 business days.
							</p>
						)}
					</div>

					<div className="sharp-card">
						<p className="eyebrow">Money</p>
						<div style={{ marginTop: "0.4rem" }}>
							<div className="pkv">
								<span className="pkv__k">Consultation</span>
								<span className="pkv__v">
									{booking.paymentStatus === "success" ? (
										<>
											Paid ✓
											{consultInvoice && consultInvoice.payments.length > 0 ? (
												<button
													type="button"
													className="doc-link"
													style={{ marginLeft: "0.4rem" }}
													onClick={() => openInvoiceDocument(consultInvoice, "receipt")}
												>
													↓ receipt
												</button>
											) : null}
										</>
									) : (
										"Due"
									)}
								</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Deposit</span>
								<span className="pkv__v">{depositState}</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Application fee</span>
								<span className="pkv__v">{appFeeState}</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Visa fee</span>
								<span className="pkv__v">{visaFeeState}</span>
							</div>
							<div className="pkv">
								<span className="pkv__k">Fee milestone</span>
								<span className="pkv__v muted">{milestoneState}</span>
							</div>
						</div>
						<div style={{ marginTop: "0.8rem" }}>
							<Button to="/portal/financial" variant="ghost" size="sm">
								Open Money →
							</Button>
						</div>
					</div>

					<div className="sharp-card">
						<p className="eyebrow">While you wait</p>
						<p className="muted" style={{ marginTop: "0.5rem", fontSize: "var(--text-sm)" }}>
							Your admission letter and visa documents are released when the pre-departure milestone
							is paid. That's the agreement, so nothing surprises you later.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ========== Financial ========== */

/** Payment execution. Confirm the plan, settle the service fee, cover travel. */
/** The Fees chapter lives in PortalFeesChapter; the ledger stays here. */

/** Financial - every payment, settlement, and what's still outstanding.
 *
 * Two surfaces share this component:
 *  • `view="ledger"` (the /portal/financial page). A read-only statement of
 *    every invoice, receipt and university deposit.
 *  • `view="plan"` (the /portal/payment-execution chapter). The payment
 *    plan picker, service-fee milestones and the travel invoice position. */
/** Invoice · Receipt — both documents on every row that has them. */
function DocLinks({ invoice }: { invoice: ApiInvoice }) {
	return (
		<>
			<button type="button" className="doc-link" onClick={() => openInvoiceDocument(invoice, "invoice")}>
				↓ invoice
			</button>
			{invoice.payments.length > 0 ? (
				<button type="button" className="doc-link" onClick={() => openInvoiceDocument(invoice, "receipt")}>
					↓ receipt
				</button>
			) : null}
		</>
	);
}

export function PortalFinancial({ view = "ledger" }: { view?: "ledger" | "plan" } = {}) {
	const { application, booking, schoolApplications, choosePaymentPlan, choosePostArrivalSchedule, enabledPostArrivalSchedules, customPostArrivalSchedules, fees, syncFromServer } = useAppState();
	const { toast } = useNotifier();
	const nav = useNavigate();
	const paySheet = usePaySheet(() => void syncFromServer());
	const a = application;
	const planView = view === "plan";

	// Self-service completion: Payment Execution → Completed. Open once the
	// plan is settled per-plan (full in full; installment with its first
	// installment), the ticketing fee is paid, travel clearance is granted and
	// the pre-departure checklist is finished. The server re-validates all of
	// it and moves the coarse stage to the terminal state.
	const [completing, setCompleting] = useState(false);
	async function handleCompleteJourney() {
		if (completing) return;
		setCompleting(true);
		try {
			await meApi.completeApplication();
			await syncFromServer();
			toast.success("Your journey is complete. Welcome to Century NIT.");
			nav("/portal/home");
		} catch (err) {
			toast.error(
				err instanceof ApiError
					? err.message
					: "Could not complete your journey. Please try again.",
			);
			setCompleting(false);
		}
	}

	// Invoice fetching from the real API
	const [invoices, setInvoices] = useState<ApiInvoice[]>([]);
	const [invoicesLoaded, setInvoicesLoaded] = useState(false);

	// Agency service-fee payment: the in-portal sheet (MoMo prompt or the card
	// modal). `agencyPaying` only covers the moment spent resolving the invoice.
	const [agencyPaying, setAgencyPaying] = useState(false);

	async function handlePayAgency() {
		if (agencyPaying) return;
		setAgencyPaying(true);
		try {
			let due = invoices.find((i) => i.type === "agency" && i.balanceCents > 0 && i.status !== "void") ?? null;
			if (!due) {
				const { invoices: list } = await meApi.invoices({ type: "agency" });
				due = list.find((i) => i.balanceCents > 0 && i.status !== "void") ?? null;
			}
			if (!due) {
				throw new Error("Your service-fee invoice isn't on the server yet. Ask your consultant to raise it.");
			}
			paySheet.pay(due);
		} catch (err) {
			toast.error(
				err instanceof ApiError
					? err.message
					: err instanceof Error && err.message
						? err.message
						: "Could not start the payment. Please try again.",
			);
		} finally {
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

	// Derived from fetched invoices (fallback to AppState + hardcoded)
	const consultationPaid = booking.paymentStatus === "success";

	// Find the application‑type and visa‑type invoice from the API list
	const appInvoiceType = invoicesLoaded ? invoices.find((i) => i.type === "application") : null;
	const visaInvoiceType = invoicesLoaded ? invoices.find((i) => i.type === "visa") : null;
	const consultInvoiceType = invoicesLoaded ? invoices.find((i) => i.type === "consultation") : null;
	const agencyInvoiceType = invoicesLoaded ? invoices.find((i) => i.type === "agency") : null;
	const travelInvoiceType = invoicesLoaded ? invoices.find((i) => i.type === "travel" && i.status !== "void") : null;

	const appPaid = isAppInvoicePaid(a) || (invoicesLoaded && appInvoiceType?.status === "paid");
	const visaPaid = isVisaInvoicePaid(a) || (invoicesLoaded && visaInvoiceType?.status === "paid");

	const settled = isAgencySettled(a);
	const depositPaid = isAgencyDepositPaid(a);
	const plan = hasPaymentPlan(a);

	const appInvoiceAmount = (appInvoiceType ? usdFromCents(appInvoiceType.subtotalCents) : null) ?? a.applicationInvoice.amount;
	const visaInvoiceAmount = (visaInvoiceType ? usdFromCents(visaInvoiceType.subtotalCents) : null) ?? a.visaInvoice.amount;

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

	// Fees the applicant will owe but that have not been raised yet. Without
	// these the top band reads GH₵0 / GH₵0 for most of the journey
	// Application fees are the universities' own and unknown until raised; visa costs are the destination's from the catalogue.
	const appNotRaised = 0;
	const visaNotRaised = a.visaInvoice.status === "none" ? usdFromCents(visaCostsCentsFor(fees?.catalogue, a.destinationId)) : 0;
	const notYetRaised = (consultationPaid ? 0 : usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents)) + appNotRaised + visaNotRaised;

	// "Due now" vs "still to come". The position band splits outstanding by
	// whether it's actually payable yet. The agency balance isn't due while it
	// waits on its milestone order (deposit → pre-departure → post-arrival).
	const depositAmt = Math.round(a.agencyTotal * AGENCY_DEPOSIT_PORTION);
	const preDepPortion =
		a.agencyTotal > 0 ? Math.round(a.agencyTotal * (AGENCY_STAGES[1]?.portion ?? 0.5)) : 0;
	const agencyDueNow =
		(a.agencyTotal > 0 && !depositPaid ? depositAmt : 0) +
		(settled || !depositPaid || !plan
			? 0
			: a.paymentPlanId === "full"
				? Math.max(0, a.agencyTotal - a.agencyPaid)
				: a.agencyStageIndex === 0
					? preDepPortion
					: 0);
	const dueNow = appOutstanding + visaOutstanding + agencyDueNow;
	const stillToCome = Math.max(0, totalOutstanding - dueNow) + notYetRaised;
	const dueBits: string[] = [];
	if (appOutstanding) dueBits.push("application fee");
	if (visaOutstanding) dueBits.push("visa fee");
	if (agencyDueNow)
		dueBits.push(a.agencyTotal > 0 && !depositPaid ? "deposit" : "service fee");
	const dueInvoiceLabel = dueBits.length ? dueBits.join(" · ") : null;
	const nextDueInvoice = appOutstanding
		? appInvoiceType
		: visaOutstanding
			? visaInvoiceType
			: agencyDueNow
				? agencyInvoiceType
				: null;
	const nextPayPath = appOutstanding
		? "/portal/application"
		: visaOutstanding
			? "/portal/visa"
			: a.agencyTotal > 0 && !depositPaid
				? "/portal/package"
				: "/portal/payment-execution";

	const [showAllReceipts, setShowAllReceipts] = useState(false);
	const isMobile = useMediaQuery("(max-width: 959.98px)");
	const pdueRef = useRef<HTMLDivElement | null>(null);
	const [pdueVisible, setPdueVisible] = useState(true);
	useEffect(() => {
		const el = pdueRef.current;
		if (!el || typeof IntersectionObserver === "undefined") return;
		const obs = new IntersectionObserver(([e]) => setPdueVisible(e.isIntersecting));
		obs.observe(el);
		return () => obs.disconnect();
	}, [planView]);

	// Every recorded payment across all invoices, newest first. Shown as the
	// "Payment receipts" section so the applicant can see what they've paid.
	const receipts = invoicesLoaded
		? invoices
				.flatMap((inv) =>
					(inv.payments ?? []).map((p) => ({
						id: p.id,
						invoiceNumber: inv.invoiceNumber,
						invoiceType: inv.type,
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
			{paySheet.sheet}
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">{planView ? "Chapter V · Departure · Fees" : "Payments"}</p>
					<h1 className="page-title mt-1">
						{planView ? "Your pre-departure fee milestone" : "Payments & settlements"}
					</h1>
					<p className="lead mt-2">
						{planView
							? "Your visa is approved. Your flight is booked first; then this milestone releases your admission letter and visa documents. The balance on a full plan, the pre-departure instalment otherwise. Any post-arrival remainder follows on your schedule."
							: "Every fee, invoice, and balance - what's paid and what's outstanding."}
					</p>
				</div>
			</header>

			{!planView ? (
				<>
				{/* the position. Due now carries the action; paid / to-come is a hairline */}
				<div ref={pdueRef} className={`pdue mt-4${dueNow === 0 ? " pdue--clear" : ""}`}>
					<div>
						<p className="eyebrow">Due now</p>
						<p className="pdue__amt">
							<Money usd={dueNow} />
						</p>
						<p className="pdue__for">
							{dueNow > 0
								? `${dueInvoiceLabel ?? ""}${nextDueInvoice?.dueAt ? ` · due ${new Date(nextDueInvoice.dueAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}`
								: "Nothing due right now. The next fee arrives with its chapter."}
						</p>
					</div>
					{dueNow > 0 ? (
						<Button to={nextPayPath} variant="primary" arrow>
							Pay{dueInvoiceLabel ? ` ${dueInvoiceLabel}` : ""} →
						</Button>
					) : null}
				</div>
				<div className="pdue2">
					<div>Paid to date <b><MoneyInline usd={totalPaid} /></b></div>
					<div>Still to come <b><MoneyInline usd={stillToCome} /></b></div>
				</div>

				<div className="psplit">
					<div>
						{/* the ledger. Every fee as a chapter-numbered row */}
						<section>
							<div className="psec"><span className="psec__title">The ledger</span></div>
							<div className="pledger">
								<div className={`pledger__row${!consultationPaid ? " pledger__row--due" : " pledger__row--settled"}`}>
									<span className="pledger__mark">I</span>
									<div className="pledger__body">
										<p className="pledger__name">Consultation fee</p>
										<p className="pledger__sub">
											{consultInvoiceType ? `${consultInvoiceType.invoiceNumber} · ` : ""}your session &amp; assessment · at booking
										</p>
									</div>
									<div className="pledger__amt">
										<Money usd={usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents)} />
									</div>
									<span className="pledger__status">
										<span className={`portal-pill${consultationPaid ? " portal-pill--solid" : ""}`}>
											{consultationPaid ? "Paid" : "Due"}
										</span>
									</span>
									<div className="pledger__acts">
										{!consultationPaid ? (
											<>
												<Button to="/portal/consultation" size="sm" variant="primary">
													Pay →
												</Button>
												{consultInvoiceType ? <DocLinks invoice={consultInvoiceType} /> : null}
											</>
										) : consultInvoiceType ? (
											<DocLinks invoice={consultInvoiceType} />
										) : null}
									</div>
								</div>
								<div className={`pledger__row${a.agencyTotal > 0 && !depositPaid ? " pledger__row--due" : depositPaid ? " pledger__row--settled" : ""}`}>
									<span className="pledger__mark">II</span>
									<div className="pledger__body">
										<p className="pledger__name">Deposit · 10%</p>
										<p className="pledger__sub">
											{agencyInvoiceType ? `${agencyInvoiceType.invoiceNumber} · ` : ""}enrolment — assigns your consultant · at enrolment
										</p>
									</div>
									<div className="pledger__amt">
										{a.agencyTotal > 0 ? <Money usd={depositAmt} /> : "N/A"}
									</div>
									<span className="pledger__status">
										<span
											className={`portal-pill${depositPaid ? " portal-pill--solid" : a.agencyTotal > 0 ? "" : " portal-pill--hollow"}`}
										>
											{depositPaid ? "Paid" : a.agencyTotal > 0 ? "Due" : "Not yet"}
										</span>
									</span>
									<div className="pledger__acts">
										{a.agencyTotal > 0 && !depositPaid ? (
											<>
												<Button to="/portal/package" size="sm" variant="primary">
													Pay →
												</Button>
												{agencyInvoiceType ? <DocLinks invoice={agencyInvoiceType} /> : null}
											</>
										) : depositPaid && agencyInvoiceType ? (
											<DocLinks invoice={agencyInvoiceType} />
										) : null}
									</div>
								</div>
								<div className={`pledger__row${appOutstanding > 0 ? " pledger__row--due" : appPaid ? " pledger__row--settled" : ""}`}>
									<span className="pledger__mark">III</span>
									<div className="pledger__body">
										<p className="pledger__name">Application fee</p>
										<p className="pledger__sub">
											{appInvoiceType ? `${appInvoiceType.invoiceNumber} · ` : ""}
											{schoolApplications.length > 0 ? `${schoolApplications.length} school${schoolApplications.length === 1 ? "" : "s"} · ` : ""}
											submissions to your selected schools · {appPaid ? "paid" : appOutstanding > 0 ? "now" : "after school selection"}
										</p>
									</div>
									<div className="pledger__amt">
										{appInvoiceAmount > 0 ? <Money usd={appInvoiceAmount} /> : "N/A"}
									</div>
									<span className="pledger__status">
										<span
											className={`portal-pill${appPaid ? " portal-pill--solid" : appOutstanding > 0 ? "" : " portal-pill--hollow"}`}
										>
											{appPaid ? "Paid" : appOutstanding > 0 ? "Due" : "Not yet"}
										</span>
									</span>
									<div className="pledger__acts">
										{appOutstanding > 0 ? (
											<>
												<Button to="/portal/application" size="sm" variant="primary">
													Pay →
												</Button>
												{appInvoiceType ? <DocLinks invoice={appInvoiceType} /> : null}
											</>
										) : appPaid && appInvoiceType ? (
											<DocLinks invoice={appInvoiceType} />
										) : null}
									</div>
								</div>
								<div className={`pledger__row${visaOutstanding > 0 ? " pledger__row--due" : visaPaid ? " pledger__row--settled" : ""}`}>
									<span className="pledger__mark">IV</span>
									<div className="pledger__body">
										<p className="pledger__name">Visa fee</p>
										<p className="pledger__sub">
											{visaInvoiceType ? `${visaInvoiceType.invoiceNumber} · ` : ""}processing + biometrics handling · your visa file · when a school admits you
										</p>
									</div>
									<div className="pledger__amt">
										{visaInvoiceAmount > 0 ? <Money usd={visaInvoiceAmount} /> : "N/A"}
									</div>
									<span className="pledger__status">
										<span
											className={`portal-pill${visaPaid ? " portal-pill--solid" : visaOutstanding > 0 ? "" : " portal-pill--hollow"}`}
										>
											{visaPaid ? "Paid" : visaOutstanding > 0 ? "Due" : "Not yet"}
										</span>
									</span>
									<div className="pledger__acts">
										{visaOutstanding > 0 ? (
											<>
												<Button to="/portal/visa" size="sm" variant="primary">
													Pay →
												</Button>
												{visaInvoiceType ? <DocLinks invoice={visaInvoiceType} /> : null}
											</>
										) : visaPaid && visaInvoiceType ? (
											<DocLinks invoice={visaInvoiceType} />
										) : null}
									</div>
								</div>
								<div
									className={`pledger__row${
										depositPaid && plan && !settled && (a.paymentPlanId === "full" || a.agencyStageIndex === 0)
											? " pledger__row--due"
											: settled
												? " pledger__row--settled"
												: ""
									}`}
								>
									<span className="pledger__mark">V</span>
									<div className="pledger__body">
										<p className="pledger__name">
											{a.paymentPlanId === "installment" ? "Pre-departure milestone" : "Pre-departure milestone · balance"}
										</p>
										<p className="pledger__sub">
											releases your letter, visa documents &amp; e-ticket · the balance of your service fee · after the visa is approved
										</p>
									</div>
									<div className="pledger__amt">
										{a.agencyTotal > 0 ? (
											<Money
												usd={
													a.paymentPlanId === "installment"
														? preDepPortion
														: Math.max(0, a.agencyTotal - depositAmt)
												}
											/>
										) : (
											"N/A"
										)}
									</div>
									<span className="pledger__status">
										<span
											className={`portal-pill${settled ? " portal-pill--solid" : " portal-pill--hollow"}`}
										>
											{settled ? "Paid" : depositPaid ? "After the visa" : "Not yet"}
										</span>
									</span>
									<div className="pledger__acts">
										{depositPaid && plan && !settled && (a.paymentPlanId === "full" || a.agencyStageIndex === 0) ? (
											<Button to="/portal/payment-execution" size="sm" variant="primary">
												Pay →
											</Button>
										) : null}
										{/* This milestone is a line on the service-fee invoice — the documents live there. */}
										{agencyInvoiceType ? <DocLinks invoice={agencyInvoiceType} /> : null}
									</div>
								</div>
								{(() => {
									const travelInvoice = travelInvoiceType;
									if (!travelInvoice) return null;
									const travelPaid = travelInvoice.status === "paid";
									return (
										<div className={`pledger__row${!travelPaid && travelInvoice.status !== "proforma" ? " pledger__row--due" : travelPaid ? " pledger__row--settled" : ""}`}>
											<span className="pledger__mark">V</span>
											<div className="pledger__body">
												<p className="pledger__name">Ticket</p>
												<p className="pledger__sub">
													{travelInvoice.invoiceNumber} · flight &amp; transfers · with the milestone
												</p>
											</div>
											<div className="pledger__amt">
												<Money usd={travelInvoice.subtotalCents / 100} />
											</div>
											<span className="pledger__status">
												<span className={`portal-pill${travelPaid ? " portal-pill--solid" : " portal-pill--hollow"}`}>
													{travelPaid ? "Paid" : travelInvoice.status === "partial" ? "Part paid" : "Due"}
												</span>
											</span>
											<div className="pledger__acts">
												{!travelPaid ? (
													<>
														<Button to="/portal/pre-departure" size="sm" variant="primary">
															Pay →
														</Button>
														<DocLinks invoice={travelInvoice} />
													</>
												) : (
													<DocLinks invoice={travelInvoice} />
												)}
											</div>
										</div>
									);
								})()}
								{a.paymentPlanId === "installment" && a.agencyTotal > 0 ? (
									<div className={`pledger__row${settled ? " pledger__row--settled" : ""}`}>
										<span className="pledger__mark">VI</span>
										<div className="pledger__body">
											<p className="pledger__name">Post-arrival · 40%</p>
											<p className="pledger__sub">on the schedule you chose · settlement support · after you arrive</p>
										</div>
										<div className="pledger__amt">
											<Money usd={Math.round(a.agencyTotal * (AGENCY_STAGES[2]?.portion ?? 0.4))} />
										</div>
										<span className="pledger__status">
											<span className={`portal-pill${settled ? " portal-pill--solid" : " portal-pill--hollow"}`}>
												{settled ? "Paid" : a.agencyStageIndex >= 1 ? "On schedule" : "Not yet"}
											</span>
										</span>
										<div className="pledger__acts">
											{a.agencyStageIndex >= 1 && !settled ? (
												<Button to="/portal/payment-execution" size="sm" variant="primary">
													Pay →
												</Button>
											) : null}
											{agencyInvoiceType ? <DocLinks invoice={agencyInvoiceType} /> : null}
										</div>
									</div>
								) : null}
							</div>
						</section>
						{/* Second ledger. Deliberately never merged with the one above.
						    Century NIT does not collect tuition, and a combined total would
						    imply that it does. */}
						{offers.length > 0 ? (
							<section className="mt-6">
								<div className="uni-ledger">
								<header className="uni-ledger__head">
									<div>
										<p className="eyebrow">University tuition</p>
										<p className="uni-ledger__sub">
											Paid directly to the institution. Not to Century NIT
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
									You pay tuition for the <strong>one</strong> institution you take up. These
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
							convert at GH₵{GHS_RATE} to $1. University tuition is never billed here. It is paid
							directly to the institution.
						</p>
					</section>

					{/* Payment receipts. Every recorded payment across all invoices */}
					{receipts.length > 0 ? (
						<section className="mt-6">
							<div className="psec">
								<span className="psec__title">Receipts · {receipts.length}</span>
								{receipts.length > 3 ? (
									<span className="psec__hint">
										<button type="button" className="jlink" onClick={() => setShowAllReceipts((s) => !s)}>
											{showAllReceipts ? "Show fewer" : `Show all (${receipts.length})`}
										</button>
									</span>
								) : null}
							</div>
							<div>
								{(showAllReceipts ? receipts : receipts.slice(0, 3)).map((r) => {
									const inv = invoices.find((i) => i.invoiceNumber === r.invoiceNumber);
									return (
										<div key={r.id} className="preceipts__row">
											<span className="d">
												{new Date(r.at).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
											</span>
											<span>
												{r.invoiceNumber} · {INVOICE_TYPE_LABELS[r.invoiceType] ?? r.invoiceType} · {r.method}
												{r.reference ? <span className="ref">ref {r.reference}</span> : null}
											</span>
											<span className="a">
												<Money usd={r.amountCents / 100} />
											</span>
											<span>
												{inv ? (
													<button
														type="button"
														className="doc-link"
														onClick={() => downloadReceipt(inv, INVOICE_TYPE_LABELS[r.invoiceType] ?? "Invoice")}
													>
														↓ receipt
													</button>
												) : null}
											</span>
										</div>
									);
								})}
							</div>
						</section>
					) : null}
					</div>

					{/* the rail. The plan only — the due block carries the action now */}
					<div className="prail">
						<div className="sharp-card">
							<p className="eyebrow">Your plan</p>
							{a.agencyTotal > 0 ? (
								<div style={{ marginTop: "0.4rem" }}>
									<div className="pkv">
										<span className="pkv__k">Plan</span>
										<span className="pkv__v">{PAYMENT_PLAN_LABELS[a.paymentPlanId] ?? "Not chosen"}</span>
									</div>
									<div className="pkv">
										<span className="pkv__k">Service fee</span>
										<span className="pkv__v"><MoneyInline usd={a.agencyTotal} /></span>
									</div>
									<div className="pkv">
										<span className="pkv__k">Paid of it</span>
										<span className="pkv__v"><MoneyInline usd={a.agencyPaid} /></span>
									</div>
									{depositPaid && !settled ? (
										<div style={{ marginTop: "0.7rem" }}>
											<Button to="/portal/payment-execution" variant="ghost" size="sm">
												Manage plan →
											</Button>
										</div>
									) : null}
								</div>
							) : (
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem" }}>
									Set once your package and plan are confirmed in Chapter II.
								</p>
							)}
						</div>

					</div>
				</div>

				{isMobile && dueNow > 0 && !pdueVisible ? (
					<div className="pstick">
						<span>Due now · <MoneyInline usd={dueNow} /></span>
						<Button to={nextPayPath} variant="primary" size="sm">
							Pay{dueInvoiceLabel ? ` ${dueInvoiceLabel}` : ""} →
						</Button>
					</div>
				) : null}
				</>
			) : null}

			{/* Payment plan. Full width */}
			{planView ? (
				<section className="mt-6">
				<p className="eyebrow mb-3">Payment plan</p>

				{/* Step 1: Deposit. Must be paid before plan selection */}
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

				{/* Step 2: Plan picker. Locked until deposit is paid */}
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
								? `Chosen ${a.paymentPlanChosenAt ? new Date(a.paymentPlanChosenAt).toLocaleDateString() : ""}. Switch any time before the balance falls due.`
								: "Deposit paid! Pick how you'd like to settle the remaining balance."}
						</p>
					</>
				) : null}
			</section>
			) : null}

			{/* Service fee milestones. Full width */}
			{a.agencyTotal > 0 && planView ? (
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

									{/* Remaining balance. Only after deposit + plan chosen */}
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
															{preDepCurrent &&
																(milestoneUnlockedFor(a) ? (
																	<Button size="sm" variant="primary" onClick={() => void handlePayAgency()} disabled={agencyPaying}>
																		{agencyPaying ? "Processing…" : "Pay pre-departure"}
																	</Button>
																) : (
																	<span className="ledger-item__detail muted">{milestoneLockReasonFor(a)}</span>
																))}
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
																			return `${Math.round((a.agencyPaid / a.agencyTotal) * 100)}% paid · ${remaining} ${sched?.label ?? ""} payment${remaining === 1 ? "" : "s"} remaining.`;
																		})()
											}
										</p>
								</div>
							</div>
						</>
					</section>
				) : null}

			{planView ? (
				<p className="muted mt-5" style={{ maxWidth: "36rem" }}>
					Your full invoice ledger (consultation, application, visa and the travel invoice)
					is always on the{" "}
					<Link className="link" to="/portal/financial">Financial</Link> page.
				</p>
			) : null}
			{planView && hasSettledPlan(a) ? (
				<div className="mt-6 box" style={{ maxWidth: "36rem" }}>
					{a.preDepartureCompletedAt ? (
						<>
							<p className="mt-0 mb-2">
								Your plan is settled. Finish the last step. Complete your journey and
								your consultant picks you up for the post-arrival plan.
							</p>
							<Button
								className="btn btn--primary"
								onClick={handleCompleteJourney}
								disabled={completing}
							>
								{completing ? "Completing journey…" : "Complete journey"}
							</Button>
						</>
					) : (
						<>
							<p className="mt-0 mb-2">
								Your plan is settled. Finish your pre-departure checklist so your
								handler can clear you. Then you can complete your journey.
							</p>
							<Button className="btn btn--primary" to="/portal/pre-departure">
								Open travel checklist
							</Button>
						</>
					)}
				</div>
			) : null}
		</div>
	);
}
