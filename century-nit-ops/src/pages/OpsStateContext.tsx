import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { safeSetItem, slotFromToday, formatSlot, resolveBranchId } from "century-nit-core";
import {
	servicePackages as PUBLIC_SERVICE_PACKAGES,
	CONSULTATION_FEE_AMOUNT,
	APP_INVOICE_BASE,
	APP_INVOICE_PER_SCHOOL,
	APP_DOC_VERIFY_FEE,
	APP_MATCH_REVIEW_FEE,
	VISA_INVOICE_AMOUNT,
	VISA_BIOMETRICS_FEE,
	VISA_TRANSLATION_FEE,
	type Lead,
	type LeadStage,
} from "century-nit-core";
import {
	EMPTY_DIRECTIVES,
	EMPTY_LIVE_OVERLAY,
	branchName,
	type Assignee,
	type CaseComment,
	type CommentKind,
	type LiveOverlay,
	type ServicePackage,
	type EligibilityDirective,
	type InvoiceDirective,
	type LiveCaseSnapshot,
	type MockApplicant,
	type MockApplication,
	type MockConsultation,
	type OpsDirectives,
	type OpsInvoiceLine,
	type Invoice,
	type InvoicePayment,
	type InvoiceStatus,
	type VisaStage,
	type PaymentPlanId,
	type VisaStageDirective,
	type PaymentPlanDirective,
	type AgencyAdvanceDirective,
	type TravelClearanceDirective,
	type ScheduleConfigDirective,
	type CustomSchedule,
} from "century-nit-core/ops";
import { fmtBoth } from "./currency";
import { cmsKey, type CmsCollectionId, type CmsOverlay, type CmsStatus } from "century-nit-core";

/* ─── INITIAL DATA ─── */

export const SEED_CONSULTATIONS: MockConsultation[] = [
	{
		id: "c-1",
		ref: "CNS-2026-001",
		applicantName: "Ama Serwaa Adjei",
		email: "ama.adjei@example.com",
		phone: "+233 24 555 0177",
		branch: "accra",
		...slotFromToday("accra", 1, "10:00"),
		type: "Online",
		assignedOfficer: "Efua Owusu",
		assignedOfficerEmail: "e.owusu@century-nit.com",
		targetCountry: "Canada",
		status: "Assigned",
		personal: { nationality: "Ghanaian", residence: "Accra, Ghana", dob: "1998-05-14" },
		passport: { number: "G76421983", expiry: "2030-11-20", previousRefusals: "None" },
		education: { degree: "BSc Computer Science", institution: "University of Ghana, Legon", gpa: "3.8 / 4.0 (First Class)", gradYear: "2021" },
		employment: { currentRole: "Software Engineer", company: "MTN Ghana", experienceYears: "3 years" },
		financial: { source: "Self-Funded + Family Sponsor", budget: "GH₵ 675,000 / year (~ $45,000)" },
		goals: { degreeLevel: "Master's", intake: "Fall 2026", major: "Artificial Intelligence" },
		documents: [
			{ name: "UG_Transcript_Official.pdf", status: "Pending Review" },
			{ name: "Passport_Scan_AmaAdjei.pdf", status: "Pending Review" },
			{ name: "IELTS_Academic_7.5.pdf", status: "Pending Review" },
			{ name: "Statement_of_Purpose.pdf", status: "Pending Review" },
		],
	},
	{
		id: "c-2",
		ref: "CNS-2026-002",
		applicantName: "Kwesi Ofori-Atta",
		email: "kwesi.oa@example.com",
		phone: "+233 26 887 4410",
		branch: "kumasi",
		...slotFromToday("kumasi", 2, "11:00"),
		type: "In-Person",
		assignedOfficer: "Efua Owusu",
		assignedOfficerEmail: "e.owusu@century-nit.com",
		targetCountry: "UK",
		status: "In Assessment",
		personal: { nationality: "Ghanaian", residence: "Kumasi, Ghana", dob: "1996-09-22" },
		passport: { number: "G81192574", expiry: "2029-04-15", previousRefusals: "None" },
		education: { degree: "BBA Business Administration", institution: "KNUST, Kumasi", gpa: "3.5 / 4.0", gradYear: "2020" },
		employment: { currentRole: "Marketing Specialist", company: "Unilever Ghana", experienceYears: "4 years" },
		financial: { source: "Government Scholarship Candidate", budget: "GH₵ 900,000 / year (~ $60,000)" },
		goals: { degreeLevel: "MBA", intake: "Fall 2026", major: "International Business" },
		documents: [
			{ name: "KNUST_Degree_Certificate.pdf", status: "Pending Review" },
			{ name: "Passport_Ghana_OforiAtta.pdf", status: "Pending Review" },
			{ name: "CV_Kwesi_OforiAtta.pdf", status: "Pending Review" },
		],
	},
	{
		id: "c-3",
		ref: "CNS-2026-003",
		applicantName: "Efua Akosua Boateng",
		email: "efua.boateng@example.com",
		phone: "+233 20 334 8890",
		branch: "takoradi",
		...slotFromToday("takoradi", 3, "14:00"),
		type: "Online",
		// Booked by the client, not yet assigned - sits in the manager's queue.
		assignedOfficer: "",
		assignedOfficerEmail: "",
		targetCountry: "Australia",
		status: "Under Review",
		personal: { nationality: "Ghanaian", residence: "Takoradi, Ghana", dob: "2000-02-10" },
		passport: { number: "G90812065", expiry: "2028-08-30", previousRefusals: "None" },
		education: { degree: "BS Nursing", institution: "University of Cape Coast", gpa: "3.6 / 4.0", gradYear: "2022" },
		employment: { currentRole: "Registered Nurse", company: "Korle Bu Teaching Hospital", experienceYears: "2 years" },
		financial: { source: "Self-Funded", budget: "GH₵ 525,000 / year (~ $35,000)" },
		goals: { degreeLevel: "Master of Nursing Practice", intake: "Spring 2027", major: "Clinical Nursing" },
		documents: [
			{ name: "Nursing_Board_License.pdf", status: "Pending Review" },
			{ name: "OET_Results_Straight_A.pdf", status: "Pending Review" },
		],
	},
];

export const SEED_APPLICATIONS: MockApplication[] = [
	{
		id: "app-1",
		appId: "APP-2026-1001",
		applicantName: "Ama Serwaa Adjei",
		email: "ama.adjei@example.com",
		phone: "+233 24 555 0177",
		branch: "accra",
		university: "University of Toronto",
		program: "MSc Computer Science",
		country: "Canada",
		degreeLevel: "Master's",
		assignedStaff: "Efua Owusu",
		assignedStaffEmail: "e.owusu@century-nit.com",
		stage: "School Submission",
		status: "Under Review",
		submittedDate: "2026-08-01",
		fundingTrack: "Scholarship Track",
		notes: "High academic standing. Transcripts verified by WES.",
		checklist: [
			{ id: "c1", label: "Official Transcripts Verified", checked: true },
			{ id: "c2", label: "Valid Passport Scan", checked: true },
			{ id: "c3", label: "Proof of Funds (GH₵ 675,000 / $45k)", checked: true },
			{ id: "c4", label: "IELTS 7.5 Certificate", checked: true },
			{ id: "c5", label: "Statement of Purpose Signed", checked: false },
		],
	},
	{
		id: "app-2",
		appId: "APP-2026-1002",
		applicantName: "Kwesi Ofori-Atta",
		email: "kwesi.oa@example.com",
		phone: "+233 26 887 4410",
		branch: "kumasi",
		university: "Imperial College London",
		program: "MBA International Management",
		country: "UK",
		degreeLevel: "Master's",
		assignedStaff: "Efua Owusu",
		assignedStaffEmail: "e.owusu@century-nit.com",
		stage: "Document Verification",
		status: "Under Review",
		submittedDate: "2026-08-02",
		fundingTrack: "Self-Funded Track",
		notes: "Employer recommendation letter attached.",
		checklist: [
			{ id: "c1", label: "KNUST Degree Certificate", checked: true },
			{ id: "c2", label: "Passport Copy (Ghana)", checked: true },
			{ id: "c3", label: "GMAT / GRE Scores", checked: false },
			{ id: "c4", label: "Work Experience Letters (4 Yrs)", checked: true },
		],
	},
	{
		id: "app-3",
		appId: "APP-2026-1003",
		applicantName: "Efua Akosua Boateng",
		email: "efua.boateng@example.com",
		phone: "+233 20 334 8890",
		branch: "takoradi",
		university: "University of Melbourne",
		program: "Master of Nursing Practice",
		country: "Australia",
		degreeLevel: "Master's",
		assignedStaff: "Abena Frimpong",
		assignedStaffEmail: "a.frimpong@century-nit.com",
		stage: "Offer Letter Review",
		status: "Accepted",
		submittedDate: "2026-07-28",
		fundingTrack: "Hybrid Track",
		notes: "Conditional offer received from Uni Melbourne.",
		checklist: [
			{ id: "c1", label: "Nursing Board License", checked: true },
			{ id: "c2", label: "OET Exam Passed", checked: true },
			{ id: "c3", label: "Passport Verified", checked: true },
			{ id: "c4", label: "Health Clearance", checked: true },
		],
	},
	{
		id: "app-4",
		appId: "APP-2026-1004",
		applicantName: "Kofi Agyemang-Badu",
		email: "kofi.ab@example.com",
		phone: "+233 24 556 0991",
		branch: "accra",
		university: "MIT",
		program: "PhD Robotics & Automation",
		country: "USA",
		degreeLevel: "PhD",
		assignedStaff: "Kwame Agyeman",
		assignedStaffEmail: "k.agyeman@century-nit.com",
		stage: "Visa Processing",
		status: "Accepted",
		submittedDate: "2026-07-20",
		fundingTrack: "Full Assistantship",
		notes: "Full tuition waiver and stipend awarded.",
		checklist: [
			{ id: "c1", label: "I-20 Certificate Issued", checked: true },
			{ id: "c2", label: "SEVIS Fee Receipt", checked: true },
			{ id: "c3", label: "DS-160 Form Submitted", checked: true },
			{ id: "c4", label: "Embassy Appointment Scheduled", checked: true },
		],
		visaStage: "biometrics",
		visaInvoicePaid: true,
		visaCounselorNote: "Biometrics completed at US Embassy Accra. Awaiting decision.",
	},
	{
		id: "app-5",
		appId: "APP-2026-1005",
		applicantName: "Adwoa Nyamekye",
		email: "adwoa.ny@example.com",
		phone: "+233 20 887 2233",
		branch: "kumasi",
		university: "University of Edinburgh",
		program: "MSc Data Science",
		country: "UK",
		degreeLevel: "Master's",
		assignedStaff: "Kwame Agyeman",
		assignedStaffEmail: "k.agyeman@century-nit.com",
		stage: "Payment Plan",
		status: "Accepted",
		submittedDate: "2026-07-15",
		fundingTrack: "Scholarship Track",
		notes: "Visa approved. Choosing payment plan for remaining fees.",
		checklist: [
			{ id: "c1", label: "CAS Letter Received", checked: true },
			{ id: "c2", label: "TB Test Certificate", checked: true },
			{ id: "c3", label: "Visa Fee Paid", checked: true },
		],
		visaStage: "complete",
		visaInvoicePaid: true,
		visaCounselorNote: "UK visa approved. Ready for payment plan selection.",
		paymentPlanId: "installments",
	},
	{
		id: "app-6",
		appId: "APP-2026-1006",
		applicantName: "Yaw Mensah-Darko",
		email: "yaw.md@example.com",
		phone: "+233 27 445 8810",
		branch: "takoradi",
		university: "University of British Columbia",
		program: "Master of Engineering",
		country: "Canada",
		degreeLevel: "Master's",
		assignedStaff: "Abena Frimpong",
		assignedStaffEmail: "a.frimpong@century-nit.com",
		stage: "Travel Assistance",
		status: "Accepted",
		submittedDate: "2026-07-08",
		fundingTrack: "Self-Funded Track",
		notes: "Visa complete, payment plan locked. Pre-departure in progress.",
		checklist: [
			{ id: "c1", label: "Passport Valid", checked: true },
			{ id: "c2", label: "Visa Stamped", checked: true },
			{ id: "c3", label: "Flight Booked", checked: false },
		],
		visaStage: "complete",
		visaInvoicePaid: true,
		visaCounselorNote: "Canada study visa approved.",
		paymentPlanId: "full",
		agencyStageIndex: 1,
		agencySettled: false,
		travelClearance: "pending",
		preDepartureTasks: [
			{ id: "pd1", category: "travel", label: "Book flight to Vancouver", detail: "Target departure: Sep 1, 2026", done: false },
			{ id: "pd2", category: "travel", label: "Airport pickup arrangement", detail: "Coordinate with university", done: false },
			{ id: "pd3", category: "accommodation", label: "Confirm student housing", detail: "UBC residence application", done: true },
			{ id: "pd4", category: "accommodation", label: "Temporary hotel booking", detail: "First 3 nights if needed", done: false },
			{ id: "pd5", category: "documents", label: "Carry original transcripts", detail: "In carry-on luggage", done: false },
			{ id: "pd6", category: "documents", label: "Print visa & admission letter", detail: "Hard copies for border control", done: true },
			{ id: "pd7", category: "health", label: "Travel insurance", detail: "Coverage for first 90 days", done: false },
			{ id: "pd8", category: "health", label: "Prescription medications", detail: "Bring sufficient supply", done: false },
			{ id: "pd9", category: "finance", label: "Open Canadian bank account", detail: "RBC student account on arrival", done: false },
			{ id: "pd10", category: "finance", label: "Notify Ghana bank of travel", detail: "Avoid card blocks abroad", done: true },
			{ id: "pd11", category: "orientation", label: "Register for orientation", detail: "UBC international orientation", done: false },
			{ id: "pd12", category: "orientation", label: "Download campus map & apps", detail: "UBC app + transit app", done: false },
		],
	},
	{
		id: "app-7",
		appId: "APP-2026-1007",
		applicantName: "Akosua Asantewaa",
		email: "akosua.as@example.com",
		phone: "+233 24 332 8890",
		branch: "accra",
		university: "TU Munich",
		program: "MSc Aerospace Engineering",
		country: "Germany",
		degreeLevel: "Master's",
		assignedStaff: "Efua Owusu",
		assignedStaffEmail: "e.owusu@century-nit.com",
		stage: "Completed",
		status: "Accepted",
		submittedDate: "2026-06-20",
		fundingTrack: "Scholarship Track",
		notes: "Fully completed. Student arrived in Munich.",
		checklist: [
			{ id: "c1", label: "All Documents Verified", checked: true },
			{ id: "c2", label: "Visa Approved", checked: true },
			{ id: "c3", label: "Payment Settled", checked: true },
		],
		visaStage: "complete",
		visaInvoicePaid: true,
		visaCounselorNote: "German student visa approved. Travel completed.",
		paymentPlanId: "full",
		agencyStageIndex: 2,
		agencySettled: true,
		travelClearance: "cleared",
		preDepartureTasks: [
			{ id: "pd1", category: "travel", label: "Book flight to Munich", detail: "Departed Aug 15, 2026", done: true },
			{ id: "pd2", category: "travel", label: "Airport pickup arrangement", detail: "Arranged by university", done: true },
			{ id: "pd3", category: "accommodation", label: "Confirm student housing", detail: "TU Munich dormitory", done: true },
			{ id: "pd4", category: "accommodation", label: "Temporary hotel booking", detail: "Not needed", done: true },
			{ id: "pd5", category: "documents", label: "Carry original transcripts", detail: "In carry-on luggage", done: true },
			{ id: "pd6", category: "documents", label: "Print visa & admission letter", detail: "Hard copies for border control", done: true },
			{ id: "pd7", category: "health", label: "Travel insurance", detail: "Coverage secured", done: true },
			{ id: "pd8", category: "health", label: "Prescription medications", detail: "Brought sufficient supply", done: true },
			{ id: "pd9", category: "finance", label: "Open German bank account", detail: "Deutsche Bank student account", done: true },
			{ id: "pd10", category: "finance", label: "Notify Ghana bank of travel", detail: "Card travel notice set", done: true },
			{ id: "pd11", category: "orientation", label: "Register for orientation", detail: "TU Munich international orientation", done: true },
			{ id: "pd12", category: "orientation", label: "Download campus map & apps", detail: "TU Munich app + MVV app", done: true },
		],
	},
	{
		id: "app-8",
		appId: "APP-2026-1008",
		applicantName: "Selorm Agbeko",
		email: "selorm.agbeko@example.com",
		phone: "+233 24 221 5566",
		branch: "tema",
		university: "University of Amsterdam",
		program: "MSc Artificial Intelligence",
		country: "Netherlands",
		degreeLevel: "Master's",
		assignedStaff: "Kwame Agyeman",
		assignedStaffEmail: "k.agyeman@century-nit.com",
		stage: "Visa Processing",
		status: "Accepted",
		submittedDate: "2026-07-25",
		fundingTrack: "Self-Funded Track",
		notes: "Awaiting biometrics appointment at Netherlands Embassy.",
		checklist: [
			{ id: "c1", label: "Admission Letter Received", checked: true },
			{ id: "c2", label: "Passport Valid", checked: true },
			{ id: "c3", label: "Financial Proof Submitted", checked: true },
		],
		visaStage: "pending",
		visaInvoicePaid: true,
		visaCounselorNote: "Visa file opened. Awaiting biometrics appointment scheduling.",
	},
	{
		id: "app-9",
		appId: "APP-2026-1009",
		applicantName: "Esi Owusu-Afriyie",
		email: "esi.oa@example.com",
		phone: "+233 26 998 1122",
		branch: "cape-coast",
		university: "ETH Zurich",
		program: "MSc Environmental Engineering",
		country: "Switzerland",
		degreeLevel: "Master's",
		assignedStaff: "Abena Frimpong",
		assignedStaffEmail: "a.frimpong@century-nit.com",
		stage: "Payment Plan",
		status: "Accepted",
		submittedDate: "2026-07-18",
		fundingTrack: "Scholarship Track",
		notes: "Visa approved. Considering full payment for discount eligibility.",
		checklist: [
			{ id: "c1", label: "Visa Approved", checked: true },
			{ id: "c2", label: "Enrollment Letter", checked: true },
		],
		visaStage: "complete",
		visaInvoicePaid: true,
		visaCounselorNote: "Swiss student visa approved. Ready for payment plan.",
		paymentPlanId: "",
	},
	{
		id: "app-10",
		appId: "APP-2026-1010",
		applicantName: "Nii Ayi Mensah",
		email: "nii.ayi@example.com",
		phone: "+233 20 556 7788",
		branch: "accra",
		university: "University of Sydney",
		program: "Master of Public Health",
		country: "Australia",
		degreeLevel: "Master's",
		assignedStaff: "Efua Owusu",
		assignedStaffEmail: "e.owusu@century-nit.com",
		stage: "Travel Assistance",
		status: "Accepted",
		submittedDate: "2026-07-05",
		fundingTrack: "Hybrid Track",
		notes: "Most pre-departure tasks complete. Awaiting travel clearance.",
		checklist: [
			{ id: "c1", label: "Visa Stamped", checked: true },
			{ id: "c2", label: "OSHC Health Cover", checked: true },
			{ id: "c3", label: "Flight Booked", checked: true },
		],
		visaStage: "complete",
		visaInvoicePaid: true,
		visaCounselorNote: "Australia student visa (subclass 500) approved.",
		paymentPlanId: "installments",
		agencyStageIndex: 2,
		agencySettled: true,
		travelClearance: "pending",
		preDepartureTasks: [
			{ id: "pd1", category: "travel", label: "Book flight to Sydney", detail: "Departure Sep 5, 2026", done: true },
			{ id: "pd2", category: "travel", label: "Airport pickup arrangement", detail: "University shuttle booked", done: true },
			{ id: "pd3", category: "accommodation", label: "Confirm student housing", detail: "USyd residential college", done: true },
			{ id: "pd4", category: "accommodation", label: "Temporary hotel booking", detail: "Not needed", done: true },
			{ id: "pd5", category: "documents", label: "Carry original transcripts", detail: "In carry-on luggage", done: true },
			{ id: "pd6", category: "documents", label: "Print visa & admission letter", detail: "Hard copies for border control", done: true },
			{ id: "pd7", category: "health", label: "Travel insurance", detail: "OSHC coverage active", done: true },
			{ id: "pd8", category: "health", label: "Prescription medications", detail: "Bring sufficient supply", done: false },
			{ id: "pd9", category: "finance", label: "Open Australian bank account", detail: "CommBank student account on arrival", done: false },
			{ id: "pd10", category: "finance", label: "Notify Ghana bank of travel", detail: "Avoid card blocks abroad", done: true },
			{ id: "pd11", category: "orientation", label: "Register for orientation", detail: "USyd international orientation", done: false },
			{ id: "pd12", category: "orientation", label: "Download campus map & apps", detail: "USyd app + Opal transit app", done: false },
		],
	},
];

