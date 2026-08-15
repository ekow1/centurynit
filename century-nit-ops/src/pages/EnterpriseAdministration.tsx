import { useMemo, useState } from "react";
import { CmsManager } from "./CmsManager";
import { CMS_COLLECTIONS, resolveRecord } from "century-nit-core";
import { useOpsAuth, ROLE_LABELS, ROLE_DESCRIPTIONS, type OpsRole } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import { staffBranchName } from "century-nit-core/ops";

/**
 * The platform console. Every screen here is about running the software -
 * accounts, access, content, configuration - never applicant case data.
 */
export type AdminSection =
	| "system"
	| "users"
	| "auth"
	| "cms"
	| "site"
	| "notifications"
	| "settings"
	| "security"
	| "branches"
	| "integrations"
	| "features";

const SECTION_META: Record<AdminSection, { title: string; blurb: string }> = {
	system: {
		title: "System Overview",
		blurb: "Platform health, configuration state, and recent administrative activity.",
	},
	users: {
		title: "Users & Roles",
		blurb: "Staff accounts, role assignment, and per-module access.",
	},
	auth: {
		title: "Authentication",
		blurb: "Sign-in methods, session policy, and multi-factor enforcement.",
	},
	cms: {
		title: "Content Management",
		blurb: "Pages, programmes, destinations, and blog content on the public site.",
	},
	site: {
		title: "Site & UI",
		blurb: "Branding, navigation, and the public-facing web experience.",
	},
	notifications: {
		title: "System Notifications",
		blurb: "Templates, triggers, and delivery channels for automated messages.",
	},
	settings: {
		title: "System Configuration",
		blurb: "Regional defaults, integrations, and platform-wide preferences.",
	},
	security: {
		title: "Security Center",
		blurb: "Failed login attempts, active sessions, IP allowlist, and audit log.",
	},
	branches: {
		title: "Branch Management",
		blurb: "Office locations, contact details, and operational status.",
	},
	integrations: {
		title: "API Keys & Webhooks",
		blurb: "Third-party integrations, API keys, and webhook endpoints.",
	},
	features: {
		title: "Feature Flags",
		blurb: "Toggle platform features on or off for controlled rollouts.",
	},
};

const STAFF_ACCOUNTS: { name: string; email: string; role: OpsRole; branch: string; status: string }[] = [
	{ name: "Adjoa Mensah-Bonsu", email: "a.mensah@century-nit.com", role: "manager", branch: "accra", status: "Active" },
	{ name: "Kojo Asante", email: "k.asante@century-nit.com", role: "coordinator", branch: "accra", status: "Active" },
	{ name: "Efua Owusu", email: "e.owusu@century-nit.com", role: "consultant", branch: "accra", status: "Active" },
	{ name: "Kwame Agyeman", email: "k.agyeman@century-nit.com", role: "consultant", branch: "kumasi", status: "Active" },
	{ name: "Abena Frimpong", email: "a.frimpong@century-nit.com", role: "consultant", branch: "takoradi", status: "Active" },
	{ name: "Ama Serwaa Boateng", email: "a.serwaa@century-nit.com", role: "finance", branch: "accra", status: "Active" },
	{ name: "Kwabena Osei", email: "k.osei@century-nit.com", role: "admin", branch: "platform", status: "Active" },
	{ name: "Yaw Darko", email: "y.darko@century-nit.com", role: "consultant", branch: "takoradi", status: "Suspended" },
];

const NOTIFICATION_TEMPLATES = [
	{ name: "Application Approved", trigger: "Status changes to Offer Letter", channel: "Email", active: true, subject: "Your application has been approved", body: "Dear {{applicantName}},\n\nCongratulations! Your application has been approved. Please log in to your portal to view next steps.\n\nReference: {{appId}}" },
	{ name: "Missing Documents Reminder", trigger: "Scheduled - weekly", channel: "Email + SMS", active: true, subject: "Action required: missing documents", body: "Dear {{applicantName}},\n\nOur records show you still have outstanding documents. Please upload them at your earliest convenience to avoid delays.\n\nMissing: {{missingDocs}}" },
	{ name: "Payment Overdue", trigger: "Invoice more than 3 days overdue", channel: "Email", active: true, subject: "Payment overdue notice", body: "Dear {{applicantName}},\n\nYour invoice {{invoiceId}} for {{amount}} is now overdue. Please settle the balance to continue with your application.\n\nOutstanding: {{outstanding}}" },
	{ name: "Consultation Reminder", trigger: "24 hours before appointment", channel: "SMS", active: false, subject: "Consultation tomorrow", body: "Hi {{applicantName}}, this is a reminder for your consultation tomorrow at {{dateTime}} with {{consultantName}}. Branch: {{branch}}." },
	{ name: "Visa Decision Received", trigger: "Visa status updated", channel: "Email", active: true, subject: "Visa decision update", body: "Dear {{applicantName}},\n\nYour visa application status has been updated to: {{visaStatus}}. Please log in to your portal for full details.\n\nReference: {{visaRef}}" },
	{ name: "Lead Follow-up", trigger: "Lead stage changes to contacted", channel: "Email", active: true, subject: "Following up on your inquiry", body: "Hi {{leadName}},\n\nThank you for your interest in Century NIT. One of our consultants will reach out to schedule a consultation.\n\nBest regards,\nThe Century NIT Team" },
];

const AUDIT_LOG = [
	{ id: "a1", at: "2026-08-06T09:12:00Z", actor: "Kwabena Osei", action: "Updated auth settings", detail: "Enabled MFA for all staff", ip: "192.168.1.10" },
	{ id: "a2", at: "2026-08-06T08:45:00Z", actor: "Adjoa Mensah-Bonsu", action: "Assigned role", detail: "Set Kojo Asante to Coordinator", ip: "192.168.1.24" },
	{ id: "a3", at: "2026-08-05T17:30:00Z", actor: "Kwabena Osei", action: "Published CMS entry", detail: "Homepage hero updated", ip: "192.168.1.10" },
	{ id: "a4", at: "2026-08-05T14:15:00Z", actor: "Ama Serwaa Boateng", action: "Exported financial report", detail: "Q3 2026 revenue report (CSV)", ip: "192.168.1.31" },
	{ id: "a5", at: "2026-08-05T11:20:00Z", actor: "Kwabena Osei", action: "Suspended user", detail: "Yaw Darko - disciplinary review", ip: "192.168.1.10" },
	{ id: "a6", at: "2026-08-04T16:00:00Z", actor: "Adjoa Mensah-Bonsu", action: "Added branch", detail: "Kumasi Branch - new office", ip: "192.168.1.24" },
	{ id: "a7", at: "2026-08-04T10:30:00Z", actor: "Kwabena Osei", action: "Rotated API key", detail: "Paystack production key rotated", ip: "192.168.1.10" },
	{ id: "a8", at: "2026-08-03T15:45:00Z", actor: "System", action: "Auto-backup completed", detail: "Full database snapshot - 2.4 MB", ip: "localhost" },
];

const FAILED_LOGINS = [
	{ id: "f1", at: "2026-08-06T08:55:00Z", email: "unknown@tempmail.com", ip: "41.215.44.10", attempts: 3, status: "Locked" },
	{ id: "f2", at: "2026-08-06T07:20:00Z", email: "a.mensah@century-nit.com", ip: "192.168.1.24", attempts: 1, status: "Resolved" },
	{ id: "f3", at: "2026-08-05T22:10:00Z", email: "admin@century-nit.com", ip: "102.89.22.5", attempts: 5, status: "Blocked" },
	{ id: "f4", at: "2026-08-05T18:30:00Z", email: "unknown@gmail.com", ip: "197.210.44.12", attempts: 2, status: "Monitoring" },
];

const ACTIVE_SESSIONS = [
	{ id: "s1", user: "Adjoa Mensah-Bonsu", role: "manager" as OpsRole, ip: "192.168.1.24", device: "Chrome · macOS", started: "2026-08-06T08:00:00Z", current: true },
	{ id: "s2", user: "Kojo Asante", role: "coordinator" as OpsRole, ip: "41.215.44.8", device: "Firefox · Windows", started: "2026-08-06T07:45:00Z", current: false },
	{ id: "s3", user: "Efua Owusu", role: "consultant" as OpsRole, ip: "94.200.22.10", device: "Safari · iPad", started: "2026-08-06T06:30:00Z", current: false },
	{ id: "s4", user: "Ama Serwaa Boateng", role: "finance" as OpsRole, ip: "192.168.1.31", device: "Chrome · Windows", started: "2026-08-05T14:00:00Z", current: false },
];

const BRANCHES = [
	{ id: "accra-hq", name: "Accra Headquarters", country: "Ghana", city: "Accra", address: "Independence Ave, Ridge", phone: "+233 30 555 0100", email: "accra@century-nit.com", status: "Active", staffCount: 4 },
	{ id: "kumasi", name: "Kumasi Branch", country: "Ghana", city: "Kumasi", address: "Adum High Street", phone: "+233 32 244 0088", email: "kumasi@century-nit.com", status: "Active", staffCount: 2 },
	{ id: "takoradi", name: "Takoradi Branch", country: "Ghana", city: "Takoradi", address: "Market Circle, Commercial St", phone: "+233 31 299 4455", email: "takoradi@century-nit.com", status: "Active", staffCount: 2 },
	{ id: "tamale", name: "Tamale Branch", country: "Ghana", city: "Tamale", address: "Kukuo Road, Bolga Rd", phone: "+233 37 222 3311", email: "tamale@century-nit.com", status: "Active", staffCount: 1 },
	{ id: "cape-coast", name: "Cape Coast Branch", country: "Ghana", city: "Cape Coast", address: "Pedu Road", phone: "+233 33 217 7788", email: "capecoast@century-nit.com", status: "Active", staffCount: 1 },
	{ id: "tema", name: "Tema Office", country: "Ghana", city: "Tema", address: "Harbour Area, Community 1", phone: "+233 30 299 1122", email: "tema@century-nit.com", status: "Active", staffCount: 2 },
];

const FEATURE_FLAGS = [
	{ id: "ff1", name: "Online consultation booking", category: "Client Portal", enabled: true, description: "Allow clients to book and pay for consultations online" },
	{ id: "ff2", name: "Document vault uploads", category: "Client Portal", enabled: true, description: "Let applicants upload and manage their documents" },
	{ id: "ff3", name: "Visa stage tracking", category: "Operations", enabled: true, description: "Track visa application progress through stages" },
	{ id: "ff4", name: "Automated lead scoring", category: "CRM", enabled: false, description: "Score leads automatically based on engagement" },
	{ id: "ff5", name: "Multi-currency billing", category: "Finance", enabled: false, description: "Bill in GHS, NGN, GBP, and AED alongside USD" },
	{ id: "ff6", name: "Public programme search", category: "Public Site", enabled: true, description: "Searchable programme catalogue on the website" },
	{ id: "ff7", name: "Appointment self-reschedule", category: "Client Portal", enabled: false, description: "Let clients reschedule their own appointments" },
	{ id: "ff8", name: "Bulk email campaigns", category: "CRM", enabled: false, description: "Send marketing emails to lead segments" },
];

