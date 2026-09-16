import { useState, useEffect, useCallback, useMemo } from "react";
import { apiFetch, ApiError } from "../lib/api";
import { API_PREFIX } from "century-nit-shared";
import { ConfirmDialog, Toast } from "./OpsDialogs";
import { useOpsAuth } from "./OpsAuthContext";

const MKT = `${API_PREFIX}/marketing`;

type Tab = "campaigns" | "templates" | "lists";

type CampaignStatus = "draft" | "scheduled" | "sending" | "sent";

type Campaign = {
	id: string;
	name: string;
	type: string;
	status: CampaignStatus | string;
	channel: string;
	audience?: string;
	subject?: string;
	body: string;
	templateId?: string;
	mailingListId?: string;
	sentBy?: string;
	sentAt?: string;
	scheduledAt?: string | null;
	recipientCount: number;
	deliveredCount: number;
	failedCount: number;
	createdAt: string;
};

type CampaignRecipient = {
	id: string;
	campaignId: string;
	contactId: string | null;
	email: string;
	name: string | null;
	status: "pending" | "sent" | "failed" | "skipped" | string;
	sentAt: string | null;
	error: string | null;
	openedAt: string | null;
	bouncedAt: string | null;
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
  <strong>Merit Awards:</strong> Scholarships covering 20% – 50% of first-year tuition are currently being assessed on a rolling basis.
</div>
<p><strong>Action Required:</strong> Ensure your Document Vault is complete and your statement of purpose has been reviewed before the upcoming deadlines.</p>
<p><a href="https://centurynit.softclicksolutions.com/portal" style="color:#18181b;font-weight:700;">Review your application →</a></p>`,
		footer: "Century NIT Scholarships Desk",
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
];

type StatusFilter = "all" | "draft" | "scheduled" | "sent";
const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "draft", label: "Draft" },
	{ id: "scheduled", label: "Scheduled" },
	{ id: "sent", label: "Sent" },
];

const statusLabel = (s: string) =>
	s === "sending" ? "Sending…" : s.charAt(0).toUpperCase() + s.slice(1);

/** Merge fields the worker actually replaces — keep this list honest. */
const MERGE_HINT = "{{name}}, {{email}}, {{date}}";

export function EnterpriseCampaigns() {
	const { opsUser } = useOpsAuth();
	const [tab, setTab] = useState<Tab>("campaigns");

	const [campaigns, setCampaigns] = useState<Campaign[]>([]);
	const [mailingLists, setMailingLists] = useState<MailingList[]>([]);
	const [templates, setTemplates] = useState<EmailTemplate[]>(PREDEFINED_TEMPLATES);

	const [contacts, setContacts] = useState<Contact[]>([]);
	const [contactsTotal, setContactsTotal] = useState(0);
	const [contactsLoading, setContactsLoading] = useState(false);
	const [contactsFilter, setContactsFilter] = useState<ContactStatus | "all">("all");
	const [contactSearch, setContactSearch] = useState("");
	const [busyContactId, setBusyContactId] = useState<string | null>(null);

	const [loading, setLoading] = useState(true);

	/* ── Campaign list state ── */
	const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
	const [reportCampaignId, setReportCampaignId] = useState<string | null>(null);
	const [recipients, setRecipients] = useState<CampaignRecipient[]>([]);
	const [recipientsTotal, setRecipientsTotal] = useState(0);
	const [recipientsLoading, setRecipientsLoading] = useState(false);
	const [recipientFilter, setRecipientFilter] = useState<"all" | "sent" | "failed" | "pending">("all");
	const [busyCampaignId, setBusyCampaignId] = useState<string | null>(null);

	/* ── Compose state ── */
	const [isComposing, setIsComposing] = useState(false);
	const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
	const [campaignName, setCampaignName] = useState("");
	const [selectedList, setSelectedList] = useState("");
	const [selectedTemplate, setSelectedTemplate] = useState("");
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");
	const [scheduleMode, setScheduleMode] = useState<"now" | "at">("now");
	const [scheduleAt, setScheduleAt] = useState("");
	const [previewHtml, setPreviewHtml] = useState<string | null>(null);
	const [composeBusy, setComposeBusy] = useState(false);

	/* ── List state ── */
	const [isCreatingList, setIsCreatingList] = useState(false);
	const [editingListId, setEditingListId] = useState<string | null>(null);
	const [listName, setListName] = useState("");
	const [listDesc, setListDesc] = useState("");
	const [contactName, setContactName] = useState("");
	const [contactEmail, setContactEmail] = useState("");
	const [showPaste, setShowPaste] = useState(false);
	const [pasteText, setPasteText] = useState("");
	const [pasteBusy, setPasteBusy] = useState(false);

	/* ── Template state ── */
	const [isEditingTemplate, setIsEditingTemplate] = useState(false);
	const [editingTplId, setEditingTplId] = useState<string | null>(null);
	const [tplName, setTplName] = useState("");
	const [tplSubject, setTplSubject] = useState("");
	const [tplHeader, setTplHeader] = useState("");
	const [tplBody, setTplBody] = useState("");
	const [tplFooter, setTplFooter] = useState("");
	const [tplPreviewHtml, setTplPreviewHtml] = useState<string | null>(null);
	const [cardPreviewId, setCardPreviewId] = useState<string | null>(null);
	const [cardPreviewHtml, setCardPreviewHtml] = useState<string | null>(null);

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

	/* ── Fetchers ── */

	const fetchCampaigns = useCallback(
		() =>
			apiFetch<{ campaigns: Campaign[] }>(`${MKT}/campaigns`)
				.then((res) => setCampaigns(res?.campaigns ?? []))
				.catch(console.error),
		[],
	);
	const fetchMailingLists = useCallback(
		() =>
			apiFetch<{ lists: MailingList[] }>(`${MKT}/mailing-lists`)
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
			apiFetch<{ contacts: Contact[]; total: number }>(`${MKT}/mailing-lists/${listId}/contacts?${params.toString()}`)
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

	useEffect(() => {
		if (!editingListId) return;
		const timer = setTimeout(() => void fetchContacts(editingListId), 300);
		return () => clearTimeout(timer);
	}, [editingListId, fetchContacts]);

	/* ── Recipients ledger ── */

	const fetchRecipients = useCallback(
		(campaignId: string) => {
			setRecipientsLoading(true);
			const params = new URLSearchParams({ limit: "500" });
			if (recipientFilter !== "all") params.set("status", recipientFilter);
			apiFetch<{ recipients: CampaignRecipient[]; total: number }>(
				`${MKT}/campaigns/${campaignId}/recipients?${params.toString()}`,
			)
				.then((res) => {
					setRecipients(res?.recipients ?? []);
					setRecipientsTotal(res?.total ?? 0);
				})
				.catch(() => {
					setRecipients([]);
					setRecipientsTotal(0);
				})
				.finally(() => setRecipientsLoading(false));
		},
		[recipientFilter],
	);

	useEffect(() => {
		if (reportCampaignId) void fetchRecipients(reportCampaignId);
	}, [reportCampaignId, fetchRecipients]);

	const toggleReport = (campaignId: string) => {
		setReportCampaignId((prev) => (prev === campaignId ? null : campaignId));
		setRecipientFilter("all");
	};

	/* ── Compose ── */

	const resetCompose = () => {
		setIsComposing(false);
		setEditingCampaignId(null);
		setCampaignName("");
		setSelectedList("");
		setSelectedTemplate("");
		setSubject("");
		setBody("");
		setScheduleMode("now");
		setScheduleAt("");
		setPreviewHtml(null);
	};

	const openCompose = (preset?: { listId?: string; template?: EmailTemplate; campaign?: Campaign }) => {
		resetCompose();
		setIsComposing(true);
		if (preset?.listId) setSelectedList(preset.listId);
		if (preset?.template) applyTemplate(preset.template);
		if (preset?.campaign) {
			const c = preset.campaign;
			setEditingCampaignId(c.id);
			setCampaignName(c.name);
			setSelectedList(c.mailingListId ?? "");
			setSelectedTemplate(c.templateId ?? "");
			setSubject(c.subject ?? "");
			setBody(c.body);
			setScheduleMode(c.scheduledAt ? "at" : "now");
			setScheduleAt(c.scheduledAt ? c.scheduledAt.slice(0, 16) : "");
		}
	};

	const applyTemplate = (tpl: EmailTemplate) => {
		setSelectedTemplate(tpl.id);
		if (tpl.subject) setSubject(tpl.subject);
		setBody((tpl.header ? `<h1>${tpl.header}</h1>\n` : "") + tpl.body + (tpl.footer ? `\n<footer>${tpl.footer}</footer>` : ""));
	};

	const handleTemplateSelect = (templateId: string) => {
		const tpl = templates.find((t) => t.id === templateId);
		if (tpl) applyTemplate(tpl);
		else setSelectedTemplate("");
	};

	/** Save (create or update) the draft. Returns the campaign id. */
	const saveDraft = async (): Promise<string | null> => {
		if (!campaignName.trim() || !body.trim() || !selectedList) return null;
		const list = mailingLists.find((l) => l.id === selectedList);
		const payload = {
			name: campaignName.trim(),
			type: "Email",
			channel: "email",
			subject: subject || undefined,
			body,
			templateId: selectedTemplate || undefined,
			mailingListId: selectedList,
			audience: list?.name || "Unknown",
		};
		if (editingCampaignId) {
			await apiFetch(`${MKT}/campaigns/${editingCampaignId}`, {
				method: "PUT",
				body: JSON.stringify(payload),
			});
			return editingCampaignId;
		}
		const res = await apiFetch<{ campaign: { id: string } }>(`${MKT}/campaigns`, {
			method: "POST",
			body: JSON.stringify(payload),
		});
		setEditingCampaignId(res.campaign.id);
		return res.campaign.id;
	};

	const handleSaveDraft = async () => {
		setComposeBusy(true);
		try {
			const id = await saveDraft();
			if (id) {
				showToast("success", "Draft saved");
				resetCompose();
				fetchCampaigns();
			}
		} catch (err) {
			showToast("error", `Failed to save: ${err instanceof Error ? err.message : "Unknown error"}`);
		} finally {
			setComposeBusy(false);
		}
	};

	const handleSend = async () => {
		if (!campaignName.trim() || !body.trim() || !selectedList) return;
		const list = mailingLists.find((l) => l.id === selectedList);
		const count = list?.confirmedCount ?? list?.recipientCount ?? 0;
		const when =
			scheduleMode === "at" && scheduleAt
				? new Date(scheduleAt).toLocaleString()
				: null;
		confirm(
			when ? "Schedule Campaign" : "Send Campaign",
			when
				? `Schedule this campaign for ${when}? It goes to ${count} confirmed contacts.`
				: `Send this campaign to ${count} confirmed contacts now?`,
			async () => {
				setComposeBusy(true);
				try {
					const id = await saveDraft();
					if (!id) return;
					const scheduleFor =
						scheduleMode === "at" && scheduleAt ? new Date(scheduleAt).toISOString() : null;
					await apiFetch(`${MKT}/campaigns/${id}/send`, {
						method: "POST",
						body: JSON.stringify({ scheduleFor }),
					});
					resetCompose();
					fetchCampaigns();
					showToast("success", scheduleFor ? "Campaign scheduled" : "Campaign queued for sending");
				} catch (err) {
					showToast("error", `Failed to send: ${err instanceof Error ? err.message : "Unknown error"}`);
				} finally {
					setComposeBusy(false);
				}
			},
		);
	};

	const handleTestSend = async () => {
		if (!opsUser?.email) {
			showToast("error", "No operator email on this session.");
			return;
		}
		setComposeBusy(true);
		try {
			const id = await saveDraft();
			if (!id) return;
			await apiFetch(`${MKT}/campaigns/${id}/test`, {
				method: "POST",
				body: JSON.stringify({ to: opsUser.email }),
			});
			fetchCampaigns();
			showToast("success", `Test sent to ${opsUser.email}`);
		} catch (err) {
			showToast("error", `Test failed: ${err instanceof Error ? err.message : "Unknown error"}`);
		} finally {
			setComposeBusy(false);
		}
	};

	const handlePreview = async () => {
		setComposeBusy(true);
		try {
			const res = await apiFetch<{ html: string }>(`${MKT}/campaigns/preview`, {
				method: "POST",
				body: JSON.stringify({ subject: subject || "(no subject)", body }),
			});
			setPreviewHtml(res.html);
		} catch (err) {
			showToast("error", `Preview failed: ${err instanceof Error ? err.message : "Unknown error"}`);
		} finally {
			setComposeBusy(false);
		}
	};

	/* ── Campaign lifecycle actions ── */

	const handleCancelScheduled = (c: Campaign) => {
		confirm("Cancel Scheduled Send", `Cancel “${c.name}”? It returns to draft — nothing is sent.`, async () => {
			setBusyCampaignId(c.id);
			try {
				await apiFetch(`${MKT}/campaigns/${c.id}/cancel`, { method: "POST" });
				fetchCampaigns();
				showToast("success", "Scheduled send cancelled");
			} catch (err) {
				showToast("error", `Failed to cancel: ${err instanceof Error ? err.message : "Unknown error"}`);
			} finally {
				setBusyCampaignId(null);
			}
		});
	};

	const handleRetryFailed = async (c: Campaign) => {
		setBusyCampaignId(c.id);
		try {
			const res = await apiFetch<{ retried: number }>(`${MKT}/campaigns/${c.id}/retry-failed`, { method: "POST" });
			fetchCampaigns();
			if (reportCampaignId === c.id) void fetchRecipients(c.id);
			showToast("success", `${res.retried} failed recipient${res.retried === 1 ? "" : "s"} re-queued`);
		} catch (err) {
			showToast("error", `Retry failed: ${err instanceof Error ? err.message : "Unknown error"}`);
		} finally {
			setBusyCampaignId(null);
		}
	};

	const handleDuplicate = async (c: Campaign) => {
		setBusyCampaignId(c.id);
		try {
			await apiFetch(`${MKT}/campaigns`, {
				method: "POST",
				body: JSON.stringify({
					name: `${c.name} (copy)`,
					type: "Email",
					channel: "email",
					subject: c.subject,
					body: c.body,
					templateId: c.templateId,
					mailingListId: c.mailingListId,
					audience: c.audience,
				}),
			});
			fetchCampaigns();
			showToast("success", "Draft copy created");
		} catch (err) {
			showToast("error", `Duplicate failed: ${err instanceof Error ? err.message : "Unknown error"}`);
		} finally {
			setBusyCampaignId(null);
		}
	};

	const handleDeleteCampaign = (c: Campaign) => {
		confirm("Delete Campaign", `Delete “${c.name}”?`, async () => {
			try {
				await apiFetch(`${MKT}/campaigns/${c.id}`, { method: "DELETE" });
				fetchCampaigns();
				showToast("success", "Campaign deleted");
			} catch (err) {
				showToast("error", `Failed to delete: ${err instanceof Error ? err.message : "Unknown error"}`);
			}
		}, true);
	};

	const handleTestExisting = async (c: Campaign) => {
		if (!opsUser?.email) return;
		setBusyCampaignId(c.id);
		try {
			await apiFetch(`${MKT}/campaigns/${c.id}/test`, {
				method: "POST",
				body: JSON.stringify({ to: opsUser.email }),
			});
			showToast("success", `Test sent to ${opsUser.email}`);
		} catch (err) {
			showToast("error", `Test failed: ${err instanceof Error ? err.message : "Unknown error"}`);
		} finally {
			setBusyCampaignId(null);
		}
	};

	/* ── Lists ── */

	const openEditList = (listId: string, name: string, description?: string) => {
		setEditingListId(listId);
		setListName(name);
		setListDesc(description || "");
		setContacts([]);
		setContactsTotal(0);
		setContactsFilter("all");
		setContactSearch("");
		setShowPaste(false);
		setPasteText("");
		setContactsLoading(true);
	};

	const closeEditList = () => {
		setEditingListId(null);
		setListName("");
		setListDesc("");
		setContacts([]);
		setContactsTotal(0);
		setShowPaste(false);
		setPasteText("");
	};

	const editingList = editingListId ? mailingLists.find((l) => l.id === editingListId) : null;

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

	/* Paste-list: parse client-side, then loop the single-contact endpoint
	   (duplicates are deduped by email both client-side and server-side). */
	const parsedPaste = useMemo(() => {
		const seen = new Set<string>();
		const parsed: { name?: string; email: string }[] = [];
		let dupes = 0;
		for (const raw of pasteText.split(/\r?\n/)) {
			const line = raw.trim();
			if (!line) continue;
			const m = line.match(/^(?:(.*?)\s*)?<([^>]+@[^>]+)>$/) || line.match(/^([^\s<>]+@[^\s<>]+)$/);
			if (!m) continue;
			const email = (m[2] ?? m[1] ?? "").trim().toLowerCase();
			const name = m[2] ? (m[1] ?? "").trim() : undefined;
			if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
			if (seen.has(email)) { dupes += 1; continue; }
			seen.add(email);
			parsed.push({ name, email });
		}
		return { parsed, dupes };
	}, [pasteText]);

	const handlePasteImport = async () => {
		if (!editingListId || parsedPaste.parsed.length === 0) return;
		setPasteBusy(true);
		let added = 0;
		let already = 0;
		let failed = 0;
		try {
			for (const c of parsedPaste.parsed) {
				try {
					await apiFetch(`${MKT}/mailing-lists/${editingListId}/contacts`, {
						method: "POST",
						body: JSON.stringify({ name: c.name || undefined, email: c.email }),
					});
					added += 1;
				} catch (err) {
					if (err instanceof ApiError && err.code === "DUPLICATE") already += 1;
					else failed += 1;
				}
			}
			setPasteText("");
			setShowPaste(false);
			refreshContactsAndList();
			showToast(
				failed > 0 ? "error" : "success",
				`${added} added · ${already + parsedPaste.dupes} already on list${failed > 0 ? ` · ${failed} failed` : ""}`,
			);
		} finally {
			setPasteBusy(false);
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
			showToast("success", `${res.imported} added · ${res.skipped} already on list`);
		} catch (err) {
			showToast("error", `Failed to import leads: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const handleImportApplicants = async () => {
		if (!editingListId) return;
		try {
			const res = await apiFetch<{ imported: number; skipped: number }>(`${MKT}/mailing-lists/${editingListId}/import-applicants`, { method: "POST" });
			refreshContactsAndList();
			showToast("success", `${res.imported} added · ${res.skipped} already on list`);
		} catch (err) {
			showToast("error", `Failed to import applicants: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	/* ── Templates ── */

	const resetTplForm = () => {
		setIsEditingTemplate(false);
		setEditingTplId(null);
		setTplName("");
		setTplSubject("");
		setTplHeader("");
		setTplBody("");
		setTplFooter("");
		setTplPreviewHtml(null);
	};

	const handleSaveTpl = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!tplName.trim() || !tplBody.trim()) return;
		const payload = {
			name: tplName.trim(),
			type: "Email",
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
		setEditingTplId(tpl.isCustom ? tpl.id : null);
		setTplName(tpl.isCustom ? tpl.name : `${tpl.name} (copy)`);
		setTplSubject(tpl.subject || "");
		setTplHeader(tpl.header || "");
		setTplBody(tpl.body);
		setTplFooter(tpl.footer || "");
		setIsEditingTemplate(true);
		setTplPreviewHtml(null);
	};

	const handleDuplicateTpl = async (tpl: EmailTemplate) => {
		try {
			await apiFetch(`${MKT}/templates`, {
				method: "POST",
				body: JSON.stringify({
					name: `${tpl.name} (copy)`,
					type: "Email",
					subject: tpl.subject || undefined,
					header: tpl.header || undefined,
					body: tpl.body,
					footer: tpl.footer || undefined,
				}),
			});
			fetchTemplates();
			showToast("success", "Template duplicated");
		} catch (err) {
			showToast("error", `Failed to duplicate: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	/** Server-rendered preview through the real emailLayout — the delivered artifact. */
	const renderServerPreview = async (tpl: { subject?: string; header?: string; body: string; footer?: string }) => {
		const composed = (tpl.header ? `<h1>${tpl.header}</h1>\n` : "") + tpl.body + (tpl.footer ? `\n<footer>${tpl.footer}</footer>` : "");
		const res = await apiFetch<{ html: string }>(`${MKT}/campaigns/preview`, {
			method: "POST",
			body: JSON.stringify({ subject: tpl.subject || "(no subject)", body: composed }),
		});
		return res.html;
	};

	const toggleCardPreview = async (tpl: EmailTemplate) => {
		if (cardPreviewId === tpl.id) {
			setCardPreviewId(null);
			setCardPreviewHtml(null);
			return;
		}
		setCardPreviewId(tpl.id);
		setCardPreviewHtml(null);
		try {
			setCardPreviewHtml(await renderServerPreview(tpl));
		} catch {
			setCardPreviewHtml("<p>Preview failed.</p>");
		}
	};

	const refreshEditorPreview = async () => {
		try {
			setTplPreviewHtml(await renderServerPreview({ subject: tplSubject, header: tplHeader, body: tplBody, footer: tplFooter }));
		} catch {
			setTplPreviewHtml("<p>Preview failed.</p>");
		}
	};

	/* ── Derived ── */

	const stats = {
		total: campaigns.length,
		draft: campaigns.filter((c) => c.status === "draft").length,
		scheduled: campaigns.filter((c) => c.status === "scheduled").length,
		sent: campaigns.filter((c) => c.status === "sent").length,
		totalDelivered: campaigns.reduce((sum, c) => sum + c.deliveredCount, 0),
		totalFailed: campaigns.reduce((sum, c) => sum + c.failedCount, 0),
	};

	const filteredCampaigns = campaigns.filter((c) => {
		if (statusFilter === "all") return true;
		if (statusFilter === "sent") return c.status === "sent" || c.status === "sending";
		return c.status === statusFilter;
	});

	const composeValid = campaignName.trim() && body.trim() && selectedList;
	const scheduledTimeValid = scheduleMode === "now" || (scheduleAt && new Date(scheduleAt).getTime() > Date.now());

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
					<h1 className="page-title">Email Marketing</h1>
					<p className="lead mt-2">Broadcast email campaigns to your mailing lists — draft, test, schedule, report.</p>
				</div>
				{tab === "campaigns" && !isComposing && (
					<button type="button" className="btn btn--primary" onClick={() => openCompose()}>
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
						onClick={() => { setTab(t); setEditingListId(null); setIsCreatingList(false); setIsEditingTemplate(false); setEditingTplId(null); resetCompose(); }}
						style={{
							padding: "0.6rem 1.2rem",
							border: "none",
							borderBottom: tab === t ? "2px solid var(--foreground)" : "2px solid transparent",
							background: "transparent",
							color: tab === t ? "var(--foreground)" : "var(--muted-foreground)",
							fontWeight: tab === t ? 600 : 400,
							cursor: "pointer",
							textTransform: "capitalize",
						}}
					>
						{t === "lists" ? "Lists & Contacts" : t}
					</button>
				))}
			</div>

			{tab === "campaigns" && (
				<>
					{/* Monochrome stat strip */}
					<div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginBottom: "1.25rem", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
						<span><strong>{stats.draft}</strong> draft</span>
						<span><strong>{stats.scheduled}</strong> scheduled</span>
						<span><strong>{stats.sent}</strong> sent</span>
						<span><strong>{stats.totalDelivered}</strong> delivered</span>
						<span><strong>{stats.totalFailed}</strong> failed</span>
					</div>

					{isComposing && (
						<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem", borderLeft: "4px solid var(--foreground)" }}>
							<h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>
								{editingCampaignId ? "Edit Campaign" : "New Campaign"}
							</h3>
							<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "1rem", marginBottom: "1rem" }}>
								<div>
									<label className="label">Campaign Name</label>
									<input type="text" className="input" placeholder="e.g. Fall Intake Newsletter" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} autoFocus />
								</div>
								<div>
									<label className="label">Mailing List</label>
									<select className="input" value={selectedList} onChange={(e) => setSelectedList(e.target.value)}>
										<option value="">Select audience...</option>
										{mailingLists.map((ml) => (
											<option key={ml.id} value={ml.id}>{ml.name} ({ml.confirmedCount ?? ml.recipientCount ?? 0} confirmed)</option>
										))}
									</select>
								</div>
								<div>
									<label className="label">Template (optional)</label>
									<select className="input" value={selectedTemplate} onChange={(e) => handleTemplateSelect(e.target.value)}>
										<option value="">Start from scratch</option>
										{templates.map((tpl) => (
											<option key={tpl.id} value={tpl.id}>{tpl.name}</option>
										))}
									</select>
								</div>
							</div>

							<div style={{ marginBottom: "1rem" }}>
								<label className="label">Subject Line</label>
								<input type="text" className="input" placeholder="e.g. New scholarship opportunities" value={subject} onChange={(e) => setSubject(e.target.value)} />
							</div>

							<div style={{ marginBottom: "1rem" }}>
								<label className="label">Email Body (HTML)</label>
								<textarea
									className="input"
									rows={9}
									placeholder="Write your email content. Inline styles only."
									value={body}
									onChange={(e) => setBody(e.target.value)}
								/>
								<div style={{ fontSize: "0.75rem", color: "var(--muted-foreground)", marginTop: "0.25rem" }}>
									Personalisation: {MERGE_HINT}
								</div>
							</div>

							{/* Now / At scheduling toggle */}
							<div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "1.25rem", flexWrap: "wrap" }}>
								<div style={{ display: "inline-flex", border: "1px solid var(--border)" }}>
									{(["now", "at"] as const).map((m) => (
										<button
											key={m}
											type="button"
											onClick={() => setScheduleMode(m)}
											style={{
												border: "none",
												background: scheduleMode === m ? "var(--foreground)" : "var(--background)",
												color: scheduleMode === m ? "var(--background)" : "var(--muted-foreground)",
												fontFamily: "var(--font-mono)",
												fontSize: "0.7rem",
												fontWeight: 800,
												letterSpacing: "0.08em",
												textTransform: "uppercase",
												padding: "0.4rem 0.9rem",
												cursor: "pointer",
											}}
										>
											{m === "now" ? "Now" : "At…"}
										</button>
									))}
								</div>
								{scheduleMode === "at" && (
									<input
										type="datetime-local"
										className="input"
										style={{ width: "auto" }}
										value={scheduleAt}
										min={new Date(Date.now() + 60000).toISOString().slice(0, 16)}
										onChange={(e) => setScheduleAt(e.target.value)}
									/>
								)}
							</div>

							<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
								<button type="button" className="btn btn--ghost" onClick={resetCompose}>Cancel</button>
								<button type="button" className="btn btn--ghost" disabled={!composeValid || composeBusy} onClick={handlePreview}>
									Preview
								</button>
								<button type="button" className="btn btn--ghost" disabled={!composeValid || composeBusy} onClick={handleTestSend}>
									Send test to me
								</button>
								<button type="button" className="btn btn--ghost" disabled={!composeValid || composeBusy} onClick={handleSaveDraft}>
									Save draft
								</button>
								<button type="button" className="btn btn--primary" disabled={!composeValid || !scheduledTimeValid || composeBusy} onClick={handleSend}>
									{scheduleMode === "at" ? "Schedule" : "Send now"}
								</button>
							</div>
						</div>
					)}

					{/* Status filter chips */}
					<div style={{ display: "flex", gap: 0, marginBottom: "1rem" }}>
						{STATUS_FILTERS.map((f, i) => {
							const n =
								f.id === "all" ? campaigns.length :
								f.id === "sent" ? stats.sent + campaigns.filter((c) => c.status === "sending").length :
								campaigns.filter((c) => c.status === f.id).length;
							return (
								<button
									key={f.id}
									type="button"
									onClick={() => setStatusFilter(f.id)}
									style={{
										fontSize: "0.75rem",
										padding: "0.35rem 0.85rem",
										fontWeight: 700,
										textTransform: "uppercase",
										letterSpacing: "0.04em",
										background: statusFilter === f.id ? "#18181b" : "#ffffff",
										color: statusFilter === f.id ? "#ffffff" : "#18181b",
										border: "1px solid #18181b",
										marginLeft: i > 0 ? "-1px" : "0",
										cursor: "pointer",
									}}
								>
									{f.label} ({n})
								</button>
							);
						})}
					</div>

					<div className="card" style={{ flex: 1, overflowY: "auto", padding: 0 }}>
						<div className="ops-table-wrap">
							<table className="admin-table">
								<thead>
									<tr>
										<th>Campaign</th>
										<th>Audience</th>
										<th>Status</th>
										<th>Recipients</th>
										<th>Delivered</th>
										<th>Opened</th>
										<th>Failed</th>
										<th>{statusFilter === "scheduled" ? "Scheduled for" : "Sent"}</th>
										<th style={{ textAlign: "right" }}></th>
									</tr>
								</thead>
								<tbody>
									{filteredCampaigns.length === 0 ? (
										<tr>
											<td colSpan={9} style={{ textAlign: "center", padding: "2rem", color: "var(--muted-foreground)" }}>
												No {statusFilter === "all" ? "" : statusFilter + " "}campaigns.
											</td>
										</tr>
									) : (
										filteredCampaigns.map((camp) => (
											<CampaignRow
												key={camp.id}
												camp={camp}
												busy={busyCampaignId === camp.id}
												reportOpen={reportCampaignId === camp.id}
												recipients={recipients}
												recipientsTotal={recipientsTotal}
												recipientsLoading={recipientsLoading}
												recipientFilter={recipientFilter}
												onRecipientFilter={setRecipientFilter}
												onToggleReport={() => toggleReport(camp.id)}
												onEdit={() => openCompose({ campaign: camp })}
												onTest={() => void handleTestExisting(camp)}
												onCancel={() => handleCancelScheduled(camp)}
												onDuplicate={() => void handleDuplicate(camp)}
												onRetry={() => void handleRetryFailed(camp)}
												onDelete={() => handleDeleteCampaign(camp)}
											/>
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
						<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem", borderLeft: "4px solid var(--foreground)" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
								<h3 style={{ fontSize: "1.1rem" }}>
									{editingTplId ? "Edit Template" : "New Template"}
								</h3>
								<button type="button" className="btn btn--ghost btn--sm" onClick={refreshEditorPreview}>
									Refresh preview
								</button>
							</div>

							<form onSubmit={handleSaveTpl}>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.5rem" }}>
									<div>
										<div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "0.85rem" }}>
											<div>
												<label className="label">Template Name</label>
												<input type="text" className="input" placeholder="e.g. Welcome Email" value={tplName} onChange={(e) => setTplName(e.target.value)} autoFocus />
											</div>
											<div>
												<label className="label">Subject Line</label>
												<input type="text" className="input" placeholder="Email subject..." value={tplSubject} onChange={(e) => setTplSubject(e.target.value)} />
											</div>
											<div>
												<label className="label">Header / Headline</label>
												<input type="text" className="input" placeholder="e.g. Welcome Aboard!" value={tplHeader} onChange={(e) => setTplHeader(e.target.value)} />
											</div>
											<div>
												<label className="label">HTML Body <span style={{ fontWeight: 400, fontSize: "0.75rem" }}>({MERGE_HINT})</span></label>
												<textarea
													className="input"
													rows={12}
													placeholder="<p>Dear {{name}},</p><p>Your content here...</p>"
													value={tplBody}
													onChange={(e) => setTplBody(e.target.value)}
													spellCheck={false}
													style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
												/>
											</div>
											<div>
												<label className="label">Footer</label>
												<input type="text" className="input" placeholder="Unsubscribe notice or disclaimer" value={tplFooter} onChange={(e) => setTplFooter(e.target.value)} />
											</div>
										</div>
									</div>
									<div>
										<label className="label">Delivered preview (real layout)</label>
										<div style={{ border: "1px solid var(--border)", background: "#fafafa", minHeight: 320, maxHeight: 520, overflowY: "auto" }}>
											{tplPreviewHtml ? (
												<iframe
													title="Template preview"
													srcDoc={tplPreviewHtml}
													style={{ width: "100%", height: 500, border: "none" }}
													sandbox=""
												/>
											) : (
												<div style={{ padding: "2rem", color: "var(--muted-foreground)", fontSize: "0.85rem", textAlign: "center" }}>
													Press “Refresh preview” to render the real email layout.
												</div>
											)}
										</div>
									</div>
								</div>

								<div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginTop: "1rem" }}>
									<button type="button" className="btn btn--ghost" onClick={resetTplForm}>Cancel</button>
									<button type="submit" className="btn btn--primary" disabled={!tplName.trim() || !tplBody.trim()}>
										{editingTplId ? "Save Changes" : "Create Template"}
									</button>
								</div>
							</form>
						</div>
					)}

					{!isEditingTemplate && (
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "1.5rem" }}>
							{templates.map((tpl) => (
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
									</div>

									{cardPreviewId === tpl.id ? (
										<div style={{ borderBottom: "1px solid var(--border-light)", background: "#fafafa", height: 320 }}>
											{cardPreviewHtml ? (
												<iframe
													title={`${tpl.name} preview`}
													srcDoc={cardPreviewHtml}
													style={{ width: "100%", height: "100%", border: "none" }}
													sandbox=""
												/>
											) : (
												<div style={{ padding: "2rem", color: "var(--muted-foreground)", fontSize: "0.8rem", textAlign: "center" }}>Rendering…</div>
											)}
										</div>
									) : (
										<div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid var(--border-light)", color: "#52525b", fontSize: "0.8rem", flex: 1 }}>
											<div style={{ fontWeight: 700, color: "#18181b", marginBottom: "0.25rem" }}>{tpl.subject || "(no subject)"}</div>
											<div style={{ overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
												{tpl.header ? `${tpl.header} — ` : ""}{tpl.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 220)}
											</div>
										</div>
									)}

									<div style={{ padding: "0.75rem 1.25rem", display: "flex", gap: "0.4rem", background: "#ffffff", flexWrap: "wrap" }}>
										<button
											type="button"
											className="btn btn--primary"
											style={{ fontSize: "0.75rem", padding: "0.45rem 0.75rem" }}
											onClick={() => { setTab("campaigns"); openCompose({ template: tpl }); }}
										>
											Use in campaign
										</button>
										<button
											type="button"
											className="btn btn--ghost"
											style={{ fontSize: "0.75rem", padding: "0.45rem 0.75rem" }}
											onClick={() => void toggleCardPreview(tpl)}
										>
											{cardPreviewId === tpl.id ? "Hide" : "Preview"}
										</button>
										<button
											type="button"
											className="btn btn--ghost"
											style={{ fontSize: "0.75rem", padding: "0.45rem 0.75rem" }}
											onClick={() => void handleDuplicateTpl(tpl)}
										>
											Duplicate
										</button>
										{tpl.isCustom && (
											<>
												<button
													type="button"
													className="btn btn--ghost"
													style={{ fontSize: "0.75rem", padding: "0.45rem 0.75rem" }}
													onClick={() => handleEditTpl(tpl)}
												>
													Edit
												</button>
												<button
													type="button"
													className="btn btn--ghost"
													style={{ fontSize: "0.75rem", padding: "0.45rem 0.75rem" }}
													onClick={() => handleDeleteTpl(tpl.id)}
												>
													Delete
												</button>
											</>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</>
			)}

			{tab === "lists" && (
				<>
					{isCreatingList && (
						<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem", border: "1px solid var(--border)", borderTop: "2px solid #18181b" }}>
							<h3 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "1rem", color: "#18181b" }}>New Mailing List</h3>
							<form onSubmit={handleCreateList}>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem", marginBottom: "1rem" }}>
									<div>
										<label className="label">List Name</label>
										<input type="text" className="input" placeholder="e.g. UK Applicants" value={listName} onChange={(e) => setListName(e.target.value)} autoFocus />
									</div>
									<div>
										<label className="label">Description</label>
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
										{editingList.name}
									</h3>
									{editingList.isNewsletter && (
										<span style={{ fontSize: "0.65rem", fontWeight: 800, background: "#18181b", color: "#ffffff", padding: "2px 8px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
											Newsletter
										</span>
									)}
								</div>
								<button type="button" className="btn btn--ghost btn--sm" onClick={closeEditList}>
									✕ Close
								</button>
							</div>

							<form onSubmit={handleSaveEdit}>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem", marginBottom: "1rem" }}>
									<div>
										<label className="label">List Name</label>
										<input
											type="text"
											className="input"
											value={listName}
											onChange={(e) => setListName(e.target.value)}
											disabled={editingList.isNewsletter}
											title={editingList.isNewsletter ? "The Website Newsletter list cannot be renamed" : undefined}
										/>
									</div>
									<div>
										<label className="label">Description</label>
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
									<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
										<button type="button" className="btn btn--ghost btn--sm" onClick={() => setShowPaste((v) => !v)}>
											Paste list
										</button>
										<button type="button" className="btn btn--ghost btn--sm" onClick={handleImportLeads}>
											Import leads
										</button>
										<button type="button" className="btn btn--ghost btn--sm" onClick={handleImportApplicants}>
											Import applicants
										</button>
									</div>
								</div>

								{showPaste && (
									<div style={{ marginBottom: "1.25rem", background: "var(--muted)", padding: "1rem", border: "1px solid var(--border-light)" }}>
										<label className="label">Paste contacts — one per line, or Name &lt;email&gt;</label>
										<textarea
											className="input"
											rows={5}
											placeholder={"ama.s@example.com\nKofi Mensah <kofi@example.com>\nEfua Owusu <efua@example.com>"}
											value={pasteText}
											onChange={(e) => setPasteText(e.target.value)}
											style={{ fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}
										/>
										<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
											<span style={{ fontSize: "0.78rem", color: "var(--muted-foreground)", fontFamily: "var(--font-mono)" }}>
												{parsedPaste.parsed.length} parsed · {parsedPaste.dupes} duplicates
											</span>
											<button
												type="button"
												className="btn btn--primary btn--sm"
												disabled={parsedPaste.parsed.length === 0 || pasteBusy}
												onClick={() => void handlePasteImport()}
											>
												{pasteBusy ? "Adding…" : `Add ${parsedPaste.parsed.length} contacts`}
											</button>
										</div>
										<div style={{ fontSize: "0.72rem", color: "var(--muted-foreground)", marginTop: "0.35rem" }}>
											New addresses land as pending and get a confirmation email (double opt-in).
										</div>
									</div>
								)}

								<form
									onSubmit={handleAddContact}
									style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr auto", gap: "0.75rem", marginBottom: "1.25rem", background: "var(--muted)", padding: "1rem", border: "1px solid var(--border-light)" }}
								>
									<div>
										<label className="label" style={{ fontSize: "0.7rem", textTransform: "uppercase" }}>Name</label>
										<input type="text" className="input" placeholder="Contact name (optional)" value={contactName} onChange={(e) => setContactName(e.target.value)} />
									</div>
									<div>
										<label className="label" style={{ fontSize: "0.7rem", textTransform: "uppercase" }}>Email</label>
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
																		<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busyContactId === c.id} onClick={() => handleResendConfirmation(c.id)}>
																			Resend
																		</button>
																		<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busyContactId === c.id} onClick={() => handleConfirmContact(c.id)}>
																			Confirm now
																		</button>
																	</>
																)}
																{c.status === "unsubscribed" && (
																	<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busyContactId === c.id} onClick={() => handleConfirmContact(c.id)}>
																		Re-subscribe
																	</button>
																)}
																{c.status === "confirmed" && (
																	<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busyContactId === c.id} onClick={() => handleUnsubscribeContact(c.id)}>
																		Unsubscribe
																	</button>
																)}
																<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busyContactId === c.id} onClick={() => handleRemoveContact(c.id)}>
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
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: "1rem" }}>
							{mailingLists.length === 0 ? (
								<div className="card" style={{ padding: "2.5rem 1rem", textAlign: "center", color: "#52525b" }}>
									No mailing lists yet. Create your first list above.
								</div>
							) : (
								mailingLists.map((ml) => (
									<div key={ml.id} className="card" style={{ padding: "1.25rem", border: "1px solid var(--border)", borderTop: "2px solid #18181b" }}>
										<div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem" }}>
											<span style={{ fontWeight: 800, fontSize: "1rem", color: "#18181b" }}>{ml.name}</span>
											{ml.isNewsletter && (
												<span style={{ fontSize: "0.62rem", fontWeight: 800, background: "#18181b", color: "#ffffff", padding: "2px 6px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
													Newsletter
												</span>
											)}
										</div>
										{ml.description && (
											<div style={{ fontSize: "0.8rem", color: "#52525b", marginBottom: "0.6rem" }}>{ml.description}</div>
										)}
										<div style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem", color: "#18181b", marginBottom: "0.9rem" }}>
											<strong>{ml.confirmedCount ?? 0}</strong> confirmed
											<span style={{ color: "#52525b" }}> · {ml.pendingCount ?? 0} pending · {ml.unsubscribedCount ?? 0} unsubscribed</span>
										</div>
										<div style={{ display: "flex", gap: "0.5rem" }}>
											<button type="button" className="btn btn--primary" style={{ fontSize: "0.75rem", padding: "0.4rem 0.8rem" }} onClick={() => openEditList(ml.id, ml.name, ml.description)}>
												Open
											</button>
											<button type="button" className="btn btn--ghost" style={{ fontSize: "0.75rem", padding: "0.4rem 0.8rem" }} onClick={() => { setTab("campaigns"); openCompose({ listId: ml.id }); }}>
												Send to list
											</button>
											{!ml.isNewsletter && (
												<button type="button" className="btn btn--ghost" style={{ fontSize: "0.75rem", padding: "0.4rem 0.8rem" }} onClick={() => handleDeleteList(ml.id)}>
													Delete
												</button>
											)}
										</div>
									</div>
								))
							)}
						</div>
					)}
				</>
			)}

			{/* Full-layout preview modal (compose) */}
			{previewHtml && (
				<div
					style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: "2rem" }}
					onClick={() => setPreviewHtml(null)}
				>
					<div
						style={{ background: "#fff", width: "100%", maxWidth: 720, maxHeight: "85vh", display: "flex", flexDirection: "column", border: "1px solid #18181b", boxShadow: "8px 8px 0 rgba(0,0,0,0.3)" }}
						onClick={(e) => e.stopPropagation()}
					>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.6rem 1rem", borderBottom: "1px solid var(--border-light)" }}>
							<span style={{ fontFamily: "var(--font-mono)", fontSize: "0.7rem", fontWeight: 800, letterSpacing: "0.08em" }}>DELIVERED PREVIEW — SAMPLE MERGE</span>
							<button type="button" className="btn btn--ghost btn--sm" onClick={() => setPreviewHtml(null)}>✕</button>
						</div>
						<iframe title="Campaign preview" srcDoc={previewHtml} style={{ width: "100%", flex: 1, minHeight: 480, border: "none" }} sandbox="" />
					</div>
				</div>
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