/** Compute realistic financial totals from shared fee constants. */
const PREMIUM_PKG = PUBLIC_SERVICE_PACKAGES.find((p) => p.id === "premium")?.price ?? 3000;
const SEED_SCHOOL_COUNT = 3;
const SEED_APP_INVOICE = APP_INVOICE_BASE + APP_INVOICE_PER_SCHOOL * SEED_SCHOOL_COUNT + APP_DOC_VERIFY_FEE + APP_MATCH_REVIEW_FEE;
const SEED_VISA_INVOICE = VISA_INVOICE_AMOUNT + VISA_BIOMETRICS_FEE + VISA_TRANSLATION_FEE;
const SEED_TOTAL = CONSULTATION_FEE_AMOUNT + SEED_APP_INVOICE + SEED_VISA_INVOICE + PREMIUM_PKG;

function seedFinancials(paidStages: "consultation" | "application" | "visa" | "agency_full" | "agency_half", plan: string) {
	const total = SEED_TOTAL;
	let paid = 0;
	switch (paidStages) {
		case "agency_full": paid = total; break;
		case "agency_half": paid = CONSULTATION_FEE_AMOUNT + SEED_APP_INVOICE + SEED_VISA_INVOICE + PREMIUM_PKG * 0.5; break;
		case "visa": paid = CONSULTATION_FEE_AMOUNT + SEED_APP_INVOICE + SEED_VISA_INVOICE; break;
		case "application": paid = CONSULTATION_FEE_AMOUNT + SEED_APP_INVOICE; break;
		case "consultation": paid = CONSULTATION_FEE_AMOUNT; break;
	}
	const outstanding = Math.max(0, total - paid);
	return {
		totalAmount: `$${total.toLocaleString()}`,
		paidAmount: `$${paid.toLocaleString()}`,
		outstanding: `$${outstanding.toLocaleString()}`,
		plan,
	};
}

export const SEED_APPLICANTS: MockApplicant[] = [
	{
		id: "applicant-1",
		applicantId: "APP-2026-9012",
		name: "Nana Adjoa Amponsah",
		email: "nana.amponsah@example.com",
		phone: "+233 24 770 0098",
		branch: "accra",
		assignedOfficer: "Efua Owusu",
		assignedOfficerEmail: "e.owusu@century-nit.com",
		country: "Canada",
		university: "University of Toronto",
		program: "Master of Science in Computer Science",
		package: "Premium Study Package",
		currentStage: "School Submission",
		stageNumber: 2,
		totalStages: 7,
		status: "Active",
		enrolledDate: "Fall 2026",
		financials: seedFinancials("application", "2 Installment Plan"),
		timeline: [
			{ stage: "1. Document Verification", status: "Completed", date: "2026-07-14" },
			{ stage: "2. School Submission", status: "In Progress", date: "Current" },
			{ stage: "3. Offer Letter Review", status: "Pending", date: "Upcoming" },
			{ stage: "4. Visa Processing", status: "Locked", date: "Upcoming" },
			{ stage: "5. Payment Plan", status: "Locked", date: "Upcoming" },
			{ stage: "6. Travel Assistance", status: "Locked", date: "Upcoming" },
			{ stage: "7. Completed", status: "Locked", date: "Upcoming" },
		],
		documents: [
			{ name: "University_Transcripts.pdf", category: "Academic", date: "2026-07-14", status: "Verified" },
			{ name: "Passport_Scan_Nana.pdf", category: "Identity", date: "2026-07-14", status: "Verified" },
			{ name: "IELTS_Score_7.5.pdf", category: "Language", date: "2026-07-16", status: "Verified" },
			{ name: "Bank_Statement_3Months.pdf", category: "Financial", date: "2026-07-21", status: "Pending Review" },
		],
		messages: [
			{ sender: "Efua Owusu (Consultant)", time: "Yesterday, 14:30", text: "Hi Nana, your transcripts were verified. Please upload your latest bank statement." },
			{ sender: "Nana Adjoa Amponsah (Applicant)", time: "Yesterday, 16:15", text: "Thanks Efua! I have just uploaded the 3-month bank statement." },
		],
		auditLog: [
			{ action: "Application Created", user: "System", timestamp: "2026-07-10 09:00" },
			{ action: "Documents Verified", user: "Efua Owusu", timestamp: "2026-07-14 11:30" },
			{ action: "Deposit Payment Verified ($1,500)", user: "Ama Serwaa Boateng (Finance)", timestamp: "2026-07-22 15:40" },
		],
	},
	{
		id: "applicant-2",
		applicantId: "APP-2026-9013",
		name: "Kofi Agyemang-Badu",
		email: "kofi.ab@example.com",
		phone: "+233 24 556 0991",
		branch: "accra",
		assignedOfficer: "Kwame Agyeman",
		assignedOfficerEmail: "k.agyeman@century-nit.com",
		country: "USA",
		university: "MIT",
		program: "PhD Robotics & Automation",
		package: "Premium Study Package",
		currentStage: "Visa Processing",
		stageNumber: 4,
		totalStages: 7,
		status: "Visa In Progress",
		enrolledDate: "Fall 2026",
		financials: seedFinancials("visa", "Full Payment"),
		timeline: [
			{ stage: "1. Document Verification", status: "Completed", date: "2026-07-05" },
			{ stage: "2. School Submission", status: "Completed", date: "2026-07-10" },
			{ stage: "3. Offer Letter Review", status: "Completed", date: "2026-07-15" },
			{ stage: "4. Visa Processing", status: "In Progress", date: "Current" },
			{ stage: "5. Payment Plan", status: "Pending", date: "Upcoming" },
			{ stage: "6. Travel Assistance", status: "Locked", date: "Upcoming" },
			{ stage: "7. Completed", status: "Locked", date: "Upcoming" },
		],
		documents: [
			{ name: "I-20_Certificate.pdf", category: "Immigration", date: "2026-07-18", status: "Verified" },
			{ name: "SEVIS_Fee_Receipt.pdf", category: "Immigration", date: "2026-07-18", status: "Verified" },
			{ name: "DS-160_Confirmation.pdf", category: "Immigration", date: "2026-07-20", status: "Verified" },
			{ name: "MIT_Admission_Letter.pdf", category: "Academic", date: "2026-07-15", status: "Verified" },
		],
		messages: [
			{ sender: "Kwame Agyeman (Consultant)", time: "2 days ago, 10:00", text: "Kofi, your biometrics appointment is confirmed for Aug 5 at the US Embassy." },
			{ sender: "Kofi Agyemang-Badu (Applicant)", time: "2 days ago, 12:30", text: "Great, thank you! I'll be there." },
		],
		auditLog: [
			{ action: "Application Created", user: "System", timestamp: "2026-07-01 08:00" },
			{ action: "Offer Letter Verified", user: "Kwame Agyeman", timestamp: "2026-07-15 14:00" },
			{ action: "Visa Invoice Paid ($1,000)", user: "Ama Serwaa Boateng (Finance)", timestamp: "2026-07-19 10:15" },
			{ action: "Biometrics Completed", user: "Kwame Agyeman", timestamp: "2026-07-28 09:00" },
		],
		visaStage: "biometrics",
		visaInvoicePaid: true,
		visaCounselorNote: "Biometrics completed at US Embassy Accra. Awaiting decision.",
	},
	{
		id: "applicant-3",
		applicantId: "APP-2026-9014",
		name: "Adwoa Nyamekye",
		email: "adwoa.ny@example.com",
		phone: "+233 20 887 2233",
		branch: "kumasi",
		assignedOfficer: "Kwame Agyeman",
		assignedOfficerEmail: "k.agyeman@century-nit.com",
		country: "UK",
		university: "University of Edinburgh",
		program: "MSc Data Science",
		package: "Premium Study Package",
		currentStage: "Payment Plan",
		stageNumber: 5,
		totalStages: 7,
		status: "Pending Payment",
		enrolledDate: "Fall 2026",
		financials: seedFinancials("visa", "2 Installment Plan"),
		timeline: [
			{ stage: "1. Document Verification", status: "Completed", date: "2026-06-20" },
			{ stage: "2. School Submission", status: "Completed", date: "2026-06-28" },
			{ stage: "3. Offer Letter Review", status: "Completed", date: "2026-07-05" },
			{ stage: "4. Visa Processing", status: "Completed", date: "2026-07-15" },
			{ stage: "5. Payment Plan", status: "In Progress", date: "Current" },
			{ stage: "6. Travel Assistance", status: "Pending", date: "Upcoming" },
			{ stage: "7. Completed", status: "Locked", date: "Upcoming" },
		],
		documents: [
			{ name: "CAS_Letter.pdf", category: "Immigration", date: "2026-07-10", status: "Verified" },
			{ name: "TB_Test_Certificate.pdf", category: "Health", date: "2026-07-08", status: "Verified" },
			{ name: "Visa_Approval_Letter.pdf", category: "Immigration", date: "2026-07-15", status: "Verified" },
		],
		messages: [
			{ sender: "Kwame Agyeman (Consultant)", time: "Today, 09:00", text: "Adwoa, your visa is approved! Please select a payment plan for the remaining fees." },
			{ sender: "Adwoa Nyamekye (Applicant)", time: "Today, 11:20", text: "I'm leaning towards installments. Can you confirm the schedule?" },
		],
		auditLog: [
			{ action: "Application Created", user: "System", timestamp: "2026-06-15 08:00" },
			{ action: "UK Visa Approved", user: "Kwame Agyeman", timestamp: "2026-07-15 16:00" },
			{ action: "Visa Invoice Paid ($1,000)", user: "Ama Serwaa Boateng (Finance)", timestamp: "2026-07-12 11:00" },
		],
		visaStage: "complete",
		visaInvoicePaid: true,
		visaCounselorNote: "UK visa approved. Ready for payment plan selection.",
		paymentPlanId: "installments",
	},
	{
		id: "applicant-4",
		applicantId: "APP-2026-9015",
		name: "Yaw Mensah-Darko",
		email: "yaw.md@example.com",
		phone: "+233 27 445 8810",
		branch: "takoradi",
		assignedOfficer: "Abena Frimpong",
		assignedOfficerEmail: "a.frimpong@century-nit.com",
		country: "Canada",
		university: "University of British Columbia",
		program: "Master of Engineering",
		package: "Premium Study Package",
		currentStage: "Travel Assistance",
		stageNumber: 6,
		totalStages: 7,
		status: "Active",
		enrolledDate: "Fall 2026",
		financials: seedFinancials("agency_full", "Full Payment"),
		timeline: [
			{ stage: "1. Document Verification", status: "Completed", date: "2026-06-10" },
			{ stage: "2. School Submission", status: "Completed", date: "2026-06-18" },
			{ stage: "3. Offer Letter Review", status: "Completed", date: "2026-06-25" },
			{ stage: "4. Visa Processing", status: "Completed", date: "2026-07-05" },
			{ stage: "5. Payment Plan", status: "Completed", date: "2026-07-12" },
			{ stage: "6. Travel Assistance", status: "In Progress", date: "Current" },
			{ stage: "7. Completed", status: "Pending", date: "Upcoming" },
		],
		documents: [
			{ name: "UBC_Admission_Letter.pdf", category: "Academic", date: "2026-06-25", status: "Verified" },
			{ name: "Canada_Study_Permit.pdf", category: "Immigration", date: "2026-07-05", status: "Verified" },
			{ name: "Passport_Stamped.pdf", category: "Identity", date: "2026-07-06", status: "Verified" },
		],
		messages: [
			{ sender: "Abena Frimpong (Consultant)", time: "Yesterday, 15:00", text: "Yaw, your flight to Vancouver needs booking. Shall I send you options?" },
			{ sender: "Yaw Mensah-Darko (Applicant)", time: "Yesterday, 17:30", text: "Yes please, looking for something around Sep 1." },
		],
		auditLog: [
			{ action: "Application Created", user: "System", timestamp: "2026-06-05 08:00" },
			{ action: "Canada Visa Approved", user: "Abena Frimpong", timestamp: "2026-07-05 14:00" },
			{ action: "Full Payment Received ($3,000)", user: "Ama Serwaa Boateng (Finance)", timestamp: "2026-07-12 10:00" },
			{ action: "Agency Deposit Confirmed", user: "Abena Frimpong", timestamp: "2026-07-15 09:00" },
		],
		visaStage: "complete",
		visaInvoicePaid: true,
		visaCounselorNote: "Canada study visa approved.",
		paymentPlanId: "full",
		agencyStageIndex: 1,
		agencySettled: false,
		travelClearance: "pending",
		preDepartureTasks: [
			{ id: "pd1", category: "travel", label: "Book flight to Vancouver", detail: "Target departure: Sep 1, 2026", done: false },
			{ id: "pd2", category: "travel", label: "Airport pickup arrangement", detail: "Coordinate with university", done: false },
			{ id: "pd3", category: "accommodation", label: "Confirm student housing", detail: "UBC residence application", done: true },
			{ id: "pd4", category: "accommodation", label: "Temporary hotel booking", detail: "First 3 nights if needed", done: false },
			{ id: "pd5", category: "documents", label: "Carry original transcripts", detail: "In carry-on luggage", done: false },
			{ id: "pd6", category: "documents", label: "Print visa & admission letter", detail: "Hard copies for border control", done: true },
			{ id: "pd7", category: "health", label: "Travel insurance", detail: "Coverage for first 90 days", done: false },
			{ id: "pd8", category: "health", label: "Prescription medications", detail: "Bring sufficient supply", done: false },
			{ id: "pd9", category: "finance", label: "Open Canadian bank account", detail: "RBC student account on arrival", done: false },
			{ id: "pd10", category: "finance", label: "Notify Ghana bank of travel", detail: "Avoid card blocks abroad", done: true },
			{ id: "pd11", category: "orientation", label: "Register for orientation", detail: "UBC international orientation", done: false },
			{ id: "pd12", category: "orientation", label: "Download campus map & apps", detail: "UBC app + transit app", done: false },
		],
	},
	{
		id: "applicant-5",
		applicantId: "APP-2026-9016",
		name: "Akosua Asantewaa",
		email: "akosua.as@example.com",
		phone: "+233 24 332 8890",
		branch: "accra",
		assignedOfficer: "Efua Owusu",
		assignedOfficerEmail: "e.owusu@century-nit.com",
		country: "Germany",
		university: "TU Munich",
		program: "MSc Aerospace Engineering",
		package: "Premium Study Package",
		currentStage: "Completed",
		stageNumber: 7,
		totalStages: 7,
		status: "Enrolled",
		enrolledDate: "Fall 2026",
		financials: seedFinancials("agency_full", "Full Payment"),
		timeline: [
			{ stage: "1. Document Verification", status: "Completed", date: "2026-05-10" },
			{ stage: "2. School Submission", status: "Completed", date: "2026-05-20" },
			{ stage: "3. Offer Letter Review", status: "Completed", date: "2026-05-28" },
			{ stage: "4. Visa Processing", status: "Completed", date: "2026-06-10" },
			{ stage: "5. Payment Plan", status: "Completed", date: "2026-06-20" },
			{ stage: "6. Travel Assistance", status: "Completed", date: "2026-07-15" },
			{ stage: "7. Completed", status: "Completed", date: "2026-08-15" },
		],
		documents: [
			{ name: "TU_Munich_Admission.pdf", category: "Academic", date: "2026-05-28", status: "Verified" },
			{ name: "German_Student_Visa.pdf", category: "Immigration", date: "2026-06-10", status: "Verified" },
			{ name: "Flight_Boarding_Pass.pdf", category: "Travel", date: "2026-08-15", status: "Verified" },
		],
		messages: [
			{ sender: "Akosua Asantewaa (Applicant)", time: "Aug 16, 10:00", text: "I've arrived in Munich safely! Thank you for all the support." },
			{ sender: "Efua Owusu (Consultant)", time: "Aug 16, 14:00", text: "Wonderful news, Akosua! Wishing you the best at TU Munich." },
		],
		auditLog: [
			{ action: "Application Created", user: "System", timestamp: "2026-05-05 08:00" },
			{ action: "German Visa Approved", user: "Efua Owusu", timestamp: "2026-06-10 12:00" },
			{ action: "Full Payment Received ($3,000)", user: "Ama Serwaa Boateng (Finance)", timestamp: "2026-06-20 10:00" },
			{ action: "Travel Clearance Granted", user: "Efua Owusu", timestamp: "2026-07-10 09:00" },
			{ action: "Case Completed - Student Arrived", user: "Efua Owusu", timestamp: "2026-08-15 18:00" },
		],
		visaStage: "complete",
		visaInvoicePaid: true,
		visaCounselorNote: "German student visa approved. Travel completed.",
		paymentPlanId: "full",
		agencyStageIndex: 2,
		agencySettled: true,
		travelClearance: "cleared",
		preDepartureTasks: [
			{ id: "pd1", category: "travel", label: "Book flight to Munich", detail: "Departed Aug 15, 2026", done: true },
			{ id: "pd2", category: "travel", label: "Airport pickup arrangement", detail: "Arranged by university", done: true },
			{ id: "pd3", category: "accommodation", label: "Confirm student housing", detail: "TU Munich dormitory", done: true },
			{ id: "pd4", category: "accommodation", label: "Temporary hotel booking", detail: "Not needed", done: true },
			{ id: "pd5", category: "documents", label: "Carry original transcripts", detail: "In carry-on luggage", done: true },
			{ id: "pd6", category: "documents", label: "Print visa & admission letter", detail: "Hard copies for border control", done: true },
			{ id: "pd7", category: "health", label: "Travel insurance", detail: "Coverage secured", done: true },
			{ id: "pd8", category: "health", label: "Prescription medications", detail: "Brought sufficient supply", done: true },
			{ id: "pd9", category: "finance", label: "Open German bank account", detail: "Deutsche Bank student account", done: true },
			{ id: "pd10", category: "finance", label: "Notify Ghana bank of travel", detail: "Card travel notice set", done: true },
			{ id: "pd11", category: "orientation", label: "Register for orientation", detail: "TU Munich international orientation", done: true },
			{ id: "pd12", category: "orientation", label: "Download campus map & apps", detail: "TU Munich app + MVV app", done: true },
		],
	},
];

