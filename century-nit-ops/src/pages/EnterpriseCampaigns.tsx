import { useState, useEffect, useCallback } from "react";
import { apiFetch, ApiError } from "../lib/api";
import { API_PREFIX } from "century-nit-shared";
import { ConfirmDialog, Toast } from "./OpsDialogs";

const BRAND_HEADER = "Century NIT";
const BRAND_FOOTER = "Century NIT  ·  Accra, Ghana  ·  century-nit.com";
const MKT = `${API_PREFIX}/marketing`;

type Tab = "campaigns" | "templates" | "lists";

type Campaign = {
	id: string;
	name: string;
	type: string;
	status: string;
	channel: string;
	audience?: string;
	subject?: string;
	body: string;
	templateId?: string;
	mailingListId?: string;
	sentBy?: string;
	sentAt?: string;
	recipientCount: number;
	deliveredCount: number;
	failedCount: number;
	createdAt: string;
};

type ContactStatus = "pending" | "confirmed" | "unsubscribed";

type Contact = {
	id: string;
	mailingListId: string;
	name?: string;
	email: string;
	status: ContactStatus;
	confirmedAt?: string | null;
	unsubscribedAt?: string | null;
	createdAt: string;
};

type MailingList = {
	id: string;
	name: string;
	description?: string;
	recipientCount?: number;
	contactCount?: number;
	pendingCount?: number;
	confirmedCount?: number;
	unsubscribedCount?: number;
	isNewsletter?: boolean;
	contacts?: Contact[];
	createdAt: string;
};

type EmailTemplate = {
	id: string;
	name: string;
	type: string;
	subject?: string;
	header?: string;
	body: string;
	footer?: string;
	isCustom: boolean;
	createdAt: string;
	createdBy?: string;
};

const PREDEFINED_TEMPLATES: EmailTemplate[] = [
	{
		id: "preset-welcome",
		name: "Welcome & Onboarding",
		type: "Email",
		header: "WELCOME TO CENTURY NIT",
		subject: "Welcome to Century NIT — Your Global Education Partner",
		body: `<p>Dear {{name}},</p>
<p>Thank you for registering with <strong>Century NIT</strong>. We are dedicated to supporting your international academic admissions, visa processing, and career readiness.</p>
<hr style="border:none;border-top:1px solid #e4e4e7;margin:18px 0;" />
<p style="font-weight:700;margin-bottom:8px;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;">Your Next Steps:</p>
<ul style="padding-left:18px;line-height:1.8;margin:0 0 16px 0;">
  <li><strong>Explore Partner Universities:</strong> Browse verified undergraduate & postgrad programs across the UK, Canada, USA, and Europe.</li>
  <li><strong>Upload Application Documents:</strong> Securely submit academic transcripts, test certificates, and identification to your Document Vault.</li>
  <li><strong>Schedule 1-on-1 Consultation:</strong> Connect directly with a certified admissions officer to map your visa pathway.</li>
</ul>
<p>You can access your portal anytime at <a href="https://centurynit.softclicksolutions.com/portal" style="color:#18181b;font-weight:700;">centurynit.com/portal</a>.</p>`,
		footer: "Century NIT Admissions Directorate · admissions@century-nit.com",
		isCustom: false,
		createdAt: "2026-08-20T00:00:00.000Z",
	},
	{
		id: "preset-intake-scholarship",
		name: "Intake Deadlines & Scholarship Grants",
		type: "Email",
		header: "APPLICATIONS OPEN — PARTIAL SCHOLARSHIPS AVAILABLE",
		subject: "Upcoming University Intakes & Merit Scholarship Opportunities",
		body: `<p>Dear {{name}},</p>
<p>Applications are now open for upcoming academic sessions. Our global partner universities have released exclusive partial scholarships for high-achieving applicants.</p>
<div style="background:#f4f4f5;padding:14px 16px;border-left:3px solid #18181b;margin:16px 0;">
  <p style="font-weight:800;margin:0 0 6px 0;font-size:12px;text-transform:uppercase;letter-spacing:0.05em;">Scholarship & Intake Highlights:</p>
  <p style="margin:0;font-size:13px;line-height:1.6;">• Merit awards up to £5,000 / $8,000 for qualifying transcripts<br />• Expedited conditional offer letters within 5 business days<br />• Full visa filing assistance & mock embassy interviews included</p>
</div>
<p>Spaces are allocated on a rolling basis. Contact your assigned admissions officer today to review your eligibility.</p>`,
		footer: "Century NIT Financial Aid & Scholarships Division",
		isCustom: false,
		createdAt: "2026-08-20T00:00:00.000Z",
	},
	{
		id: "preset-visa-prep",
		name: "Visa Interview & Document Checklist",
		type: "Email",
		header: "VISA INTERVIEW PREPARATION GUIDE",
		subject: "Action Required: Complete Your Visa Preparation Checklist",
		body: `<p>Dear {{name}},</p>
<p>As your visa application progresses toward submission, please review the mandatory preparation checklist below:</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:12px;">
  <thead>
    <tr style="border-bottom:2px solid #18181b;text-align:left;">
      <th style="padding:6px 0;text-transform:uppercase;letter-spacing:0.06em;">Required Document</th>
      <th style="padding:6px 0;text-transform:uppercase;letter-spacing:0.06em;">Status</th>
    </tr>
  </thead>
  <tbody>
    <tr style="border-bottom:1px solid #e4e4e7;">
      <td style="padding:8px 0;">Unconditional Offer Letter / CAS / I-20</td>
      <td style="padding:8px 0;font-weight:700;">Mandatory</td>
    </tr>
    <tr style="border-bottom:1px solid #e4e4e7;">
      <td style="padding:8px 0;">Certified Bank Statements (28-Day Holding Rule)</td>
      <td style="padding:8px 0;font-weight:700;">Mandatory</td>
    </tr>
    <tr style="border-bottom:1px solid #e4e4e7;">
      <td style="padding:8px 0;">Tuberculosis (TB) Screening Certificate</td>
      <td style="padding:8px 0;font-weight:700;">Required (UK/EU)</td>
    </tr>
  </tbody>
</table>
<p>Log in to your portal to book a 1-on-1 mock interview session with our visa compliance team.</p>`,
		footer: "Century NIT Visa & Compliance Office · compliance@century-nit.com",
		isCustom: false,
		createdAt: "2026-08-20T00:00:00.000Z",
	},
	{
		id: "preset-doc-reminder",
		name: "Document Submission Reminder",
		type: "Email",
		header: "DOCUMENT VAULT SUBMISSION PENDING",
		subject: "Reminder: Outstanding Documents for Your Application",
		body: `<p>Dear {{name}},</p>
<p>Our admissions desk has reviewed your file and noted that one or more required verification documents remain outstanding in your <strong>Document Vault</strong>.</p>
<p>To avoid delays in securing your university offer or CAS issuance, please upload your certified documents as soon as possible.</p>
<p style="margin-top:16px;"><strong>Access Vault:</strong> <a href="https://centurynit.softclicksolutions.com/portal" style="color:#18181b;font-weight:700;">centurynit.com/portal</a></p>`,
		footer: "Century NIT Document Verification Desk",
		isCustom: false,
		createdAt: "2026-08-20T00:00:00.000Z",
	},
	{
		id: "preset-sms-consultation",
		name: "Consultation Reminder (SMS)",
		type: "SMS",
		body: "Hi {{name}}, your Century NIT consultation is scheduled for tomorrow. View meeting link & time in your portal: https://centurynit.com/portal",
		isCustom: false,
		createdAt: "2026-08-20T00:00:00.000Z",
	},
	{
		id: "preset-sms-visa-update",
		name: "Visa Stage Update (SMS)",
		type: "SMS",
		body: "Hi {{name}}, your visa application status has been updated by your advisor. Log in to review the latest notes: https://centurynit.com/portal",
		isCustom: false,
		createdAt: "2026-08-20T00:00:00.000Z",
	},
	{
		id: "preset-sms-deadline",
		name: "Intake Deadline Warning (SMS)",
		type: "SMS",
		body: "Century NIT Alert: Upcoming university intake deadlines close in 5 days. Submit your pending documents today to secure your place.",
		isCustom: false,
		createdAt: "2026-08-20T00:00:00.000Z",
	},
];