export function EnterpriseAdministration({ section = "system" }: { section?: AdminSection }) {
	const meta = SECTION_META[section];

	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem" }}>
				<p className="eyebrow">Platform administration</p>
				<h1 className="page-title mt-1">{meta.title}</h1>
				<p className="lead mt-2">{meta.blurb}</p>
			</div>

			{section === "system" && <SystemOverview />}
			{section === "users" && <UsersAndRoles />}
			{section === "auth" && <AuthSettings />}
			{section === "cms" && <CmsManager />}
			{section === "site" && <SiteSettings />}
			{section === "notifications" && <SystemNotifications />}
			{section === "settings" && <SystemConfig />}
			{section === "security" && <SecurityCenter />}
			{section === "branches" && <BranchManagement />}
			{section === "integrations" && <IntegrationsManager />}
			{section === "features" && <FeatureFlagsManager />}
		</div>
	);
}

/* ─── System overview ─── */

const SYSTEM_HEALTH = [
	{ name: "Web Application", status: "operational", uptime: "99.98%" },
	{ name: "Database", status: "operational", uptime: "99.99%" },
	{ name: "Payment Gateway", status: "operational", uptime: "99.95%" },
	{ name: "Email Delivery", status: "operational", uptime: "99.9%" },
	{ name: "SMS Gateway", status: "degraded", uptime: "97.2%" },
];

function SystemOverview() {
	const { activityLog, cmsOverlay } = useOpsState();
	// Real counts from the site's own collections, not a hardcoded list
	const content = useMemo(() => {
		let all = 0;
		let hidden = 0;
		for (const c of CMS_COLLECTIONS) {
			for (const rec of c.records()) {
				all++;
				if (resolveRecord(c.id, rec, cmsOverlay).status !== "Published") hidden++;
			}
		}
		return { all, published: all - hidden };
	}, [cmsOverlay]);
	const active = STAFF_ACCOUNTS.filter((u) => u.status === "Active").length;
	const operationalCount = SYSTEM_HEALTH.filter((s) => s.status === "operational").length;

	return (
		<>
			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
				<Stat label="Staff Accounts" value={String(STAFF_ACCOUNTS.length)} note={`${active} active`} />
				<Stat label="Roles Configured" value="5" note="Manager · Coordinator · Consultant · Finance · Admin" />
				<Stat label="Published Content" value={String(content.published)} note={`${content.all} entries across ${CMS_COLLECTIONS.length} collections`} />
				<Stat label="System Health" value={`${Math.round((operationalCount / SYSTEM_HEALTH.length) * 100)}%`} note={operationalCount === SYSTEM_HEALTH.length ? "All services operational" : `${operationalCount}/${SYSTEM_HEALTH.length} operational`} inverted />
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Platform Configuration</h2>
					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						<Row label="Authentication" value="Email + SSO (Google, Apple, LinkedIn)" />
						<Row label="Session policy" value="8 hours, sliding" />
						<Row label="Multi-factor" value="Optional - enforced for admins" />
						<Row label="Public site" value="Live · 18 pages" />
						<Row label="Notification channels" value="Email, SMS" />
					</ul>
				</div>
				<div className="card">
					<h2 className="section-title mb-3">Service Health</h2>
					<div className="admin-service-status-list">
						{SYSTEM_HEALTH.map((svc) => (
							<div key={svc.name} className="admin-service-status-row">
								<div className="admin-service-status-row__indicator">
									<span className={`admin-status-dot admin-status-dot--${svc.status}`} />
								</div>
								<div className="admin-service-status-row__name">{svc.name}</div>
								<div className="admin-service-status-row__metrics">
									<span className="mono muted">{svc.uptime}</span>
								</div>
								<span className={`admin-status-pill admin-status-pill--${svc.status}`}>{svc.status}</span>
							</div>
						))}
					</div>
				</div>
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Recent Activity</h2>
					{activityLog.length === 0 ? (
						<p className="muted" style={{ fontSize: "var(--text-sm)", padding: "1rem 0" }}>
							No recorded activity yet.
						</p>
					) : (
						<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
							{activityLog.slice(0, 6).map((e) => (
								<li key={e.id} style={{ padding: "0.7rem 0", borderBottom: "1px solid var(--border-light)" }}>
									<p style={{ fontWeight: 500, fontSize: "var(--text-sm)" }}>{e.action}</p>
									<p className="muted" style={{ fontSize: "var(--text-xs)" }}>{e.actor} · {e.detail}</p>
								</li>
							))}
						</ul>
					)}
				</div>
				<div className="card">
					<h2 className="section-title mb-3">Quick Actions</h2>
					<div className="admin-quick-actions">
						<button className="admin-quick-action">Manage users</button>
						<button className="admin-quick-action">Edit site content</button>
						<button className="admin-quick-action">Configure auth</button>
						<button className="admin-quick-action">View audit log</button>
						<button className="admin-quick-action">Manage branches</button>
						<button className="admin-quick-action">Feature flags</button>
					</div>
				</div>
			</div>

			{/* Audit Log */}
			<div className="card">
				<div className="admin-section-head" style={{ marginBottom: "1rem" }}>
					<div>
						<h2 className="section-title">Audit Log</h2>
						<p className="muted" style={{ fontSize: "var(--text-sm)", marginTop: "0.25rem" }}>Immutable record of administrative actions across the platform.</p>
					</div>
				</div>
				<div style={{ overflowX: "auto" }}>
					<div className="ops-table-wrap">
						<table className="admin-table">
							<thead>
								<tr>
									<th>Time</th>
									<th>Actor</th>
									<th>Action</th>
									<th>Detail</th>
									<th>IP</th>
								</tr>
							</thead>
							<tbody>
								{AUDIT_LOG.map((e) => (
									<tr key={e.id}>
										<td className="admin-table__mono">{new Date(e.at).toLocaleString()}</td>
										<td style={{ fontWeight: 500 }}>{e.actor}</td>
										<td>{e.action}</td>
										<td className="muted">{e.detail}</td>
										<td className="admin-table__mono">{e.ip}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</>
	);
}

function UsersAndRoles() {
	const { opsUser } = useOpsAuth();
	const [roleFilter, setRoleFilter] = useState<"all" | OpsRole>("all");
	const [search, setSearch] = useState("");

	const rows = STAFF_ACCOUNTS.filter((u) => (roleFilter === "all" || u.role === roleFilter) && (search === "" || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())));

	return (
		<>
			<div className="admin-section-head" style={{ marginBottom: "1.5rem" }}>
				<input type="search" placeholder="Search staff..." className="input input--sm" style={{ maxWidth: "260px" }} value={search} onChange={(e) => setSearch(e.target.value)} />
				<div className="admin-section-head__actions">
					<div className="admin-env-tabs">
						{(["all", "manager", "coordinator", "consultant", "finance", "admin"] as const).map((r) => (
							<button
								key={r}
								onClick={() => setRoleFilter(r)}
								className={`admin-env-tab${roleFilter === r ? " admin-env-tab--active" : ""}`}
							>
								{r === "all" ? "All" : ROLE_LABELS[r]}
							</button>
						))}
					</div>
					<button className="btn btn--primary btn--sm">+ Add User</button>
				</div>
			</div>

			<div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "2rem" }}>
				<div className="ops-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Name</th>
								<th>Email</th>
								<th>Role</th>
								<th>Branch</th>
								<th>Status</th>
								<th style={{ textAlign: "right" }}>Action</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((u) => (
								<tr key={u.email}>
									<td style={{ fontWeight: 500 }}>
										{u.name}
										{u.email === opsUser?.email && (
											<span className="mono" style={{ fontSize: "0.6rem", marginLeft: "0.4rem", opacity: 0.6 }}>YOU</span>
										)}
									</td>
									<td className="muted">{u.email}</td>
									<td>{ROLE_LABELS[u.role]}</td>
									<td className="muted">{staffBranchName(u.branch)}</td>
									<td>
										<span
											className="portal-pill"
											style={u.status === "Active" ? { background: "var(--foreground)", color: "var(--background)" } : undefined}
										>
											{u.status}
										</span>
									</td>
									<td style={{ textAlign: "right" }}>
										<button className="btn btn--ghost btn--sm">Edit</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			<div className="card">
				<h2 className="section-title mb-3">Role Definitions</h2>
				<div className="admin-role-grid">
					{(["manager", "coordinator", "consultant", "finance", "admin"] as OpsRole[]).map((r) => (
						<div key={r} className="admin-role-card">
							<div className="admin-role-card__head">
								<span className="admin-role-card__name">{ROLE_LABELS[r]}</span>
								<span className="admin-role-card__count">{STAFF_ACCOUNTS.filter((u) => u.role === r).length}</span>
							</div>
							<p className="admin-role-card__desc">{ROLE_DESCRIPTIONS[r]}</p>
						</div>
					))}
				</div>
			</div>
		</>
	);
}

/* ─── Auth ─── */

function AuthSettings() {
	const [methods, setMethods] = useState({ email: true, google: true, apple: true, linkedin: true, sso: false });
	const [mfa, setMfa] = useState("admins");
	const [sessionLength, setSessionLength] = useState("8");
	const [idleTimeout, setIdleTimeout] = useState("30");
	const [pwMinLength, setPwMinLength] = useState("12");
	const [maxAttempts, setMaxAttempts] = useState("5");
	const [lockoutMin, setLockoutMin] = useState("15");
	const [saved, setSaved] = useState(false);

	function save() {
		setSaved(true);
		window.setTimeout(() => setSaved(false), 2500);
	}

	return (
		<>
			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Sign-in Methods</h2>
					<div className="admin-toggle-list">
						{(
							[
								["email", "Email & password", "Standard username/password login"],
								["google", "Google", "OAuth 2.0 single sign-on"],
								["apple", "Apple", "Sign in with Apple ID"],
								["linkedin", "LinkedIn", "Professional identity verification"],
								["sso", "Enterprise SAML SSO", "SAML 2.0 for enterprise identity providers"],
							] as const
						).map(([key, label, desc]) => (
							<label key={key} className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">{label}</span>
									<span className="admin-toggle-row__desc">{desc}</span>
								</div>
								<input type="checkbox" checked={methods[key]} onChange={() => setMethods((m) => ({ ...m, [key]: !m[key] }))} />
							</label>
						))}
					</div>
				</div>

				<div className="card">
					<h2 className="section-title mb-3">Session & MFA</h2>
					<div className="admin-form-grid">
						<div className="field">
							<label>MFA enforcement</label>
							<select className="input input--full-border" value={mfa} onChange={(e) => setMfa(e.target.value)}>
								<option value="off">Optional for everyone</option>
								<option value="admins">Required for administrators</option>
								<option value="all">Required for all staff</option>
							</select>
						</div>
						<div className="field">
							<label>Session length (hours)</label>
							<input className="input input--full-border" type="number" value={sessionLength} onChange={(e) => setSessionLength(e.target.value)} />
						</div>
						<div className="field">
							<label>Idle timeout (minutes)</label>
							<input className="input input--full-border" type="number" value={idleTimeout} onChange={(e) => setIdleTimeout(e.target.value)} />
						</div>
						<div className="field">
							<label>Min password length</label>
							<input className="input input--full-border" type="number" value={pwMinLength} onChange={(e) => setPwMinLength(e.target.value)} />
						</div>
						<div className="field">
							<label>Max login attempts</label>
							<input className="input input--full-border" type="number" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
						</div>
						<div className="field">
							<label>Lockout duration (min)</label>
							<input className="input input--full-border" type="number" value={lockoutMin} onChange={(e) => setLockoutMin(e.target.value)} />
						</div>
					</div>
					<div className="admin-settings-footer">
						{saved && <span className="admin-saved-indicator">✓ Settings saved</span>}
						<button className="btn btn--primary btn--sm" onClick={save}>{saved ? "Saved" : "Save settings"}</button>
					</div>
			</div>
			</div>

			<div className="card">
				<h2 className="section-title mb-3">Password Policy</h2>
				<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
					<Row label="Minimum length" value={`${pwMinLength} characters`} />
					<Row label="Breach database check" value="Enabled (HaveIBeenPwned)" />
					<Row label="Require uppercase" value="Yes" />
					<Row label="Require numbers" value="Yes" />
					<Row label="Require special characters" value="Yes" />
					<Row label="Password reuse prevention" value="Last 5 passwords" />
				</ul>
			</div>
		</>
	);
}

/* ─── CMS ─── */

/* ─── Site & UI ─── */

function SiteSettings() {
	const [navItems, setNavItems] = useState(["Destinations", "Universities", "Programs", "Scholarships", "Visa Services", "Blog", "Contact"]);
	const [branding, setBranding] = useState({ siteName: "Century NIT", tagline: "Your global education partner", typeface: "Display serif / mono accents", theme: "Monochrome, light", favicon: "favicon.svg" });
	const [editingBranding, setEditingBranding] = useState(false);
	const [saved, setSaved] = useState(false);

	function moveNav(index: number, dir: -1 | 1) {
		const next = [...navItems];
		const target = index + dir;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target], next[index]];
		setNavItems(next);
	}

	function removeNav(index: number) {
		setNavItems(navItems.filter((_, i) => i !== index));
	}

	function save() {
		setSaved(true);
		window.setTimeout(() => setSaved(false), 2500);
	}

	return (
		<>
			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
				<div className="card">
					<div className="admin-section-head" style={{ marginBottom: "1rem" }}>
						<h2 className="section-title">Branding</h2>
						<button className="btn btn--ghost btn--sm" onClick={() => setEditingBranding(!editingBranding)}>
							{editingBranding ? "Cancel" : "Edit"}
						</button>
					</div>
					{editingBranding ? (
						<div className="admin-form-grid">
							<div className="field">
								<label>Site name</label>
								<input className="input input--full-border" value={branding.siteName} onChange={(e) => setBranding({ ...branding, siteName: e.target.value })} />
							</div>
							<div className="field">
								<label>Tagline</label>
								<input className="input input--full-border" value={branding.tagline} onChange={(e) => setBranding({ ...branding, tagline: e.target.value })} />
							</div>
							<div className="field">
								<label>Primary typeface</label>
								<input className="input input--full-border" value={branding.typeface} onChange={(e) => setBranding({ ...branding, typeface: e.target.value })} />
							</div>
							<div className="field">
								<label>Theme</label>
								<select className="input input--full-border" value={branding.theme} onChange={(e) => setBranding({ ...branding, theme: e.target.value })}>
									<option>Monochrome, light</option>
									<option>Monochrome, dark</option>
									<option>High contrast</option>
								</select>
							</div>
							<div className="field">
								<label>Favicon</label>
								<input className="input input--full-border" value={branding.favicon} onChange={(e) => setBranding({ ...branding, favicon: e.target.value })} />
							</div>
							<div className="admin-form-card__actions" style={{ marginTop: "0.5rem" }}>
								<button className="btn btn--primary btn--sm" onClick={() => { setEditingBranding(false); save(); }}>Save changes</button>
							</div>
						</div>
					) : (
						<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
							<Row label="Site name" value={branding.siteName} />
							<Row label="Tagline" value={branding.tagline} />
							<Row label="Primary typeface" value={branding.typeface} />
							<Row label="Theme" value={branding.theme} />
							<Row label="Favicon" value={branding.favicon} />
						</ul>
					)}
				</div>

				<div className="card">
					<h2 className="section-title mb-3">Public Navigation</h2>
					<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
						Items shown in the public site header, in order.
					</p>
					<ul className="admin-nav-list">
						{navItems.map((item, i) => (
							<li key={item} className="admin-nav-item">
								<span className="admin-nav-item__index">{String(i + 1).padStart(2, "0")}</span>
								<span className="admin-nav-item__label">{item}</span>
								<span className="admin-nav-item__actions">
									<button className="admin-icon-btn" onClick={() => moveNav(i, -1)} disabled={i === 0} title="Move up">↑</button>
									<button className="admin-icon-btn" onClick={() => moveNav(i, 1)} disabled={i === navItems.length - 1} title="Move down">↓</button>
									<button className="admin-icon-btn admin-btn--danger" onClick={() => removeNav(i)} title="Remove">✕</button>
								</span>
							</li>
						))}
					</ul>
					{saved && <span className="admin-saved-indicator" style={{ marginTop: "1rem", display: "inline-block" }}>✓ Changes saved</span>}
				</div>
			</div>
		</>
	);
}

