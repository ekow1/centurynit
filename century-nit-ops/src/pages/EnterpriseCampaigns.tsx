import { useSearchParams } from "react-router-dom";
import { CampaignsTab } from "./marketing/CampaignsTab";
import { AudiencesTab } from "./marketing/AudiencesTab";
import { ContactsTab } from "./marketing/ContactsTab";
import { TemplatesTab } from "./marketing/TemplatesTab";
import { AutomationsTab } from "./marketing/AutomationsTab";

type Tab = "campaigns" | "audiences" | "contacts" | "templates" | "automations";

const TABS: { id: Tab; label: string; hint: string }[] = [
	{ id: "campaigns", label: "Campaigns", hint: "Queue, compose, report" },
	{ id: "audiences", label: "Audiences", hint: "Live segments & lists" },
	{ id: "contacts", label: "Contacts", hint: "People, consent, history" },
	{ id: "templates", label: "Templates", hint: "Reusable block emails" },
	{ id: "automations", label: "Automations", hint: "Event → segment → send" },
];

/**
 * Marketing command surface — five URL-addressable tabs so a refresh or a
 * shared link lands exactly where the operator was.
 */
export function EnterpriseCampaigns() {
	const [params, setParams] = useSearchParams();
	const tab = (TABS.some((t) => t.id === params.get("tab")) ? params.get("tab") : "campaigns") as Tab;

	return (
		<div className="page-content fade-in">
			<header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16, flexWrap: "wrap" }}>
				<div>
					<h1 className="page-title">Marketing</h1>
					<p className="lead">Campaigns, live audiences, people, and the automations that mail them.</p>
				</div>
			</header>

			<nav className="mkt-tabs" aria-label="Marketing sections">
				{TABS.map((t) => (
					<button
						key={t.id}
						type="button"
						className={`mkt-tab${tab === t.id ? " mkt-tab--on" : ""}`}
						onClick={() => setParams({ tab: t.id }, { replace: true })}
					>
						<span className="mkt-tab__label">{t.label}</span>
						<span className="mkt-tab__hint">{t.hint}</span>
					</button>
				))}
			</nav>

			{tab === "campaigns" && <CampaignsTab />}
			{tab === "audiences" && <AudiencesTab />}
			{tab === "contacts" && <ContactsTab />}
			{tab === "templates" && <TemplatesTab />}
			{tab === "automations" && <AutomationsTab />}
		</div>
	);
}
