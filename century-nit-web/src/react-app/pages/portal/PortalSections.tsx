import { Link, useNavigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select, Textarea } from "../../components/ui/Field";
import {
	hasPaymentPlan,
	hasSettledPlan,
	isAppInvoicePaid,
	isAgencySettled,
	isAgencyDepositPaid,
	isVisaInvoicePaid,
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
	formatDualCurrency,
	getDestination,
	getProgram,
	getUniversity,
	GHS_RATE,
	PAYMENT_PLANS,
	SCHOOL_DEGREE_LEVELS,
	REQUIRED_DOCUMENTS,
	getBranchName,
} from "century-nit-core";
import { documentsApi, meApi, ApiError, visaCostsCentsFor } from "century-nit-core/api";
import { useNotifier } from "../../components/notifier/Notifier";
import { ChapterGate } from "./PortalLayout";
import { Avatar } from "../../components/ui/Avatar";
import { AvatarCropModal } from "../../components/portal/AvatarCropModal";
import { ChangePasswordModal, ChangeEmailModal } from "../../components/portal/SecurityModals";
import type { ApplicantDocument, ApiInvoice } from "century-nit-shared";
import { Money, MoneyInline } from "../../components/ui/Money";
import { getMfaEnrollment, type MfaEnrollmentStatus } from "../../lib/api";
import { ALLOWED_DOCUMENT_TYPES, MAX_DOCUMENT_BYTES } from "century-nit-shared";
import { prepareDocumentForUpload } from "../../lib/upload";
import { downloadReceipt } from "../../lib/receipt";

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
		schoolApplications,
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
							className="btn btn--primary"
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
							{a.appNumber ?? <span className="profile-hero__empty">Not issued yet</span>}
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
							{titleCase(a.intake || ass.intakePreference) || <span className="profile-hero__empty">Not set</span>}
						</p>
					</div>
				</div>
			</section>

			{/* Dossier Panels */}
			<div className="dossier-panel" style={{ display: "flex", flexDirection: "column", gap: "2rem", marginTop: "2rem" }}>
						<div className="dossier-card">
							<div className="dossier-card__head">
								<h2 className="dossier-card__title">Academic Path &amp; Target Application</h2>
								<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
									STATUS: {uploadedDocs < totalDocs ? "IN PROGRESS" : "APPLICATION SUBMITTED"}
								</span>
							</div>
							<div className="dossier-grid">
								<DossierField label="Target Destination" value={targetDestination} />
								<DossierField label="Target Institution" value={targetInstitution} />
								<DossierField label="Academic Programme" value={targetProgram} />
								<DossierField label="Target Intake" value={titleCase(a.intake || ass.intakePreference)} />
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
																: scalar(ass, f.key)) ?? "",
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
														PREFERENCE_FIELDS.map((f) => [f.key, scalar(ass, f.key) ?? ""]),
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
								<>
									<div className="dossier-grid">
										<DossierField label="Target Degree Level" value={getDegreeLevelName(ass.preferredLevel)} />
										<DossierField label="Preferred Countries" value={ass.preferredCountries} />
										<DossierField label="Preferred Major / Field" value={ass.preferredField} />
									</div>
									{ass.studyChoices.some((c) => c.country || c.university || c.program) ? (
										<ol className="choice-list mt-3">
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
								<DossierField label="Destination" value={targetDestination} />
								<DossierField label="Target University" value={targetInstitution} />
								<DossierField label="Programme" value={targetProgram} />
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

						<div className="dossier-card" style={{ borderColor: "#fecaca" }}>
							<div className="dossier-card__head">
								<h2 className="dossier-card__title" style={{ color: "#ef4444" }}>Danger Zone</h2>
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

/** What opens a locked chapter — the hint under its blurb. */
const JMAP_HINT: Record<ChapterId, string> = {
	consult: "Book your consultation to begin.",
	enrol: "Opens once your assessment says you can proceed.",
	apply: "Opens once your enrolment is confirmed and the deposit is paid.",
	visa: "Opens when a school admits you. The visa fee is paid here, then your file goes to the visa officer.",
	depart: "The pre-departure milestone is due once your visa is approved — your ticket is issued after it, never before.",
	done: "The last chapter — reached when the flight is booked and the checklist is done.",
};

/**
 * Journey — six chapters with the fine steps nested inside the live one.
 * Done chapters collapse to one mono line of facts; locked chapters explain
 * what opens them. Everything is derived from `stageStatuses` /
 * `chapterUnlocks` (`/me/journey`) — the page never guesses.
 */
export function PortalJourney() {
	const { journeyPhase, application, schoolApplications, stageStatuses, chapterUnlocks, booking } = useAppState();
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
				return chapterUnlocks.tracking ? "/portal/tracking" : "/portal/application";
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

	// Done chapters collapse to one mono line — the facts, not the steps.
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
				{tail ? <> — <b>{tail}</b></> : null}
			</>
		);
	};

	// Money snapshot for the rail — from the case record, no extra fetch.
	const depositState = application.agencyDepositPaid
		? "Paid ✓"
		: application.agencyTotal > 0
			? "Due"
			: "—";
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
						Six chapters, start to departure. This is the map — every card opens its page.
					</p>
				</div>
			</header>

			{/* You are here */}
			<div className="journey-now mt-4">
				<div>
					<p className="eyebrow">
						Chapter {chapterMeta?.numeral} · {chapterMeta?.label} — you are here
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

				{/* the rail — consultant, money, the release terms */}
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
								Assigned after your enrolment deposit — usually within 1–2 business days.
							</p>
						)}
					</div>

					<div className="sharp-card">
						<p className="eyebrow">Money</p>
						<div style={{ marginTop: "0.4rem" }}>
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
							is paid — that's the agreement, so nothing surprises you later.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