/* ─── System notifications ─── */

function SystemNotifications() {
	const [templates, setTemplates] = useState(NOTIFICATION_TEMPLATES);
	const [editing, setEditing] = useState<string | null>(null);

	function toggle(name: string) {
		setTemplates((prev) => prev.map((t) => (t.name === name ? { ...t, active: !t.active } : t)));
	}

	function updateTemplate(name: string, field: "subject" | "body", value: string) {
		setTemplates((prev) => prev.map((t) => (t.name === name ? { ...t, [field]: value } : t)));
	}

	return (
		<>
			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
				<Stat label="Templates" value={String(templates.length)} note={`${templates.filter((t) => t.active).length} active`} />
				<Stat label="Email" value={String(templates.filter((t) => t.channel.includes("Email")).length)} note="Email channels" />
				<Stat label="SMS" value={String(templates.filter((t) => t.channel.includes("SMS")).length)} note="SMS channels" />
				<Stat label="Inactive" value={String(templates.filter((t) => !t.active).length)} note="Disabled" inverted />
			</div>

			<div className="admin-section-head" style={{ marginBottom: "1.5rem" }}>
				<h2 className="section-title">Notification Templates</h2>
				<button className="btn btn--primary btn--sm">+ New Template</button>
			</div>

			<div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: "2rem" }}>
				<div className="ops-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Template</th>
								<th>Trigger</th>
								<th>Channel</th>
								<th style={{ textAlign: "right" }}>Enabled</th>
								<th style={{ textAlign: "right" }}>Edit</th>
							</tr>
						</thead>
						<tbody>
							{templates.map((t) => (
								<tr key={t.name}>
									<td style={{ fontWeight: 500 }}>{t.name}</td>
									<td className="muted">{t.trigger}</td>
									<td>{t.channel}</td>
									<td style={{ textAlign: "right" }}>
										<input type="checkbox" checked={t.active} onChange={() => toggle(t.name)} />
									</td>
									<td style={{ textAlign: "right" }}>
										<button
											className="btn btn--ghost btn--sm"
											onClick={() => setEditing(editing === t.name ? null : t.name)}
										>
											{editing === t.name ? "Close" : "Edit"}
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>

			{editing && templates.find((t) => t.name === editing) && (
				<div className="card admin-form-card">
					<h2 className="admin-form-card__title">Edit: {editing}</h2>
					<div style={{ marginBottom: "1.25rem" }}>
						<label className="eyebrow" style={{ display: "block", marginBottom: "0.4rem", fontSize: "var(--text-xs)" }}>
							Subject line
						</label>
						<input
							className="input input--full-border"
							value={templates.find((t) => t.name === editing)!.subject}
							onChange={(e) => updateTemplate(editing, "subject", e.target.value)}
						/>
					</div>
					<div style={{ marginBottom: "1.25rem" }}>
						<label className="eyebrow" style={{ display: "block", marginBottom: "0.4rem", fontSize: "var(--text-xs)" }}>
							Body <span className="muted" style={{ fontWeight: 400 }}>(use {"{{variables}}"})</span>
						</label>
						<textarea
							className="input input--full-border"
							rows={8}
							value={templates.find((t) => t.name === editing)!.body}
							onChange={(e) => updateTemplate(editing, "body", e.target.value)}
							style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-sm)", resize: "vertical" }}
						/>
					</div>
					<div className="admin-form-card__actions">
						<button className="btn btn--primary btn--sm" onClick={() => setEditing(null)}>Save template</button>
						<button className="btn btn--ghost btn--sm" onClick={() => setEditing(null)}>Cancel</button>
					</div>
				</div>
			)}
		</>
	);
}

/* ─── System config ─── */

const SERVICE_STATUSES = [
	{ name: "Web Application", status: "operational", latency: "42ms", uptime: "99.98%" },
	{ name: "Payment Gateway", status: "operational", latency: "180ms", uptime: "99.95%" },
	{ name: "Email Delivery", status: "operational", latency: "320ms", uptime: "99.9%" },
	{ name: "SMS Gateway", status: "degraded", latency: "1.2s", uptime: "97.2%" },
	{ name: "File Storage (R2)", status: "operational", latency: "85ms", uptime: "100%" },
	{ name: "Database", status: "operational", latency: "12ms", uptime: "99.99%" },
];

type ConfigTab = "general" | "regional" | "storage" | "security" | "email" | "sms" | "payments" | "social" | "advanced";

