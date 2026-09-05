import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useOpsState } from "./OpsStateContext";
import { useCases } from "../hooks/useCases";
import { useOpsAuth, ROLE_LABELS, type OpsModule } from "./OpsAuthContext";

export function OpsCommandPalette() {
	const { isCommandOpen, openCommandPalette, closeCommandPalette, recentRecords, pushRecentRecord } = useOpsState();
	const { consultations, applications, applicants } = useCases();
	const { opsRole, opsUser, hasPermission, scopeRecords } = useOpsAuth();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Keyboard listener for ⌘K or Ctrl+K, and "/" (excluding editable fields).
	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
				e.preventDefault();
				if (isCommandOpen) {
					closeCommandPalette();
				} else {
					setQuery("");
					setSelectedIndex(0);
					openCommandPalette();
				}
			} else if (
				e.key === "/" &&
				!isCommandOpen &&
				!isEditableTarget(e.target as HTMLElement | null)
			) {
				e.preventDefault();
				setQuery("");
				setSelectedIndex(0);
				openCommandPalette();
			} else if (e.key === "Escape" && isCommandOpen) {
				closeCommandPalette();
			}
		}
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isCommandOpen, openCommandPalette, closeCommandPalette]);

	useEffect(() => {
		if (isCommandOpen) {
			setTimeout(() => inputRef.current?.focus(), 50);
		}
	}, [isCommandOpen]);

	if (!isCommandOpen) return null;

	// Build search results across all entities
	const navItems = [
		{ type: "Module", title: "Dashboard", subtitle: "Mission Control View", path: "/dashboard", module: "dashboard" },
		{ type: "Module", title: "Applications", subtitle: "Active Cases & Approvals", path: "/applications", module: "applications" },
		{ type: "Module", title: "Consultations", subtitle: "Meetings & Eligibility Assessments", path: "/consultations", module: "consultations" },
		{ type: "Module", title: "Applicants", subtitle: "Confirmed Dossiers & Timelines", path: "/applicants", module: "applicants" },
		{ type: "Module", title: "Workflow Pipeline", subtitle: "Kanban Board", path: "/workflow", module: "workflow" },
		{ type: "Module", title: "Finance & Invoices", subtitle: "Revenue Analytics & Ledger", path: "/finance", module: "finance" },
		{ type: "Module", title: "Universities", subtitle: "Institutions & Programs", path: "/universities", module: "universities" },
		{ type: "Module", title: "Service Packages", subtitle: "Pricing & Tiers", path: "/packages", module: "packages" },
		{ type: "Module", title: "Helpdesk", subtitle: "Client conversation queue", path: "/helpdesk", module: "helpdesk" },
		{ type: "Module", title: "Marketing", subtitle: "Email & SMS campaigns", path: "/marketing", module: "marketing" },
		{ type: "Module", title: "Notifications", subtitle: "Templates & Delivery Logs", path: "/notifications", module: "notifications" },
		{ type: "Module", title: "System Settings", subtitle: "Configuration & Preferences", path: "/settings", module: "settings" },
	].filter((item) => hasPermission(item.module as OpsModule));

	// Record results are scoped to the current user's role/assignment, matching
	// the dashboard scoping. A finance role shouldn't see consultation statuses.
	const canSeeConsultations = hasPermission("consultations");
	const canSeeApplications = hasPermission("applications");
	const canSeeApplicants = hasPermission("applicants");

	const scopedConsultations = canSeeConsultations
		? scopeRecords(
				consultations,
				(c) => c.assignedOfficerEmail === opsUser?.email || c.assignedOfficer === opsUser?.name,
			)
		: [];
	const scopedApplications = canSeeApplications
		? scopeRecords(
				applications,
				(a) => a.assignedStaffEmail === opsUser?.email || a.assignedStaff === opsUser?.name,
			)
		: [];
	const scopedApplicantsRecord = canSeeApplicants
		? scopeRecords(
				applicants,
				(a) => a.assignedOfficerEmail === opsUser?.email || a.assignedOfficer === opsUser?.name,
			)
		: [];

	const consultationResults = scopedConsultations
		.filter((c) => c.applicantName.toLowerCase().includes(query.toLowerCase()) || c.ref.toLowerCase().includes(query.toLowerCase()))
		.map((c) => ({
			type: "Consultation",
			title: `${c.applicantName} (${c.ref})`,
			subtitle: `Targeting ${c.targetCountry} · ${c.dateTime} · ${c.status}`,
			path: `/consultations?focus=${encodeURIComponent(c.id)}`,
			recordId: c.id,
		}));

	const applicationResults = scopedApplications
		.filter((a) => a.applicantName.toLowerCase().includes(query.toLowerCase()) || a.appId.toLowerCase().includes(query.toLowerCase()) || a.university.toLowerCase().includes(query.toLowerCase()))
		.map((a) => ({
			type: "Application",
			title: `${a.applicantName} - ${a.appId}`,
			subtitle: `${a.university} (${a.program}) · ${a.status}`,
			path: `/applications?focus=${encodeURIComponent(a.id)}`,
			recordId: a.id,
		}));

	const applicantResults = scopedApplicantsRecord
		.filter((ap) => ap.name.toLowerCase().includes(query.toLowerCase()) || ap.applicantId.toLowerCase().includes(query.toLowerCase()))
		.map((ap) => ({
			type: "Applicant",
			title: `${ap.name} (${ap.applicantId})`,
			subtitle: `${ap.university} · Stage: ${ap.currentStage} · ${ap.status}`,
			path: `/applicants?focus=${encodeURIComponent(ap.id)}`,
			recordId: ap.id,
		}));

	const recordResults = [...consultationResults, ...applicationResults, ...applicantResults];

	const allResults = (() => {
		if (!query.trim()) {
			// Empty query: show modules + recent records (most useful default state).
			const recent = recentRecords.filter((r) => r.type !== "Module");
			return [...navItems, ...recent];
		}
		return [...navItems, ...recordResults].filter((res) => {
			if (res.type === "Module") return true;
			return (
				res.title.toLowerCase().includes(query.toLowerCase()) ||
				res.subtitle.toLowerCase().includes(query.toLowerCase()) ||
				res.type.toLowerCase().includes(query.toLowerCase())
			);
		});
	})();

	function handleSelect(item: typeof allResults[number]) {
		// Push record selections to recent so they surface on an empty query.
		if (item.type !== "Module") {
			pushRecentRecord({
				path: item.path,
				title: item.title,
				subtitle: item.subtitle,
				type: item.type,
			});
		}
		closeCommandPalette();
		navigate(item.path);
	}

	function handleKeyDown(e: React.KeyboardEvent) {
		if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((prev) => (prev < allResults.length - 1 ? prev + 1 : 0));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((prev) => (prev > 0 ? prev - 1 : allResults.length - 1));
		} else if (e.key === "Enter" && allResults[selectedIndex]) {
			e.preventDefault();
			handleSelect(allResults[selectedIndex]);
		}
	}

	return (
		<div className="ops-modal-backdrop" onClick={closeCommandPalette}>
			<div
				className="ops-modal ops-command-palette"
				onClick={(e) => e.stopPropagation()}
				style={{ maxWidth: "640px" }}
			>
				{/* Search Input Bar */}
				<div className="ops-command-palette__input-row">
					<span className="ops-command-palette__search-icon" aria-hidden>⚲</span>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => {
							setQuery(e.target.value);
							setSelectedIndex(0);
						}}
						onKeyDown={handleKeyDown}
						placeholder="Type a command or search across all records... (Esc to cancel)"
						className="ops-command-palette__input"
						aria-label="Search commands and records"
					/>
					<span className="portal-pill ops-command-palette__role">
						{opsRole ? ROLE_LABELS[opsRole] : "Ops"}
					</span>
				</div>

				{/* Results List */}
				<div className="ops-command-palette__results">
					{allResults.length === 0 ? (
						<p className="muted ops-command-palette__empty">
							No command or record matching &quot;{query}&quot;.
						</p>
					) : (
						allResults.map((item, idx) => {
							const isRecent = !query.trim() && item.type !== "Module";
							return (
								<div
									key={`${item.type}-${item.path}-${idx}`}
									onClick={() => handleSelect(item)}
									onMouseEnter={() => setSelectedIndex(idx)}
									className={`ops-command-palette__item${selectedIndex === idx ? " ops-command-palette__item--active" : ""}`}
								>
									<div className="ops-command-palette__item-text">
										<p className="ops-command-palette__item-title">
											{item.title}
											{isRecent ? <span className="ops-command-palette__recent-tag">Recent</span> : null}
										</p>
										<p className="ops-command-palette__item-sub muted">{item.subtitle}</p>
									</div>
									<span className="ops-command-palette__item-type">{item.type}</span>
								</div>
							);
						})
					)}
				</div>

				{/* Footer Shortcuts */}
				<div className="ops-command-palette__footer muted">
					<span>Use <strong>↑ ↓</strong> to navigate</span>
					<span>Press <strong>↵ Enter</strong> to select</span>
					<span>Press <strong>Esc</strong> to close</span>
				</div>
			</div>
		</div>
	);
}

function isEditableTarget(el: HTMLElement | null): boolean {
	if (!el) return false;
	const tag = el.tagName;
	if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
	if (el.isContentEditable) return true;
	return false;
}