/* ========== Financial ========== */

/** Payment execution — confirm the plan, settle the service fee, cover travel. */
export function PortalPaymentExecution() {
	return (
		<ChapterGate chapter="payment_execution">
			<PortalFinancial view="plan" />
		</ChapterGate>
	);
}

/** Financial - every payment, settlement, and what's still outstanding.
 *
 * Two surfaces share this component:
 *  • `view="ledger"` (the /portal/financial page) — a read-only statement of
 *    every invoice, receipt and university deposit.
 *  • `view="plan"` (the /portal/payment-execution chapter) — the payment
 *    plan picker, service-fee milestones and the travel invoice position. */
export function PortalFinancial({ view = "ledger" }: { view?: "ledger" | "plan" } = {}) {
	const { application, booking, schoolApplications, choosePaymentPlan, choosePostArrivalSchedule, payAgencyInstallment, enabledPostArrivalSchedules, customPostArrivalSchedules, fees, syncFromServer } = useAppState();
	const { toast } = useNotifier();
	const nav = useNavigate();
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
			toast.success("Your journey is complete — welcome to Century NIT.");
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

	// Fees the applicant will owe but that have not been raised yet — without
	// these the top band reads GH₵0 / GH₵0 for most of the journey
	// Application fees are the universities' own and unknown until raised; visa costs are the destination's from the catalogue.
	const appNotRaised = 0;
	const visaNotRaised = a.visaInvoice.status === "none" ? usdFromCents(visaCostsCentsFor(fees?.catalogue, a.destinationId)) : 0;
	const notYetRaised = (consultationPaid ? 0 : usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents)) + appNotRaised + visaNotRaised;

	// "Due now" vs "still to come" — the position band splits outstanding by
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
	const nextPayPath = appOutstanding
		? "/portal/application"
		: visaOutstanding
			? "/portal/visa"
			: a.agencyTotal > 0 && !depositPaid
				? "/portal/package"
				: "/portal/payment-execution";

	// Every recorded payment across all invoices, newest first — shown as the
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
			{agencyPaying ? (
				<div className="loading-overlay" role="status" aria-live="polite">
					<div className="spinner" aria-hidden />
					<p className="mono">Contacting payment provider…</p>
					<p className="muted">Redirecting you to Paystack to pay your service fee</p>
				</div>
			) : null}
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">{planView ? "Chapter V · Departure · Fees" : "Money"}</p>
					<h1 className="page-title mt-1">
						{planView ? "Your pre-departure fee milestone" : "Payments & settlements"}
					</h1>
					<p className="lead mt-2">
						{planView
							? "Your visa is approved. This milestone is due before your ticket is issued — the balance on a full plan, the pre-departure instalment otherwise. Your admission letter and visa documents are released, and your ticket is issued, after it. Any post-arrival remainder follows on your schedule."
							: "Every fee, invoice, and balance - what's paid and what's outstanding."}
					</p>
				</div>
			</header>

			{!planView ? (
				<>
				{/* the position — paid / due now / still to come */}
				<div className="pposition mt-4">
					<div>
						<p className="eyebrow">Paid to date</p>
						<p className="pposition__num">
							<Money usd={totalPaid} />
						</p>
					</div>
					<div className="pposition__due">
						<p className="eyebrow">Due now</p>
						<p className="pposition__num">
							<Money usd={dueNow} />
						</p>
						{dueInvoiceLabel ? (
							<p className="mono" style={{ fontSize: "0.65rem", opacity: 0.7, marginTop: "0.2rem" }}>
								{dueInvoiceLabel}
							</p>
						) : null}
					</div>
					<div>
						<p className="eyebrow">Still to come</p>
						<p className="pposition__num">
							<Money usd={stillToCome} />
						</p>
						<p className="mono muted" style={{ fontSize: "0.65rem", opacity: 0.7, marginTop: "0.2rem" }}>
							later chapters, in their order
						</p>
					</div>
				</div>

				<div className="psplit">
					<div>
						{/* the ledger — every fee as a chapter-numbered row */}
						<section>
							<h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>The ledger</h2>
							<table className="ptable">
								<thead>
									<tr>
										<th></th>
										<th>Fee</th>
										<th>Covers</th>
										<th>Due</th>
										<th>Amount</th>
										<th>Status</th>
										<th></th>
									</tr>
								</thead>
								<tbody>
									<tr className={!consultationPaid ? "ptable__now" : undefined}>
										<td className="ptable__mark">I</td>
										<td>Consultation fee</td>
										<td>Your session &amp; assessment</td>
										<td>At booking</td>
										<td className="ptable__amt">
											<Money usd={usdFromCents((fees || FALLBACK_FEE_SCHEDULE).consultationCents)} />
										</td>
										<td>
											<span className={`portal-pill${consultationPaid ? " portal-pill--solid" : ""}`}>
												{consultationPaid ? "Paid" : "Due"}
											</span>
										</td>
										<td>
											{!consultationPaid ? (
												<Button to="/portal/consultation" size="sm" variant="primary">
													Pay →
												</Button>
											) : null}
										</td>
									</tr>
									<tr className={a.agencyTotal > 0 && !depositPaid ? "ptable__now" : undefined}>
										<td className="ptable__mark">II</td>
										<td>Deposit · 10%</td>
										<td>Enrolment — assigns your consultant</td>
										<td>At enrolment</td>
										<td className="ptable__amt">
											{a.agencyTotal > 0 ? <Money usd={depositAmt} /> : "—"}
										</td>
										<td>
											<span
												className={`portal-pill${depositPaid ? " portal-pill--solid" : a.agencyTotal > 0 ? "" : " portal-pill--hollow"}`}
											>
												{depositPaid ? "Paid" : a.agencyTotal > 0 ? "Due" : "Not yet"}
											</span>
										</td>
										<td>
											{a.agencyTotal > 0 && !depositPaid ? (
												<Button to="/portal/package" size="sm" variant="primary">
													Pay →
												</Button>
											) : null}
										</td>
									</tr>
									<tr className={appOutstanding > 0 ? "ptable__now" : undefined}>
										<td className="ptable__mark">III</td>
										<td>
											Application fee
											{schoolApplications.length > 0 ? (
												<span className="ptable__sub">
													{schoolApplications.length} school
													{schoolApplications.length === 1 ? "" : "s"}
												</span>
											) : null}
										</td>
										<td>Submissions to your selected schools</td>
										<td>{appPaid ? "—" : appOutstanding > 0 ? "Now" : "After school selection"}</td>
										<td className="ptable__amt">
											{appInvoiceAmount > 0 ? <Money usd={appInvoiceAmount} /> : "—"}
										</td>
										<td>
											<span
												className={`portal-pill${appPaid ? " portal-pill--solid" : appOutstanding > 0 ? "" : " portal-pill--hollow"}`}
											>
												{appPaid ? "Paid" : appOutstanding > 0 ? "Due" : "Not yet"}
											</span>
										</td>
										<td>
											{appOutstanding > 0 ? (
												<Button to="/portal/application" size="sm" variant="primary">
													Pay →
												</Button>
											) : null}
										</td>
									</tr>
									<tr className={visaOutstanding > 0 ? "ptable__now" : undefined}>
										<td className="ptable__mark">IV</td>
										<td>
											Visa fee
											<span className="ptable__sub">processing + biometrics handling</span>
										</td>
										<td>Your visa file</td>
										<td>When a school admits you</td>
										<td className="ptable__amt">
											{visaInvoiceAmount > 0 ? <Money usd={visaInvoiceAmount} /> : "—"}
										</td>
										<td>
											<span
												className={`portal-pill${visaPaid ? " portal-pill--solid" : visaOutstanding > 0 ? "" : " portal-pill--hollow"}`}
											>
												{visaPaid ? "Paid" : visaOutstanding > 0 ? "Due" : "Not yet"}
											</span>
										</td>
										<td>
											{visaOutstanding > 0 ? (
												<Button to="/portal/visa" size="sm" variant="primary">
													Pay →
												</Button>
											) : null}
										</td>
									</tr>
									<tr
										className={
											depositPaid && plan && !settled && (a.paymentPlanId === "full" || a.agencyStageIndex === 0)
												? "ptable__now"
												: undefined
										}
									>
										<td className="ptable__mark">V</td>
										<td>
											{a.paymentPlanId === "installment" ? "Pre-departure milestone · 50%" : "Pre-departure milestone · balance"}
											<span className="ptable__sub">releases your letter, visa documents &amp; ticket</span>
										</td>
										<td>The balance of your service fee</td>
										<td>After the visa is approved</td>
										<td className="ptable__amt">
											{a.agencyTotal > 0 ? (
												<Money
													usd={
														a.paymentPlanId === "installment"
															? preDepPortion
															: Math.max(0, a.agencyTotal - depositAmt)
													}
												/>
											) : (
												"—"
											)}
										</td>
										<td>
											<span
												className={`portal-pill${settled ? " portal-pill--solid" : " portal-pill--hollow"}`}
											>
												{settled ? "Paid" : depositPaid ? "After the visa" : "Not yet"}
											</span>
										</td>
										<td>
											{depositPaid && plan && !settled && (a.paymentPlanId === "full" || a.agencyStageIndex === 0) ? (
												<Button to="/portal/payment-execution" size="sm" variant="primary">
													Pay →
												</Button>
											) : null}
										</td>
									</tr>
									{(() => {
										const travelInvoice = invoicesLoaded ? invoices.find((i) => i.type === "travel") : null;
										if (!travelInvoice) return null;
										const travelPaid = travelInvoice.status === "paid";
										return (
											<tr className={!travelPaid && travelInvoice.status !== "proforma" ? "ptable__now" : undefined}>
												<td className="ptable__mark">V</td>
												<td>
													Ticket
													<span className="ptable__sub">{travelInvoice.invoiceNumber}</span>
												</td>
												<td>Flight &amp; transfers</td>
												<td>With the milestone</td>
												<td className="ptable__amt">
													<Money usd={travelInvoice.subtotalCents / 100} />
												</td>
												<td>
													<span className={`portal-pill${travelPaid ? " portal-pill--solid" : " portal-pill--hollow"}`}>
														{travelPaid ? "Paid" : travelInvoice.status === "partial" ? "Part paid" : "Due"}
													</span>
												</td>
												<td>
													{!travelPaid ? (
														<Button to="/portal/pre-departure" size="sm" variant="primary">
															Pay →
														</Button>
													) : null}
												</td>
											</tr>
										);
									})()}
									{a.paymentPlanId === "installment" && a.agencyTotal > 0 ? (
										<tr>
											<td className="ptable__mark">VI</td>
											<td>
												Post-arrival · 40%
												<span className="ptable__sub">on the schedule you chose</span>
											</td>
											<td>Settlement support</td>
											<td>After you arrive</td>
											<td className="ptable__amt">
												<Money usd={Math.round(a.agencyTotal * (AGENCY_STAGES[2]?.portion ?? 0.4))} />
											</td>
											<td>
												<span className={`portal-pill${settled ? " portal-pill--solid" : " portal-pill--hollow"}`}>
													{settled ? "Paid" : a.agencyStageIndex >= 1 ? "On schedule" : "Not yet"}
												</span>
											</td>
											<td>
												{a.agencyStageIndex >= 1 && !settled ? (
													<Button to="/portal/payment-execution" size="sm" variant="primary">
														Pay →
													</Button>
												) : null}
											</td>
										</tr>
									) : null}
								</tbody>
							</table>
						</section>
					</div>

					{/* the rail — next payment, plan, the fixed order */}
					<div className="prail">
						<div className="sharp-card sharp-card--key">
							<p className="eyebrow">Next payment</p>
							{dueNow > 0 ? (
								<>
									<p style={{ fontWeight: 700, fontSize: "1.1rem", margin: "0.4rem 0 0.2rem" }}>
										<Money usd={dueNow} /> · {dueInvoiceLabel}
									</p>
									<Button to={nextPayPath} variant="primary" arrow style={{ width: "100%", marginTop: "0.9rem" }}>
										Pay <MoneyInline usd={dueNow} /> →
									</Button>
								</>
							) : (
								<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.5 }}>
									Nothing due right now — the next fee arrives with its chapter.
								</p>
							)}
						</div>

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

						<div className="sharp-card">
							<p className="eyebrow">The order is fixed</p>
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.4rem", lineHeight: 1.6 }}>
								Deposit at enrolment · application fee at submissions · visa fee after an offer · the
								milestone after your visa — and your letter, visa documents and ticket are released
								with it.
							</p>
						</div>
					</div>
				</div>
				</>
			) : null}

			{/* Payment plan — full width */}
			{planView ? (
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
			) : null}

			{/* Service fee milestones — full width */}
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

				{!planView ? (
				<>
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
					<h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "0.75rem" }}>Receipts</h2>
					<table className="ptable">
						<thead>
							<tr>
								<th>Receipt</th>
								<th>For</th>
								<th>Method</th>
								<th>Amount</th>
								<th>Date</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{receipts.map((r) => {
								const inv = invoices.find((i) => i.invoiceNumber === r.invoiceNumber);
								return (
									<tr key={r.id}>
										<td className="mono">{r.invoiceNumber}</td>
										<td>{INVOICE_TYPE_LABELS[r.invoiceType] ?? r.invoiceType}</td>
										<td>{r.method}</td>
										<td className="ptable__amt">
											<Money usd={r.amountCents / 100} />
										</td>
										<td className="ptable__mark">
											{new Date(r.at).toLocaleDateString(undefined, {
												year: "numeric",
												month: "short",
												day: "numeric",
											})}
											{r.reference ? ` · ${r.reference}` : ""}
										</td>
										<td>
											{inv ? (
												<Button
													variant="ghost"
													size="sm"
													onClick={() => downloadReceipt(inv, INVOICE_TYPE_LABELS[r.invoiceType] ?? "Invoice")}
												>
													PDF
												</Button>
											) : null}
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</section>
			) : null}
				</>
			) : null}
			{planView ? (
				<p className="muted mt-5" style={{ maxWidth: "36rem" }}>
					Your full invoice ledger — consultation, application, visa and the travel invoice —
					is always on the{" "}
					<Link className="link" to="/portal/financial">Financial</Link> page.
				</p>
			) : null}
			{planView && hasSettledPlan(a) ? (
				<div className="mt-6 box" style={{ maxWidth: "36rem" }}>
					{a.preDepartureCompletedAt ? (
						<>
							<p className="mt-0 mb-2">
								Your plan is settled. Finish the last step — complete your journey and
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
								handler can clear you — then you can complete your journey.
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