const CONFIG_TABS: { id: ConfigTab; label: string }[] = [
	{ id: "general", label: "General" },
	{ id: "regional", label: "Regional" },
	{ id: "storage", label: "Storage & Data" },
	{ id: "security", label: "Security" },
	{ id: "email", label: "Email" },
	{ id: "sms", label: "SMS" },
	{ id: "payments", label: "Payments" },
	{ id: "social", label: "Social Sign-In" },
	{ id: "advanced", label: "Advanced" },
];

function SystemConfig() {
	const [tab, setTab] = useState<ConfigTab>("general");
	const [config, setConfig] = useState({
		platformName: "Century NIT",
		supportEmail: "support@century-nit.com",
		supportPhone: "+233 30 555 0100",
		defaultLanguage: "en-GH",
		timezone: "UTC",
		currency: "GHS",
		currencySymbol: "GH₵",
		dateFormat: "YYYY-MM-DD",
		locale: "en-GH",
		fiscalYearStart: "January",
		storageProvider: "Cloudflare R2",
		storageBucket: "century-nit-assets",
		storageRegion: "Auto",
		maxUploadSize: "50",
		backupSchedule: "Daily",
		backupTime: "02:00",
		retentionYears: "7",
		sessionTimeout: "8",
		idleTimeout: "30",
		passwordMinLength: "12",
		maxLoginAttempts: "5",
		lockoutDuration: "15",
		apiRateLimit: "100",
		cacheEnabled: false,
		debugMode: false,
		maintenanceMode: false,
		// Email
		emailProvider: "resend",
		emailFromName: "Century NIT",
		emailFromAddress: "noreply@century-nit.com",
		emailReplyTo: "support@century-nit.com",
		emailApiKey: "re_xxxxxxxxxxxxxxxxxxxx",
		smtpHost: "",
		smtpPort: "587",
		smtpUser: "",
		smtpPassword: "",
		smtpSecure: true,
		emailEnabled: true,
		// SMS
		smsProvider: "twilio",
		smsApiKey: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
		smsApiSecret: "",
		smsSenderId: "CENTURY",
		smsWebhookUrl: "https://api.century-nit.com/webhooks/sms",
		smsEnabled: true,
		// Payments
		paymentProvider: "paystack",
		paymentPublicKey: "pk_live_xxxxxxxxxxxxxxxxxxxx",
		paymentSecretKey: "sk_live_xxxxxxxxxxxxxxxxxxxx",
		paymentWebhookSecret: "whsec_xxxxxxxxxxxxxxxxxxxx",
		paymentCurrency: "GHS",
		paymentTestMode: true,
		paymentEnabled: true,
		// Social Sign-In
		socialGoogleEnabled: true,
		socialGoogleClientId: "xxxxxxxxxxxx.apps.googleusercontent.com",
		socialGoogleClientSecret: "",
		socialGithubEnabled: false,
		socialGithubClientId: "",
		socialGithubClientSecret: "",
		socialFacebookEnabled: false,
		socialFacebookAppId: "",
		socialFacebookAppSecret: "",
		socialAppleEnabled: false,
		socialAppleClientId: "",
		socialAppleClientSecret: "",
		socialCallbackUrl: "https://app.century-nit.com/auth/callback",
	});
	const [saved, setSaved] = useState(false);

	function update<K extends keyof typeof config>(key: K, value: (typeof config)[K]) {
		setConfig((prev) => ({ ...prev, [key]: value }));
		setSaved(false);
	}

	function save() {
		setSaved(true);
		window.setTimeout(() => setSaved(false), 2500);
	}

	const operationalCount = SERVICE_STATUSES.filter((s) => s.status === "operational").length;

	return (
		<>
			{/* Service Status */}
			<div className="card" style={{ marginBottom: "2rem" }}>
				<div className="admin-section-head" style={{ marginBottom: "1.25rem" }}>
					<h2 className="section-title">Service Status</h2>
					<span className={`admin-status-badge admin-status-badge--${operationalCount === SERVICE_STATUSES.length ? "healthy" : "degraded"}`}>
						{operationalCount === SERVICE_STATUSES.length ? "All systems operational" : `${operationalCount}/${SERVICE_STATUSES.length} operational`}
					</span>
				</div>
				<div className="admin-service-status-list">
					{SERVICE_STATUSES.map((svc) => (
						<div key={svc.name} className="admin-service-status-row">
							<div className="admin-service-status-row__indicator">
								<span className={`admin-status-dot admin-status-dot--${svc.status}`} />
							</div>
							<div className="admin-service-status-row__name">{svc.name}</div>
							<div className="admin-service-status-row__metrics">
								<span className="mono muted">{svc.latency}</span>
								<span className="mono muted">{svc.uptime}</span>
							</div>
							<span className={`admin-status-pill admin-status-pill--${svc.status}`}>{svc.status}</span>
						</div>
					))}
				</div>
			</div>

			{/* Tabbed Settings */}
			<div className="card" style={{ padding: 0 }}>
				<div className="admin-settings-tabs">
					{CONFIG_TABS.map((t) => (
						<button
							key={t.id}
							className={`admin-settings-tab${tab === t.id ? " admin-settings-tab--active" : ""}`}
							onClick={() => setTab(t.id)}
						>
							{t.label}
						</button>
					))}
				</div>

				<div className="admin-settings-body">
					{tab === "general" && (
						<div className="admin-form-grid">
							<div className="field">
								<label>Platform name</label>
								<input className="input input--full-border" value={config.platformName} onChange={(e) => update("platformName", e.target.value)} />
							</div>
							<div className="field">
								<label>Support email</label>
								<input className="input input--full-border" type="email" value={config.supportEmail} onChange={(e) => update("supportEmail", e.target.value)} />
							</div>
							<div className="field">
								<label>Support phone</label>
								<input className="input input--full-border" value={config.supportPhone} onChange={(e) => update("supportPhone", e.target.value)} />
							</div>
							<div className="field">
								<label>Default language</label>
								<select className="input input--full-border" value={config.defaultLanguage} onChange={(e) => update("defaultLanguage", e.target.value)}>
									<option value="en-GH">English (Ghana)</option>
									<option value="en-NG">English (Nigeria)</option>
									<option value="en-GB">English (UK)</option>
									<option value="fr-FR">French</option>
								</select>
							</div>
							<div className="field">
								<label>Timezone</label>
								<select className="input input--full-border" value={config.timezone} onChange={(e) => update("timezone", e.target.value)}>
									<option value="UTC">UTC</option>
									<option value="Africa/Accra">Africa/Accra (GMT)</option>
									<option value="Africa/Lagos">Africa/Lagos (WAT)</option>
									<option value="Europe/London">Europe/London (GMT/BST)</option>
								</select>
							</div>
						</div>
					)}

					{tab === "regional" && (
						<div className="admin-form-grid">
							<div className="field">
								<label>Default currency</label>
								<select className="input input--full-border" value={config.currency} onChange={(e) => update("currency", e.target.value)}>
									<option value="GHS">GHS - Ghanaian Cedi</option>
									<option value="USD">USD - US Dollar</option>
									<option value="GBP">GBP - British Pound</option>
									<option value="NGN">NGN - Nigerian Naira</option>
									<option value="AED">AED - UAE Dirham</option>
								</select>
							</div>
							<div className="field">
								<label>Currency symbol</label>
								<input className="input input--full-border" value={config.currencySymbol} onChange={(e) => update("currencySymbol", e.target.value)} />
							</div>
							<div className="field">
								<label>Date format</label>
								<select className="input input--full-border" value={config.dateFormat} onChange={(e) => update("dateFormat", e.target.value)}>
									<option value="YYYY-MM-DD">YYYY-MM-DD</option>
									<option value="DD/MM/YYYY">DD/MM/YYYY</option>
									<option value="MM/DD/YYYY">MM/DD/YYYY</option>
									<option value="DD-MM-YYYY">DD-MM-YYYY</option>
								</select>
							</div>
							<div className="field">
								<label>Locale</label>
								<input className="input input--full-border" value={config.locale} onChange={(e) => update("locale", e.target.value)} />
							</div>
							<div className="field">
								<label>Fiscal year start</label>
								<select className="input input--full-border" value={config.fiscalYearStart} onChange={(e) => update("fiscalYearStart", e.target.value)}>
									<option value="January">January</option>
									<option value="April">April</option>
									<option value="July">July</option>
									<option value="September">September</option>
								</select>
							</div>
						</div>
					)}

					{tab === "storage" && (
						<div className="admin-form-grid">
							<div className="field">
								<label>Storage provider</label>
								<input className="input input--full-border" value={config.storageProvider} onChange={(e) => update("storageProvider", e.target.value)} />
							</div>
							<div className="field">
								<label>Bucket name</label>
								<input className="input input--full-border" value={config.storageBucket} onChange={(e) => update("storageBucket", e.target.value)} />
							</div>
							<div className="field">
								<label>Storage region</label>
								<select className="input input--full-border" value={config.storageRegion} onChange={(e) => update("storageRegion", e.target.value)}>
									<option value="Auto">Auto (nearest)</option>
									<option value="WEUR">Western Europe</option>
									<option value="ENAM">Eastern North America</option>
									<option value="AF">Africa</option>
								</select>
							</div>
							<div className="field">
								<label>Max upload size (MB)</label>
								<input className="input input--full-border" type="number" value={config.maxUploadSize} onChange={(e) => update("maxUploadSize", e.target.value)} />
							</div>
							<div className="field">
								<label>Backup schedule</label>
								<select className="input input--full-border" value={config.backupSchedule} onChange={(e) => update("backupSchedule", e.target.value)}>
									<option value="Daily">Daily</option>
									<option value="Weekly">Weekly</option>
									<option value="Hourly">Hourly</option>
								</select>
							</div>
							<div className="field">
								<label>Backup time (UTC)</label>
								<input className="input input--full-border" type="time" value={config.backupTime} onChange={(e) => update("backupTime", e.target.value)} />
							</div>
							<div className="field">
								<label>Data retention (years)</label>
								<input className="input input--full-border" type="number" value={config.retentionYears} onChange={(e) => update("retentionYears", e.target.value)} />
							</div>
						</div>
					)}

					{tab === "security" && (
						<div className="admin-form-grid">
							<div className="field">
								<label>Session timeout (hours)</label>
								<input className="input input--full-border" type="number" value={config.sessionTimeout} onChange={(e) => update("sessionTimeout", e.target.value)} />
							</div>
							<div className="field">
								<label>Idle timeout (minutes)</label>
								<input className="input input--full-border" type="number" value={config.idleTimeout} onChange={(e) => update("idleTimeout", e.target.value)} />
							</div>
							<div className="field">
								<label>Minimum password length</label>
								<input className="input input--full-border" type="number" value={config.passwordMinLength} onChange={(e) => update("passwordMinLength", e.target.value)} />
							</div>
							<div className="field">
								<label>Max login attempts</label>
								<input className="input input--full-border" type="number" value={config.maxLoginAttempts} onChange={(e) => update("maxLoginAttempts", e.target.value)} />
							</div>
							<div className="field">
								<label>Lockout duration (minutes)</label>
								<input className="input input--full-border" type="number" value={config.lockoutDuration} onChange={(e) => update("lockoutDuration", e.target.value)} />
							</div>
							<div className="field">
								<label>API rate limit (req/min)</label>
								<input className="input input--full-border" type="number" value={config.apiRateLimit} onChange={(e) => update("apiRateLimit", e.target.value)} />
							</div>
						</div>
					)}

					{tab === "email" && (
					<div className="admin-form-grid">
						<div className="field">
							<label>Email provider</label>
							<select className="input input--full-border" value={config.emailProvider} onChange={(e) => update("emailProvider", e.target.value)}>
								<option value="resend">Resend</option>
								<option value="smtp">SMTP (Custom)</option>
								<option value="sendgrid">SendGrid</option>
								<option value="mailgun">Mailgun</option>
								<option value="postmark">Postmark</option>
							</select>
						</div>
						<div className="field">
							<label>From name</label>
							<input className="input input--full-border" value={config.emailFromName} onChange={(e) => update("emailFromName", e.target.value)} />
						</div>
						<div className="field">
							<label>From address</label>
							<input className="input input--full-border" type="email" value={config.emailFromAddress} onChange={(e) => update("emailFromAddress", e.target.value)} />
						</div>
						<div className="field">
							<label>Reply-to address</label>
							<input className="input input--full-border" type="email" value={config.emailReplyTo} onChange={(e) => update("emailReplyTo", e.target.value)} />
						</div>
						{config.emailProvider === "smtp" ? (<>
							<div className="field">
								<label>SMTP host</label>
								<input className="input input--full-border" value={config.smtpHost} onChange={(e) => update("smtpHost", e.target.value)} placeholder="smtp.gmail.com" />
							</div>
							<div className="field">
								<label>SMTP port</label>
								<input className="input input--full-border" type="number" value={config.smtpPort} onChange={(e) => update("smtpPort", e.target.value)} />
							</div>
							<div className="field">
								<label>SMTP username</label>
								<input className="input input--full-border" value={config.smtpUser} onChange={(e) => update("smtpUser", e.target.value)} />
							</div>
							<div className="field">
								<label>SMTP password</label>
								<input className="input input--full-border" type="password" value={config.smtpPassword} onChange={(e) => update("smtpPassword", e.target.value)} />
							</div>
							<div className="field" style={{ gridColumn: "1 / -1" }}>
								<label className="admin-toggle-row">
									<div>
										<span className="admin-toggle-row__label">Use TLS/SSL</span>
										<span className="admin-toggle-row__desc">Encrypt SMTP connections using TLS</span>
									</div>
									<input type="checkbox" checked={config.smtpSecure} onChange={(e) => update("smtpSecure", e.target.checked)} />
								</label>
							</div>
						</>) : (
							<div className="field" style={{ gridColumn: "1 / -1" }}>
								<label>API key</label>
								<input className="input input--full-border" type="password" value={config.emailApiKey} onChange={(e) => update("emailApiKey", e.target.value)} />
							</div>
						)}
						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">Email service enabled</span>
									<span className="admin-toggle-row__desc">Allow the platform to send transactional emails</span>
								</div>
								<input type="checkbox" checked={config.emailEnabled} onChange={(e) => update("emailEnabled", e.target.checked)} />
							</label>
						</div>
					</div>
				)}

				{tab === "sms" && (
					<div className="admin-form-grid">
						<div className="field">
							<label>SMS provider</label>
							<select className="input input--full-border" value={config.smsProvider} onChange={(e) => update("smsProvider", e.target.value)}>
								<option value="twilio">Twilio</option>
								<option value="vonage">Vonage (Nexmo)</option>
								<option value="africastalking">Africa's Talking</option>
								<option value="messagebird">MessageBird</option>
							</select>
						</div>
						<div className="field">
							<label>API key / Account SID</label>
							<input className="input input--full-border" type="password" value={config.smsApiKey} onChange={(e) => update("smsApiKey", e.target.value)} />
						</div>
						<div className="field">
							<label>API secret / Auth token</label>
							<input className="input input--full-border" type="password" value={config.smsApiSecret} onChange={(e) => update("smsApiSecret", e.target.value)} />
						</div>
						<div className="field">
							<label>Sender ID / From number</label>
							<input className="input input--full-border" value={config.smsSenderId} onChange={(e) => update("smsSenderId", e.target.value)} />
						</div>
						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label>Delivery webhook URL</label>
							<input className="input input--full-border" value={config.smsWebhookUrl} onChange={(e) => update("smsWebhookUrl", e.target.value)} />
						</div>
						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">SMS service enabled</span>
									<span className="admin-toggle-row__desc">Allow the platform to send SMS notifications</span>
								</div>
								<input type="checkbox" checked={config.smsEnabled} onChange={(e) => update("smsEnabled", e.target.checked)} />
							</label>
						</div>
					</div>
				)}

				{tab === "payments" && (
					<div className="admin-form-grid">
						<div className="field">
							<label>Payment provider</label>
							<select className="input input--full-border" value={config.paymentProvider} onChange={(e) => update("paymentProvider", e.target.value)}>
								<option value="paystack">Paystack</option>
								<option value="stripe">Stripe</option>
								<option value="flutterwave">Flutterwave</option>
								<option value="paypal">PayPal</option>
								<option value="mtnmomo">MTN MoMo</option>
							</select>
						</div>
						<div className="field">
							<label>Public key</label>
							<input className="input input--full-border" type="password" value={config.paymentPublicKey} onChange={(e) => update("paymentPublicKey", e.target.value)} />
						</div>
						<div className="field">
							<label>Secret key</label>
							<input className="input input--full-border" type="password" value={config.paymentSecretKey} onChange={(e) => update("paymentSecretKey", e.target.value)} />
						</div>
						<div className="field">
							<label>Webhook signing secret</label>
							<input className="input input--full-border" type="password" value={config.paymentWebhookSecret} onChange={(e) => update("paymentWebhookSecret", e.target.value)} />
						</div>
						<div className="field">
							<label>Settlement currency</label>
							<select className="input input--full-border" value={config.paymentCurrency} onChange={(e) => update("paymentCurrency", e.target.value)}>
								<option value="GHS">GHS - Ghanaian Cedi</option>
								<option value="USD">USD - US Dollar</option>
								<option value="NGN">NGN - Nigerian Naira</option>
								<option value="KES">KES - Kenyan Shilling</option>
							</select>
						</div>
						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">Test mode (sandbox)</span>
									<span className="admin-toggle-row__desc">Use provider's sandbox/test environment instead of live keys</span>
								</div>
								<input type="checkbox" checked={config.paymentTestMode} onChange={(e) => update("paymentTestMode", e.target.checked)} />
							</label>
						</div>
						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">Payments enabled</span>
									<span className="admin-toggle-row__desc">Allow online payment collection through the platform</span>
								</div>
								<input type="checkbox" checked={config.paymentEnabled} onChange={(e) => update("paymentEnabled", e.target.checked)} />
							</label>
						</div>
					</div>
				)}

				{tab === "social" && (
					<div className="admin-form-grid">
						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label>OAuth callback URL</label>
							<input className="input input--full-border" value={config.socialCallbackUrl} onChange={(e) => update("socialCallbackUrl", e.target.value)} />
							<p className="muted" style={{ fontSize: "var(--text-xs)", marginTop: "0.25rem" }}>Configure this URL in each provider's developer console</p>
						</div>

						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">Google Sign-In</span>
									<span className="admin-toggle-row__desc">Allow users to sign in with their Google account</span>
								</div>
								<input type="checkbox" checked={config.socialGoogleEnabled} onChange={(e) => update("socialGoogleEnabled", e.target.checked)} />
							</label>
						</div>
						{config.socialGoogleEnabled && (<>
							<div className="field">
								<label>Google Client ID</label>
								<input className="input input--full-border" value={config.socialGoogleClientId} onChange={(e) => update("socialGoogleClientId", e.target.value)} />
							</div>
							<div className="field">
								<label>Google Client Secret</label>
								<input className="input input--full-border" type="password" value={config.socialGoogleClientSecret} onChange={(e) => update("socialGoogleClientSecret", e.target.value)} />
							</div>
						</>)}

						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">GitHub Sign-In</span>
									<span className="admin-toggle-row__desc">Allow users to sign in with their GitHub account</span>
								</div>
								<input type="checkbox" checked={config.socialGithubEnabled} onChange={(e) => update("socialGithubEnabled", e.target.checked)} />
							</label>
						</div>
						{config.socialGithubEnabled && (<>
							<div className="field">
								<label>GitHub Client ID</label>
								<input className="input input--full-border" value={config.socialGithubClientId} onChange={(e) => update("socialGithubClientId", e.target.value)} />
							</div>
							<div className="field">
								<label>GitHub Client Secret</label>
								<input className="input input--full-border" type="password" value={config.socialGithubClientSecret} onChange={(e) => update("socialGithubClientSecret", e.target.value)} />
							</div>
						</>)}

						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">Facebook Sign-In</span>
									<span className="admin-toggle-row__desc">Allow users to sign in with their Facebook account</span>
								</div>
								<input type="checkbox" checked={config.socialFacebookEnabled} onChange={(e) => update("socialFacebookEnabled", e.target.checked)} />
							</label>
						</div>
						{config.socialFacebookEnabled && (<>
							<div className="field">
								<label>Facebook App ID</label>
								<input className="input input--full-border" value={config.socialFacebookAppId} onChange={(e) => update("socialFacebookAppId", e.target.value)} />
							</div>
							<div className="field">
								<label>Facebook App Secret</label>
								<input className="input input--full-border" type="password" value={config.socialFacebookAppSecret} onChange={(e) => update("socialFacebookAppSecret", e.target.value)} />
							</div>
						</>)}

						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">Apple Sign-In</span>
									<span className="admin-toggle-row__desc">Allow users to sign in with their Apple ID</span>
								</div>
								<input type="checkbox" checked={config.socialAppleEnabled} onChange={(e) => update("socialAppleEnabled", e.target.checked)} />
							</label>
						</div>
						{config.socialAppleEnabled && (<>
							<div className="field">
								<label>Apple Client ID (Services ID)</label>
								<input className="input input--full-border" value={config.socialAppleClientId} onChange={(e) => update("socialAppleClientId", e.target.value)} />
							</div>
							<div className="field">
								<label>Apple Client Secret</label>
								<input className="input input--full-border" type="password" value={config.socialAppleClientSecret} onChange={(e) => update("socialAppleClientSecret", e.target.value)} />
							</div>
						</>)}
					</div>
				)}

				{tab === "advanced" && (
						<div className="admin-form-grid" style={{ gridTemplateColumns: "1fr" }}>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">Cache layer</span>
									<span className="admin-toggle-row__desc">Enable Redis-based caching for sessions and frequently accessed data</span>
								</div>
								<input type="checkbox" checked={config.cacheEnabled} onChange={(e) => update("cacheEnabled", e.target.checked)} />
							</label>
							<label className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">Debug mode</span>
									<span className="admin-toggle-row__desc">Show detailed error messages and stack traces (disable in production)</span>
								</div>
								<input type="checkbox" checked={config.debugMode} onChange={(e) => update("debugMode", e.target.checked)} />
							</label>
							<label className="admin-toggle-row admin-toggle-row--danger">
								<div>
									<span className="admin-toggle-row__label">Maintenance mode</span>
									<span className="admin-toggle-row__desc">Take the platform offline for scheduled maintenance</span>
								</div>
								<input type="checkbox" checked={config.maintenanceMode} onChange={(e) => update("maintenanceMode", e.target.checked)} />
							</label>
						</div>
					)}
				</div>

				<div className="admin-settings-footer">
					{saved && <span className="admin-saved-indicator">✓ Changes saved</span>}
					<button className="btn btn--primary btn--sm" onClick={save}>
						{saved ? "Saved" : "Save configuration"}
					</button>
				</div>
			</div>
		</>
	);
}