export const SEED_INVOICES: Invoice[] = [
	{
		id: "inv-seed-1",
		invoiceNumber: "INV-2026-0001",
		applicantId: "APP-2026-9012",
		applicantName: "Nana Adjoa Amponsah",
		type: "Application",
		lines: [
			{ id: "pkg", label: "Premium Study Package", detail: "Full service including visa & housing", amount: PREMIUM_PKG },
			{ id: "per-school", label: `School submissions (${SEED_SCHOOL_COUNT})`, detail: `$${APP_INVOICE_PER_SCHOOL} per institution`, amount: APP_INVOICE_PER_SCHOOL * SEED_SCHOOL_COUNT },
			{ id: "verification", label: "Document verification", detail: "Credential authentication", amount: APP_DOC_VERIFY_FEE },
			{ id: "match-review", label: "Match review", detail: "Programme fit assessment", amount: APP_MATCH_REVIEW_FEE },
		],
		subtotal: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT,
		note: "Premium package - 2 installment plan.",
		status: "paid",
		issuedAt: "2026-07-22T15:40:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-08-05T15:40:00Z",
		payments: [
			{ id: "pay-seed-1a", amount: 1500, at: "2026-07-22T16:00:00Z", by: "Ama Serwaa Boateng", method: "Bank Transfer", reference: "SWIFT-ACC-558201" },
			{ id: "pay-seed-1b", amount: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT - 1500, at: "2026-07-28T10:30:00Z", by: "Ama Serwaa Boateng", method: "Visa Card", reference: "VISA-4112-XY902" },
		],
		history: [
			{ at: "2026-07-22T15:40:00Z", by: "Ama Serwaa Boateng", action: "Invoice issued" },
			{ at: "2026-07-22T16:00:00Z", by: "Ama Serwaa Boateng", action: "Part payment", detail: "Bank Transfer · SWIFT-ACC-558201" },
			{ at: "2026-07-28T10:30:00Z", by: "Ama Serwaa Boateng", action: "Paid in full", detail: "Visa Card · VISA-4112-XY902" },
		],
	},
	{
		id: "inv-seed-2",
		invoiceNumber: "INV-2026-0002",
		applicantId: "APP-2026-9012",
		applicantName: "Nana Adjoa Amponsah",
		type: "Visa",
		lines: [
			{ id: "visa-prep", label: "Visa file preparation", detail: "Forms, evidence pack & review", amount: VISA_INVOICE_AMOUNT },
			{ id: "biometrics", label: "Biometrics & appointment", detail: "Booking and support", amount: VISA_BIOMETRICS_FEE },
			{ id: "translation", label: "Document translation", detail: "Certified translations", amount: VISA_TRANSLATION_FEE },
		],
		subtotal: SEED_VISA_INVOICE,
		note: "Visa stage invoice - pending payment.",
		status: "issued",
		issuedAt: "2026-08-03T09:15:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-08-17T09:15:00Z",
	},
	{
		id: "inv-seed-3",
		invoiceNumber: "INV-2026-0003",
		applicantId: "APP-2026-9013",
		applicantName: "Kofi Agyemang-Badu",
		type: "Application",
		lines: [
			{ id: "pkg", label: "Premium Study Package", detail: "Full service including visa & housing", amount: PREMIUM_PKG },
			{ id: "per-school", label: "School submissions (3)", detail: `$${APP_INVOICE_PER_SCHOOL} per institution`, amount: APP_INVOICE_PER_SCHOOL * 3 },
			{ id: "verification", label: "Document verification", detail: "Credential authentication", amount: APP_DOC_VERIFY_FEE },
			{ id: "match-review", label: "Match review", detail: "Programme fit assessment", amount: APP_MATCH_REVIEW_FEE },
		],
		subtotal: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT,
		note: "Premium package - full payment.",
		status: "paid",
		issuedAt: "2026-07-01T11:00:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-07-15T11:00:00Z",
		payments: [
			{ id: "pay-seed-3a", amount: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT, at: "2026-07-02T14:20:00Z", by: "Ama Serwaa Boateng", method: "Mastercard", reference: "MC-5573-ZK411" },
		],
		history: [
			{ at: "2026-07-01T11:00:00Z", by: "Ama Serwaa Boateng", action: "Invoice issued" },
			{ at: "2026-07-02T14:20:00Z", by: "Ama Serwaa Boateng", action: "Paid in full", detail: "Mastercard · MC-5573-ZK411" },
		],
	},
	{
		id: "inv-seed-4",
		invoiceNumber: "INV-2026-0004",
		applicantId: "APP-2026-9013",
		applicantName: "Kofi Agyemang-Badu",
		type: "Visa",
		lines: [
			{ id: "visa-prep", label: "Visa file preparation", detail: "Forms, evidence pack & review", amount: VISA_INVOICE_AMOUNT },
			{ id: "biometrics", label: "Biometrics & appointment", detail: "Booking and support", amount: VISA_BIOMETRICS_FEE },
			{ id: "translation", label: "Document translation", detail: "Certified translations", amount: VISA_TRANSLATION_FEE },
		],
		subtotal: SEED_VISA_INVOICE,
		note: "Visa stage invoice - paid via mobile money.",
		status: "paid",
		issuedAt: "2026-07-18T08:00:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-08-01T08:00:00Z",
		payments: [
			{ id: "pay-seed-4a", amount: 500, at: "2026-07-19T10:15:00Z", by: "Ama Serwaa Boateng", method: "Mobile Money", reference: "MOMO-0244-9981" },
			{ id: "pay-seed-4b", amount: SEED_VISA_INVOICE - 500, at: "2026-07-22T13:45:00Z", by: "Ama Serwaa Boateng", method: "Bank Transfer", reference: "SWIFT-ACC-771034" },
		],
		history: [
			{ at: "2026-07-18T08:00:00Z", by: "Ama Serwaa Boateng", action: "Invoice issued" },
			{ at: "2026-07-19T10:15:00Z", by: "Ama Serwaa Boateng", action: "Part payment", detail: "Mobile Money · MOMO-0244-9981" },
			{ at: "2026-07-22T13:45:00Z", by: "Ama Serwaa Boateng", action: "Paid in full", detail: "Bank Transfer · SWIFT-ACC-771034" },
		],
	},
	{
		id: "inv-seed-5",
		invoiceNumber: "INV-2026-0005",
		applicantId: "APP-2026-9014",
		applicantName: "Adwoa Nyamekye",
		type: "Application",
		lines: [
			{ id: "pkg", label: "Premium Study Package", detail: "Full service including visa & housing", amount: PREMIUM_PKG },
			{ id: "per-school", label: "School submissions (3)", detail: `$${APP_INVOICE_PER_SCHOOL} per institution`, amount: APP_INVOICE_PER_SCHOOL * 3 },
			{ id: "verification", label: "Document verification", detail: "Credential authentication", amount: APP_DOC_VERIFY_FEE },
			{ id: "match-review", label: "Match review", detail: "Programme fit assessment", amount: APP_MATCH_REVIEW_FEE },
		],
		subtotal: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT,
		note: "Premium package - 2 installment plan.",
		status: "paid",
		issuedAt: "2026-06-25T09:00:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-07-09T09:00:00Z",
		payments: [
			{ id: "pay-seed-5a", amount: 2000, at: "2026-06-26T11:30:00Z", by: "Ama Serwaa Boateng", method: "Visa Card", reference: "VISA-4022-PQ771" },
			{ id: "pay-seed-5b", amount: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT - 2000, at: "2026-07-03T15:00:00Z", by: "Ama Serwaa Boateng", method: "Direct Debit", reference: "SEPA-DD-992011" },
		],
		history: [
			{ at: "2026-06-25T09:00:00Z", by: "Ama Serwaa Boateng", action: "Invoice issued" },
			{ at: "2026-06-26T11:30:00Z", by: "Ama Serwaa Boateng", action: "Part payment", detail: "Visa Card · VISA-4022-PQ771" },
			{ at: "2026-07-03T15:00:00Z", by: "Ama Serwaa Boateng", action: "Paid in full", detail: "Direct Debit · SEPA-DD-992011" },
		],
	},
	{
		id: "inv-seed-6",
		invoiceNumber: "INV-2026-0006",
		applicantId: "APP-2026-9014",
		applicantName: "Adwoa Nyamekye",
		type: "Visa",
		lines: [
			{ id: "visa-prep", label: "Visa file preparation", detail: "Forms, evidence pack & review", amount: VISA_INVOICE_AMOUNT },
			{ id: "biometrics", label: "Biometrics & appointment", detail: "Booking and support", amount: VISA_BIOMETRICS_FEE },
			{ id: "translation", label: "Document translation", detail: "Certified translations", amount: VISA_TRANSLATION_FEE },
		],
		subtotal: SEED_VISA_INVOICE,
		note: "Visa stage invoice - paid in full.",
		status: "paid",
		issuedAt: "2026-07-08T10:00:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-07-22T10:00:00Z",
		payments: [
			{ id: "pay-seed-6a", amount: SEED_VISA_INVOICE, at: "2026-07-12T11:00:00Z", by: "Ama Serwaa Boateng", method: "Bank Transfer", reference: "SWIFT-ACC-339872" },
		],
		history: [
			{ at: "2026-07-08T10:00:00Z", by: "Ama Serwaa Boateng", action: "Invoice issued" },
			{ at: "2026-07-12T11:00:00Z", by: "Ama Serwaa Boateng", action: "Paid in full", detail: "Bank Transfer · SWIFT-ACC-339872" },
		],
	},
	{
		id: "inv-seed-7",
		invoiceNumber: "INV-2026-0007",
		applicantId: "APP-2026-9015",
		applicantName: "Yaw Mensah-Darko",
		type: "Application",
		lines: [
			{ id: "pkg", label: "Premium Study Package", detail: "Full service including visa & housing", amount: PREMIUM_PKG },
			{ id: "per-school", label: "School submissions (3)", detail: `$${APP_INVOICE_PER_SCHOOL} per institution`, amount: APP_INVOICE_PER_SCHOOL * 3 },
			{ id: "verification", label: "Document verification", detail: "Credential authentication", amount: APP_DOC_VERIFY_FEE },
			{ id: "match-review", label: "Match review", detail: "Programme fit assessment", amount: APP_MATCH_REVIEW_FEE },
		],
		subtotal: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT,
		note: "Premium package - full payment.",
		status: "paid",
		issuedAt: "2026-06-15T09:00:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-06-29T09:00:00Z",
		payments: [
			{ id: "pay-seed-7a", amount: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT, at: "2026-06-16T12:00:00Z", by: "Ama Serwaa Boateng", method: "Mastercard", reference: "MC-5573-AB008" },
		],
		history: [
			{ at: "2026-06-15T09:00:00Z", by: "Ama Serwaa Boateng", action: "Invoice issued" },
			{ at: "2026-06-16T12:00:00Z", by: "Ama Serwaa Boateng", action: "Paid in full", detail: "Mastercard · MC-5573-AB008" },
		],
	},
	{
		id: "inv-seed-8",
		invoiceNumber: "INV-2026-0008",
		applicantId: "APP-2026-9015",
		applicantName: "Yaw Mensah-Darko",
		type: "Visa",
		lines: [
			{ id: "visa-prep", label: "Visa file preparation", detail: "Forms, evidence pack & review", amount: VISA_INVOICE_AMOUNT },
			{ id: "biometrics", label: "Biometrics & appointment", detail: "Booking and support", amount: VISA_BIOMETRICS_FEE },
			{ id: "translation", label: "Document translation", detail: "Certified translations", amount: VISA_TRANSLATION_FEE },
		],
		subtotal: SEED_VISA_INVOICE,
		note: "Visa stage invoice - paid via card.",
		status: "paid",
		issuedAt: "2026-07-01T08:00:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-07-15T08:00:00Z",
		payments: [
			{ id: "pay-seed-8a", amount: SEED_VISA_INVOICE, at: "2026-07-05T10:00:00Z", by: "Ama Serwaa Boateng", method: "Visa Card", reference: "VISA-4022-MN330" },
		],
		history: [
			{ at: "2026-07-01T08:00:00Z", by: "Ama Serwaa Boateng", action: "Invoice issued" },
			{ at: "2026-07-05T10:00:00Z", by: "Ama Serwaa Boateng", action: "Paid in full", detail: "Visa Card · VISA-4022-MN330" },
		],
	},
	{
		id: "inv-seed-9",
		invoiceNumber: "INV-2026-0009",
		applicantId: "APP-2026-9016",
		applicantName: "Akosua Asantewaa",
		type: "Application",
		lines: [
			{ id: "pkg", label: "Premium Study Package", detail: "Full service including visa & housing", amount: PREMIUM_PKG },
			{ id: "per-school", label: "School submissions (3)", detail: `$${APP_INVOICE_PER_SCHOOL} per institution`, amount: APP_INVOICE_PER_SCHOOL * 3 },
			{ id: "verification", label: "Document verification", detail: "Credential authentication", amount: APP_DOC_VERIFY_FEE },
			{ id: "match-review", label: "Match review", detail: "Programme fit assessment", amount: APP_MATCH_REVIEW_FEE },
		],
		subtotal: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT,
		note: "Premium package - full payment.",
		status: "paid",
		issuedAt: "2026-05-10T09:00:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-05-24T09:00:00Z",
		payments: [
			{ id: "pay-seed-9a", amount: PREMIUM_PKG + SEED_APP_INVOICE - CONSULTATION_FEE_AMOUNT, at: "2026-05-12T14:00:00Z", by: "Ama Serwaa Boateng", method: "Bank Transfer", reference: "SWIFT-ACC-110045" },
		],
		history: [
			{ at: "2026-05-10T09:00:00Z", by: "Ama Serwaa Boateng", action: "Invoice issued" },
			{ at: "2026-05-12T14:00:00Z", by: "Ama Serwaa Boateng", action: "Paid in full", detail: "Bank Transfer · SWIFT-ACC-110045" },
		],
	},
	{
		id: "inv-seed-10",
		invoiceNumber: "INV-2026-0010",
		applicantId: "APP-2026-9016",
		applicantName: "Akosua Asantewaa",
		type: "Visa",
		lines: [
			{ id: "visa-prep", label: "Visa file preparation", detail: "Forms, evidence pack & review", amount: VISA_INVOICE_AMOUNT },
			{ id: "biometrics", label: "Biometrics & appointment", detail: "Booking and support", amount: VISA_BIOMETRICS_FEE },
			{ id: "translation", label: "Document translation", detail: "Certified translations", amount: VISA_TRANSLATION_FEE },
		],
		subtotal: SEED_VISA_INVOICE,
		note: "Visa stage invoice - paid via mobile money.",
		status: "paid",
		issuedAt: "2026-06-01T08:00:00Z",
		issuedBy: "Ama Serwaa Boateng",
		dueAt: "2026-06-15T08:00:00Z",
		payments: [
			{ id: "pay-seed-10a", amount: SEED_VISA_INVOICE, at: "2026-06-05T11:00:00Z", by: "Ama Serwaa Boateng", method: "Mobile Money", reference: "MOMO-0712-5543" },
		],
		history: [
			{ at: "2026-06-01T08:00:00Z", by: "Ama Serwaa Boateng", action: "Invoice issued" },
			{ at: "2026-06-05T11:00:00Z", by: "Ama Serwaa Boateng", action: "Paid in full", detail: "Mobile Money · MOMO-0712-5543" },
		],
	},
];