/* ── Campaign row + expandable recipient ledger ─────────────────────────── */

function CampaignRow({
	camp,
	busy,
	reportOpen,
	recipients,
	recipientsTotal,
	recipientsLoading,
	recipientFilter,
	onRecipientFilter,
	onToggleReport,
	onEdit,
	onTest,
	onCancel,
	onDuplicate,
	onRetry,
	onDelete,
}: {
	camp: Campaign;
	busy: boolean;
	reportOpen: boolean;
	recipients: CampaignRecipient[];
	recipientsTotal: number;
	recipientsLoading: boolean;
	recipientFilter: "all" | "sent" | "failed" | "pending";
	onRecipientFilter: (f: "all" | "sent" | "failed" | "pending") => void;
	onToggleReport: () => void;
	onEdit: () => void;
	onTest: () => void;
	onCancel: () => void;
	onDuplicate: () => void;
	onRetry: () => void;
	onDelete: () => void;
}) {
	const isDraft = camp.status === "draft";
	const isScheduled = camp.status === "scheduled";
	const isSent = camp.status === "sent" || camp.status === "sending";
	const opened = isSent ? Math.max(0, recipients.filter((r) => r.openedAt).length) : 0;

	return (
		<>
			<tr>
				<td style={{ fontWeight: 600 }}>{camp.name}</td>
				<td style={{ color: "var(--muted-foreground)" }}>{camp.audience ?? "—"}</td>
				<td>
					<span style={{
						padding: "3px 8px",
						fontSize: "0.68rem",
						fontWeight: 800,
						textTransform: "uppercase",
						letterSpacing: "0.04em",
						fontFamily: "var(--font-mono)",
						display: "inline-block",
						background: isSent ? "#18181b" : "#f4f4f5",
						color: isSent ? "#ffffff" : "#18181b",
						border: isSent ? "1px solid #18181b" : isScheduled ? "1px solid #18181b" : "1px dashed #71717a",
					}}>
						{statusLabel(camp.status)}
					</span>
				</td>
				<td>{camp.recipientCount}</td>
				<td>{camp.deliveredCount}</td>
				<td>{reportOpen ? opened : "—"}</td>
				<td style={{ fontWeight: camp.failedCount > 0 ? 700 : 400 }}>{camp.failedCount}</td>
				<td style={{ color: "var(--muted-foreground)", fontFamily: "var(--font-mono)", fontSize: "0.8rem" }}>
					{isScheduled && camp.scheduledAt
						? new Date(camp.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
						: camp.sentAt
							? new Date(camp.sentAt).toLocaleDateString()
							: "—"}
				</td>
				<td>
					<div style={{ display: "flex", gap: "0.35rem", justifyContent: "flex-end", flexWrap: "wrap" }}>
						{isDraft && (
							<>
								<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busy} onClick={onEdit}>Edit</button>
								<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busy} onClick={onTest}>Test</button>
								<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busy} onClick={onDelete}>Delete</button>
							</>
						)}
						{isScheduled && (
							<>
								<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busy} onClick={onEdit}>Edit</button>
								<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busy} onClick={onCancel}>Cancel</button>
							</>
						)}
						{isSent && (
							<>
								<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busy} onClick={onToggleReport}>
									{reportOpen ? "▾ Report" : "▸ Report"}
								</button>
								<button type="button" className="btn btn--ghost" style={{ fontSize: "0.72rem", padding: "0.2rem 0.55rem" }} disabled={busy} onClick={onDuplicate}>Duplicate</button>
							</>
						)}
					</div>
				</td>
			</tr>
			{reportOpen && (
				<tr>
					<td colSpan={9} style={{ padding: 0, background: "#fafafa" }}>
						<div style={{ padding: "1rem 1.25rem", borderTop: "1px dashed var(--border-light)" }}>
							<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: "0.5rem" }}>
								<div style={{ display: "flex", gap: 0 }}>
									{(["all", "sent", "failed", "pending"] as const).map((f, i) => (
										<button
											key={f}
											type="button"
											onClick={() => onRecipientFilter(f)}
											style={{
												fontSize: "0.68rem",
												padding: "0.25rem 0.65rem",
												fontWeight: 700,
												textTransform: "uppercase",
												letterSpacing: "0.04em",
												fontFamily: "var(--font-mono)",
												background: recipientFilter === f ? "#18181b" : "#ffffff",
												color: recipientFilter === f ? "#ffffff" : "#18181b",
												border: "1px solid #18181b",
												marginLeft: i > 0 ? "-1px" : "0",
												cursor: "pointer",
											}}
										>
											{f}
										</button>
									))}
								</div>
								<div style={{ fontFamily: "var(--font-mono)", fontSize: "0.72rem", color: "#52525b" }}>
									{recipientsTotal} recipients · {opened} opened
									{camp.failedCount > 0 && (
										<button
											type="button"
											className="btn btn--primary btn--sm"
											style={{ marginLeft: "0.75rem", fontSize: "0.72rem" }}
											disabled={busy}
											onClick={onRetry}
										>
											Retry {camp.failedCount} failed →
										</button>
									)}
								</div>
							</div>
							{recipientsLoading ? (
								<p style={{ fontSize: "0.8rem", color: "#52525b" }}>Loading ledger…</p>
							) : recipients.length === 0 ? (
								<p style={{ fontSize: "0.8rem", color: "#52525b" }}>No recipients in this view.</p>
							) : (
								<table className="admin-table" style={{ fontSize: "0.78rem" }}>
									<thead>
										<tr>
											<th>Contact</th>
											<th>Status</th>
											<th>Sent</th>
											<th>Opened</th>
											<th>Error</th>
										</tr>
									</thead>
									<tbody>
										{recipients.map((r) => (
											<tr key={r.id}>
												<td>
													<span style={{ fontWeight: 600 }}>{r.name || "—"}</span>{" "}
													<span style={{ color: "#52525b", fontFamily: "var(--font-mono)" }}>{r.email}</span>
												</td>
												<td>
													<span style={{
														padding: "2px 6px",
														fontSize: "0.65rem",
														fontWeight: 800,
														textTransform: "uppercase",
														fontFamily: "var(--font-mono)",
														background: r.status === "sent" ? "#18181b" : "#f4f4f5",
														color: r.status === "sent" ? "#ffffff" : "#18181b",
														border: r.status === "sent" ? "1px solid #18181b" : r.status === "failed" ? "1px dashed #18181b" : "1px solid #d4d4d8",
													}}>
														{r.status}
													</span>
													{r.bouncedAt && <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.65rem", marginLeft: 4 }}>(bounced)</span>}
												</td>
												<td style={{ fontFamily: "var(--font-mono)", color: "#52525b" }}>
													{r.sentAt ? new Date(r.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
												</td>
												<td style={{ fontFamily: "var(--font-mono)", color: "#52525b" }}>
													{r.openedAt ? new Date(r.openedAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—"}
												</td>
												<td style={{ color: "#18181b", fontFamily: "var(--font-mono)", fontSize: "0.72rem", maxWidth: 260 }}>
													{r.error ?? "—"}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
					</td>
				</tr>
			)}
		</>
	);
}