/* ─── Security center ─── */

function SecurityCenter() {
	const [ipAllowlist, setIpAllowlist] = useState(["192.168.1.0/24", "41.215.44.0/22"]);
	const [newIp, setNewIp] = useState("");
	const [sessions, setSessions] = useState(ACTIVE_SESSIONS);

	function addIp() {
		if (!newIp.trim()) return;
		setIpAllowlist((prev) => [...prev, newIp.trim()]);
		setNewIp("");
	}

	function removeIp(ip: string) {
		setIpAllowlist((prev) => prev.filter((i) => i !== ip));
	}

	function revokeSession(id: string) {
		setSessions((prev) => prev.filter((s) => s.id !== id));
	}

	return (
		<>
			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
				<Stat label="Failed Logins" value={String(FAILED_LOGINS.length)} note={`${FAILED_LOGINS.filter((f) => f.status === "Blocked").length} blocked`} inverted />
				<Stat label="Active Sessions" value={String(sessions.length)} note={`${sessions.filter((s) => s.current).length} yours`} />
				<Stat label="IP Rules" value={String(ipAllowlist.length)} note="CIDR ranges" />
				<Stat label="MFA Coverage" value="60%" note="3 of 5 staff enrolled" />
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem", marginBottom: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Failed Login Attempts</h2>
					<div style={{ overflowX: "auto" }}>
						<div className="ops-table-wrap">
							<table className="admin-table">
								<thead>
									<tr>
										<th>Time</th>
										<th>Email</th>
										<th>IP</th>
										<th>Attempts</th>
										<th>Status</th>
									</tr>
								</thead>
								<tbody>
									{FAILED_LOGINS.map((f) => (
										<tr key={f.id}>
											<td className="admin-table__mono">{new Date(f.at).toLocaleTimeString()}</td>
											<td>{f.email}</td>
											<td className="admin-table__mono">{f.ip}</td>
											<td>{f.attempts}</td>
											<td>
												<span className="portal-pill" style={{
													background: f.status === "Blocked" ? "var(--foreground)" : f.status === "Locked" ? "var(--muted)" : undefined,
													color: f.status === "Blocked" ? "var(--background)" : undefined,
													fontSize: "var(--text-xs)",
												}}>
													{f.status}
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</div>
				</div>

				<div className="card">
					<h2 className="section-title mb-3">IP Allowlist</h2>
					<p className="muted mb-3" style={{ fontSize: "var(--text-sm)" }}>
						Only these CIDR ranges can access the operations console.
					</p>
					<ul className="admin-ip-list">
						{ipAllowlist.map((ip) => (
							<li key={ip} className="admin-ip-row">
								<span className="admin-ip-row__value">{ip}</span>
								<button className="btn btn--ghost btn--sm admin-btn--danger" onClick={() => removeIp(ip)}>Remove</button>
							</li>
						))}
					</ul>
					<div style={{ display: "flex", gap: "0.5rem" }}>
						<input
							className="input input--sm"
							placeholder="e.g. 10.0.0.0/8"
							value={newIp}
							onChange={(e) => setNewIp(e.target.value)}
							onKeyDown={(e) => e.key === "Enter" && addIp()}
						/>
						<button className="btn btn--primary btn--sm" onClick={addIp}>Add</button>
					</div>
				</div>
			</div>

			<div className="card" style={{ padding: 0, overflow: "hidden" }}>
				<h2 className="section-title" style={{ padding: "1.25rem 1.25rem 0" }}>Active Sessions</h2>
				<div className="ops-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>User</th>
								<th>Role</th>
								<th>IP</th>
								<th>Device</th>
								<th>Started</th>
								<th style={{ textAlign: "right" }}>Action</th>
							</tr>
						</thead>
						<tbody>
							{sessions.map((s) => (
								<tr key={s.id}>
									<td style={{ fontWeight: 500 }}>
										{s.user}
										{s.current && <span className="mono" style={{ fontSize: "0.6rem", marginLeft: "0.4rem", opacity: 0.6 }}>YOU</span>}
									</td>
									<td>{ROLE_LABELS[s.role]}</td>
									<td className="admin-table__mono">{s.ip}</td>
									<td>{s.device}</td>
									<td className="admin-table__mono">{new Date(s.started).toLocaleString()}</td>
									<td style={{ textAlign: "right" }}>
										<button
											className="btn btn--ghost btn--sm"
											onClick={() => revokeSession(s.id)}
											disabled={s.current}
										>
											{s.current ? "Current" : "Revoke"}
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</>
	);
}

/* ─── Branch management ─── */

function BranchManagement() {
	const [branches, setBranches] = useState(BRANCHES);
	const [showForm, setShowForm] = useState(false);
	const [form, setForm] = useState({ name: "", country: "", city: "", address: "", phone: "", email: "" });

	function addBranch() {
		if (!form.name.trim()) return;
		const id = form.name.toLowerCase().replace(/\s+/g, "-");
		setBranches((prev) => [...prev, { ...form, id, status: "Active", staffCount: 0 }]);
		setForm({ name: "", country: "", city: "", address: "", phone: "", email: "" });
		setShowForm(false);
	}

	function toggleStatus(id: string) {
		setBranches((prev) => prev.map((b) => b.id === id ? { ...b, status: b.status === "Active" ? "Inactive" : "Active" } : b));
	}

	return (
		<>
			<div className="admin-section-head" style={{ marginBottom: "1.5rem" }}>
				<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1rem" }}>
					<Stat label="Total Branches" value={String(branches.length)} note={`${branches.filter((b) => b.status === "Active").length} active`} />
					<Stat label="Total Staff" value={String(branches.reduce((sum, b) => sum + b.staffCount, 0))} note="Across all branches" />
				</div>
				<button className="btn btn--primary btn--sm" onClick={() => setShowForm(!showForm)}>
					{showForm ? "Cancel" : "+ Add Branch"}
				</button>
			</div>

			{showForm && (
				<div className="card admin-form-card" style={{ marginBottom: "2rem" }}>
					<h2 className="admin-form-card__title">New Branch</h2>
					<div className="admin-form-grid" style={{ marginBottom: "1rem" }}>
						<div className="field">
							<label>Branch name</label>
							<input className="input input--full-border" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Cape Town Office" />
						</div>
						<div className="field">
							<label>Country</label>
							<input className="input input--full-border" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} placeholder="e.g. South Africa" />
						</div>
						<div className="field">
							<label>City</label>
							<input className="input input--full-border" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="e.g. Cape Town" />
						</div>
						<div className="field">
							<label>Phone</label>
							<input className="input input--full-border" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+27 21 555 0100" />
						</div>
						<div className="field">
							<label>Address</label>
							<input className="input input--full-border" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" />
						</div>
						<div className="field">
							<label>Email</label>
							<input className="input input--full-border" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="branch@century-nit.com" />
						</div>
					</div>
					<div className="admin-form-card__actions">
						<button className="btn btn--primary btn--sm" onClick={addBranch}>Create branch</button>
					</div>
				</div>
			)}

			<div className="card" style={{ padding: 0, overflow: "hidden" }}>
				<div className="ops-table-wrap">
					<table className="admin-table">
						<thead>
							<tr>
								<th>Branch</th>
								<th>Location</th>
								<th>Contact</th>
								<th>Staff</th>
								<th>Status</th>
								<th style={{ textAlign: "right" }}>Action</th>
							</tr>
						</thead>
						<tbody>
							{branches.map((b) => (
								<tr key={b.id}>
									<td style={{ fontWeight: 500 }}>{b.name}</td>
									<td className="muted">{b.city}, {b.country}</td>
									<td style={{ fontSize: "var(--text-sm)" }}>
										<div>{b.phone}</div>
										<div className="muted" style={{ fontSize: "var(--text-xs)" }}>{b.email}</div>
									</td>
									<td>{b.staffCount}</td>
									<td>
										<span className="portal-pill" style={b.status === "Active" ? { background: "var(--foreground)", color: "var(--background)" } : undefined}>
											{b.status}
										</span>
									</td>
									<td style={{ textAlign: "right" }}>
										<button className="btn btn--ghost btn--sm" onClick={() => toggleStatus(b.id)}>
											{b.status === "Active" ? "Deactivate" : "Activate"}
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</>
	);
}

/* ─── Integrations manager ─── */

type ApiKey = {
	id: string;
	name: string;
	key: string;
	fullKey: string;
	scope: string;
	environment: "production" | "test";
	created: string;
	lastUsed: string;
	status: "Active" | "Inactive" | "Expired";
	expiresAt: string;
	permissions: string[];
};

type Webhook = {
	id: string;
	name: string;
	url: string;
	events: string[];
	status: "Active" | "Inactive";
	lastDelivery: string;
	signingSecret: string;
	deliveryCount: number;
	failureCount: number;
};

const FULL_API_KEYS: ApiKey[] = [
	{ id: "k1", name: "Paystack Production", key: "sk_live_••••••••4f2a", fullKey: "sk_live_MOCK_KEY_REPLACE_WITH_REAL", scope: "Payments", environment: "production", created: "2026-07-01", lastUsed: "2026-08-06T08:00:00Z", status: "Active", expiresAt: "2027-07-01", permissions: ["charges:write", "charges:read", "refunds:write"] },
	{ id: "k2", name: "Paystack Test", key: "sk_test_••••••••8b3c", fullKey: "sk_test_MOCK_KEY_REPLACE_WITH_REAL", scope: "Payments", environment: "test", created: "2026-07-01", lastUsed: "2026-08-06T09:15:00Z", status: "Active", expiresAt: "2027-07-01", permissions: ["charges:write", "charges:read"] },
	{ id: "k3", name: "Resend Email", key: "re_••••••••a8c1", fullKey: "re_MOCK_KEY_REPLACE_WITH_REAL", scope: "Email delivery", environment: "production", created: "2026-06-15", lastUsed: "2026-08-06T07:30:00Z", status: "Active", expiresAt: "2027-06-15", permissions: ["emails:send", "contacts:read"] },
	{ id: "k4", name: "Twilio SMS", key: "AC••••••••e3b9", fullKey: "ACMOCKKEYREPLACEWITHREAL", scope: "SMS gateway", environment: "production", created: "2026-06-20", lastUsed: "2026-08-05T10:00:00Z", status: "Active", expiresAt: "2027-06-20", permissions: ["sms:send", "sms:read"] },
	{ id: "k5", name: "Cloudflare R2", key: "••••••••d7f0", fullKey: "MOCKKEYREPLACEWITHREAL", scope: "File storage", environment: "production", created: "2026-05-10", lastUsed: "2026-08-06T09:00:00Z", status: "Active", expiresAt: "2028-05-10", permissions: ["objects:read", "objects:write", "buckets:read"] },
	{ id: "k6", name: "Google Maps", key: "AIza••••••••2c4d", fullKey: "AIzaMOCKKEYREPLACEWITHREAL", scope: "Maps & geocoding", environment: "production", created: "2026-04-01", lastUsed: "2026-08-04T14:00:00Z", status: "Inactive", expiresAt: "2027-04-01", permissions: ["geocode:read", "maps:embed"] },
];

const FULL_WEBHOOKS: Webhook[] = [
	{ id: "w1", name: "Paystack Events", url: "https://hooks.century-nit.com/paystack", events: ["payment.success", "payment.failed"], status: "Active", lastDelivery: "2026-08-06T08:05:00Z", signingSecret: "whsec_MOCK_SECRET_REPLACE", deliveryCount: 1247, failureCount: 2 },
	{ id: "w2", name: "Resend Events", url: "https://hooks.century-nit.com/resend", events: ["email.delivered", "email.bounced"], status: "Active", lastDelivery: "2026-08-06T07:35:00Z", signingSecret: "whsec_MOCK_SECRET_REPLACE", deliveryCount: 856, failureCount: 0 },
	{ id: "w3", name: "Lead Capture", url: "https://hooks.century-nit.com/leads", events: ["lead.created", "lead.stage_changed"], status: "Inactive", lastDelivery: "2026-08-01T12:00:00Z", signingSecret: "whsec_MOCK_SECRET_REPLACE", deliveryCount: 34, failureCount: 5 },
];

const SERVICE_CATALOG = [
	{ id: "paystack", name: "Paystack", category: "Payments", description: "Payment processing for GHS and USD", connected: true, icon: "₵" },
	{ id: "resend", name: "Resend", category: "Email", description: "Transactional email delivery", connected: true, icon: "✉" },
	{ id: "twilio", name: "Twilio", category: "SMS", description: "SMS notifications and alerts", connected: true, icon: "SMS" },
	{ id: "r2", name: "Cloudflare R2", category: "Storage", description: "S3-compatible object storage", connected: true, icon: "◈" },
	{ id: "maps", name: "Google Maps", category: "Maps", description: "Geocoding and map embeds", connected: false, icon: "◉" },
	{ id: "openai", name: "OpenAI", category: "AI", description: "Document summarization and chat", connected: false, icon: "✦" },
];

function IntegrationsManager() {
	const [keys, setKeys] = useState<ApiKey[]>(FULL_API_KEYS);
	const [webhooks, setWebhooks] = useState<Webhook[]>(FULL_WEBHOOKS);
	const [env, setEnv] = useState<"all" | "production" | "test">("all");
	const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
	const [copiedId, setCopiedId] = useState<string | null>(null);
	const [showKeyForm, setShowKeyForm] = useState(false);
	const [showWebhookForm, setShowWebhookForm] = useState(false);
	const [newKey, setNewKey] = useState({ name: "", key: "", scope: "", environment: "production" as "production" | "test" });
	const [newWebhook, setNewWebhook] = useState({ name: "", url: "", events: "" });
	const [testResult, setTestResult] = useState<Record<string, "pending" | "success" | "failed">>({});

	function toggleReveal(id: string) {
		setRevealedKeys((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	}

	function copyKey(id: string, fullKey: string) {
		navigator.clipboard?.writeText(fullKey).then(() => {
			setCopiedId(id);
			window.setTimeout(() => setCopiedId(null), 2000);
		});
	}

	function addKey() {
		if (!newKey.name.trim() || !newKey.key.trim()) return;
		const id = `k${keys.length + 1}`;
		const masked = newKey.key.slice(0, 4) + "••••••••" + newKey.key.slice(-4);
		setKeys((prev) => [...prev, {
			id,
			name: newKey.name,
			key: masked,
			fullKey: newKey.key,
			scope: newKey.scope || "Custom",
			environment: newKey.environment,
			created: new Date().toISOString().slice(0, 10),
			lastUsed: new Date().toISOString(),
			status: "Active",
			expiresAt: new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
			permissions: [],
		}]);
		setNewKey({ name: "", key: "", scope: "", environment: "production" });
		setShowKeyForm(false);
	}

	function rotateKey(id: string) {
		setKeys((prev) => prev.map((k) => {
			if (k.id !== id) return k;
			const newSuffix = Math.random().toString(36).slice(2, 6);
			const prefix = k.fullKey.split("_")[0] + (k.fullKey.includes("_") ? "_" : "");
			const newFull = prefix + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10) + newSuffix;
			return { ...k, key: newFull.slice(0, 4) + "••••••••" + newSuffix, fullKey: newFull, lastUsed: new Date().toISOString() };
		}));
	}

	function revokeKey(id: string) {
		setKeys((prev) => prev.map((k) => k.id === id ? { ...k, status: "Inactive" as const } : k));
	}

	function addWebhook() {
		if (!newWebhook.name.trim() || !newWebhook.url.trim()) return;
		const id = `w${webhooks.length + 1}`;
		const events = newWebhook.events.split(",").map((e) => e.trim()).filter(Boolean);
		setWebhooks((prev) => [...prev, {
			id,
			name: newWebhook.name,
			url: newWebhook.url,
			events: events.length > 0 ? events : ["custom.event"],
			status: "Active",
			lastDelivery: new Date().toISOString(),
			signingSecret: "whsec_" + Math.random().toString(36).slice(2, 20),
			deliveryCount: 0,
			failureCount: 0,
		}]);
		setNewWebhook({ name: "", url: "", events: "" });
		setShowWebhookForm(false);
	}

	function toggleWebhook(id: string) {
		setWebhooks((prev) => prev.map((w) => w.id === id ? { ...w, status: w.status === "Active" ? "Inactive" : "Active" } : w));
	}

	function testWebhook(id: string) {
		setTestResult((prev) => ({ ...prev, [id]: "pending" }));
		window.setTimeout(() => {
			setTestResult((prev) => ({ ...prev, [id]: "success" }));
			window.setTimeout(() => {
				setTestResult((prev) => {
					const next = { ...prev };
					delete next[id];
					return next;
				});
			}, 3000);
		}, 1200);
	}

	const filteredKeys = env === "all" ? keys : keys.filter((k) => k.environment === env);
	const prodCount = keys.filter((k) => k.environment === "production").length;
	const testCount = keys.filter((k) => k.environment === "test").length;
	const activeCount = keys.filter((k) => k.status === "Active").length;

	return (
		<>
			{/* Stats */}
			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
				<Stat label="API Keys" value={String(keys.length)} note={`${activeCount} active`} />
				<Stat label="Production" value={String(prodCount)} note="Live environment" />
				<Stat label="Test / Sandbox" value={String(testCount)} note="Non-production" />
				<Stat label="Webhooks" value={String(webhooks.filter((w) => w.status === "Active").length)} note={`${webhooks.length} configured`} inverted />
			</div>

			{/* Service Catalog */}
			<div className="card" style={{ marginBottom: "2rem" }}>
				<h2 className="section-title mb-3">Connected Services</h2>
				<div className="admin-service-grid">
					{SERVICE_CATALOG.map((svc) => (
						<div key={svc.id} className={`admin-service-card${svc.connected ? " admin-service-card--connected" : ""}`}>
							<div className="admin-service-card__icon">{svc.icon}</div>
							<div className="admin-service-card__meta">
								<p className="admin-service-card__name">{svc.name}</p>
								<p className="admin-service-card__cat">{svc.category}</p>
							</div>
							<div className="admin-service-card__body">
								<p className="admin-service-card__desc">{svc.description}</p>
							</div>
							<span className={`admin-service-card__badge${svc.connected ? " admin-service-card__badge--on" : ""}`}>
								{svc.connected ? "Connected" : "Available"}
							</span>
					</div>
					))}
				</div>
			</div>

			{/* API Keys */}
			<div className="admin-section-head">
				<h2 className="section-title">API Keys & Credentials</h2>
				<div className="admin-section-head__actions">
					<div className="admin-env-tabs">
						{(["all", "production", "test"] as const).map((e) => (
							<button
								key={e}
								className={`admin-env-tab${env === e ? " admin-env-tab--active" : ""}`}
								onClick={() => setEnv(e)}
							>
								{e === "all" ? "All" : e === "production" ? "Production" : "Test"}
							</button>
						))}
					</div>
					<button className="btn btn--primary btn--sm" onClick={() => setShowKeyForm(!showKeyForm)}>
						{showKeyForm ? "Cancel" : "+ Add Key"}
					</button>
				</div>
			</div>

			{showKeyForm && (
				<div className="card admin-form-card" style={{ marginBottom: "1.5rem" }}>
					<h3 className="admin-form-card__title">New API Key</h3>
					<div className="form-grid form-grid--2" style={{ marginBottom: "1rem" }}>
						<div className="field">
							<label>Key name</label>
							<input className="input input--full-border" value={newKey.name} onChange={(e) => setNewKey({ ...newKey, name: e.target.value })} placeholder="e.g. Stripe Production" />
						</div>
						<div className="field">
							<label>Secret key value</label>
							<input className="input input--full-border" type="password" value={newKey.key} onChange={(e) => setNewKey({ ...newKey, key: e.target.value })} placeholder="sk_live_..." />
						</div>
						<div className="field">
							<label>Scope / Category</label>
							<input className="input input--full-border" value={newKey.scope} onChange={(e) => setNewKey({ ...newKey, scope: e.target.value })} placeholder="e.g. Payments" />
						</div>
						<div className="field">
							<label>Environment</label>
							<select className="input input--full-border" value={newKey.environment} onChange={(e) => setNewKey({ ...newKey, environment: e.target.value as "production" | "test" })}>
								<option value="production">Production</option>
								<option value="test">Test / Sandbox</option>
							</select>
						</div>
					</div>
					<div className="admin-form-card__actions">
						<button className="btn btn--primary btn--sm" onClick={addKey}>Save key</button>
						<button className="btn btn--ghost btn--sm" onClick={() => setShowKeyForm(false)}>Cancel</button>
					</div>
				</div>
			)}

			<div className="admin-key-list" style={{ marginBottom: "2.5rem" }}>
				{filteredKeys.map((k) => {
					const revealed = revealedKeys.has(k.id);
					const copied = copiedId === k.id;
					return (
						<div key={k.id} className={`admin-key-card${k.status === "Inactive" ? " admin-key-card--inactive" : ""}`}>
							<div className="admin-key-card__header">
								<div className="admin-key-card__title-row">
									<span className="admin-key-card__name">{k.name}</span>
									<span className={`admin-env-tag admin-env-tag--${k.environment}`}>{k.environment}</span>
									<span className={`admin-key-status admin-key-status--${k.status.toLowerCase()}`}>{k.status}</span>
								</div>
								<span className="admin-key-card__scope">{k.scope}</span>
							</div>

							<div className="admin-key-card__secret">
								<code className="admin-key-card__value">{revealed ? k.fullKey : k.key}</code>
								<div className="admin-key-card__secret-actions">
									<button className="admin-icon-btn" onClick={() => toggleReveal(k.id)} title={revealed ? "Hide" : "Reveal"}>
										{revealed ? <EyeOffIcon /> : <EyeIcon />}
									</button>
									<button className="admin-icon-btn" onClick={() => copyKey(k.id, k.fullKey)} title="Copy">
										{copied ? <CheckIcon /> : <CopyIcon />}
									</button>
								</div>
							</div>

							{k.permissions.length > 0 && (
								<div className="admin-key-card__perms">
									{k.permissions.map((p) => (
										<span key={p} className="admin-perm-chip">{p}</span>
									))}
								</div>
							)}

							<div className="admin-key-card__footer">
								<div className="admin-key-card__meta">
									<span className="mono">Created {k.created}</span>
									<span className="mono">Expires {k.expiresAt}</span>
									<span className="mono">Last used {new Date(k.lastUsed).toLocaleDateString()}</span>
								</div>
								<div className="admin-key-card__actions">
									<button className="btn btn--ghost btn--sm" onClick={() => rotateKey(k.id)}>Rotate</button>
									{k.status === "Active" ? (
										<button className="btn btn--ghost btn--sm admin-btn--danger" onClick={() => revokeKey(k.id)}>Revoke</button>
									) : (
										<span className="muted mono" style={{ fontSize: "var(--text-xs)" }}>Revoked</span>
									)}
								</div>
							</div>
						</div>
					);
				})}
			</div>

			{/* Webhooks */}
			<div className="admin-section-head">
				<h2 className="section-title">Webhook Endpoints</h2>
				<button className="btn btn--primary btn--sm" onClick={() => setShowWebhookForm(!showWebhookForm)}>
					{showWebhookForm ? "Cancel" : "+ Add Webhook"}
				</button>
			</div>

			{showWebhookForm && (
				<div className="card admin-form-card" style={{ marginBottom: "1.5rem" }}>
					<h3 className="admin-form-card__title">New Webhook</h3>
					<div className="form-grid form-grid--2" style={{ marginBottom: "1rem" }}>
						<div className="field">
							<label>Webhook name</label>
							<input className="input input--full-border" value={newWebhook.name} onChange={(e) => setNewWebhook({ ...newWebhook, name: e.target.value })} placeholder="e.g. Payment Events" />
						</div>
						<div className="field">
							<label>Endpoint URL</label>
							<input className="input input--full-border" value={newWebhook.url} onChange={(e) => setNewWebhook({ ...newWebhook, url: e.target.value })} placeholder="https://hooks.example.com/endpoint" />
						</div>
						<div className="field" style={{ gridColumn: "1 / -1" }}>
							<label>Events (comma-separated)</label>
							<input className="input input--full-border" value={newWebhook.events} onChange={(e) => setNewWebhook({ ...newWebhook, events: e.target.value })} placeholder="payment.success, payment.failed" />
						</div>
					</div>
					<div className="admin-form-card__actions">
						<button className="btn btn--primary btn--sm" onClick={addWebhook}>Create webhook</button>
						<button className="btn btn--ghost btn--sm" onClick={() => setShowWebhookForm(false)}>Cancel</button>
					</div>
				</div>
			)}

			<div className="admin-webhook-list">
				{webhooks.map((w) => {
					const result = testResult[w.id];
					const successRate = w.deliveryCount > 0 ? Math.round(((w.deliveryCount - w.failureCount) / w.deliveryCount) * 100) : 100;
					return (
						<div key={w.id} className={`admin-webhook-card${w.status === "Inactive" ? " admin-webhook-card--inactive" : ""}`}>
							<div className="admin-webhook-card__header">
								<div>
									<span className="admin-webhook-card__name">{w.name}</span>
									<span className={`admin-key-status admin-key-status--${w.status.toLowerCase()}`}>{w.status}</span>
								</div>
								<button className="btn btn--ghost btn--sm" onClick={() => toggleWebhook(w.id)}>
									{w.status === "Active" ? "Disable" : "Enable"}
								</button>
							</div>

							<div className="admin-webhook-card__url">
								<code>{w.url}</code>
							</div>

							<div className="admin-webhook-card__events">
								{w.events.map((ev) => (
									<span key={ev} className="admin-event-chip">{ev}</span>
								))}
							</div>

							<div className="admin-webhook-card__secret">
								<span className="mono muted" style={{ fontSize: "var(--text-xs)" }}>Signing secret</span>
								<code className="admin-webhook-card__secret-val">{w.signingSecret}</code>
								<button className="admin-icon-btn" onClick={() => navigator.clipboard?.writeText(w.signingSecret)} title="Copy secret">
									<CopyIcon />
								</button>
							</div>

							<div className="admin-webhook-card__stats">
								<div className="admin-webhook-stat">
									<span className="admin-webhook-stat__value">{w.deliveryCount.toLocaleString()}</span>
									<span className="admin-webhook-stat__label">Deliveries</span>
								</div>
								<div className="admin-webhook-stat">
									<span className="admin-webhook-stat__value">{w.failureCount}</span>
									<span className="admin-webhook-stat__label">Failures</span>
								</div>
								<div className="admin-webhook-stat">
									<span className={`admin-webhook-stat__value${successRate < 95 ? " admin-webhook-stat__value--warn" : ""}`}>{successRate}%</span>
									<span className="admin-webhook-stat__label">Success rate</span>
								</div>
								<div className="admin-webhook-stat">
									<span className="admin-webhook-stat__value mono">{new Date(w.lastDelivery).toLocaleDateString()}</span>
									<span className="admin-webhook-stat__label">Last delivery</span>
								</div>
							</div>

							<div className="admin-webhook-card__footer">
								<button
									className={`btn btn--sm ${result === "success" ? "btn--primary" : "btn--ghost"}`}
									onClick={() => testWebhook(w.id)}
									disabled={result === "pending" || w.status === "Inactive"}
								>
									{result === "pending" ? "Sending..." : result === "success" ? "✓ Delivered" : "Send test"}
								</button>
							</div>
						</div>
					);
				})}
			</div>
		</>
	);
}

/* ─── Small icons for integrations ─── */

function EyeIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	);
}

function EyeOffIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
			<line x1="1" y1="1" x2="23" y2="23" />
		</svg>
	);
}

function CopyIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
			<rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
			<path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
		</svg>
	);
}

function CheckIcon() {
	return (
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
			<polyline points="20 6 9 17 4 12" />
		</svg>
	);
}

/* ─── Feature flags ─── */

function FeatureFlagsManager() {
	const [flags, setFlags] = useState(FEATURE_FLAGS);

	function toggle(id: string) {
		setFlags((prev) => prev.map((f) => f.id === id ? { ...f, enabled: !f.enabled } : f));
	}

	const categories = [...new Set(flags.map((f) => f.category))];

	return (
		<>
			<div className="ops-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
				<Stat label="Total Flags" value={String(flags.length)} note={`${flags.filter((f) => f.enabled).length} enabled`} />
				<Stat label="Categories" value={String(categories.length)} note={categories.join(", ")} />
				<Stat label="Disabled" value={String(flags.filter((f) => !f.enabled).length)} note="Pending rollout" inverted />
			</div>

			{categories.map((cat) => (
				<div key={cat} className="card" style={{ marginBottom: "1.5rem" }}>
					<h2 className="section-title mb-3">{cat}</h2>
					<div className="admin-toggle-list">
						{flags.filter((f) => f.category === cat).map((f) => (
							<label key={f.id} className="admin-toggle-row">
								<div>
									<span className="admin-toggle-row__label">{f.name}</span>
									<span className="admin-toggle-row__desc">{f.description}</span>
								</div>
								<input type="checkbox" checked={f.enabled} onChange={() => toggle(f.id)} />
							</label>
						))}
					</div>
				</div>
			))}
		</>
	);
}

/* ─── Shared ─── */

function Stat({ label, value, note, inverted }: { label: string; value: string; note: string; inverted?: boolean }) {
	return (
		<div className="card" style={inverted ? { background: "var(--foreground)", color: "var(--background)" } : undefined}>
			<p className="eyebrow" style={inverted ? { color: "var(--muted-foreground)" } : undefined}>{label}</p>
			<p className="page-title mt-1" style={inverted ? { color: "var(--background)" } : undefined}>{value}</p>
			<p className="muted mt-2" style={inverted ? { color: "var(--muted-foreground)" } : undefined}>{note}</p>
		</div>
	);
}

function Row({ label, value }: { label: string; value: string }) {
	return (
		<li style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.6rem 0", borderBottom: "1px solid var(--border-light)", fontSize: "var(--text-sm)" }}>
			<span className="muted">{label}</span>
			<span style={{ textAlign: "right" }}>{value}</span>
		</li>
	);
}
