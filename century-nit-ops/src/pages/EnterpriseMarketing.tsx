import { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../lib/api";
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

type Contact = {
	id: string;
	mailingListId: string;
	name?: string;
	email: string;
	createdAt: string;
};

type MailingList = {
	id: string;
	name: string;
	description?: string;
	recipientCount?: number;
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

export function EnterpriseMarketing() {
	const [tab, setTab] = useState<Tab>("campaigns");

	const [campaigns, setCampaigns] = useState<Campaign[]>([]);
	const [mailingLists, setMailingLists] = useState<MailingList[]>([]);
	const [templates, setTemplates] = useState<EmailTemplate[]>([]);

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

	const fetchCampaigns = useCallback(() => apiFetch<Campaign[]>(`${MKT}/campaigns`).then(setCampaigns).catch(console.error), []);
	const fetchMailingLists = useCallback(() => apiFetch<MailingList[]>(`${MKT}/mailing-lists`).then(setMailingLists).catch(console.error), []);
	const fetchTemplates = useCallback(() => apiFetch<EmailTemplate[]>(`${MKT}/templates`).then(setTemplates).catch(console.error), []);

	useEffect(() => {
		Promise.all([fetchCampaigns(), fetchMailingLists(), fetchTemplates()]).finally(() => setLoading(false));
	}, [fetchCampaigns, fetchMailingLists, fetchTemplates]);

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
				const res = await apiFetch<{ id: string }>(`${MKT}/campaigns`, {
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
				await apiFetch(`${MKT}/campaigns/${res.id}/send`, { method: "POST" });
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
			setEditingListId(null);
			setListName("");
			setListDesc("");
			fetchMailingLists();
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

	const handleAddContact = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!editingListId || !contactName.trim() || !contactEmail.trim()) return;
		try {
			await apiFetch(`${MKT}/mailing-lists/${editingListId}/contacts`, {
				method: "POST",
				body: JSON.stringify({ name: contactName.trim(), email: contactEmail.trim() }),
			});
			setContactName("");
			setContactEmail("");
			fetchMailingLists();
		} catch (err) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			if (msg.toLowerCase().includes("duplicate")) {
				showToast("error", "This email already exists in the list.");
			} else {
				showToast("error", `Failed to add contact: ${msg}`);
			}
		}
	};

	const handleRemoveContact = async (contactId: string) => {
		if (!editingListId) return;
		try {
			await apiFetch(`${MKT}/mailing-lists/${editingListId}/contacts/${contactId}`, { method: "DELETE" });
			fetchMailingLists();
		} catch (err) {
			showToast("error", `Failed to remove contact: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const handleImportLeads = async () => {
		if (!editingListId) return;
		try {
			await apiFetch(`${MKT}/mailing-lists/${editingListId}/import-leads`, { method: "POST" });
			fetchMailingLists();
			showToast("success", "Leads imported");
		} catch (err) {
			showToast("error", `Failed to import leads: ${err instanceof Error ? err.message : "Unknown error"}`);
		}
	};

	const handleImportApplicants = async () => {
		if (!editingListId) return;
		try {
			await apiFetch(`${MKT}/mailing-lists/${editingListId}/import-applicants`, { method: "POST" });
			fetchMailingLists();
			showToast("success", "Applicants imported");
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
												<option key={ml.id} value={ml.id}>{ml.name} ({ml.recipientCount ?? 0} contacts)</option>
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
													<span style={{ fontSize: "0.85rem", color: camp.status === "Sent" ? "#10b981" : "var(--muted-foreground)" }}>
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
						<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))", gap: "1.5rem" }}>
							{templates.map((tpl) => (
								<div key={tpl.id} className="card" style={{ padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
									<div style={{
										padding: "0.6rem 1rem",
										display: "flex",
										justifyContent: "space-between",
										alignItems: "center",
										borderBottom: "1px solid var(--border-light)",
										background: "var(--muted)",
									}}>
										<div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
											<span style={{ fontWeight: 600, fontSize: "0.9rem" }}>{tpl.name}</span>
											{tpl.isCustom && <span style={{ fontSize: "0.6rem", fontWeight: 700, color: "#8b5cf6", textTransform: "uppercase", letterSpacing: "0.05em" }}>Custom</span>}
										</div>
										<span style={{
											fontSize: "0.65rem",
											fontWeight: 700,
											padding: "0.15rem 0.5rem",
											textTransform: "uppercase",
											letterSpacing: "0.05em",
											background: tpl.type === "Email" ? "rgba(59, 130, 246, 0.12)" : "rgba(16, 185, 129, 0.12)",
											color: tpl.type === "Email" ? "var(--primary)" : "#10b981",
										}}>
											{tpl.type}
										</span>
									</div>

									{tpl.type === "Email" ? (
										<div className="mkt-email-preview">
											<div className="mkt-email-preview__brand">{BRAND_HEADER}</div>
											{tpl.header && <div className="mkt-email-preview__headline">{tpl.header}</div>}
											<div className="mkt-email-preview__subject">
												<span className="mkt-email-preview__subject-label">Subject:</span> {tpl.subject}
											</div>
											<div className="mkt-email-preview__body" dangerouslySetInnerHTML={{ __html: tpl.body }} />
											{tpl.footer && <div className="mkt-email-preview__footer">{tpl.footer}</div>}
											<div className="mkt-email-preview__brand-footer">{BRAND_FOOTER}</div>
										</div>
									) : (
										<div style={{ padding: "1.25rem", flex: 1, display: "flex", flexDirection: "column", gap: "0.75rem" }}>
											<div style={{
												background: "var(--muted)",
												padding: "1rem",
												fontSize: "0.85rem",
												lineHeight: 1.6,
												color: "var(--foreground)",
												fontFamily: "var(--font-mono)",
												maxWidth: "280px",
											}}>
												{tpl.body}
											</div>
											<span style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
												{tpl.body.length} characters
											</span>
										</div>
									)}

									<div style={{ padding: "0.75rem 1rem", borderTop: "1px solid var(--border-light)", display: "flex", gap: "0.5rem" }}>
										<button
											type="button"
											className="btn btn--ghost"
											style={{ flex: 1, fontSize: "0.8rem" }}
											onClick={() => {
												setTab("campaigns");
												setIsComposing(true);
												setChannel(tpl.type as "Email" | "SMS");
												setSelectedTemplate(tpl.id);
												if (tpl.subject) setSubject(tpl.subject);
												setBody((tpl.header ? `<h1>${tpl.header}</h1>\n` : "") + tpl.body + (tpl.footer ? `\n<footer>${tpl.footer}</footer>` : ""));
											}}
										>
											Use This
										</button>
										<button
											type="button"
											className="btn btn--ghost"
											style={{ fontSize: "0.8rem" }}
											onClick={() => handleEditTpl(tpl)}
										>
											Edit
										</button>
										{tpl.isCustom && (
											<button
												type="button"
												className="btn btn--ghost"
												style={{ fontSize: "0.8rem", color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.3)" }}
												onClick={() => handleDeleteTpl(tpl.id)}
											>
												Delete
											</button>
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
						<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem", borderLeft: "4px solid var(--primary)" }}>
							<h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>New Mailing List</h3>
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
						<div className="card" style={{ marginBottom: "1.5rem", padding: "1.5rem", borderLeft: "4px solid var(--primary)" }}>
							<h3 style={{ fontSize: "1.1rem", marginBottom: "1rem" }}>Edit Mailing List</h3>
							<form onSubmit={handleSaveEdit}>
								<div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "1rem", marginBottom: "1rem" }}>
									<div>
										<label className="label">List Name</label>
										<input type="text" className="input" value={listName} onChange={(e) => setListName(e.target.value)} autoFocus />
									</div>
									<div>
										<label className="label">Description</label>
										<input type="text" className="input" value={listDesc} onChange={(e) => setListDesc(e.target.value)} />
									</div>
								</div>
								<div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end", marginBottom: "1.5rem" }}>
									<button type="button" className="btn btn--ghost" onClick={() => { setEditingListId(null); setListName(""); setListDesc(""); }}>
										Cancel
									</button>
									<button type="submit" className="btn btn--primary" disabled={!listName.trim()}>
										Save Changes
									</button>
								</div>
							</form>

							<div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border-light)", paddingTop: "1.5rem" }}>
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
									<h4 style={{ fontSize: "0.95rem", fontWeight: 600 }}>Contacts ({editingList.recipientCount ?? editingList.contacts?.length ?? 0})</h4>
									<div style={{ display: "flex", gap: "0.5rem" }}>
										<button type="button" className="btn btn--ghost" style={{ fontSize: "0.8rem" }} onClick={handleImportLeads}>
											Import All Leads
										</button>
										<button type="button" className="btn btn--ghost" style={{ fontSize: "0.8rem" }} onClick={handleImportApplicants}>
											Import Applicants
										</button>
									</div>
								</div>

								<form
									onSubmit={handleAddContact}
									style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.75rem", marginBottom: "1rem" }}
								>
									<div>
										<label className="label">Name</label>
										<input type="text" className="input" placeholder="Contact name" value={contactName} onChange={(e) => setContactName(e.target.value)} />
									</div>
									<div>
										<label className="label">Email</label>
										<input type="email" className="input" placeholder="email@example.com" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
									</div>
									<div style={{ display: "flex", alignItems: "flex-end" }}>
										<button type="submit" className="btn btn--primary btn--sm" disabled={!contactName.trim() || !contactEmail.trim()}>
											Add Contact
										</button>
									</div>
								</form>

								{(!editingList.contacts || editingList.contacts.length === 0) ? (
									<p style={{ color: "var(--muted-foreground)", fontSize: "0.85rem", padding: "0.75rem 1rem", background: "var(--muted)" }}>
										No contacts yet. Add recipients above or import from leads/applicants.
									</p>
								) : (
									<div className="ops-table-wrap">
										<table className="admin-table">
											<thead>
												<tr>
													<th>Name</th>
													<th>Email</th>
													<th>Added</th>
													<th></th>
												</tr>
											</thead>
											<tbody>
												{editingList.contacts.map((c) => (
													<tr key={c.id}>
														<td style={{ fontWeight: 600 }}>{c.name || "-"}</td>
														<td style={{ color: "var(--muted-foreground)" }}>{c.email}</td>
														<td style={{ color: "var(--muted-foreground)" }}>{new Date(c.createdAt).toLocaleDateString()}</td>
														<td>
															<button
																type="button"
																className="btn btn--ghost"
																style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem", color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.3)" }}
																onClick={() => handleRemoveContact(c.id)}
															>
																Remove
															</button>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								)}
							</div>
						</div>
					)}

					{!isCreatingList && !editingListId && (
						<div className="card" style={{ padding: 0 }}>
							<div className="ops-table-wrap">
								<table className="admin-table">
									<thead>
										<tr>
											<th>List Name</th>
											<th>Description</th>
											<th>Recipients</th>
											<th>Created</th>
											<th></th>
										</tr>
									</thead>
									<tbody>
										{mailingLists.length === 0 ? (
											<tr>
												<td colSpan={5} style={{ textAlign: "center", padding: "2rem", color: "var(--muted-foreground)" }}>
													No mailing lists yet.
												</td>
											</tr>
										) : (
											mailingLists.map((ml) => (
												<tr key={ml.id}>
													<td style={{ fontWeight: 600 }}>{ml.name}</td>
													<td style={{ color: "var(--muted-foreground)" }}>{ml.description || "-"}</td>
													<td>{ml.recipientCount ?? 0}</td>
													<td style={{ color: "var(--muted-foreground)" }}>{new Date(ml.createdAt).toLocaleDateString()}</td>
													<td>
														<div style={{ display: "flex", gap: "0.5rem" }}>
															<button
																type="button"
																className="btn btn--ghost"
																style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
																onClick={() => {
																	setEditingListId(ml.id);
																	setListName(ml.name);
																	setListDesc(ml.description || "");
																	setTab("lists");
																}}
															>
																Edit
															</button>
															<button
																type="button"
																className="btn btn--ghost"
																style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem", color: "#ef4444", borderColor: "rgba(239, 68, 68, 0.3)" }}
																onClick={() => handleDeleteList(ml.id)}
															>
																Delete
															</button>
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