/* ─── Persistence ─── */

const OPS_STATE_KEY = "century-nit-ops-state";

/** Bump when seed data or shape changes so stale saved state is discarded. */
const OPS_STATE_VERSION = 21;

const SEED_PACKAGES: ServicePackage[] = PUBLIC_SERVICE_PACKAGES.map((p) => ({
	id: p.id,
	name: p.name,
	price: p.price,
	description: p.description,
	services: p.features,
	active: true,
}));

/**
 * Ticket vocabulary lives in `century-nit-core` because both apps speak it:
 * ops triages tickets, and the applicant portal raises and replies to the
 * `external` ones. Re-exported here so ops code keeps importing it from the
 * store it works with.
 */
import type {
	TicketSource,
	TicketStatus,
	TicketPriority,
	TicketCategory,
	TicketMessage,
	InternalTicket,
} from "century-nit-core/ops";
export type {
	TicketSource,
	TicketStatus,
	TicketPriority,
	TicketCategory,
	TicketMessage,
	InternalTicket,
};

export type MarketingCampaign = {
	id: string;
	name: string;
	type: "Email" | "SMS";
	audience: string;
	status: "Draft" | "Sent";
	sentAt?: string;
	sentBy?: string;
	subject?: string;
	body: string;
	templateId?: string;
};

export type MailingListContact = {
	id: string;
	name: string;
	email: string;
	addedAt: string;
};

export type MailingList = {
	id: string;
	name: string;
	description: string;
	recipientCount: number;
	contacts: MailingListContact[];
	createdAt: string;
};

export type EmailTemplate = {
	id: string;
	name: string;
	type: "Email" | "SMS";
	subject: string;
	header: string;
	body: string;
	footer: string;
	custom: boolean;
	createdAt: string;
	createdBy: string;
};

export const SEED_TICKETS: InternalTicket[] = [
	{
		id: "tkt-1",
		ref: "TKT-2026-0001",
		source: "internal",
		title: "Cannot assign consultant to case #402",
		description: "The dropdown is disabled when I try to select a consultant.",
		category: "Technical",
		status: "Open",
		priority: "High",
		createdBy: "Adjoa Mensah-Bonsu",
		createdAt: "2026-08-05T10:00:00Z",
		updatedAt: "2026-08-05T10:00:00Z",
		assignedTo: "",
		assignedToEmail: "",
		escalatedToAdmin: false,
		messages: [],
	},
	{
		id: "tkt-2",
		ref: "TKT-2026-0002",
		source: "internal",
		title: "Update UK university list",
		description: "Add the new partner universities for the upcoming term.",
		category: "Other",
		status: "In Progress",
		priority: "Medium",
		createdBy: "Kojo Asante",
		createdAt: "2026-08-04T14:30:00Z",
		updatedAt: "2026-08-04T14:30:00Z",
		assignedTo: "Efua Owusu",
		assignedToEmail: "e.owusu@century-nit.com",
		escalatedToAdmin: false,
		messages: [],
	},
	{
		id: "tkt-3",
		ref: "TKT-2026-0003",
		source: "external",
		title: "Payment went through but the portal still shows unpaid",
		description:
			"I paid the application invoice yesterday with mobile money and received a confirmation SMS, but my dashboard still says the invoice is outstanding.",
		category: "Billing",
		status: "Open",
		priority: "Urgent",
		createdBy: "Nana Adjoa Amponsah",
		createdByEmail: "nana.amponsah@example.com",
		applicantRef: "APP-2026-9012",
		createdAt: "2026-08-06T08:12:00Z",
		updatedAt: "2026-08-06T08:12:00Z",
		assignedTo: "",
		assignedToEmail: "",
		escalatedToAdmin: false,
		messages: [
			{
				id: "m1",
				author: "Nana Adjoa Amponsah",
				role: "applicant",
				body: "I paid yesterday with mobile money and got a confirmation SMS, but the dashboard still shows the invoice as outstanding. Reference on the SMS is MM-77413902.",
				at: "2026-08-06T08:12:00Z",
			},
		],
	},
	{
		id: "tkt-4",
		ref: "TKT-2026-0004",
		source: "external",
		title: "Cannot upload my IELTS result",
		description: "The upload keeps failing when I choose my IELTS PDF. Other documents uploaded fine.",
		category: "Documents",
		status: "In Progress",
		priority: "High",
		createdBy: "Kwesi Ofori-Atta",
		createdByEmail: "kwesi.oa@example.com",
		applicantRef: "CNS-2026-002",
		createdAt: "2026-08-05T16:40:00Z",
		updatedAt: "2026-08-06T09:05:00Z",
		assignedTo: "Efua Owusu",
		assignedToEmail: "e.owusu@century-nit.com",
		escalatedToAdmin: false,
		messages: [
			{
				id: "m1",
				author: "Kwesi Ofori-Atta",
				role: "applicant",
				body: "The upload keeps failing when I choose my IELTS PDF. Other documents uploaded fine.",
				at: "2026-08-05T16:40:00Z",
			},
			{
				id: "m2",
				author: "Efua Owusu",
				role: "staff",
				body: "Thanks for flagging this — could you tell me the file size? Anything over 10MB is rejected silently, which we are fixing.",
				at: "2026-08-06T09:05:00Z",
			},
		],
	},
	{
		id: "tkt-5",
		ref: "TKT-2026-0005",
		source: "external",
		title: "Requesting a change of consultation date",
		description: "Something came up at work and I cannot make Thursday. Could we move to the following week?",
		category: "Application",
		status: "Resolved",
		priority: "Low",
		createdBy: "Ama Serwaa Adjei",
		createdByEmail: "ama.adjei@example.com",
		applicantRef: "CNS-2026-001",
		createdAt: "2026-08-03T11:20:00Z",
		updatedAt: "2026-08-04T10:02:00Z",
		assignedTo: "Kojo Asante",
		assignedToEmail: "k.asante@century-nit.com",
		escalatedToAdmin: false,
		messages: [
			{
				id: "m1",
				author: "Ama Serwaa Adjei",
				role: "applicant",
				body: "Something came up at work and I cannot make Thursday. Could we move to the following week?",
				at: "2026-08-03T11:20:00Z",
			},
			{
				id: "m2",
				author: "Kojo Asante",
				role: "staff",
				body: "No problem at all — I have moved you to Tuesday 10:00 at the Accra branch. You will see the new time on your dashboard.",
				at: "2026-08-04T10:02:00Z",
			},
		],
	},
	/* The demo applicant (Google sign-in → Alex Rivera). Seeded so the portal's
	   Support page and the chat's Support tab open with real history rather
	   than an empty shell. */
	{
		id: "tkt-9",
		ref: "TKT-2026-0009",
		source: "external",
		title: "Australia deadline — will my file be ready in time?",
		description:
			"My shortlist is all Australian universities and the intake closes at the end of September. Is my file on track, or should I add a backup?",
		category: "Application",
		status: "Open",
		priority: "High",
		createdBy: "Efua Akosua Boateng",
		createdByEmail: "efua.boateng@example.com",
		applicantRef: "CNS-2026-003",
		createdAt: "2026-08-06T14:08:00Z",
		updatedAt: "2026-08-06T14:08:00Z",
		assignedTo: "",
		assignedToEmail: "",
		escalatedToAdmin: false,
		messages: [
			{
				id: "m1",
				author: "Efua Akosua Boateng",
				role: "applicant",
				body: "My shortlist is all Australian universities and the intake closes at the end of September. Is my file on track, or should I add a backup?",
				at: "2026-08-06T14:08:00Z",
			},
		],
	},
	{
		id: "tkt-10",
		ref: "TKT-2026-0010",
		source: "external",
		title: "Receipt needed for my sponsor",
		description:
			"My uncle is sponsoring me and his bank wants an official receipt for the consultation fee I already paid. Can you send one with the company letterhead?",
		category: "Billing",
		status: "Waiting",
		priority: "Medium",
		createdBy: "Kofi Agyemang-Badu",
		createdByEmail: "kofi.ab@example.com",
		applicantRef: "APP-2026-4471",
		createdAt: "2026-08-04T10:55:00Z",
		updatedAt: "2026-08-05T09:12:00Z",
		assignedTo: "Ama Serwaa Boateng",
		assignedToEmail: "a.serwaa@century-nit.com",
		escalatedToAdmin: false,
		messages: [
			{
				id: "m1",
				author: "Kofi Agyemang-Badu",
				role: "applicant",
				body: "My uncle is sponsoring me and his bank wants an official receipt for the consultation fee I already paid. Can you send one with the company letterhead?",
				at: "2026-08-04T10:55:00Z",
			},
			{
				id: "m2",
				author: "Ama Serwaa Boateng",
				role: "staff",
				body: "Of course. I have issued a letterheaded receipt for the Stage I fee — could you confirm the exact name and address the bank needs it addressed to?",
				at: "2026-08-05T09:12:00Z",
			},
		],
	},
	{
		id: "tkt-11",
		ref: "TKT-2026-0011",
		source: "external",
		title: "Portal signed me out mid-form",
		description:
			"I was halfway through the assessment when the portal signed me out and I lost everything I had typed. It has happened twice now.",
		category: "Technical",
		status: "In Progress",
		priority: "Urgent",
		createdBy: "Nana Adjoa Amponsah",
		createdByEmail: "nana.amponsah@example.com",
		applicantRef: "APP-2026-9012",
		createdAt: "2026-08-06T19:30:00Z",
		updatedAt: "2026-08-07T07:45:00Z",
		assignedTo: "",
		assignedToEmail: "",
		escalatedToAdmin: true,
		messages: [
			{
				id: "m1",
				author: "Nana Adjoa Amponsah",
				role: "applicant",
				body: "I was halfway through the assessment when the portal signed me out and I lost everything I had typed. It has happened twice now.",
				at: "2026-08-06T19:30:00Z",
			},
			{
				id: "m2",
				author: "Adjoa Mensah-Bonsu",
				role: "staff",
				body: "That should not happen and I am sorry you lost the work. I have escalated this to our platform team as a priority — I will come back to you as soon as I have a fix or a workaround.",
				at: "2026-08-07T07:45:00Z",
			},
		],
	},
	{
		id: "tkt-6",
		ref: "TKT-2026-0006",
		source: "external",
		title: "Which English test do you accept for Canada?",
		description:
			"I have an IELTS Academic result from 2024. Is that still valid for the Canadian universities on my shortlist, or do I need to resit?",
		category: "Application",
		status: "Resolved",
		priority: "Low",
		createdBy: "Alex Rivera",
		createdByEmail: "alex.rivera@gmail.com",
		applicantRef: "CNT-CONS-673192",
		createdAt: "2026-07-28T09:15:00Z",
		updatedAt: "2026-07-28T15:40:00Z",
		assignedTo: "Efua Owusu",
		assignedToEmail: "e.owusu@century-nit.com",
		escalatedToAdmin: false,
		messages: [
			{
				id: "m1",
				author: "Alex Rivera",
				role: "applicant",
				body: "I have an IELTS Academic result from 2024. Is that still valid for the Canadian universities on my shortlist, or do I need to resit?",
				at: "2026-07-28T09:15:00Z",
			},
			{
				id: "m2",
				author: "Efua Owusu",
				role: "staff",
				body: "IELTS Academic is valid for two years from the test date, so a 2024 result is still accepted for the Fall 2026 intake. Upload the certificate to your Documents vault and I will verify it against each university's minimum.",
				at: "2026-07-28T15:40:00Z",
			},
		],
	},
	{
		id: "tkt-7",
		ref: "TKT-2026-0007",
		source: "external",
		title: "Transcript upload keeps spinning",
		description:
			"I have tried thrice to upload my degree transcript. The progress bar reaches the end and then resets with no error message.",
		category: "Documents",
		status: "In Progress",
		priority: "High",
		createdBy: "Alex Rivera",
		createdByEmail: "alex.rivera@gmail.com",
		applicantRef: "CNT-CONS-673192",
		createdAt: "2026-08-05T13:02:00Z",
		updatedAt: "2026-08-06T08:30:00Z",
		assignedTo: "Kojo Asante",
		assignedToEmail: "k.asante@century-nit.com",
		escalatedToAdmin: false,
		messages: [
			{
				id: "m1",
				author: "Alex Rivera",
				role: "applicant",
				body: "I have tried thrice to upload my degree transcript. The progress bar reaches the end and then resets with no error message.",
				at: "2026-08-05T13:02:00Z",
			},
			{
				id: "m2",
				author: "Kojo Asante",
				role: "staff",
				body: "Sorry about that — I have raised it with our platform team. In the meantime, could you send the transcript to documents@centurynit.com and I will attach it to your file so nothing is held up?",
				at: "2026-08-06T08:30:00Z",
			},
		],
	},
	{
		id: "tkt-8",
		ref: "TKT-2026-0008",
		source: "external",
		title: "Can I add a second destination to my shortlist?",
		description:
			"My consultation focused on Canada, but I would like to add the UK as a backup. Is it too late to change?",
		category: "Application",
		status: "Open",
		priority: "Medium",
		createdBy: "Alex Rivera",
		createdByEmail: "alex.rivera@gmail.com",
		applicantRef: "CNT-CONS-673192",
		createdAt: "2026-08-06T17:45:00Z",
		updatedAt: "2026-08-06T17:45:00Z",
		assignedTo: "",
		assignedToEmail: "",
		escalatedToAdmin: false,
		messages: [
			{
				id: "m1",
				author: "Alex Rivera",
				role: "applicant",
				body: "My consultation focused on Canada, but I would like to add the UK as a backup. Is it too late to change?",
				at: "2026-08-06T17:45:00Z",
			},
		],
	},
];

export const SEED_CAMPAIGNS: MarketingCampaign[] = [
	{ id: "cmp-1", name: "Fall Intake Newsletter", type: "Email", audience: "All Leads", status: "Sent", sentAt: "2026-08-01T09:00:00Z", sentBy: "Adjoa Mensah-Bonsu", subject: "Fall 2026 Intake - New Programs Available", body: "Dear {{name}},\n\nWe are excited to announce new programs for the Fall 2026 intake...", templateId: "tpl-email-newsletter" },
	{ id: "cmp-2", name: "Missing Documents Reminder", type: "SMS", audience: "Applicants - Missing Docs", status: "Sent", sentAt: "2026-08-03T11:00:00Z", sentBy: "Kojo Asante", body: "Hi {{name}}, your application is missing documents. Please upload them by Friday.", templateId: "tpl-sms-reminder" },
];

export const SEED_MAILING_LISTS: MailingList[] = [
	{ id: "ml-1", name: "All Leads", description: "Every lead in the CRM pipeline", recipientCount: 0, contacts: [], createdAt: "2026-07-15T10:00:00Z" },
	{ id: "ml-2", name: "Active Applicants", description: "Applicants with an open application", recipientCount: 0, contacts: [], createdAt: "2026-07-15T10:00:00Z" },
	{ id: "ml-3", name: "Visa Stage Applicants", description: "Applicants currently in visa processing", recipientCount: 0, contacts: [], createdAt: "2026-07-20T14:00:00Z" },
	{ id: "ml-4", name: "Missing Documents", description: "Applicants with outstanding document uploads", recipientCount: 0, contacts: [], createdAt: "2026-07-22T09:00:00Z" },
];