export function EnterpriseCampaigns() {
	const [tab, setTab] = useState<Tab>("campaigns");

	const [campaigns, setCampaigns] = useState<Campaign[]>([]);
	const [mailingLists, setMailingLists] = useState<MailingList[]>([]);
	const [templates, setTemplates] = useState<EmailTemplate[]>(PREDEFINED_TEMPLATES);
	const [templateFilter, setTemplateFilter] = useState<"All" | "Email" | "SMS">("All");

	const [contacts, setContacts] = useState<Contact[]>([]);
	const [contactsTotal, setContactsTotal] = useState(0);
	const [contactsLoading, setContactsLoading] = useState(false);
	const [contactsFilter, setContactsFilter] = useState<ContactStatus | "all">("all");
	const [contactSearch, setContactSearch] = useState("");
	const [busyContactId, setBusyContactId] = useState<string | null>(null);

	const [loading, setLoading] = useState(true);

	const [isComposing, setIsComposing] = useState(false);
	const [isCreatingList, setIsCreatingList] = useState(false);
	const [editingListId, setEditingListId] = useState<string | null>(null);

	const [campaignName, setCampaignName] = useState("");
	const [channel, setChannel] = useState<"Email" | "SMS">("Email");
	const [selectedList, setSelectedList] = useState("");
	const [selectedTemplate, setSelectedTemplate] = useState("");
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");

	const [listName, setListName] = useState("");
	const [listDesc, setListDesc] = useState("");

	const [contactName, setContactName] = useState("");
	const [contactEmail, setContactEmail] = useState("");

	const [isEditingTemplate, setIsEditingTemplate] = useState(false);
	const [editingTplId, setEditingTplId] = useState<string | null>(null);
	const [tplName, setTplName] = useState("");
	const [tplType, setTplType] = useState<"Email" | "SMS">("Email");
	const [tplSubject, setTplSubject] = useState("");
	const [tplHeader, setTplHeader] = useState("");
	const [tplBody, setTplBody] = useState("");
	const [tplFooter, setTplFooter] = useState("");
	const [previewMode, setPreviewMode] = useState<"edit" | "preview">("edit");

	const [confirmOpen, setConfirmOpen] = useState(false);
	const [confirmTitle, setConfirmTitle] = useState("");
	const [confirmMessage, setConfirmMessage] = useState("");
	const [confirmDanger, setConfirmDanger] = useState(false);
	const [confirmAction, setConfirmAction] = useState<(() => void) | null>(null);
	const [toast, setToast] = useState<{ type: "error" | "success"; message: string } | null>(null);

	const showToast = (type: "error" | "success", message: string) => setToast({ type, message });

	const confirm = (title: string, message: string, action: () => void, danger = false) => {
		setConfirmTitle(title);
		setConfirmMessage(message);
		setConfirmDanger(danger);
		setConfirmAction(() => action);
		setConfirmOpen(true);
	};

	const fetchCampaigns = useCallback(
		() =>
			apiFetch<{ campaigns: Campaign[] }>(`${MKT}/campaigns`)
				.then((res) => setCampaigns(res?.campaigns ?? []))
				.catch(console.error),
		[],
	);
	const fetchMailingLists = useCallback(
		() =>
			apiFetch<{ lists: MailingList[] }>(`${MKT}/lists`)
				.then((res) => setMailingLists(res?.lists ?? []))
				.catch(console.error),
		[],
	);

	const fetchContacts = useCallback(
		(listId: string) => {
			setContactsLoading(true);
			const params = new URLSearchParams({ limit: "500" });
			if (contactsFilter !== "all") params.set("status", contactsFilter);
			if (contactSearch.trim()) params.set("search", contactSearch.trim());
			apiFetch<{ contacts: Contact[]; total: number }>(`${MKT}/lists/${listId}/contacts?${params.toString()}`)
				.then((res) => {
					setContacts(res?.contacts ?? []);
					setContactsTotal(res?.total ?? 0);
				})
				.catch((err) => {
					console.error("fetchContacts error:", err);
					setContacts([]);
					setContactsTotal(0);
				})
				.finally(() => setContactsLoading(false));
		},
		[contactsFilter, contactSearch],
	);

	const fetchTemplates = useCallback(
		() =>
			apiFetch<{ templates: EmailTemplate[] }>(`${MKT}/templates`)
				.then((res) => {
					const apiTpls = res?.templates ?? [];
					const combined = [
						...PREDEFINED_TEMPLATES.filter((p) => !apiTpls.some((a) => a.id === p.id || a.name === p.name)),
						...apiTpls,
					];
					setTemplates(combined);
				})
				.catch(() => setTemplates(PREDEFINED_TEMPLATES)),
		[],
	);

	useEffect(() => {
		Promise.all([fetchCampaigns(), fetchMailingLists(), fetchTemplates()]).finally(() => setLoading(false));
	}, [fetchCampaigns, fetchMailingLists, fetchTemplates]);

	/*
	 * The single place contacts are (re)fetched from list-open, filter and
	 * search changes. The 300ms delay debounces search typing — one request
	 * per keystroke against a 500-row query was pure waste — and also
	 * coalesces rapid filter clicks.
	 */
	useEffect(() => {
		if (!editingListId) return;
		const timer = setTimeout(() => void fetchContacts(editingListId), 300);
		return () => clearTimeout(timer);
	}, [editingListId, fetchContacts]);

	const openEditList = (listId: string, name: string, description?: string) => {
		setEditingListId(listId);
		setListName(name);
		setListDesc(description || "");
		setContacts([]);
		setContactsTotal(0);
		setContactsFilter("all");
		setContactSearch("");
		setContactsLoading(true);
	};

	const closeEditList = () => {
		setEditingListId(null);
		setListName("");
		setListDesc("");
		setContacts([]);
		setContactsTotal(0);
	};

	const editingList = editingListId ? mailingLists.find((l) => l.id === editingListId) : null;

	const filteredTemplates = templates.filter((t) => t.type === channel);

	const stats = {
		total: campaigns.length,
		email: campaigns.filter((c) => c.type === "Email").length,
		sms: campaigns.filter((c) => c.type === "SMS").length,
		totalRecipients: campaigns.reduce((sum, c) => sum + c.recipientCount, 0),
		totalDelivered: campaigns.reduce((sum, c) => sum + c.deliveredCount, 0),
		totalFailed: campaigns.reduce((sum, c) => sum + c.failedCount, 0),
	};

	const handleChannelChange = (ch: "Email" | "SMS") => {
		setChannel(ch);
		setSelectedTemplate("");
		setSubject("");
		setBody("");
	};

	const resetForm = () => {
		setIsComposing(false);
		setCampaignName("");
		setChannel("Email");
		setSelectedList("");
		setSelectedTemplate("");
		setSubject("");
		setBody("");
	};

	const handleTemplateSelect = (templateId: string) => {
		setSelectedTemplate(templateId);
		const tpl = templates.find((t) => t.id === templateId);
		if (tpl) {
			if (tpl.subject) setSubject(tpl.subject);
			setBody((tpl.header ? `<h1>${tpl.header}</h1>\n` : "") + tpl.body + (tpl.footer ? `\n<footer>${tpl.footer}</footer>` : ""));
		}
	};

	const handleSend = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!campaignName.trim() || !body.trim() || !selectedList) return;
		const list = mailingLists.find((l) => l.id === selectedList);
		const count = list?.recipientCount ?? 0;
		confirm("Send Campaign", `Send this campaign to ${count} contacts?`, async () => {
			try {
				const res = await apiFetch<{ campaign: { id: string } }>(`${MKT}/campaigns`, {
					method: "POST",
					body: JSON.stringify({
						name: campaignName.trim(),
						type: channel,
						channel,
						subject: channel === "Email" ? subject : undefined,
						body,
						templateId: selectedTemplate || undefined,
						mailingListId: selectedList,
						audience: list?.name || "Unknown",
					}),
				});
				await apiFetch(`${MKT}/campaigns/${res.campaign.id}/send`, { method: "POST" });
				resetForm();
				fetchCampaigns();
				showToast("success", "Campaign sent successfully");
			} catch (err) {
				showToast("error", `Failed to send campaign: ${err instanceof Error ? err.message : "Unknown error"}`);
			}
		});
	};

	const handleCreateList = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!listName.trim()) return;
		try {
			await apiFetch(`${MKT}/mailing-lists`, {
				method: "POST",
				body: JSON.stringify({ name: listName.trim(), description: listDesc.trim() || undefined }),
			});
			setIsCreatingList(false);
			setListName("");
			setListDesc("");
			fetchMailingLists();
			showToast("success", "List created");
		} catch (err) {
			showToast("error", `Failed to create list: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const handleSaveEdit = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!editingListId || !listName.trim()) return;
		try {
			await apiFetch(`${MKT}/mailing-lists/${editingListId}`, {
				method: "PUT",
				body: JSON.stringify({ name: listName.trim(), description: listDesc.trim() || undefined }),
			});
			fetchMailingLists();
			closeEditList();
			showToast("success", "List saved");
		} catch (err) {
			showToast("error", `Failed to save list: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const handleDeleteList = async (id: string) => {
		confirm("Delete Mailing List", "Delete this mailing list?", async () => {
			try {
				await apiFetch(`${MKT}/mailing-lists/${id}`, { method: "DELETE" });
				fetchMailingLists();
				showToast("success", "List deleted");
			} catch (err) {
				showToast("error", `Failed to delete list: ${err instanceof Error ? err.message : "Unknown error"}`);
			}
		}, true);
	};

	const refreshContactsAndList = () => {
		if (editingListId) void fetchContacts(editingListId);
		fetchMailingLists();
	};

	const handleAddContact = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!editingListId || !contactEmail.trim()) return;
		try {
			await apiFetch(`${MKT}/mailing-lists/${editingListId}/contacts`, {
				method: "POST",
				body: JSON.stringify({ name: contactName.trim() || undefined, email: contactEmail.trim() }),
			});
			setContactName("");
			setContactEmail("");
			refreshContactsAndList();
		} catch (err) {
			if (err instanceof ApiError && err.code === "DUPLICATE") {
				showToast("error", "This email already exists in the list.");
			} else {
				showToast("error", `Failed to add contact: ${err instanceof Error ? err.message : "Unknown error"}`);
			}
		}
	};

	const handleRemoveContact = async (contactId: string) => {
		if (!editingListId) return;
		setBusyContactId(contactId);
		try {
			await apiFetch(`${MKT}/mailing-lists/${editingListId}/contacts/${contactId}`, { method: "DELETE" });
			refreshContactsAndList();
		} catch (err) {
			showToast("error", `Failed to remove contact: ${err instanceof Error ? err.message : "Unknown error"}`);
		} finally {
			setBusyContactId(null);
		}
	};

	const handleConfirmContact = async (contactId: string) => {
		if (!editingListId) return;
		setBusyContactId(contactId);
		try {
			await apiFetch(`${MKT}/mailing-lists/${editingListId}/contacts/${contactId}/confirm`, { method: "POST" });
			refreshContactsAndList();
			showToast("success", "Contact confirmed");
		} catch (err) {
			showToast("error", `Failed to confirm: ${err instanceof Error ? err.message : "Unknown error"}`);
		} finally {
			setBusyContactId(null);
		}
	};

	const handleResendConfirmation = async (contactId: string) => {
		if (!editingListId) return;
		setBusyContactId(contactId);
		try {
			await apiFetch(`${MKT}/mailing-lists/${editingListId}/contacts/${contactId}/resend-confirmation`, { method: "POST" });
			showToast("success", "Confirmation email sent");
		} catch (err) {
			showToast("error", `Failed to resend: ${err instanceof Error ? err.message : "Unknown error"}`);
		} finally {
			setBusyContactId(null);
		}
	};

	const handleUnsubscribeContact = async (contactId: string) => {
		if (!editingListId) return;
		confirm("Unsubscribe Contact", "Mark this contact as unsubscribed? They will stop receiving campaigns.", async () => {
			setBusyContactId(contactId);
			try {
				await apiFetch(`${MKT}/mailing-lists/${editingListId}/contacts/${contactId}/unsubscribe`, { method: "POST" });
				refreshContactsAndList();
				showToast("success", "Contact unsubscribed");
			} catch (err) {
				showToast("error", `Failed to unsubscribe: ${err instanceof Error ? err.message : "Unknown error"}`);
			} finally {
				setBusyContactId(null);
			}
		});
	};

	const handleImportLeads = async () => {
		if (!editingListId) return;
		try {
			const res = await apiFetch<{ imported: number; skipped: number }>(`${MKT}/mailing-lists/${editingListId}/import-leads`, { method: "POST" });
			refreshContactsAndList();
			showToast("success", `Imported ${res.imported} lead${res.imported === 1 ? "" : "s"} (${res.skipped} skipped)`);
		} catch (err) {
			showToast("error", `Failed to import leads: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const handleImportApplicants = async () => {
		if (!editingListId) return;
		try {
			const res = await apiFetch<{ imported: number; skipped: number }>(`${MKT}/mailing-lists/${editingListId}/import-applicants`, { method: "POST" });
			refreshContactsAndList();
			showToast("success", `Imported ${res.imported} applicant${res.imported === 1 ? "" : "s"} (${res.skipped} skipped)`);
		} catch (err) {
			showToast("error", `Failed to import applicants: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const resetTplForm = () => {
		setIsEditingTemplate(false);
		setEditingTplId(null);
		setTplName("");
		setTplType("Email");
		setTplSubject("");
		setTplHeader("");
		setTplBody("");
		setTplFooter("");
		setPreviewMode("edit");
	};

	const handleSaveTpl = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!tplName.trim() || !tplBody.trim()) return;
		const payload = {
			name: tplName.trim(),
			type: tplType,
			subject: tplSubject || undefined,
			header: tplHeader || undefined,
			body: tplBody,
			footer: tplFooter || undefined,
		};
		try {
			if (editingTplId) {
				await apiFetch(`${MKT}/templates/${editingTplId}`, { method: "PUT", body: JSON.stringify(payload) });
			} else {
				await apiFetch(`${MKT}/templates`, { method: "POST", body: JSON.stringify(payload) });
			}
			resetTplForm();
			fetchTemplates();
			showToast("success", editingTplId ? "Template saved" : "Template created");
		} catch (err) {
			showToast("error", `Failed to save template: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const handleDeleteTpl = async (id: string) => {
		confirm("Delete Template", "Delete this template?", async () => {
			try {
				await apiFetch(`${MKT}/templates/${id}`, { method: "DELETE" });
				fetchTemplates();
				showToast("success", "Template deleted");
			} catch (err) {
				showToast("error", `Failed to delete template: ${err instanceof Error ? err.message : "Unknown error"}`);
			}
		}, true);
	};

	const handleEditTpl = (tpl: EmailTemplate) => {
		setEditingTplId(tpl.id);
		setTplName(tpl.name);
		setTplType(tpl.type as "Email" | "SMS");
		setTplSubject(tpl.subject || "");
		setTplHeader(tpl.header || "");
		setTplBody(tpl.body);
		setTplFooter(tpl.footer || "");
		setIsEditingTemplate(true);
		setPreviewMode("edit");
	};

	if (loading) {
		return (
			<div className="page-content fade-in" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
				<span style={{ color: "var(--muted-foreground)" }}>Loading...</span>
			</div>
		);
	}

	return (
		<div className="page-content fade-in" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.5rem" }}>
				<div>
					<h1 className="page-title">Marketing Campaigns</h1>
					<p className="lead mt-2">Broadcast email newsletters and bulk SMS alerts to your applicants and leads.</p>
				</div>
				{tab === "campaigns" && (
					<button type="button" className="btn btn--primary" onClick={() => setIsComposing(true)}>
						+ New Campaign
					</button>
				)}
				{tab === "lists" && !isCreatingList && !editingListId && (
					<button type="button" className="btn btn--primary" onClick={() => setIsCreatingList(true)}>
						+ New List
					</button>
				)}
				{tab === "templates" && !isEditingTemplate && (
					<button type="button" className="btn btn--primary" onClick={() => setIsEditingTemplate(true)}>
						+ New Template
					</button>
				)}
			</div>

			<div style={{ display: "flex", gap: "0.5rem", marginBottom: "1.5rem", borderBottom: "1px solid var(--border-light)" }}>
				{(["campaigns", "templates", "lists"] as Tab[]).map((t) => (
					<button
						key={t}
						type="button"
						onClick={() => { setTab(t); setEditingListId(null); setIsCreatingList(false); setIsEditingTemplate(false); setEditingTplId(null); }}
						style={{
							padding: "0.6rem 1.2rem",
							border: "none",
							borderBottom: tab === t ? "2px solid var(--primary)" : "2px solid transparent",
							background: "transparent",
							color: tab === t ? "var(--primary)" : "var(--muted-foreground)",
							fontWeight: tab === t ? 600 : 400,
							cursor: "pointer",
							textTransform: "capitalize",
						}}
					>
						{t === "lists" ? "Mailing Lists" : t}
					</button>
				))}
			</div>

			{tab === "campaigns" && (
				<>
					<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
						<div className="card" style={{ padding: "1rem" }}>
							<div className="eyebrow">Total Campaigns</div>
							<div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem" }}>{stats.total}</div>
						</div>
						<div className="card" style={{ padding: "1rem" }}>
							<div className="eyebrow">Email</div>
							<div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "var(--primary)" }}>{stats.email}</div>
						</div>
						<div className="card" style={{ padding: "1rem" }}>
							<div className="eyebrow">SMS</div>
							<div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "#10b981" }}>{stats.sms}</div>
						</div>
						<div className="card" style={{ padding: "1rem" }}>
							<div className="eyebrow">Total Recipients</div>
							<div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem" }}>{stats.totalRecipients}</div>
						</div>
						<div className="card" style={{ padding: "1rem" }}>
							<div className="eyebrow">Total Delivered</div>
							<div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "#10b981" }}>{stats.totalDelivered}</div>
						</div>
						<div className="card" style={{ padding: "1rem" }}>
							<div className="eyebrow">Total Failed</div>
							<div style={{ fontSize: "1.5rem", fontWeight: "bold", marginTop: "0.25rem", color: "#ef4444" }}>{stats.totalFailed}</div>
						</div>
					</div>

					{isComposing && (
						<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem", borderLeft: "4px solid var(--primary)" }}>
							<h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>New Campaign</h3>
							<form onSubmit={handleSend}>
								<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
									<div>
										<label className="label">Campaign Name</label>
										<input type="text" className="input" placeholder="e.g. Fall Intake Newsletter" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} autoFocus />
									</div>
									<div>
										<label className="label">Channel</label>
										<select className="input" value={channel} onChange={(e) => handleChannelChange(e.target.value as "Email" | "SMS")}>
											<option value="Email">Email</option>
											<option value="SMS">SMS</option>
										</select>
									</div>
									<div>
										<label className="label">Mailing List</label>
										<select className="input" value={selectedList} onChange={(e) => setSelectedList(e.target.value)}>
											<option value="">Select audience...</option>
											{mailingLists.map((ml) => (
												<option key={ml.id} value={ml.id}>{ml.name} ({ml.recipientCount ?? 0} confirmed)</option>
											))}
										</select>
									</div>
								</div>

								<div style={{ marginBottom: "1rem" }}>
									<label className="label">Template (optional)</label>
									<select className="input" value={selectedTemplate} onChange={(e) => handleTemplateSelect(e.target.value)}>
										<option value="">Start from scratch</option>
										{filteredTemplates.map((tpl) => (
											<option key={tpl.id} value={tpl.id}>{tpl.name}</option>
										))}
									</select>
								</div>

								{channel === "Email" && (
									<div style={{ marginBottom: "1rem" }}>
										<label className="label">Subject Line</label>
										<input type="text" className="input" placeholder="e.g. New scholarship opportunities" value={subject} onChange={(e) => setSubject(e.target.value)} />
									</div>
								)}

								<div style={{ marginBottom: "1.25rem" }}>
									<label className="label">{channel === "Email" ? "Email Body" : "SMS Message"}</label>
									<textarea
										className="input"
										rows={channel === "SMS" ? 4 : 8}
										placeholder={channel === "SMS" ? "Type your text message..." : "Write your email content. Use {{name}} for personalization."}
										value={body}
										onChange={(e) => setBody(e.target.value)}
									/>
									<div style={{ display: "flex", justifyContent: "space-between", marginTop: "0.25rem" }}>
										<span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
											Use {"{{name}}"}, {"{{date}}"}, {"{{intake}}"} for personalization
										</span>
										{channel === "SMS" && (
											<span style={{ fontSize: "0.75rem", color: body.length > 160 ? "#ef4444" : "var(--muted-foreground)" }}>
												{body.length} / 160 chars
											</span>
										)}
									</div>
								</div>

								<div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
									<button type="button" className="btn btn--ghost" onClick={resetForm}>Cancel</button>
									<button type="submit" className="btn btn--primary" disabled={!campaignName.trim() || !body.trim() || !selectedList}>
										Send {channel}
									</button>
								</div>
							</form>
						</div>
					)}

					<div className="card" style={{ flex: 1, overflowY: "auto", padding: 0 }}>
						<div className="ops-table-wrap">
							<table className="admin-table">
								<thead>
									<tr>
										<th>Campaign</th>
										<th>Channel</th>
										<th>Audience</th>
										<th>Status</th>
										<th>Recipients</th>
										<th>Delivered</th>
										<th>Failed</th>
										<th>Sent</th>
									</tr>
								</thead>
								<tbody>
									{campaigns.length === 0 ? (
										<tr>
											<td colSpan={8} style={{ textAlign: "center", padding: "2rem", color: "var(--muted-foreground)" }}>
												No campaigns sent yet.
											</td>
										</tr>
									) : (
										campaigns.map((camp) => (
											<tr key={camp.id}>
												<td style={{ fontWeight: 600 }}>{camp.name}</td>
												<td>
													<span style={{
														padding: "0.15rem 0.5rem",
														fontSize: "0.75rem",
														fontWeight: 600,
														background: camp.type === "Email" ? "rgba(59, 130, 246, 0.1)" : "rgba(16, 185, 129, 0.1)",
														color: camp.type === "Email" ? "var(--primary)" : "#10b981",
													}}>
														{camp.type}
													</span>
												</td>
												<td style={{ color: "var(--muted-foreground)" }}>{camp.audience}</td>
												<td>
												<span style={{ fontSize: "0.85rem", color: camp.status.toLowerCase() === "sent" ? "#10b981" : "var(--muted-foreground)" }}>
													{camp.status}
												</span>
												</td>
												<td>{camp.recipientCount}</td>
												<td style={{ color: "#10b981" }}>{camp.deliveredCount}</td>
												<td style={{ color: camp.failedCount > 0 ? "#ef4444" : "var(--muted-foreground)" }}>{camp.failedCount}</td>
												<td style={{ color: "var(--muted-foreground)" }}>
													{camp.sentAt ? new Date(camp.sentAt).toLocaleDateString() : "-"}
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>
				</>
			)}

			{tab === "templates" && (
				<>
					{isEditingTemplate && (
						<div className="card mkt-tpl-editor" style={{ marginBottom: "1.5rem", padding: "1.5rem", borderLeft: "4px solid var(--primary)" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
								<h3 style={{ fontSize: "1.1rem" }}>
									{editingTplId ? "Edit Template" : "New Template"}
								</h3>
								{tplType === "Email" && (
									<div className="mkt-tpl-editor__tabs">
										<button type="button" className={previewMode === "edit" ? "active" : ""} onClick={() => setPreviewMode("edit")}>Edit</button>
										<button type="button" className={previewMode === "preview" ? "active" : ""} onClick={() => setPreviewMode("preview")}>Preview</button>
									</div>
								)}
							</div>

							<form onSubmit={handleSaveTpl}>
								<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
									<div>
										<label className="label">Template Name</label>
										<input type="text" className="input" placeholder="e.g. Welcome Email" value={tplName} onChange={(e) => setTplName(e.target.value)} autoFocus />
									</div>
									<div>
										<label className="label">Channel</label>
										<select className="input" value={tplType} onChange={(e) => setTplType(e.target.value as "Email" | "SMS")}>
											<option value="Email">Email</option>
											<option value="SMS">SMS</option>
										</select>
									</div>
								</div>

								{tplType === "Email" && (
									<>
										<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
											<div>
												<label className="label">Subject Line</label>
												<input type="text" className="input" placeholder="Email subject..." value={tplSubject} onChange={(e) => setTplSubject(e.target.value)} />
											</div>
											<div>
												<label className="label">Header / Headline</label>
												<input type="text" className="input" placeholder="e.g. Welcome Aboard!" value={tplHeader} onChange={(e) => setTplHeader(e.target.value)} />
											</div>
										</div>

										{previewMode === "edit" ? (
											<div className="mkt-tpl-editor__code">
												<label className="label">HTML Body <span style={{ fontWeight: 400, fontSize: "0.75rem" }}>(use inline styles, {"{{name}}"} for personalization)</span></label>
												<textarea
													className="input mkt-tpl-editor__textarea"
													rows={14}
													placeholder="<p>Dear {{name}},</p><p>Your content here...</p>"
													value={tplBody}
													onChange={(e) => setTplBody(e.target.value)}
													spellCheck={false}
												/>
											</div>
										) : (
											<div className="mkt-tpl-editor__preview">
												<div className="mkt-email-preview">
													<div className="mkt-email-preview__brand">{BRAND_HEADER}</div>
													{tplHeader && <div className="mkt-email-preview__headline">{tplHeader}</div>}
													<div className="mkt-email-preview__subject">
														<span className="mkt-email-preview__subject-label">Subject:</span> {tplSubject || "(no subject)"}
													</div>
													<div className="mkt-email-preview__body" dangerouslySetInnerHTML={{ __html: tplBody || "<p style='color:#9ca3af'>Start typing to see preview...</p>" }} />
													{tplFooter && <div className="mkt-email-preview__footer">{tplFooter}</div>}
													<div className="mkt-email-preview__brand-footer">{BRAND_FOOTER}</div>
												</div>
											</div>
										)}

										<div style={{ marginBottom: "1rem" }}>
											<label className="label">Footer</label>
											<input type="text" className="input" placeholder="Unsubscribe notice or disclaimer" value={tplFooter} onChange={(e) => setTplFooter(e.target.value)} />
										</div>
									</>
								)}

								{tplType === "SMS" && (
									<div style={{ marginBottom: "1rem" }}>
										<label className="label">SMS Message <span style={{ fontWeight: 400, fontSize: "0.75rem" }}>({"{{name}}"} for personalization)</span></label>
										<textarea
											className="input"
											rows={4}
											placeholder="Type your text message..."
											value={tplBody}
											onChange={(e) => setTplBody(e.target.value)}
										/>
										<span style={{ fontSize: "0.75rem", color: tplBody.length > 160 ? "#ef4444" : "var(--muted-foreground)", marginTop: "0.25rem", display: "block" }}>
											{tplBody.length} / 160 chars
										</span>
									</div>
								)}

								<div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
									<button type="button" className="btn btn--ghost" onClick={resetTplForm}>Cancel</button>
									<button type="submit" className="btn btn--primary" disabled={!tplName.trim() || !tplBody.trim()}>
										{editingTplId ? "Save Changes" : "Create Template"}
									</button>
								</div>
							</form>
						</div>
					)}

					{!isEditingTemplate && (
						<>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", flexWrap: "wrap", gap: "0.75rem" }}>
								<div style={{ display: "flex", gap: "0", alignItems: "center" }}>
									{(["All", "Email", "SMS"] as const).map((f, i) => (
										<button
											key={f}
											type="button"
											style={{
												fontSize: "0.75rem",
												padding: "0.35rem 0.85rem",
												fontWeight: 700,
												textTransform: "uppercase",
												letterSpacing: "0.04em",
												background: templateFilter === f ? "#18181b" : "#ffffff",
												color: templateFilter === f ? "#ffffff" : "#18181b",
												border: "1px solid #18181b",
												marginLeft: i > 0 ? "-1px" : "0",
												cursor: "pointer",
												transition: "all 100ms",
											}}
											onClick={() => setTemplateFilter(f)}
										>
											{f} ({f === "All" ? templates.length : templates.filter((t) => t.type === f).length})
										</button>
									))}
								</div>
								<div style={{ fontSize: "0.8rem", color: "#52525b", fontFamily: "var(--font-mono)" }}>
									Showing {templateFilter === "All" ? templates.length : templates.filter((t) => t.type === templateFilter).length} templates
								</div>
							</div>

							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "1.5rem" }}>
								{templates
									.filter((tpl) => templateFilter === "All" || tpl.type === templateFilter)
									.map((tpl) => (
									<div key={tpl.id} className="card" style={{ padding: 0, display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid var(--border)", borderTop: "2px solid #18181b" }}>
										<div style={{
											padding: "0.75rem 1.25rem",
											display: "flex",
											justifyContent: "space-between",
											alignItems: "center",
											borderBottom: "1px solid var(--border-light)",
											background: "#fafafa",
										}}>
											<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
												<span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#18181b" }}>{tpl.name}</span>
												<span style={{
													fontSize: "0.65rem",
													fontWeight: 800,
													textTransform: "uppercase",
													letterSpacing: "0.05em",
													padding: "2px 6px",
													background: tpl.isCustom ? "#18181b" : "#f4f4f5",
													color: tpl.isCustom ? "#ffffff" : "#52525b",
													border: tpl.isCustom ? "1px solid #18181b" : "1px solid #d4d4d8",
												}}>
													{tpl.isCustom ? "Custom" : "Preset"}
												</span>
											</div>
											<span style={{
												fontSize: "0.65rem",
												fontWeight: 800,
												padding: "2px 8px",
												textTransform: "uppercase",
												letterSpacing: "0.06em",
												background: tpl.type === "Email" ? "#18181b" : "#f4f4f5",
												color: tpl.type === "Email" ? "#ffffff" : "#18181b",
												border: "1px solid #18181b",
											}}>
												{tpl.type}
											</span>
										</div>

										{tpl.type === "Email" ? (
											<div className="mkt-email-preview">
												<div className="mkt-email-preview__brand">{BRAND_HEADER}</div>
												{tpl.header && <div className="mkt-email-preview__headline" style={{ color: "#18181b", fontWeight: 800 }}>{tpl.header}</div>}
												<div className="mkt-email-preview__subject" style={{ color: "#18181b", fontWeight: 600 }}>
													<span className="mkt-email-preview__subject-label" style={{ color: "#71717a" }}>Subject:</span> {tpl.subject}
												</div>
												<div className="mkt-email-preview__body" dangerouslySetInnerHTML={{ __html: tpl.body }} />
												{tpl.footer && <div className="mkt-email-preview__footer" style={{ color: "#71717a" }}>{tpl.footer}</div>}
												<div className="mkt-email-preview__brand-footer">{BRAND_FOOTER}</div>
											</div>
										) : (
											<div style={{ padding: "1.5rem", flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
												<div style={{
													background: "#f4f4f5",
													padding: "1.25rem",
													fontSize: "0.85rem",
													lineHeight: 1.6,
													color: "#18181b",
													fontFamily: "var(--font-mono)",
													borderLeft: "3px solid #18181b",
												}}>
													{tpl.body}
												</div>
												<span style={{ fontSize: "0.75rem", color: "#71717a", fontFamily: "var(--font-mono)" }}>
													{tpl.body.length} characters
												</span>
											</div>
										)}

										<div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid var(--border-light)", display: "flex", gap: "0.5rem", background: "#ffffff" }}>
											<button
												type="button"
												className="btn btn--primary"
												style={{ flex: 1, fontSize: "0.75rem", padding: "0.45rem 0.75rem" }}
												onClick={() => {
													setTab("campaigns");
													setIsComposing(true);
													setChannel(tpl.type as "Email" | "SMS");
													setSelectedTemplate(tpl.id);
													if (tpl.subject) setSubject(tpl.subject);
													setBody((tpl.header ? `<h1>${tpl.header}</h1>\n` : "") + tpl.body + (tpl.footer ? `\n<footer>${tpl.footer}</footer>` : ""));
												}}
											>
												Use This Template
											</button>
											<button
												type="button"
												className="btn btn--ghost"
												style={{ fontSize: "0.75rem", padding: "0.45rem 0.75rem", color: "#18181b", fontWeight: 700 }}
												onClick={() => handleEditTpl(tpl)}
											>
												{tpl.isCustom ? "Edit" : "Customize"}
											</button>
											{tpl.isCustom && (
												<button
													type="button"
													className="btn btn--ghost"
													style={{ fontSize: "0.75rem", padding: "0.45rem 0.75rem", color: "#18181b", borderColor: "#71717a", fontWeight: 700 }}
													onClick={() => handleDeleteTpl(tpl.id)}
												>
													Delete
												</button>
											)}
										</div>
									</div>
								))}
							</div>
						</>
					)}
				</>
			)}

			{tab === "lists" && (
				<>
					{!isCreatingList && !editingListId && (
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
							<div className="card" style={{ padding: "1.25rem 1.5rem", borderTop: "2px solid #18181b" }}>
								<div className="eyebrow" style={{ color: "#71717a", fontWeight: 700 }}>Total Lists</div>
								<div style={{ fontSize: "1.75rem", fontWeight: 800, marginTop: "0.25rem", color: "#18181b" }}>{mailingLists.length}</div>
							</div>
							<div className="card" style={{ padding: "1.25rem 1.5rem", borderTop: "2px solid #18181b" }}>
								<div className="eyebrow" style={{ color: "#71717a", fontWeight: 700 }}>Total Subscribers</div>
								<div style={{ fontSize: "1.75rem", fontWeight: 800, marginTop: "0.25rem", color: "#18181b" }}>
									{mailingLists.reduce((sum, ml) => sum + (ml.confirmedCount ?? 0), 0)}
								</div>
							</div>
							<div className="card" style={{ padding: "1.25rem 1.5rem", borderTop: "2px solid #18181b" }}>
								<div className="eyebrow" style={{ color: "#71717a", fontWeight: 700 }}>Pending Confirmations</div>
								<div style={{ fontSize: "1.75rem", fontWeight: 800, marginTop: "0.25rem", color: "#18181b" }}>
									{mailingLists.reduce((sum, ml) => sum + (ml.pendingCount ?? 0), 0)}
								</div>
							</div>
						</div>
					)}

					{isCreatingList && (
						<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem", border: "1px solid var(--border)", borderTop: "2px solid #18181b" }}>
							<h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem", color: "#18181b" }}>New Mailing List</h3>
							<form onSubmit={handleCreateList}>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem", marginBottom: "1rem" }}>
									<div>
										<label className="label" style={{ fontWeight: 700, color: "#18181b" }}>List Name</label>
										<input type="text" className="input" placeholder="e.g. UK Applicants" value={listName} onChange={(e) => setListName(e.target.value)} autoFocus />
									</div>
									<div>
										<label className="label" style={{ fontWeight: 700, color: "#18181b" }}>Description</label>
										<input type="text" className="input" placeholder="Brief description of this audience" value={listDesc} onChange={(e) => setListDesc(e.target.value)} />
									</div>
								</div>
								<div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
									<button type="button" className="btn btn--ghost" onClick={() => { setIsCreatingList(false); setListName(""); setListDesc(""); }}>
										Cancel
									</button>
									<button type="submit" className="btn btn--primary" disabled={!listName.trim()}>
										Create List
									</button>
								</div>
							</form>
						</div>
					)}

				{editingList && (
					<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem", border: "1px solid var(--border)", borderTop: "2px solid #18181b" }}>
						<div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "1.25rem", paddingBottom: "0.75rem", borderBottom: "1px solid var(--border-light)" }}>
							<div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
								<h3 style={{ fontSize: "1.15rem", fontWeight: 800, color: "#18181b", margin: 0 }}>
									Edit Mailing List
								</h3>
								{editingList.isNewsletter && (
									<span style={{ fontSize: "0.65rem", fontWeight: 800, background: "#18181b", color: "#ffffff", padding: "2px 8px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
										Newsletter
									</span>
								)}
							</div>
							<button type="button" className="btn btn--ghost btn--sm" onClick={closeEditList}>
								✕ Close Editor
							</button>
						</div>

						<form onSubmit={handleSaveEdit}>
							<div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem", marginBottom: "1rem" }}>
								<div>
									<label className="label" style={{ fontWeight: 700, color: "#18181b" }}>List Name</label>
									<input
										type="text"
										className="input"
										value={listName}
										onChange={(e) => setListName(e.target.value)}
										autoFocus
										disabled={editingList.isNewsletter}
										title={editingList.isNewsletter ? "The Website Newsletter list cannot be renamed" : undefined}
									/>
								</div>
								<div>
									<label className="label" style={{ fontWeight: 700, color: "#18181b" }}>Description</label>
									<input type="text" className="input" value={listDesc} onChange={(e) => setListDesc(e.target.value)} />
								</div>
							</div>
							<div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginBottom: "1.5rem" }}>
								<button type="button" className="btn btn--ghost" onClick={closeEditList}>
									Cancel
								</button>
								<button type="submit" className="btn btn--primary" disabled={!listName.trim()}>
									Save Changes
								</button>
							</div>
						</form>

						<div style={{ marginTop: "1.5rem", borderTop: "2px solid #18181b", paddingTop: "1.5rem" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap", gap: "0.75rem" }}>
								<div>
									<h4 style={{ fontSize: "1rem", fontWeight: 800, color: "#18181b", display: "inline-block", marginRight: "0.75rem" }}>
										Contacts
									</h4>
									<span style={{ fontWeight: 600, fontSize: "0.8rem", color: "#52525b", fontFamily: "var(--font-mono)" }}>
										{editingList.confirmedCount ?? 0} confirmed
										{(editingList.pendingCount ?? 0) > 0 && <> · {editingList.pendingCount} pending</>}
										{(editingList.unsubscribedCount ?? 0) > 0 && <> · {editingList.unsubscribedCount} unsubscribed</>}
									</span>
								</div>
								<div style={{ display: "flex", gap: "0.5rem" }}>
									<button type="button" className="btn btn--ghost btn--sm" style={{ fontWeight: 700, color: "#18181b" }} onClick={handleImportLeads}>
										Import All Leads
									</button>
									<button type="button" className="btn btn--ghost btn--sm" style={{ fontWeight: 700, color: "#18181b" }} onClick={handleImportApplicants}>
										Import Applicants
									</button>
								</div>
							</div>

							<form
								onSubmit={handleAddContact}
								style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr auto", gap: "0.75rem", marginBottom: "1.25rem", background: "var(--muted)", padding: "1rem", border: "1px solid var(--border-light)" }}
							>
								<div>
									<label className="label" style={{ fontWeight: 700, color: "#18181b", fontSize: "0.7rem", textTransform: "uppercase" }}>Name</label>
									<input type="text" className="input" placeholder="Contact name (optional)" value={contactName} onChange={(e) => setContactName(e.target.value)} />
								</div>
								<div>
									<label className="label" style={{ fontWeight: 700, color: "#18181b", fontSize: "0.7rem", textTransform: "uppercase" }}>Email</label>
									<input type="email" className="input" placeholder="email@example.com" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
								</div>
								<div style={{ display: "flex", alignItems: "flex-end" }}>
									<button type="submit" className="btn btn--primary" style={{ padding: "0.55rem 1.25rem" }} disabled={!contactEmail.trim()}>
										+ Add Contact
									</button>
								</div>
							</form>

							<div style={{ display: "flex", gap: "0", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
								{(["all", "confirmed", "pending", "unsubscribed"] as const).map((f, i) => (
									<button
										key={f}
										type="button"
										style={{
											fontSize: "0.75rem",
											padding: "0.35rem 0.85rem",
											fontWeight: 700,
											textTransform: "uppercase",
											letterSpacing: "0.04em",
											background: contactsFilter === f ? "#18181b" : "#ffffff",
											color: contactsFilter === f ? "#ffffff" : "#18181b",
											border: "1px solid #18181b",
											marginLeft: i > 0 ? "-1px" : "0",
											cursor: "pointer",
											transition: "all 100ms",
										}}
										onClick={() => setContactsFilter(f)}
									>
										{f === "all" ? "All" : f}
									</button>
								))}
								<input
									type="text"
									className="input"
									placeholder="Search name or email..."
									value={contactSearch}
									onChange={(e) => setContactSearch(e.target.value)}
									style={{ marginLeft: "auto", maxWidth: "260px", fontSize: "0.8rem", padding: "0.35rem 0.75rem", border: "1px solid #18181b" }}
								/>
							</div>

							{contactsLoading ? (
								<p style={{ color: "#18181b", fontSize: "0.85rem", padding: "1rem" }}>Loading contacts…</p>
							) : contacts.length === 0 ? (
								<p style={{ color: "#52525b", fontSize: "0.85rem", padding: "1.25rem", background: "var(--muted)", border: "1px solid var(--border-light)" }}>
									{contactsFilter === "all"
										? "No contacts yet. Add recipients above or import from leads/applicants."
										: `No ${contactsFilter} contacts.`}
								</p>
							) : (
								<div className="ops-table-wrap">
									<table className="admin-table">
										<thead>
											<tr>
												<th>Name</th>
												<th>Email</th>
												<th>Status</th>
												<th>Confirmed / Unsubscribed</th>
												<th>Added</th>
												<th style={{ textAlign: "right" }}></th>
											</tr>
										</thead>
										<tbody>
											{contacts.map((c) => (
												<tr key={c.id}>
													<td style={{ fontWeight: 700, color: "#18181b" }}>{c.name || "—"}</td>
													<td style={{ color: "#18181b", fontFamily: "var(--font-mono)", fontSize: "0.85rem" }}>{c.email}</td>
													<td>
														<span style={{
															padding: "3px 8px",
															fontSize: "0.68rem",
															fontWeight: 800,
															textTransform: "uppercase",
															letterSpacing: "0.04em",
															fontFamily: "var(--font-mono)",
															display: "inline-block",
															background: c.status === "confirmed" ? "#18181b" : "#f4f4f5",
															color: c.status === "confirmed" ? "#ffffff" : "#18181b",
															border: c.status === "confirmed" ? "1px solid #18181b" : c.status === "pending" ? "1px solid #71717a" : "1px dashed #71717a",
														}}>
															{c.status}
														</span>
													</td>
													<td style={{ color: "#52525b", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>
														{c.status === "confirmed" && c.confirmedAt ? `Confirmed ${new Date(c.confirmedAt).toLocaleDateString()}` :
														 c.status === "unsubscribed" && c.unsubscribedAt ? `Unsubscribed ${new Date(c.unsubscribedAt).toLocaleDateString()}` :
														 "—"}
													</td>
													<td style={{ color: "#52525b", fontSize: "0.8rem", fontFamily: "var(--font-mono)" }}>{new Date(c.createdAt).toLocaleDateString()}</td>
													<td>
														<div style={{ display: "flex", gap: "0.4rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
															{c.status === "pending" && (
																<>
																	<button
																		type="button"
																		className="btn btn--ghost"
																		style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem", color: "#18181b", fontWeight: 700 }}
																		disabled={busyContactId === c.id}
																		onClick={() => handleConfirmContact(c.id)}
																	>
																		Confirm
																	</button>
																	<button
																		type="button"
																		className="btn btn--ghost"
																		style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem", color: "#18181b", fontWeight: 700 }}
																		disabled={busyContactId === c.id}
																		onClick={() => handleResendConfirmation(c.id)}
																	>
																		Resend
																	</button>
																</>
															)}
															{c.status === "unsubscribed" && (
																<button
																	type="button"
																	className="btn btn--ghost"
																	style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem", color: "#18181b", fontWeight: 700 }}
																	disabled={busyContactId === c.id}
																	onClick={() => handleConfirmContact(c.id)}
																>
																	Re-subscribe
																</button>
															)}
															{c.status === "confirmed" && (
																<button
																	type="button"
																	className="btn btn--ghost"
																	style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem", color: "#18181b", fontWeight: 700 }}
																	disabled={busyContactId === c.id}
																	onClick={() => handleUnsubscribeContact(c.id)}
																>
																	Unsubscribe
																</button>
															)}
															<button
																type="button"
																className="btn btn--ghost"
																style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem", color: "#18181b", borderColor: "#71717a", fontWeight: 700 }}
																disabled={busyContactId === c.id}
																onClick={() => handleRemoveContact(c.id)}
															>
																Remove
															</button>
														</div>
													</td>
												</tr>
											))}
										</tbody>
									</table>
									{contactsTotal > contacts.length && (
										<div style={{ padding: "0.5rem 1rem", fontSize: "0.75rem", color: "#52525b" }}>
											Showing {contacts.length} of {contactsTotal}. Refine the search to narrow down.
										</div>
									)}
								</div>
							)}
						</div>
					</div>
				)}

					{!isCreatingList && !editingListId && (
						<div className="card" style={{ padding: 0, border: "1px solid var(--border)", borderTop: "2px solid #18181b" }}>
							<div className="ops-table-wrap">
								<table className="admin-table">
									<thead>
										<tr>
											<th>List Name</th>
											<th>Description</th>
											<th>Subscribers</th>
											<th>Created</th>
											<th style={{ textAlign: "right" }}>Actions</th>
										</tr>
									</thead>
									<tbody>
										{mailingLists.length === 0 ? (
											<tr>
												<td colSpan={5} style={{ textAlign: "center", padding: "2.5rem 1rem", color: "#52525b" }}>
													No mailing lists yet. Create your first list above.
												</td>
											</tr>
										) : (
										mailingLists.map((ml) => (
											<tr key={ml.id}>
												<td style={{ fontWeight: 700, color: "#18181b" }}>
													<div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
														<span>{ml.name}</span>
														{ml.isNewsletter && (
															<span style={{ fontSize: "0.65rem", fontWeight: 850, background: "#18181b", color: "#ffffff", padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
																Newsletter
															</span>
														)}
													</div>
												</td>
												<td style={{ color: "#52525b" }}>{ml.description || "—"}</td>
												<td>
													<span style={{ fontWeight: 800, color: "#18181b" }}>{ml.confirmedCount ?? 0}</span>
													<span style={{ fontSize: "0.75rem", color: "#52525b", fontFamily: "var(--font-mono)" }}> confirmed</span>
													{(ml.pendingCount ?? 0) > 0 && (
														<span style={{ fontSize: "0.75rem", color: "#18181b", fontFamily: "var(--font-mono)" }}> · {ml.pendingCount} pending</span>
													)}
													{(ml.unsubscribedCount ?? 0) > 0 && (
														<span style={{ fontSize: "0.75rem", color: "#71717a", fontFamily: "var(--font-mono)" }}> · {ml.unsubscribedCount} unsub</span>
													)}
												</td>
												<td style={{ color: "#52525b", fontFamily: "var(--font-mono)" }}>{new Date(ml.createdAt).toLocaleDateString()}</td>
												<td>
													<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
														<button
															type="button"
															className="btn btn--ghost"
															style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem", color: "#18181b", fontWeight: 700 }}
															onClick={() => { setTab("lists"); openEditList(ml.id, ml.name, ml.description); }}
														>
															Edit
														</button>
														{!ml.isNewsletter && (
															<button
																type="button"
																className="btn btn--ghost"
																style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem", color: "#18181b", borderColor: "#71717a", fontWeight: 700 }}
																onClick={() => handleDeleteList(ml.id)}
															>
																Delete
															</button>
														)}
													</div>
												</td>
											</tr>
										))
										)}
									</tbody>
								</table>
							</div>
						</div>
					)}
				</>
			)}

			<ConfirmDialog
				open={confirmOpen}
				title={confirmTitle}
				message={confirmMessage}
				danger={confirmDanger}
				confirmLabel={confirmDanger ? "Delete" : "Confirm"}
				onConfirm={() => { confirmAction?.(); setConfirmOpen(false); setConfirmAction(null); }}
				onCancel={() => { setConfirmOpen(false); setConfirmAction(null); }}
			/>
			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
