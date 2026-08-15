import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useOpsState } from "./OpsStateContext";
import { useOpsAuth, ROLE_LABELS, type OpsModule } from "./OpsAuthContext";

export function OpsCommandPalette() {
	const { isCommandOpen, openCommandPalette, closeCommandPalette, consultations, applications, applicants } =
		useOpsState();
	const { opsRole, hasPermission } = useOpsAuth();
	const navigate = useNavigate();
	const [query, setQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Keyboard listener for ⌘K or /
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
				!["INPUT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
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
		{ type: "Module", title: "Dashboard", subtitle: "Mission Control View", path: "/ops/dashboard", module: "dashboard" },
		{ type: "Module", title: "Applications", subtitle: "Active Cases & Approvals", path: "/ops/applications", module: "applications" },
		{ type: "Module", title: "Consultations", subtitle: "Meetings & Eligibility Assessments", path: "/ops/consultations", module: "consultations" },
		{ type: "Module", title: "Applicants", subtitle: "Confirmed Dossiers & Timelines", path: "/ops/applicants", module: "applicants" },
		{ type: "Module", title: "Workflow Pipeline", subtitle: "Kanban Board", path: "/ops/workflow", module: "workflow" },
		{ type: "Module", title: "Finance & Invoices", subtitle: "Revenue Analytics & Ledger", path: "/ops/finance", module: "finance" },
		{ type: "Module", title: "Universities", subtitle: "Institutions & Programs", path: "/ops/universities", module: "universities" },
		{ type: "Module", title: "Service Packages", subtitle: "Pricing & Tiers", path: "/ops/packages", module: "packages" },
		{ type: "Module", title: "Helpdesk", subtitle: "Support tickets & inquiries", path: "/ops/helpdesk", module: "helpdesk" },
		{ type: "Module", title: "Marketing", subtitle: "Email & SMS campaigns", path: "/ops/marketing", module: "marketing" },
		{ type: "Module", title: "Notifications", subtitle: "Templates & Delivery Logs", path: "/ops/notifications", module: "notifications" },
		{ type: "Module", title: "System Settings", subtitle: "Configuration & Preferences", path: "/ops/settings", module: "settings" },
	].filter((item) => hasPermission(item.module as OpsModule));

	const consultationResults = consultations
		.filter((c) => c.applicantName.toLowerCase().includes(query.toLowerCase()) || c.ref.toLowerCase().includes(query.toLowerCase()))
		.map((c) => ({
			type: "Consultation",
			title: `${c.applicantName} (${c.ref})`,
			subtitle: `Targeting ${c.targetCountry} · ${c.dateTime} · ${c.status}`,
			path: "/ops/consultations",
		}));

	const applicationResults = applications
		.filter((a) => a.applicantName.toLowerCase().includes(query.toLowerCase()) || a.appId.toLowerCase().includes(query.toLowerCase()) || a.university.toLowerCase().includes(query.toLowerCase()))
		.map((a) => ({
			type: "Application",
			title: `${a.applicantName} - ${a.appId}`,
			subtitle: `${a.university} (${a.program}) · ${a.status}`,
			path: "/ops/applications",
		}));

	const applicantResults = applicants
		.filter((ap) => ap.name.toLowerCase().includes(query.toLowerCase()) || ap.applicantId.toLowerCase().includes(query.toLowerCase()))
		.map((ap) => ({
			type: "Applicant",
			title: `${ap.name} (${ap.applicantId})`,
			subtitle: `${ap.university} · Stage: ${ap.currentStage} · ${ap.status}`,
			path: "/ops/applicants",
		}));

	const allResults = [...navItems, ...consultationResults, ...applicationResults, ...applicantResults].filter((res) => {
		if (!query.trim()) return res.type === "Module";
		return (
			res.title.toLowerCase().includes(query.toLowerCase()) ||
			res.subtitle.toLowerCase().includes(query.toLowerCase()) ||
			res.type.toLowerCase().includes(query.toLowerCase())
		);
	});

	function handleSelect(path: string) {
		closeCommandPalette();
		navigate(path);
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
			handleSelect(allResults[selectedIndex].path);
		}
	}

	return (
		<div
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 2000,
				display: "flex",
				justifyContent: "center",
				alignItems: "flex-start",
				paddingTop: "8vh",
				background: "rgba(0, 0, 0, 0.65)",
				backdropFilter: "blur(4px)",
			}}
			onClick={closeCommandPalette}
		>
			<div
				onClick={(e) => e.stopPropagation()}
				style={{
					width: "100%",
					maxWidth: "640px",
					background: "var(--background)",
					border: "1px solid var(--border)",
					boxShadow: "0 16px 48px rgba(0,0,0,0.3)",
					display: "flex",
					flexDirection: "column",
					overflow: "hidden",
					animation: "ops-fade-in 0.15s ease-out",
				}}
			>
				{/* Search Input Bar */}
				<div style={{ display: "flex", alignItems: "center", padding: "1rem 1.25rem", borderBottom: "1px solid var(--border-light)" }}>
					<span style={{ fontSize: "1.2rem", marginRight: "0.75rem", opacity: 0.6 }}>⚲</span>
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
						style={{
							width: "100%",
							border: "none",
							background: "transparent",
							outline: "none",
							fontFamily: "var(--font-body)",
							fontSize: "var(--text-base)",
						}}
					/>
					<span className="portal-pill" style={{ fontSize: "var(--text-xs)", padding: "0.2rem 0.5rem" }}>
						{opsRole ? ROLE_LABELS[opsRole] : "Ops"}
					</span>
				</div>

				{/* Results List */}
				<div style={{ maxHeight: "380px", overflowY: "auto", padding: "0.5rem" }}>
					{allResults.length === 0 ? (
						<p style={{ padding: "2rem", textAlign: "center" }} className="muted">
							No command or record matching &quot;{query}&quot;.
						</p>
					) : (
						allResults.map((item, idx) => (
							<div
								key={idx}
								onClick={() => handleSelect(item.path)}
								onMouseEnter={() => setSelectedIndex(idx)}
								style={{
									display: "flex",
									justifyContent: "space-between",
									alignItems: "center",
									padding: "0.85rem 1rem",
									border: "1px solid",
									borderColor: selectedIndex === idx ? "var(--border)" : "transparent",
									background: selectedIndex === idx ? "var(--foreground)" : "transparent",
									color: selectedIndex === idx ? "var(--background)" : "var(--foreground)",
									cursor: "pointer",
									transition: "all 100ms",
								}}
							>
								<div>
									<p style={{ fontWeight: 600, fontSize: "var(--text-sm)", color: selectedIndex === idx ? "var(--background)" : "var(--foreground)" }}>
										{item.title}
									</p>
									<p style={{ fontSize: "var(--text-xs)", opacity: 0.7, color: selectedIndex === idx ? "var(--muted)" : "var(--muted-foreground)" }}>
										{item.subtitle}
									</p>
								</div>
								<span
									style={{
										fontFamily: "var(--font-mono)",
										fontSize: "var(--text-xs)",
										textTransform: "uppercase",
										padding: "0.2rem 0.5rem",
										border: "1px solid",
										borderColor: selectedIndex === idx ? "var(--background)" : "var(--border-light)",
										color: selectedIndex === idx ? "var(--background)" : "var(--muted-foreground)",
									}}
								>
									{item.type}
								</span>
							</div>
						))
					)}
				</div>

				{/* Footer Shortcuts */}
				<div style={{ padding: "0.75rem 1.25rem", borderTop: "1px solid var(--border-light)", background: "var(--muted)", display: "flex", justifyContent: "space-between", fontSize: "var(--text-xs)" }} className="muted">
					<span>Use <strong style={{ color: "var(--foreground)" }}>↑ ↓</strong> to navigate</span>
					<span>Press <strong style={{ color: "var(--foreground)" }}>↵ Enter</strong> to select</span>
					<span>Press <strong style={{ color: "var(--foreground)" }}>Esc</strong> to close</span>
				</div>
			</div>
		</div>
	);
}