const SEED_EMAIL_TEMPLATES: EmailTemplate[] = [
	{
		id: "tpl-email-newsletter",
		name: "Intake Newsletter",
		type: "Email",
		subject: "New Programs Available for {{intake}}",
		header: "New Programs, New Opportunities",
		body: `<p>Dear {{name}},</p>
<p>We are excited to announce new partner universities and programs for the upcoming <strong>{{intake}}</strong> intake. Whether you are interested in business, engineering, health sciences, or the arts, we have new pathways to help you reach your study abroad goals.</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:0.75rem 1rem;background:#f9fafb;font-weight:600;border-bottom:1px solid #e5e7eb;">\u2713  12 new university partnerships</td></tr>
<tr><td style="padding:0.75rem 1rem;background:#f9fafb;font-weight:600;border-bottom:1px solid #e5e7eb;">\u2713  Expanded scholarships up to $5,000</td></tr>
<tr><td style="padding:0.75rem 1rem;background:#f9fafb;font-weight:600;">\u2713  New STEM programs with extended work permits</td></tr>
</table>
<p style="margin-top:1.5rem;">Log in to your portal to explore the full catalog and update your preferences.</p>
<p style="margin-top:1.5rem;">Best regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "You are receiving this email because you are registered with Century NIT. To unsubscribe, reply with STOP.",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-reminder",
		name: "Document Reminder",
		type: "Email",
		subject: "Action Required: Missing Documents for Your Application",
		header: "Your Application Needs Attention",
		body: `<p>Dear {{name}},</p>
<p>Our records show that your application is currently missing one or more required documents. To avoid delays in processing, please log in to your portal and upload the following:</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;border:1px solid #fca5a5;border-radius:8px;overflow:hidden;">
<tr><td style="padding:0.6rem 1rem;background:#fef2f2;border-bottom:1px solid #fca5a5;">\u26a0  Academic transcripts (sealed and stamped)</td></tr>
<tr><td style="padding:0.6rem 1rem;background:#fef2f2;border-bottom:1px solid #fca5a5;">\u26a0  Clear passport copy (bio-data page)</td></tr>
<tr><td style="padding:0.6rem 1rem;background:#fef2f2;">\u26a0  Proof of funds (bank statement, last 3 months)</td></tr>
</table>
<p>Your application cannot proceed to the next stage until these documents are received. If you have already uploaded them, please disregard this message.</p>
<p style="margin-top:1rem;padding:0.75rem 1rem;background:#eff6ff;border-radius:6px;border:1px solid #bfdbfe;">Need help? Reply to this email or call us at <strong>+233 30 123 4567</strong>.</p>
<p style="margin-top:1.5rem;">Regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "This is an automated reminder. Please do not reply directly if your documents are already uploaded.",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-deadline",
		name: "Deadline Alert",
		type: "Email",
		subject: "Application Deadline Approaching — {{date}}",
		header: "Deadline Reminder",
		body: `<p>Dear {{name}},</p>
<p>This is a friendly reminder that your application deadline is approaching on <strong style="color:#dc2626;">{{date}}</strong>. Please ensure that all required materials — including documents, payments, and forms — are submitted before this date.</p>
<p>Late submissions may not be considered for your preferred intake. If you anticipate any delays, contact your assigned consultant as soon as possible to discuss your options.</p>
<p>You can track your application status and outstanding items in your portal.</p>
<p style="margin-top:1.5rem;">Regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "Century NIT  \u00b7  Your Study Abroad Partner",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-welcome",
		name: "Welcome Email",
		type: "Email",
		subject: "Welcome to Century NIT — Your Journey Starts Here",
		header: "Welcome Aboard!",
		body: `<p>Dear {{name}},</p>
<p>Welcome to <strong>Century NIT</strong>! We are thrilled to have you join our community of ambitious students pursuing their education abroad.</p>
<p>Your dedicated consultant will reach out within 24 hours to schedule your first consultation. During this session, we will:</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;">
<tr><td style="padding:0.4rem 0;color:#3b82f6;">\u2713</td><td style="padding:0.4rem 0;">Assess your academic background and career goals</td></tr>
<tr><td style="padding:0.4rem 0;color:#3b82f6;">\u2713</td><td style="padding:0.4rem 0;">Recommend universities and programs tailored to you</td></tr>
<tr><td style="padding:0.4rem 0;color:#3b82f6;">\u2713</td><td style="padding:0.4rem 0;">Outline a personalized application timeline</td></tr>
<tr><td style="padding:0.4rem 0;color:#3b82f6;">\u2713</td><td style="padding:0.4rem 0;">Discuss scholarship and funding opportunities</td></tr>
</table>
<p>In the meantime, feel free to explore your portal where you can browse programs, check requirements, and start your document checklist.</p>
<p style="margin-top:1.5rem;">Warm regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "Century NIT  \u00b7  Your Study Abroad Partner  \u00b7  century-nit.com",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-visa",
		name: "Visa Preparation",
		type: "Email",
		subject: "Visa Interview Preparation — Next Steps",
		header: "Your Visa Appointment Is Approaching",
		body: `<p>Dear {{name}},</p>
<p>Your visa appointment has been scheduled and it is time to prepare. Your consultant has uploaded your visa support documents to the portal. Please review them carefully.</p>
<p style="font-weight:600;margin-top:1rem;">Here is what you need to do before your appointment:</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:0.6rem 1rem;border-bottom:1px solid #e5e7eb;">\u2713  Print your visa letter and all supporting documents</td></tr>
<tr><td style="padding:0.6rem 1rem;border-bottom:1px solid #e5e7eb;">\u2713  Prepare your biometrics confirmation slip</td></tr>
<tr><td style="padding:0.6rem 1rem;border-bottom:1px solid #e5e7eb;">\u2713  Practice common interview questions (guide in portal)</td></tr>
<tr><td style="padding:0.6rem 1rem;border-bottom:1px solid #e5e7eb;">\u2713  Dress professionally and arrive 30 minutes early</td></tr>
<tr><td style="padding:0.6rem 1rem;">\u2713  Carry original passport and all originals of uploaded documents</td></tr>
</table>
<p>Your consultant is available for a mock interview session if you would like to practice. Simply book a slot through your portal.</p>
<p style="margin-top:1rem;padding:0.75rem 1rem;background:#ecfdf5;border-radius:6px;border:1px solid #a7f3d0;">You have got this \u2014 we are with you every step of the way.</p>
<p style="margin-top:1.5rem;">Best regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "Century NIT  \u00b7  Visa Support Team",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-email-payment",
		name: "Payment Confirmation",
		type: "Email",
		subject: "Payment Received — {{amount}}",
		header: "Payment Confirmed",
		body: `<p>Dear {{name}},</p>
<p>We have received your payment of <strong>{{amount}}</strong>. Your invoice has been marked as paid and your application will continue processing.</p>
<table role="presentation" style="width:100%;border-collapse:separate;border-spacing:0;margin:1rem 0;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
<tr><td style="padding:0.5rem 1rem;background:#f9fafb;font-weight:600;border-bottom:1px solid #e5e7eb;">Amount</td><td style="padding:0.5rem 1rem;border-bottom:1px solid #e5e7eb;">{{amount}}</td></tr>
<tr><td style="padding:0.5rem 1rem;background:#f9fafb;font-weight:600;border-bottom:1px solid #e5e7eb;">Method</td><td style="padding:0.5rem 1rem;border-bottom:1px solid #e5e7eb;">Mobile Money / Bank Transfer</td></tr>
<tr><td style="padding:0.5rem 1rem;background:#f9fafb;font-weight:600;">Status</td><td style="padding:0.5rem 1rem;"><span style="color:#059669;font-weight:600;">Confirmed</span></td></tr>
</table>
<p>You can download your receipt from your portal under the Finance section.</p>
<p style="margin-top:1.5rem;">Regards,<br/><strong>The Century NIT Team</strong></p>`,
		footer: "Century NIT  \u00b7  Finance Department",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-sms-reminder",
		name: "SMS Document Reminder",
		type: "SMS",
		subject: "",
		header: "",
		body: "Hi {{name}}, your application is missing documents. Please upload them by {{date}}. Reply STOP to opt out.",
		footer: "",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-sms-appointment",
		name: "SMS Appointment Alert",
		type: "SMS",
		subject: "",
		header: "",
		body: "Reminder: You have a consultation with Century NIT on {{date}} at {{time}}. Reply C to confirm or R to reschedule. Reply STOP to opt out.",
		footer: "",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-sms-deadline",
		name: "SMS Deadline Alert",
		type: "SMS",
		subject: "",
		header: "",
		body: "Alert: Your application deadline is {{date}}. Submit all documents now via your portal. Reply STOP to opt out.",
		footer: "",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
	{
		id: "tpl-sms-payment",
		name: "SMS Payment Reminder",
		type: "SMS",
		subject: "",
		header: "",
		body: "Hi {{name}}, your invoice of {{amount}} is due on {{date}}. Pay via your portal to avoid delays. Reply STOP to opt out.",
		footer: "",
		custom: false,
		createdAt: "2026-07-01T10:00:00Z",
		createdBy: "System",
	},
];

export type OpsActivityEntry = {
	id: string;
	at: string;
	actor: string;
	action: string;
	detail: string;
};

type PersistedOpsState = {
	version: number;
	consultations: MockConsultation[];
	applications: MockApplication[];
	applicants: MockApplicant[];
	leads: Lead[];
	packages: ServicePackage[];
	directives: OpsDirectives;
	activityLog: OpsActivityEntry[];
	/** Staff actions against the derived live portal case. */
	liveOverlay: LiveOverlay;
	/** Verification decisions on seeded (non-live) documents, keyed by unique doc key. */
	seededDocVerdicts: Record<string, "Verified" | "Rejected">;
	/** Historical invoice records for all applicants. */
	invoices: Invoice[];
	/** CMS edits, keyed `collection:id`. Overlay on the seed in data/content.ts. */
	cmsOverlay: CmsOverlay;
	internalTickets: InternalTicket[];
	marketingCampaigns: MarketingCampaign[];
	mailingLists: MailingList[];
	emailTemplates: EmailTemplate[];
};

function defaultPersisted(): PersistedOpsState {
	return {
		version: OPS_STATE_VERSION,
		consultations: [],
		applications: [],
		applicants: [],
		leads: [],
		packages: SEED_PACKAGES,
		directives: EMPTY_DIRECTIVES,
		activityLog: [],
		liveOverlay: EMPTY_LIVE_OVERLAY,
		seededDocVerdicts: {},
		invoices: [],
		cmsOverlay: {},
		internalTickets: [],
		marketingCampaigns: [],
		mailingLists: [],
		emailTemplates: SEED_EMAIL_TEMPLATES,
	};
}

function loadPersisted(): PersistedOpsState {
	const base = defaultPersisted();
	try {
		const raw = localStorage.getItem(OPS_STATE_KEY);
		if (!raw) return base;
		const parsed = JSON.parse(raw) as Partial<PersistedOpsState>;
		// Seed data or shape changed underneath a saved session - start clean.
		if (parsed.version !== OPS_STATE_VERSION) return base;
		return {
			version: OPS_STATE_VERSION,
			consultations: parsed.consultations ?? base.consultations,
			applications: parsed.applications ?? base.applications,
			applicants: parsed.applicants ?? base.applicants,
			leads: parsed.leads ?? base.leads,
			packages: parsed.packages ?? base.packages,
			directives: { ...EMPTY_DIRECTIVES, ...(parsed.directives ?? {}) },
			activityLog: parsed.activityLog ?? [],
			liveOverlay: { ...EMPTY_LIVE_OVERLAY, ...(parsed.liveOverlay ?? {}) },
			seededDocVerdicts: parsed.seededDocVerdicts ?? {},
			invoices: parsed.invoices ?? base.invoices,
			cmsOverlay: parsed.cmsOverlay ?? base.cmsOverlay,
			internalTickets: parsed.internalTickets ?? base.internalTickets,
			marketingCampaigns: parsed.marketingCampaigns ?? base.marketingCampaigns,
			mailingLists: (parsed.mailingLists ?? base.mailingLists).map((l) => ({ ...l, contacts: l.contacts ?? [] })),
			emailTemplates: parsed.emailTemplates ?? base.emailTemplates,
		};
	} catch {
		return base;
	}
}

/** Prepend an activity entry, capped so the log can't grow without bound. */
function withLog(
	state: PersistedOpsState,
	actor: string,
	action: string,
	detail: string,
): PersistedOpsState {
	return {
		...state,
		activityLog: [
			{
				id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
				at: new Date().toISOString(),
				actor,
				action,
				detail,
			},
			...state.activityLog,
		].slice(0, 40),
	};
}

/* ─── Live case projection ─── */

const LIVE_CONSULTATION_ID = "live-consultation";
const LIVE_APPLICATION_ID = "live-application";
const LIVE_APPLICANT_ID = "live-applicant";

/**
 * The live applicant arrives UNASSIGNED - clients book themselves, and routing
 * the booking to a consultant is the manager's job.
 */
function liveConsultation(snap: LiveCaseSnapshot, overlay: LiveOverlay): MockConsultation {
	return {
		id: LIVE_CONSULTATION_ID,
		ref: snap.consultationRef ?? "CNS-LIVE",
		applicantName: snap.name,
		email: snap.email,
		phone: snap.phone || "-",
		branch: "accra",
		dateTime: overlay.rescheduledTo ?? "Live · portal session",
		type: "Online",
		assignedOfficer: overlay.assignedOfficer,
		assignedOfficerEmail: overlay.assignedOfficerEmail,
		targetCountry: snap.targetCountry || "-",
		status:
			snap.eligibility === "eligible" || snap.eligibility === "conditional"
				? "Completed"
				: overlay.assignedOfficer
					? overlay.assessmentStarted
						? "In Assessment"
						: "Assigned"
					: "Under Review",
		personal: { nationality: "-", residence: "-", dob: "-" },
		passport: { number: "-", expiry: "-", previousRefusals: "None" },
		education: { degree: "-", institution: "-", gpa: "-", gradYear: "-" },
		employment: { currentRole: "-", company: "-", experienceYears: "-" },
		financial: { source: snap.fundingTrack || "-", budget: "-" },
		goals: {
			degreeLevel: snap.degreeLevel || "-",
			intake: "Fall 2026",
			major: snap.program || "-",
		},
		documents: snap.documents.map((d) => ({
			name: d.name,
			status: overlay.documentStatuses[d.name] ?? d.status,
		})),
		comments: overlay.comments,
		rescheduledTo: overlay.rescheduledTo,
		requestedDocuments: overlay.requestedDocuments,
		slotConfirmed: overlay.slotConfirmed,
		isLive: true,
	};
}

function liveApplication(snap: LiveCaseSnapshot, overlay: LiveOverlay): MockApplication {
	return {
		id: LIVE_APPLICATION_ID,
		appId: snap.applicationId ?? snap.consultationRef ?? "APP-LIVE",
		applicantName: snap.name,
		email: snap.email,
		phone: snap.phone || "-",
		branch: "accra",
		university: snap.university || "-",
		program: snap.program || "-",
		country: snap.targetCountry || "-",
		degreeLevel: snap.degreeLevel || "-",
		assignedStaff: overlay.assignedOfficer,
		assignedStaffEmail: overlay.assignedOfficerEmail,
		stage: snap.stageLabel,
		status: snap.stage === "completed" ? "Accepted" : "Under Review",
		submittedDate: snap.updatedAt.slice(0, 10),
		fundingTrack: snap.fundingTrack || "-",
		notes: "Live record projected from the applicant portal session.",
		checklist: snap.documents.map((d, i) => ({
			id: `live-chk-${i}`,
			label: d.name,
			checked: (overlay.documentStatuses[d.name] ?? d.status) === "Verified",
		})),
		comments: overlay.comments,
		requestedDocuments: overlay.requestedDocuments,
		isLive: true,
	};
}

function liveApplicant(snap: LiveCaseSnapshot, overlay: LiveOverlay): MockApplicant {
	const consultationPaid = snap.consultationPaid ? snap.consultationAmount : 0;
	const appPaid = snap.appInvoiceStatus === "paid" ? snap.appInvoiceAmount : 0;
	const visaPaid = snap.visaInvoiceStatus === "paid" ? snap.visaInvoiceAmount : 0;
	const agencyPaid = snap.agencyPaid;

	const totalBilled =
		snap.consultationAmount +
		snap.appInvoiceAmount +
		snap.visaInvoiceAmount +
		snap.agencyTotal;
	const paid = consultationPaid + appPaid + visaPaid + agencyPaid;
	const outstanding = Math.max(0, totalBilled - paid);

	return {
		id: LIVE_APPLICANT_ID,
		applicantId: snap.applicationId ?? snap.consultationRef ?? "APP-LIVE",
		name: snap.name,
		email: snap.email,
		phone: snap.phone || "-",
		branch: "accra",
		assignedOfficer: overlay.assignedOfficer,
		assignedOfficerEmail: overlay.assignedOfficerEmail,
		country: snap.targetCountry || "-",
		university: snap.university || "-",
		program: snap.program || "-",
		package: snap.fundingTrack || "-",
		currentStage: snap.stageLabel,
		stageNumber: snap.stageIndex,
		totalStages: snap.totalStages,
		status: snap.stage === "completed" ? "Enrolled" : "Active",
		enrolledDate: "Fall 2026",
		paymentPlanId: snap.paymentPlanId as PaymentPlanId | undefined,
		agencyStageIndex: snap.agencyStageIndex,
		agencySettled: snap.agencySettled,
		financials: {
			totalAmount: `$${totalBilled.toLocaleString()}`,
			paidAmount: `$${paid.toLocaleString()}`,
			outstanding: `$${outstanding.toLocaleString()}`,
			plan: snap.agencyTotal > 0
				? `${snap.paymentPlanId === "full" ? "Full" : snap.paymentPlanId === "installment" ? "Installment" : "No plan"} · ${snap.agencyDepositPaid ? "deposit paid" : "deposit pending"}${snap.postArrivalSchedule ? ` · ${snap.postArrivalSchedule}${snap.paymentPlanId === "installment" && snap.postArrivalPaymentIndex > 0 ? ` (${snap.postArrivalPaymentIndex} paid)` : ""}` : ""}`
				: "Live portal session",
		},
		timeline: snap.schools.map((s, i) => ({
			stage: `${i + 1}. ${s.university}`,
			status: s.status,
			date: snap.updatedAt.slice(0, 10),
		})),
		documents: snap.documents.map((d) => ({
			name: d.name,
			category: d.category,
			date: snap.updatedAt.slice(0, 10),
			status: overlay.documentStatuses[d.name] ?? d.status,
		})),
		messages: [
			{ sender: "System", time: "Live", text: `Applicant is at stage: ${snap.stageLabel}.` },
		],
		auditLog: [
			{
				action: "Live portal session projected into ops",
				user: "SimBridge",
				timestamp: snap.updatedAt.replace("T", " ").slice(0, 16),
			},
		],
		isLive: true,
	};
}

/* ─── CONTEXT INTERFACE ─── */

interface OpsStateContextValue {
	consultations: MockConsultation[];
	applications: MockApplication[];
	applicants: MockApplicant[];
	/** Seeded records only - excludes the live portal projection */
	seededApplications: MockApplication[];
	liveCase: LiveCaseSnapshot | null;
	liveOverlay: LiveOverlay;
	directives: OpsDirectives;
	activityLog: OpsActivityEntry[];

	completeConsultationAssessment: (
		id: string,
		result: {
			outcome: string;
			notes: string;
			recCountry: string;
			recUniversity: string;
			recProgram: string;
			recPackage: string;
		},
		actor?: string,
	) => void;
	acceptApplication: (appId: string, actor?: string) => void;
	toggleApplicationChecklist: (appId: string, itemIndex: number) => void;
	setApplicationStage: (appId: string, stage: string, actor?: string) => void;

	/** Visa processing management */
	setVisaStage: (appId: string, stage: VisaStage, actor?: string) => void;
	setVisaInvoicePaid: (appId: string, actor?: string) => void;
	setVisaCounselorNote: (appId: string, note: string) => void;

	/** Travel assistance management */
	setPaymentPlan: (appId: string, plan: PaymentPlanId, actor?: string) => void;
	advanceAgencyStage: (appId: string, actor?: string) => void;
	setTravelClearance: (appId: string, cleared: boolean, actor?: string) => void;
	togglePreDepartureTask: (appId: string, taskId: string) => void;

	/** Assignment - manager only (enforced in the UI via canAssignWork) */
	assignConsultation: (id: string, to: Assignee, by: string) => void;
	/** Consultant confirms the assigned slot, acknowledging they've accepted it. */
	confirmConsultationSlot: (id: string, by: string) => void;
	/** Consultant starts working on an assigned consultation, moving to In Assessment. */
	startConsultationAssessment: (id: string, by: string) => void;
	assignApplication: (appId: string, to: Assignee, by: string) => void;
	/** Case work - consultant on their assigned items */
	addCaseComment: (
		target: { type: "consultation" | "application"; id: string },
		kind: CommentKind,
		text: string,
		by: string,
	) => void;
	requestDocuments: (
		target: { type: "consultation" | "application"; id: string },
		docs: string[],
		by: string,
	) => void;
	rescheduleConsultation: (id: string, date: string, time: string, reason: string, by: string) => void;

	/** Verify or reject a document on the live applicant's file. Persists to the overlay. */
	verifyDocument: (docName: string, verdict: "Verified" | "Rejected", by: string) => void;

	/** Unified document verdict - works for both live and seeded documents. */
	setDocVerdict: (docKey: string, isLive: boolean, docName: string, verdict: "Verified" | "Rejected", by: string) => void;
	seededDocVerdicts: Record<string, "Verified" | "Rejected">;

	/** Service packages - finance owns these */
	packages: ServicePackage[];
	savePackage: (pkg: ServicePackage, by: string) => void;
	togglePackage: (id: string, by: string) => void;

	/** Ops → portal directives */
	publishLiveCase: (snap: LiveCaseSnapshot | null) => void;
	issueEligibility: (d: Omit<EligibilityDirective, "at">) => void;
	issueAppInvoice: (amount: number, lines: OpsInvoiceLine[], note: string, by: string) => void;
	issueVisaInvoice: (amount: number, lines: OpsInvoiceLine[], note: string, by: string) => void;
	issueVisaStage: (stage: VisaStage, note: string, by: string) => void;
	issuePaymentPlan: (plan: PaymentPlanId, by: string) => void;
	issueAgencyAdvance: (stageIndex: number, settled: boolean, by: string) => void;
	issueTravelClearance: (cleared: boolean, by: string) => void;
	issueScheduleConfig: (enabledScheduleIds: string[], by: string, customSchedules?: CustomSchedule[]) => void;
	/** Build and issue a custom invoice to any applicant. Also writes a directive for the live case. */
	createInvoice: (invoice: Omit<Invoice, "id" | "invoiceNumber" | "issuedAt" | "status">) => void;
	recordInvoicePayment: (id: string, amount: number, method: string, reference: string, by: string) => void;
	voidInvoice: (id: string, reason: string, by: string) => void;
	creditInvoice: (id: string, amount: number, reason: string, by: string) => void;
	resendInvoice: (id: string, by: string) => void;
	/** All issued invoices across every applicant. */
	invoices: Invoice[];

	/** CMS - overlay on the seed content, plus the actions that write it. */
	cmsOverlay: CmsOverlay;
	saveCmsRecord: (
		collection: CmsCollectionId,
		id: string,
		title: string,
		values: Record<string, string>,
		status: CmsStatus,
		by: string,
	) => void;
	setCmsStatus: (
		collection: CmsCollectionId,
		id: string,
		title: string,
		status: CmsStatus,
		by: string,
	) => void;
	revertCmsRecord: (collection: CmsCollectionId, id: string, title: string, by: string) => void;
	clearDirectives: () => void;
	logActivity: (actor: string, action: string, detail: string) => void;
	resetOpsState: () => void;

	// Command palette state
	isCommandOpen: boolean;
	openCommandPalette: () => void;
	closeCommandPalette: () => void;
	// Preview document modal state
	previewDoc: { name: string; category?: string; status?: string; isLive?: boolean; docKey?: string } | null;
	openDocPreview: (doc: { name: string; category?: string; status?: string; isLive?: boolean; docKey?: string }) => void;
	closeDocPreview: () => void;
	// CRM leads
	leads: Lead[];
	moveLead: (id: string, stage: LeadStage) => void;
	addLead: (lead: Omit<Lead, "id" | "createdAt" | "lastContactAt">) => void;

	/** Support tickets — internal (staff) and external (client portal). */
	internalTickets: InternalTicket[];
	createTicket: (
		ticket: Omit<
			InternalTicket,
			"id" | "ref" | "createdAt" | "updatedAt" | "assignedTo" | "assignedToEmail" | "escalatedToAdmin" | "messages"
		> & { messages?: TicketMessage[] },
	) => void;
	updateTicketStatus: (id: string, status: TicketStatus, by?: string) => void;
	assignTicket: (id: string, to: { name: string; email: string } | null, by: string) => void;
	escalateTicket: (id: string, by: string) => void;
	replyToTicket: (id: string, body: string, author: string, role: "applicant" | "staff") => void;

	marketingCampaigns: MarketingCampaign[];
	sendCampaign: (campaign: Omit<MarketingCampaign, "id" | "status" | "sentAt">) => void;

	mailingLists: MailingList[];
	createMailingList: (list: Omit<MailingList, "id" | "createdAt" | "recipientCount" | "contacts">) => void;
	deleteMailingList: (id: string) => void;
	addMailingListContact: (listId: string, name: string, email: string) => void;
	removeMailingListContact: (listId: string, contactId: string) => void;

	emailTemplates: EmailTemplate[];
	createEmailTemplate: (tpl: Omit<EmailTemplate, "id" | "createdAt" | "createdBy" | "custom">) => void;
	updateEmailTemplate: (id: string, updates: Partial<Omit<EmailTemplate, "id" | "createdAt" | "createdBy" | "custom">>) => void;
	deleteEmailTemplate: (id: string) => void;
}

const OpsStateContext = createContext<OpsStateContextValue | null>(null);

export function OpsStateProvider({ children }: { children: ReactNode }) {
	const [persisted, setPersisted] = useState<PersistedOpsState>(loadPersisted);
	const [liveCase, setLiveCase] = useState<LiveCaseSnapshot | null>(null);
	const [isCommandOpen, setIsCommandOpen] = useState(false);
	const [previewDoc, setPreviewDoc] = useState<{ name: string; category?: string; status?: string; isLive?: boolean; docKey?: string } | null>(null);

	/** Serialized value we last wrote, so cross-tab echoes don't ping-pong. */
	const lastWrittenRef = useRef<string>("");

	useEffect(() => {
		const serialized = JSON.stringify(persisted);
		if (serialized === lastWrittenRef.current) return;
		lastWrittenRef.current = serialized;
		// Guarded: the seeded ops state is large, and an unguarded quota failure
		// here throws inside the effect and takes down the Operations Center.
		safeSetItem(OPS_STATE_KEY, serialized);
	}, [persisted]);

	/** Cross-tab sync - this is what makes the two-window demo work. */
	useEffect(() => {
		function onStorage(e: StorageEvent) {
			if (e.key !== OPS_STATE_KEY || e.newValue == null) return;
			if (e.newValue === lastWrittenRef.current) return;
			try {
				const parsed = JSON.parse(e.newValue) as Partial<PersistedOpsState>;
				lastWrittenRef.current = e.newValue;
				setPersisted({
					...defaultPersisted(),
					...parsed,
					version: OPS_STATE_VERSION,
					directives: { ...EMPTY_DIRECTIVES, ...(parsed.directives ?? {}) },
				});
			} catch {
				/* ignore malformed payloads */
			}
		}
		window.addEventListener("storage", onStorage);
		return () => window.removeEventListener("storage", onStorage);
	}, []);

	const logActivity = useCallback((actor: string, action: string, detail: string) => {
		setPersisted((prev) => withLog(prev, actor, action, detail));
	}, []);

	/* ─── Consultation → Application ─── */

	const completeConsultationAssessment = useCallback(
		(
			id: string,
			result: {
				outcome: string;
				notes: string;
				recCountry: string;
				recUniversity: string;
				recProgram: string;
				recPackage: string;
			},
			actor = "Consultant",
		) => {
			setPersisted((prev) => {
				const target = prev.consultations.find((c) => c.id === id);
				if (!target) return prev;

				const consultations = prev.consultations.map((c) =>
					c.id === id ? { ...c, status: "Completed" as const, assessmentResult: result } : c,
				);
				const next = { ...prev, consultations };

				const eligible =
					result.outcome === "Eligible" || result.outcome === "Conditionally Eligible";

				// The live portal case is driven by an eligibility directive instead,
				// so we never fabricate a second record for it.
				if (!eligible || target.isLive) return next;

				const alreadyExists = prev.applications.some(
					(a) => a.email === target.email && a.university === result.recUniversity,
				);
				if (alreadyExists) return next;

				const newApp: MockApplication = {
					id: `app-${Date.now()}`,
					appId: `APP-2026-${Math.floor(1000 + Math.random() * 9000)}`,
					applicantName: target.applicantName,
					email: target.email,
					phone: target.phone,
					branch: target.branch,
					university: result.recUniversity || "University of Toronto",
					program: result.recProgram || "Master's Degree Program",
					country: result.recCountry || target.targetCountry,
					degreeLevel: target.goals.degreeLevel || "Master's",
					assignedStaff: target.assignedOfficer,
					assignedStaffEmail: target.assignedOfficerEmail,
					stage: "Document Verification",
					status: "Under Review",
					submittedDate: new Date().toISOString().split("T")[0],
					fundingTrack: result.recPackage || "Standard Admission",
					notes: result.notes || "Generated from completed consultation assessment.",
					checklist: target.documents.map((d, i) => ({
						id: `chk-${i}`,
						label: d.name.replace(/_/g, " "),
						checked: d.status === "Verified",
					})),
				};

				return withLog(
					{ ...next, applications: [newApp, ...prev.applications] },
					actor,
					"Assessment completed",
					`${target.applicantName} → ${result.outcome}. Application ${newApp.appId} created.`,
				);
			});
		},
		[],
	);

	const acceptApplication = useCallback((appId: string, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;

			const applications = prev.applications.map((a) =>
				a.appId === appId ? { ...a, status: "Accepted" as const } : a,
			);
			const next = { ...prev, applications };

			const exists = prev.applicants.some((ap) => ap.applicantId === target.appId);
			if (exists || target.isLive) return next;

			const newApplicant: MockApplicant = {
				id: `applicant-${Date.now()}`,
				applicantId: target.appId,
				name: target.applicantName,
				email: target.email,
				phone: target.phone,
				branch: target.branch,
				assignedOfficer: target.assignedStaff,
				assignedOfficerEmail: target.assignedStaffEmail,
				country: target.country,
				university: target.university,
				program: target.program,
				package: target.fundingTrack,
				currentStage: "Document Review",
				stageNumber: 4,
				totalStages: 11,
				status: "Active",
				enrolledDate: "Fall 2026",
				financials: {
					totalAmount: "$3,000",
					paidAmount: "$1,500",
					outstanding: "$1,500",
					plan: "2 Installment Plan",
				},
				timeline: [
					{ stage: "1. Consultation", status: "Completed", date: target.submittedDate },
					{ stage: "2. Eligibility", status: "Completed", date: target.submittedDate },
					{ stage: "3. School Package", status: "Completed", date: target.submittedDate },
					{ stage: "4. Select Schools", status: "Completed", date: target.submittedDate },
					{ stage: "5. Application Process", status: "In Progress", date: "Current" },
				],
				documents: target.checklist.map((c) => ({
					name: `${c.label.replace(/\s+/g, "_")}.pdf`,
					category: "Verified Item",
					date: target.submittedDate,
					status: c.checked ? "Verified" : "Pending Review",
				})),
				messages: [
					{
						sender: `${target.assignedStaff} (Staff)`,
						time: "Just now",
						text: "Application accepted and activated in the active applicants directory.",
					},
				],
				auditLog: [
					{
						action: "Application Accepted & Approved",
						user: target.assignedStaff,
						timestamp: new Date().toISOString().replace("T", " ").substring(0, 16),
					},
				],
			};

			return withLog(
				{ ...next, applicants: [newApplicant, ...prev.applicants] },
				actor,
				"Application accepted",
				`${target.applicantName} (${target.appId}) activated as an applicant.`,
			);
		});
	}, []);

	const toggleApplicationChecklist = useCallback((appId: string, itemIndex: number) => {
		setPersisted((prev) => ({
			...prev,
			applications: prev.applications.map((a) =>
				a.appId === appId
					? {
							...a,
							checklist: a.checklist.map((item, idx) =>
								idx === itemIndex ? { ...item, checked: !item.checked } : item,
							),
						}
					: a,
			),
		}));
	}, []);

	const setApplicationStage = useCallback((appId: string, stage: string, actor = "Processing") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target || target.stage === stage) return prev;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId ? { ...a, stage } : a,
					),
				},
				actor,
				"Stage advanced",
				`${target.applicantName}: ${target.stage} → ${stage}`,
			);
		});
	}, []);

	/* ─── Visa processing management ─── */

	const setVisaStage = useCallback((appId: string, stage: VisaStage, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			const isLive = target.id === LIVE_APPLICATION_ID;
			const next = withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId ? { ...a, visaStage: stage } : a,
					),
					directives: isLive
						? {
								...prev.directives,
								visaStage: { stage, note: target.visaCounselorNote ?? "", at: new Date().toISOString(), by: actor },
							}
						: prev.directives,
				},
				actor,
				"Visa stage updated",
				`${target.applicantName}: visa → ${stage}`,
			);
			return next;
		});
	}, []);

	const setVisaInvoicePaid = useCallback((appId: string, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId
							? {
									...a,
									visaInvoicePaid: true,
									visaStage: a.visaStage === "locked" ? "pending" : a.visaStage,
								}
							: a,
					),
				},
				actor,
				"Visa invoice paid",
				`${target.applicantName}: visa invoice marked paid`,
			);
		});
	}, []);

	const setVisaCounselorNote = useCallback((appId: string, note: string) => {
		setPersisted((prev) => ({
			...prev,
			applications: prev.applications.map((a) =>
				a.appId === appId ? { ...a, visaCounselorNote: note } : a,
			),
		}));
	}, []);

	/* ─── Travel assistance management ─── */

	const setPaymentPlan = useCallback((appId: string, plan: PaymentPlanId, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			const isLive = target.id === LIVE_APPLICATION_ID;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId ? { ...a, paymentPlanId: plan } : a,
					),
					directives: isLive
						? { ...prev.directives, paymentPlan: { plan, at: new Date().toISOString(), by: actor } }
						: prev.directives,
				},
				actor,
				"Payment plan set",
				`${target.applicantName}: plan → ${plan || "none"}`,
			);
		});
	}, []);

	const advanceAgencyStage = useCallback((appId: string, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			const curIdx = target.agencyStageIndex ?? 0;
			const nextIdx = Math.min(curIdx + 1, 2);
			const settled = nextIdx >= 2;
			const isLive = target.id === LIVE_APPLICATION_ID;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId
							? { ...a, agencyStageIndex: nextIdx, agencySettled: settled }
							: a,
					),
					directives: isLive
						? { ...prev.directives, agencyAdvance: { stageIndex: nextIdx, settled, at: new Date().toISOString(), by: actor } }
						: prev.directives,
				},
				actor,
				"Agency milestone advanced",
				`${target.applicantName}: agency stage ${nextIdx + 1}/3`,
			);
		});
	}, []);

	const setTravelClearance = useCallback((appId: string, cleared: boolean, actor = "Staff") => {
		setPersisted((prev) => {
			const target = prev.applications.find((a) => a.appId === appId);
			if (!target) return prev;
			const isLive = target.id === LIVE_APPLICATION_ID;
			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId
							? { ...a, travelClearance: cleared ? "cleared" : "pending" }
							: a,
					),
					directives: isLive
						? { ...prev.directives, travelClearance: { cleared, at: new Date().toISOString(), by: actor } }
						: prev.directives,
				},
				actor,
				cleared ? "Travel cleared" : "Travel clearance revoked",
				`${target.applicantName}: travel ${cleared ? "cleared" : "pending"}`,
			);
		});
	}, []);

	const togglePreDepartureTask = useCallback((appId: string, taskId: string) => {
		setPersisted((prev) => ({
			...prev,
			applications: prev.applications.map((a) =>
				a.appId === appId
					? {
							...a,
							preDepartureTasks: (a.preDepartureTasks ?? []).map((t) =>
								t.id === taskId ? { ...t, done: !t.done } : t,
							),
						}
					: a,
			),
		}));
	}, []);

	const LIVE_IDS = { consultation: LIVE_CONSULTATION_ID, application: LIVE_APPLICATION_ID };

	function makeComment(author: string, kind: CommentKind, text: string): CaseComment {
		return {
			id: `cm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
			at: new Date().toISOString(),
			author,
			kind,
			text,
		};
	}

	/** Manager routes a consultation to a consultant (or reassigns it). */
	const assignConsultation = useCallback((id: string, to: Assignee, by: string) => {
		setPersisted((prev) => {
			const note = makeComment(by, "assignment", `Assigned to ${to.name} (${branchName(to.branch)}).`);

			if (id === LIVE_IDS.consultation) {
				return withLog(
					{
						...prev,
						liveOverlay: {
							...prev.liveOverlay,
							assignedOfficer: to.name,
							assignedOfficerEmail: to.email,
							slotConfirmed: false,
							assessmentStarted: false,
							comments: [...prev.liveOverlay.comments, note],
						},
					},
					by,
					"Consultation assigned",
					`Live portal applicant → ${to.name}`,
				);
			}

			const target = prev.consultations.find((c) => c.id === id);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					consultations: prev.consultations.map((c) =>
						c.id === id
							? {
									...c,
									assignedOfficer: to.name,
									assignedOfficerEmail: to.email,
									status: "Assigned",
									slotConfirmed: false,
									comments: [...(c.comments ?? []), note],
								}
							: c,
					),
				},
				by,
				"Consultation assigned",
				`${target.applicantName} → ${to.name}`,
			);
		});
	}, []);

	/** Consultant confirms the assigned slot → adds a comment and marks it confirmed. */
	const confirmConsultationSlot = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			const note = makeComment(by, "status", "Slot confirmed - consultant accepted the booking time.");

			if (id === LIVE_IDS.consultation) {
				return withLog(
					{
						...prev,
						liveOverlay: {
							...prev.liveOverlay,
							slotConfirmed: true,
							comments: [...prev.liveOverlay.comments, note],
						},
					},
					by,
					"Slot confirmed",
					"Live portal applicant",
				);
			}

			const target = prev.consultations.find((c) => c.id === id);
			if (!target) return prev;
			const isOnline = target.type === "online";
			const meetingLink = isOnline
				? `https://meet.google.com/century-nit-${target.ref.toLowerCase().replace(/[^a-z0-9]/g, "")}`
				: undefined;
			const mapsUrl = !isOnline
				? `https://www.google.com/maps?q=${encodeURIComponent(target.branch)}`
				: undefined;
			return withLog(
				{
					...prev,
					consultations: prev.consultations.map((c) =>
						c.id === id
							? { ...c, slotConfirmed: true, meetingLink, mapsUrl, comments: [...(c.comments ?? []), note] }
							: c,
					),
				},
				by,
				"Slot confirmed",
				`${target.applicantName} - consultant accepted slot`,
			);
		});
	}, []);

	/** Consultant starts assessment → status becomes "In Assessment". */
	const startConsultationAssessment = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			if (id === LIVE_IDS.consultation) {
				return withLog(
					{
						...prev,
						liveOverlay: {
							...prev.liveOverlay,
							assessmentStarted: true,
						},
					},
					by,
					"Assessment started",
					"Live portal applicant",
				);
			}
			const target = prev.consultations.find((c) => c.id === id);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					consultations: prev.consultations.map((c) =>
						c.id === id ? { ...c, status: "In Assessment" } : c,
					),
				},
				by,
				"Assessment started",
				`${target.applicantName} - consultant began review`,
			);
		});
	}, []);

	/** Manager routes a case stage to a consultant. */
	const assignApplication = useCallback((appId: string, to: Assignee, by: string) => {
		setPersisted((prev) => {
			const note = makeComment(by, "assignment", `Assigned to ${to.name} (${branchName(to.branch)}).`);
			const target = prev.applications.find((a) => a.appId === appId);

			if (!target) {
				// Live case - held on the overlay instead.
				return withLog(
					{
						...prev,
						liveOverlay: {
							...prev.liveOverlay,
							assignedOfficer: to.name,
							assignedOfficerEmail: to.email,
							comments: [...prev.liveOverlay.comments, note],
						},
					},
					by,
					"Case assigned",
					`Live portal applicant → ${to.name}`,
				);
			}

			return withLog(
				{
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === appId
							? {
									...a,
									assignedStaff: to.name,
									assignedStaffEmail: to.email,
									comments: [...(a.comments ?? []), note],
								}
							: a,
					),
				},
				by,
				"Case assigned",
				`${target.applicantName} (${appId}) → ${to.name}`,
			);
		});
	}, []);

	/** Consultant note, recommendation, or status update on an assigned case. */
	const addCaseComment = useCallback(
		(target: { type: "consultation" | "application"; id: string }, kind: CommentKind, text: string, by: string) => {
			setPersisted((prev) => {
				const note = makeComment(by, kind, text);

				if (target.id === LIVE_IDS.consultation || target.id === LIVE_IDS.application) {
					return {
						...prev,
						liveOverlay: { ...prev.liveOverlay, comments: [...prev.liveOverlay.comments, note] },
					};
				}
				if (target.type === "consultation") {
					return {
						...prev,
						consultations: prev.consultations.map((c) =>
							c.id === target.id ? { ...c, comments: [...(c.comments ?? []), note] } : c,
						),
					};
				}
				return {
					...prev,
					applications: prev.applications.map((a) =>
						a.appId === target.id ? { ...a, comments: [...(a.comments ?? []), note] } : a,
					),
				};
			});
		},
		[],
	);

	/** Consultant asks the applicant for more paperwork. */
	const requestDocuments = useCallback(
		(target: { type: "consultation" | "application"; id: string }, docs: string[], by: string) => {
			setPersisted((prev) => {
				const note = makeComment(by, "document_request", `Requested: ${docs.join(", ")}.`);

				if (target.id === LIVE_IDS.consultation || target.id === LIVE_IDS.application) {
					return withLog(
						{
							...prev,
							liveOverlay: {
								...prev.liveOverlay,
								comments: [...prev.liveOverlay.comments, note],
								requestedDocuments: [...prev.liveOverlay.requestedDocuments, ...docs],
							},
						},
						by,
						"Documents requested",
						docs.join(", "),
					);
				}
				if (target.type === "consultation") {
					return withLog(
						{
							...prev,
							consultations: prev.consultations.map((c) =>
								c.id === target.id
									? {
											...c,
											comments: [...(c.comments ?? []), note],
											requestedDocuments: [...(c.requestedDocuments ?? []), ...docs],
										}
									: c,
							),
						},
						by,
						"Documents requested",
						docs.join(", "),
					);
				}
				return withLog(
					{
						...prev,
						applications: prev.applications.map((a) =>
							a.appId === target.id
								? {
										...a,
										comments: [...(a.comments ?? []), note],
										requestedDocuments: [...(a.requestedDocuments ?? []), ...docs],
									}
								: a,
						),
					},
					by,
					"Documents requested",
					docs.join(", "),
				);
			});
		},
		[],
	);

	/**
	 * Consultant moves an assigned consultation onto a new slot.
	 *
	 * Takes the structured date and time rather than a formatted string, and
	 * derives the display text from them. The structured triple is what makes
	 * the slot visible to the conflict check — a record carrying only prose is
	 * invisible to it and its slot reads as free.
	 */
	const rescheduleConsultation = useCallback(
		(id: string, date: string, time: string, reason: string, by: string) => {
			const when = formatSlot(date, time);
			setPersisted((prev) => {
				const note = makeComment(by, "status", `Rescheduled to ${when}. ${reason}`.trim());

				if (id === LIVE_IDS.consultation) {
					return withLog(
						{
							...prev,
							liveOverlay: {
								...prev.liveOverlay,
								rescheduledTo: when,
								rescheduledSlot: { date, time },
								comments: [...prev.liveOverlay.comments, note],
							},
						},
						by,
						"Consultation rescheduled",
						`Live portal applicant → ${when}`,
					);
				}

				const target = prev.consultations.find((c) => c.id === id);
				if (!target) return prev;
				return withLog(
					{
						...prev,
						consultations: prev.consultations.map((c) =>
							c.id === id
								? {
										...c,
										dateTime: when,
										rescheduledTo: when,
										slotBranchId: resolveBranchId(c.branch) ?? c.slotBranchId,
										slotDate: date,
										slotTime: time,
										comments: [...(c.comments ?? []), note],
									}
								: c,
						),
					},
					by,
					"Consultation rescheduled",
					`${target.applicantName} → ${when}`,
				);
			});
		},
		[],
	);

	/** Consultant verifies or rejects a document on the live applicant's file. */
	const verifyDocument = useCallback((docName: string, verdict: "Verified" | "Rejected", by: string) => {
		setPersisted((prev) =>
			withLog(
				{
					...prev,
					liveOverlay: {
						...prev.liveOverlay,
						documentStatuses: {
							...prev.liveOverlay.documentStatuses,
							[docName]: verdict,
						},
					},
				},
				by,
				verdict === "Verified" ? "Document verified" : "Document rejected",
				docName,
			),
		);
	}, []);

	/** Unified document verdict - routes to liveOverlay or seededDocVerdicts. */
	const setDocVerdict = useCallback((docKey: string, isLive: boolean, docName: string, verdict: "Verified" | "Rejected", by: string) => {
		setPersisted((prev) =>
			withLog(
				isLive
					? {
							...prev,
							liveOverlay: {
								...prev.liveOverlay,
								documentStatuses: {
									...prev.liveOverlay.documentStatuses,
									[docName]: verdict,
								},
							},
						}
					: {
							...prev,
							seededDocVerdicts: {
								...prev.seededDocVerdicts,
								[docKey]: verdict,
							},
						},
				by,
				verdict === "Verified" ? "Document verified" : "Document rejected",
				docName,
			),
		);
	}, []);

	/* ─── Service packages (finance) ─── */

	const savePackage = useCallback((pkg: ServicePackage, by: string) => {
		setPersisted((prev) => {
			const exists = prev.packages.some((p) => p.id === pkg.id);
			return withLog(
				{
					...prev,
					packages: exists
						? prev.packages.map((p) => (p.id === pkg.id ? pkg : p))
						: [...prev.packages, pkg],
				},
				by,
				exists ? "Package updated" : "Package created",
				`${pkg.name} - ${fmtBoth(pkg.price)}`,
			);
		});
	}, []);

	const togglePackage = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			const target = prev.packages.find((p) => p.id === id);
			if (!target) return prev;
			return withLog(
				{
					...prev,
					packages: prev.packages.map((p) => (p.id === id ? { ...p, active: !p.active } : p)),
				},
				by,
				target.active ? "Package retired" : "Package activated",
				target.name,
			);
		});
	}, []);

	/* ─── Directives (ops → portal) ─── */

	const publishLiveCase = useCallback((snap: LiveCaseSnapshot | null) => {
		setLiveCase(snap);
	}, []);

	const issueEligibility = useCallback((d: Omit<EligibilityDirective, "at">) => {
		const directive: EligibilityDirective = { ...d, at: new Date().toISOString() };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, eligibility: directive } },
				d.by,
				"Eligibility decision sent to applicant",
				`${d.outcome} - ${d.note}`,
			),
		);
	}, []);

	const issueInvoice = useCallback(
		(
			kind: "appInvoice" | "visaInvoice",
			amount: number,
			lines: OpsInvoiceLine[],
			note: string,
			by: string,
		) => {
			const directive: InvoiceDirective = {
				amount,
				lines,
				note,
				by,
				at: new Date().toISOString(),
			};
			setPersisted((prev) =>
				withLog(
					{ ...prev, directives: { ...prev.directives, [kind]: directive } },
					by,
					kind === "appInvoice" ? "Application invoice issued" : "Visa invoice issued",
					`${fmtBoth(amount)} - ${note}`,
				),
			);
		},
		[],
	);

	const issueAppInvoice = useCallback(
		(amount: number, lines: OpsInvoiceLine[], note: string, by: string) =>
			issueInvoice("appInvoice", amount, lines, note, by),
		[issueInvoice],
	);

	const issueVisaInvoice = useCallback(
		(amount: number, lines: OpsInvoiceLine[], note: string, by: string) =>
			issueInvoice("visaInvoice", amount, lines, note, by),
		[issueInvoice],
	);

	const issueVisaStage = useCallback((stage: VisaStage, note: string, by: string) => {
		const directive: VisaStageDirective = { stage, note, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, visaStage: directive } },
				by,
				"Visa stage updated",
				`${stage} - ${note}`,
			),
		);
	}, []);

	const issuePaymentPlan = useCallback((plan: PaymentPlanId, by: string) => {
		const directive: PaymentPlanDirective = { plan, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, paymentPlan: directive } },
				by,
				"Payment plan set",
				`plan → ${plan || "none"}`,
			),
		);
	}, []);

	const issueAgencyAdvance = useCallback((stageIndex: number, settled: boolean, by: string) => {
		const directive: AgencyAdvanceDirective = { stageIndex, settled, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, agencyAdvance: directive } },
				by,
				settled ? "Agency settled" : "Agency installment recorded",
				`stage ${stageIndex + 1}/3${settled ? " — settled" : ""}`,
			),
		);
	}, []);

	const issueTravelClearance = useCallback((cleared: boolean, by: string) => {
		const directive: TravelClearanceDirective = { cleared, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, travelClearance: directive } },
				by,
				cleared ? "Travel cleared" : "Travel clearance revoked",
				cleared ? "Cleared for departure" : "Clearance revoked",
			),
		);
	}, []);

	const issueScheduleConfig = useCallback((enabledScheduleIds: string[], by: string, customSchedules: CustomSchedule[] = []) => {
		const directive: ScheduleConfigDirective = { enabledScheduleIds, customSchedules, at: new Date().toISOString(), by };
		setPersisted((prev) =>
			withLog(
				{ ...prev, directives: { ...prev.directives, scheduleConfig: directive } },
				by,
				"Post-arrival schedules configured",
				`${enabledScheduleIds.length} option${enabledScheduleIds.length === 1 ? "" : "s"} enabled${customSchedules.length ? `, ${customSchedules.length} custom` : ""}`,
			),
		);
	}, []);

	/* ─── Invoice lifecycle ─── */

	/** Record a payment. A part-payment leaves a balance rather than closing it. */
	const recordInvoicePayment = useCallback(
		(id: string, amount: number, method: string, reference: string, by: string) => {
			setPersisted((prev) => {
				const target = prev.invoices.find((i) => i.id === id);
				if (!target) return prev;
				const payment: InvoicePayment = {
					id: `pay-${Date.now().toString(36)}`,
					amount,
					at: new Date().toISOString(),
					by,
					method,
					reference,
				};
				const payments = [...(target.payments ?? []), payment];
				const settled = payments.reduce((n, p) => n + p.amount, 0) + (target.creditedAmount ?? 0);
				const status: InvoiceStatus = settled >= target.subtotal ? "paid" : "partial";

				return withLog(
					{
						...prev,
						invoices: prev.invoices.map((i) =>
							i.id === id
								? {
										...i,
										payments,
										status,
										history: [
											...(i.history ?? []),
											{
												at: payment.at,
												by,
												action: status === "paid" ? "Paid in full" : "Part payment",
												detail: `${fmtBoth(amount)} · ${method}${reference ? ` · ${reference}` : ""}`,
											},
										],
									}
								: i,
						),
					},
					by,
					status === "paid" ? "Invoice paid" : "Part payment recorded",
					`${target.invoiceNumber} · ${fmtBoth(amount)}`,
				);
			});
		},
		[],
	);

	/** Void an invoice raised in error. Balance drops to zero; the record stays. */
	const voidInvoice = useCallback((id: string, reason: string, by: string) => {
		setPersisted((prev) => {
			const target = prev.invoices.find((i) => i.id === id);
			if (!target) return prev;
			const at = new Date().toISOString();
			return withLog(
				{
					...prev,
					invoices: prev.invoices.map((i) =>
						i.id === id
							? {
									...i,
									status: "void" as InvoiceStatus,
									voidedAt: at,
									voidReason: reason,
									history: [...(i.history ?? []), { at, by, action: "Voided", detail: reason }],
								}
							: i,
					),
				},
				by,
				"Invoice voided",
				`${target.invoiceNumber} · ${reason}`,
			);
		});
	}, []);

	/** Credit note — reverses part or all of an invoice without deleting it. */
	const creditInvoice = useCallback((id: string, amount: number, reason: string, by: string) => {
		setPersisted((prev) => {
			const target = prev.invoices.find((i) => i.id === id);
			if (!target) return prev;
			const at = new Date().toISOString();
			const credited = (target.creditedAmount ?? 0) + amount;
			const settled = (target.payments ?? []).reduce((n, p) => n + p.amount, 0) + credited;
			return withLog(
				{
					...prev,
					invoices: prev.invoices.map((i) =>
						i.id === id
							? {
									...i,
									creditedAmount: credited,
									status: (settled >= i.subtotal ? "paid" : i.status) as InvoiceStatus,
									history: [
										...(i.history ?? []),
										{ at, by, action: "Credit note", detail: `${fmtBoth(amount)} · ${reason}` },
									],
								}
							: i,
					),
				},
				by,
				"Credit note issued",
				`${target.invoiceNumber} · ${fmtBoth(amount)}`,
			);
		});
	}, []);

	/** Re-send to the applicant. Recorded so the chase history is visible. */
	const resendInvoice = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			const target = prev.invoices.find((i) => i.id === id);
			if (!target) return prev;
			const at = new Date().toISOString();
			return withLog(
				{
					...prev,
					invoices: prev.invoices.map((i) =>
						i.id === id
							? { ...i, history: [...(i.history ?? []), { at, by, action: "Re-sent to applicant" }] }
							: i,
					),
				},
				by,
				"Invoice re-sent",
				`${target.invoiceNumber} · ${target.applicantName}`,
			);
		});
	}, []);

	const createInvoice = useCallback(
		(input: Omit<Invoice, "id" | "invoiceNumber" | "issuedAt" | "status">) => {
			const id = `inv-${Date.now().toString(36)}`;
			const num = `INV-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`;
			const invoice: Invoice = {
				...input,
				id,
				invoiceNumber: num,
				issuedAt: new Date().toISOString(),
				status: "issued",
				// 14-day terms unless the caller says otherwise
				dueAt: input.dueAt ?? new Date(Date.now() + 14 * 86_400_000).toISOString(),
				payments: [],
				history: [
					{
						at: new Date().toISOString(),
						by: input.issuedBy,
						action: "Issued",
						detail: fmtBoth(input.subtotal),
					},
				],
			};
			setPersisted((prev) => {
				const next = {
					...prev,
					invoices: [invoice, ...prev.invoices],
				};

				// If this is the live applicant, also push a directive to their portal.
				if (liveCase?.present && input.applicantId === (liveCase.applicationId ?? liveCase.consultationRef)) {
					const kind = input.type === "Visa" ? "visaInvoice" : "appInvoice";
					const directive: InvoiceDirective = {
						amount: invoice.subtotal,
						lines: invoice.lines,
						note: invoice.note,
						by: invoice.issuedBy,
						at: invoice.issuedAt,
					};
					return withLog(
						{ ...next, directives: { ...prev.directives, [kind]: directive } },
						invoice.issuedBy,
						`${invoice.type} invoice issued`,
						`${invoice.applicantName} - ${fmtBoth(invoice.subtotal)}`,
					);
				}

				return withLog(
					next,
					invoice.issuedBy,
					`${invoice.type} invoice issued`,
					`${invoice.applicantName} - ${fmtBoth(invoice.subtotal)}`,
				);
			});
		},
		[liveCase],
	);

	const clearDirectives = useCallback(() => {
		setPersisted((prev) => ({ ...prev, directives: EMPTY_DIRECTIVES }));
	}, []);

	/* ─── CMS ─── */

	/** Save an edit. Only fields differing from the seed are persisted. */
	const saveCmsRecord = useCallback(
		(
			collection: CmsCollectionId,
			id: string,
			title: string,
			values: Record<string, string>,
			status: CmsStatus,
			by: string,
		) => {
			setPersisted((prev) =>
				withLog(
					{
						...prev,
						cmsOverlay: {
							...prev.cmsOverlay,
							[cmsKey(collection, id)]: {
								values,
								status,
								updatedAt: new Date().toISOString(),
								updatedBy: by,
							},
						},
					},
					by,
					"Content updated",
					`${title} · ${status}`,
				),
			);
		},
		[],
	);

	/** Publish / unpublish without touching the field values. */
	const setCmsStatus = useCallback(
		(collection: CmsCollectionId, id: string, title: string, status: CmsStatus, by: string) => {
			setPersisted((prev) => {
				const key = cmsKey(collection, id);
				const existing = prev.cmsOverlay[key];
				return withLog(
					{
						...prev,
						cmsOverlay: {
							...prev.cmsOverlay,
							[key]: {
								values: existing?.values ?? {},
								status,
								updatedAt: new Date().toISOString(),
								updatedBy: by,
							},
						},
					},
					by,
					status === "Published" ? "Content published" : `Content set to ${status}`,
					title,
				);
			});
		},
		[],
	);

	/** Drop the override so the record falls back to the seed. */
	const revertCmsRecord = useCallback(
		(collection: CmsCollectionId, id: string, title: string, by: string) => {
			setPersisted((prev) => {
				const next = { ...prev.cmsOverlay };
				delete next[cmsKey(collection, id)];
				return withLog({ ...prev, cmsOverlay: next }, by, "Content reverted", title);
			});
		},
		[],
	);

	const resetOpsState = useCallback(() => {
		const fresh = defaultPersisted();
		lastWrittenRef.current = "";
		setPersisted(fresh);
	}, []);

	/* ─── CRM leads ─── */

	const moveLead = useCallback((id: string, stage: LeadStage) => {
		setPersisted((prev) => ({
			...prev,
			leads: prev.leads.map((l) =>
				l.id === id ? { ...l, stage, lastContactAt: new Date().toISOString() } : l,
			),
		}));
	}, []);

	const addLead = useCallback((lead: Omit<Lead, "id" | "createdAt" | "lastContactAt">) => {
		const now = new Date().toISOString();
		setPersisted((prev) => ({
			...prev,
			leads: [
				{ ...lead, id: `lead-${Date.now().toString(36)}`, createdAt: now, lastContactAt: now },
				...prev.leads,
			],
		}));
	}, []);

	/* ─── Helpdesk ─── */

	/* ─── Helpdesk ─── */

	/** Sequential, human-quotable reference */
	function nextTicketRef(existing: InternalTicket[]) {
		const year = new Date().getFullYear();
		const n = existing.length + 1;
		return `TKT-${year}-${String(n).padStart(4, "0")}`;
	}

	/**
	 * Raise a ticket. Called by staff from the helpdesk (`internal`) and by the
	 * applicant from the client portal (`external`) — the portal sits inside
	 * OpsStateProvider, so it writes here directly rather than through a bridge.
	 */
	const createTicket = useCallback(
		(
			ticket: Omit<
				InternalTicket,
				"id" | "ref" | "createdAt" | "updatedAt" | "assignedTo" | "assignedToEmail" | "escalatedToAdmin" | "messages"
			> & { messages?: TicketMessage[] },
		) => {
			const now = new Date().toISOString();
			setPersisted((prev) => {
				const ref = nextTicketRef(prev.internalTickets);
				const record: InternalTicket = {
					...ticket,
					id: `tkt-${Date.now().toString(36)}`,
					ref,
					createdAt: now,
					updatedAt: now,
					assignedTo: "",
					assignedToEmail: "",
					escalatedToAdmin: false,
					messages:
						ticket.messages ??
						(ticket.source === "external"
							? [
									{
										id: `m-${Date.now().toString(36)}`,
										author: ticket.createdBy,
										role: "applicant" as const,
										body: ticket.description,
										at: now,
									},
								]
							: []),
				};
				return withLog(
					{ ...prev, internalTickets: [record, ...prev.internalTickets] },
					ticket.createdBy,
					ticket.source === "external" ? "Support ticket received" : "Internal ticket raised",
					`${ref} · ${ticket.title}`,
				);
			});
		},
		[],
	);

	const updateTicketStatus = useCallback((id: string, status: TicketStatus, by = "Staff") => {
		setPersisted((prev) => {
			const t = prev.internalTickets.find((x) => x.id === id);
			if (!t) return prev;
			return withLog(
				{
					...prev,
					internalTickets: prev.internalTickets.map((x) =>
						x.id === id ? { ...x, status, updatedAt: new Date().toISOString() } : x,
					),
				},
				by,
				`Ticket ${status.toLowerCase()}`,
				`${t.ref} · ${t.title}`,
			);
		});
	}, []);

	/** Route a ticket to a colleague. Passing an empty assignee returns it to triage. */
	const assignTicket = useCallback(
		(id: string, to: { name: string; email: string } | null, by: string) => {
			setPersisted((prev) => {
				const t = prev.internalTickets.find((x) => x.id === id);
				if (!t) return prev;
				return withLog(
					{
						...prev,
						internalTickets: prev.internalTickets.map((x) =>
							x.id === id
								? {
										...x,
										assignedTo: to?.name ?? "",
										assignedToEmail: to?.email ?? "",
										escalatedToAdmin: to ? false : x.escalatedToAdmin,
										status: to && x.status === "Open" ? "In Progress" : x.status,
										updatedAt: new Date().toISOString(),
									}
								: x,
						),
					},
					by,
					to ? "Ticket assigned" : "Ticket returned to triage",
					`${t.ref} → ${to?.name ?? "Unassigned"}`,
				);
			});
		},
		[],
	);

	/** Hand a ticket to platform administration — used when it is a system fault. */
	const escalateTicket = useCallback((id: string, by: string) => {
		setPersisted((prev) => {
			const t = prev.internalTickets.find((x) => x.id === id);
			if (!t) return prev;
			return withLog(
				{
					...prev,
					internalTickets: prev.internalTickets.map((x) =>
						x.id === id
							? {
									...x,
									escalatedToAdmin: true,
									assignedTo: "",
									assignedToEmail: "",
									status: x.status === "Resolved" ? x.status : "In Progress",
									updatedAt: new Date().toISOString(),
								}
							: x,
					),
				},
				by,
				"Ticket escalated to system admin",
				`${t.ref} · ${t.title}`,
			);
		});
	}, []);

	/** Post a reply. On an external ticket the applicant sees this in their portal. */
	const replyToTicket = useCallback(
		(id: string, body: string, author: string, role: "applicant" | "staff") => {
			const now = new Date().toISOString();
			setPersisted((prev) => {
				const t = prev.internalTickets.find((x) => x.id === id);
				if (!t) return prev;
				const msg: TicketMessage = {
					id: `m-${Date.now().toString(36)}`,
					author,
					role,
					body,
					at: now,
				};
				return withLog(
					{
						...prev,
						internalTickets: prev.internalTickets.map((x) =>
							x.id === id
								? {
										...x,
										messages: [...x.messages, msg],
										// An applicant reply reopens a waiting ticket
										status: role === "applicant" && x.status === "Waiting" ? "Open" : x.status,
										updatedAt: now,
									}
								: x,
						),
					},
					author,
					"Ticket reply",
					`${t.ref} · ${role === "staff" ? "staff" : "applicant"}`,
				);
			});
		},
		[],
	);



	/* ─── Marketing ─── */

	const sendCampaign = useCallback((campaign: Omit<MarketingCampaign, "id" | "status" | "sentAt">) => {
		setPersisted((prev) => ({
			...prev,
			marketingCampaigns: [
				{ ...campaign, id: `cmp-${Date.now().toString(36)}`, status: "Sent", sentAt: new Date().toISOString() },
				...prev.marketingCampaigns,
			],
		}));
	}, []);

	const createMailingList = useCallback((list: Omit<MailingList, "id" | "createdAt" | "recipientCount" | "contacts">) => {
		setPersisted((prev) => ({
			...prev,
			mailingLists: [
				{ ...list, id: `ml-${Date.now().toString(36)}`, recipientCount: 0, contacts: [], createdAt: new Date().toISOString() },
				...prev.mailingLists,
			],
		}));
	}, []);

	const deleteMailingList = useCallback((id: string) => {
		setPersisted((prev) => ({
			...prev,
			mailingLists: prev.mailingLists.filter((l) => l.id !== id),
		}));
	}, []);

	const addMailingListContact = useCallback((listId: string, name: string, email: string) => {
		setPersisted((prev) => ({
			...prev,
			mailingLists: prev.mailingLists.map((l) => {
				if (l.id !== listId) return l;
				const contact: MailingListContact = { id: `ct-${Date.now().toString(36)}`, name, email, addedAt: new Date().toISOString() };
				return { ...l, contacts: [...l.contacts, contact], recipientCount: l.contacts.length + 1 };
			}),
		}));
	}, []);

	const removeMailingListContact = useCallback((listId: string, contactId: string) => {
		setPersisted((prev) => ({
			...prev,
			mailingLists: prev.mailingLists.map((l) => {
				if (l.id !== listId) return l;
				const contacts = l.contacts.filter((c) => c.id !== contactId);
				return { ...l, contacts, recipientCount: contacts.length };
			}),
		}));
	}, []);

	const createEmailTemplate = useCallback((tpl: Omit<EmailTemplate, "id" | "createdAt" | "createdBy" | "custom">) => {
		setPersisted((prev) => ({
			...prev,
			emailTemplates: [
				{ ...tpl, id: `tpl-${Date.now().toString(36)}`, custom: true, createdAt: new Date().toISOString(), createdBy: "System" },
				...prev.emailTemplates,
			],
		}));
	}, []);

	const updateEmailTemplate = useCallback((id: string, updates: Partial<Omit<EmailTemplate, "id" | "createdAt" | "createdBy" | "custom">>) => {
		setPersisted((prev) => ({
			...prev,
			emailTemplates: prev.emailTemplates.map((t) => (t.id === id ? { ...t, ...updates } : t)),
		}));
	}, []);

	const deleteEmailTemplate = useCallback((id: string) => {
		setPersisted((prev) => ({
			...prev,
			emailTemplates: prev.emailTemplates.filter((t) => t.id !== id),
		}));
	}, []);

	/* ─── UI state ─── */

	const openCommandPalette = useCallback(() => setIsCommandOpen(true), []);
	const closeCommandPalette = useCallback(() => setIsCommandOpen(false), []);
	const openDocPreview = useCallback(
		(doc: { name: string; category?: string; status?: string }) => setPreviewDoc(doc),
		[],
	);
	const closeDocPreview = useCallback(() => setPreviewDoc(null), []);

	/* ─── Merge the live portal case into the visible lists ─── */

	const consultations = useMemo(
		() => (liveCase?.present ? [liveConsultation(liveCase, persisted.liveOverlay), ...persisted.consultations] : persisted.consultations),
		[liveCase, persisted.consultations, persisted.liveOverlay],
	);

	const applications = useMemo(
		() =>
			liveCase?.present && liveCase.consultationPaid
				? [liveApplication(liveCase, persisted.liveOverlay), ...persisted.applications]
				: persisted.applications,
		[liveCase, persisted.applications, persisted.liveOverlay],
	);

	const applicants = useMemo(
		() =>
			liveCase?.present && liveCase.applicationId
				? [liveApplicant(liveCase, persisted.liveOverlay), ...persisted.applicants]
				: persisted.applicants,
		[liveCase, persisted.applicants, persisted.liveOverlay],
	);

	const value: OpsStateContextValue = {
		consultations,
		applications,
		applicants,
		seededApplications: persisted.applications,
		liveCase,
		liveOverlay: persisted.liveOverlay,
		directives: persisted.directives,
		activityLog: persisted.activityLog,
		completeConsultationAssessment,
		acceptApplication,
		toggleApplicationChecklist,
		setApplicationStage,
		setVisaStage,
		setVisaInvoicePaid,
		setVisaCounselorNote,
		setPaymentPlan,
		advanceAgencyStage,
		setTravelClearance,
		togglePreDepartureTask,
		assignConsultation,
		confirmConsultationSlot,
		startConsultationAssessment,
		assignApplication,
		addCaseComment,
		requestDocuments,
		rescheduleConsultation,
		verifyDocument,
		setDocVerdict,
		seededDocVerdicts: persisted.seededDocVerdicts,
		packages: persisted.packages,
		savePackage,
		togglePackage,
		publishLiveCase,
		issueEligibility,
		issueAppInvoice,
		issueVisaInvoice,
		issueVisaStage,
		issuePaymentPlan,
		issueAgencyAdvance,
		issueTravelClearance,
		issueScheduleConfig,
		createInvoice,
		recordInvoicePayment,
		voidInvoice,
		creditInvoice,
		resendInvoice,
		invoices: persisted.invoices,
		cmsOverlay: persisted.cmsOverlay,
		saveCmsRecord,
		setCmsStatus,
		revertCmsRecord,
		clearDirectives,
		logActivity,
		resetOpsState,
		isCommandOpen,
		openCommandPalette,
		closeCommandPalette,
		previewDoc,
		openDocPreview,
		closeDocPreview,
		leads: persisted.leads,
		moveLead,
		addLead,
		internalTickets: persisted.internalTickets,
		createTicket,
		updateTicketStatus,
		assignTicket,
		escalateTicket,
		replyToTicket,
		marketingCampaigns: persisted.marketingCampaigns,
		sendCampaign,
		mailingLists: persisted.mailingLists,
		createMailingList,
		deleteMailingList,
		addMailingListContact,
		removeMailingListContact,
		emailTemplates: persisted.emailTemplates,
		createEmailTemplate,
		updateEmailTemplate,
		deleteEmailTemplate,
	};

	return <OpsStateContext.Provider value={value}>{children}</OpsStateContext.Provider>;
}

export function useOpsState() {
	const ctx = useContext(OpsStateContext);
	if (!ctx) throw new Error("useOpsState must be used within OpsStateProvider");
	return ctx;
}
