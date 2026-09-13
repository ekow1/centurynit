import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
	API_PREFIX,
	FEE_KIND_LABELS,
	type DestinationTariff,
	type FeeCatalogue,
	type FeeItem,
	type UpdateFeeItem,
} from "century-nit-shared";
import { Sheet, StatusPill } from "century-nit-core/ui";
import { apiFetch, ApiError } from "../lib/api";
import { useOpsAuth } from "./OpsAuthContext";
import { Toast } from "./OpsDialogs";

/**
 * The fee schedule — what finance owns, and only that.
 *
 * Century's fee is the package's service fee (edited under Packages) plus
 * the items here: the consultation and a short list of add-ons. Everything
 * else the client pays through Century is a third-party cost recovered at
 * cost: a university's application fee (on the university), a country's
 * visa and biometrics fees (below), and the optional at-cost items. The
 * exchange rate and the milestone split close the page — every surface
 * prices from this same payload (`GET /api/v1/fees`).
 */

const CHAPTER_LABELS: Record<string, string> = { consult: "Consultation", apply: "Applications", visa: "Visa", depart: "Departure" };

const usd = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const toCents = (dollars: string): number => {
	const n = Number(dollars.replace(/[^0-9.]/g, ""));
	return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export function EnterpriseFeeSchedule() {
	const { hasCapability } = useOpsAuth();
	const canEdit = hasCapability("manage_settings");
	const [cat, setCat] = useState<FeeCatalogue | null>(null);
	const [items, setItems] = useState<FeeItem[]>([]);
	const [loading, setLoading] = useState(true);
	const [toast, setToast] = useState<{ type: "error" | "success" | "info"; message: string } | null>(null);
	const say = (type: "error" | "success" | "info", message: string) => setToast({ type, message });

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [catalogue, all] = await Promise.all([apiFetch<FeeCatalogue>(`${API_PREFIX}/fees`), apiFetch<{ items: FeeItem[] }>(`${API_PREFIX}/fees/items`)]);
			setCat(catalogue);
			setItems(all.items);
		} catch (err) {
			say("error", err instanceof ApiError ? err.message : "Could not load the fee schedule");
		} finally {
			setLoading(false);
		}
	}, []);
	useEffect(() => {
		void load();
	}, [load]);

	// ── item editor ─────────────────────────────────────────────────────
	const [editing, setEditing] = useState<FeeItem | null>(null);
	const [draft, setDraft] = useState<{ name: string; clientLabel: string; description: string; amount: string; optional: boolean; active: boolean }>({
		name: "",
		clientLabel: "",
		description: "",
		amount: "",
		optional: false,
		active: true,
	});
	const [saving, setSaving] = useState(false);
	const [sheetError, setSheetError] = useState<string | null>(null);
	function openItem(item: FeeItem) {
		setDraft({ name: item.name, clientLabel: item.clientLabel, description: item.description ?? "", amount: (item.amountCents / 100).toFixed(2), optional: item.optional, active: item.active });
		setSheetError(null);
		setEditing(item);
	}
	async function saveItem() {
		if (!editing) return;
		setSaving(true);
		setSheetError(null);
		try {
			const patch: UpdateFeeItem = {
				name: draft.name.trim(),
				clientLabel: draft.clientLabel.trim(),
				description: draft.description.trim() || null,
				amountCents: toCents(draft.amount),
				optional: draft.optional,
				active: draft.active,
			};
			await apiFetch(`${API_PREFIX}/fees/items/${editing.key}`, { method: "PUT", body: JSON.stringify(patch) });
			say("success", `${patch.name} saved.`);
			setEditing(null);
			await load();
		} catch (err) {
			setSheetError(err instanceof ApiError ? err.message : "Could not save the item");
		} finally {
			setSaving(false);
		}
	}

	// ── destination tariffs (inline) ────────────────────────────────────
	const [tariffDraft, setTariffDraft] = useState<Record<string, { visa: string; biometrics: string }>>({});
	const tariffValue = (d: DestinationTariff) => tariffDraft[d.id] ?? { visa: (d.visaFeeCents / 100).toFixed(2), biometrics: (d.biometricsFeeCents / 100).toFixed(2) };
	async function saveTariff(d: DestinationTariff) {
		const v = tariffValue(d);
		try {
			await apiFetch(`${API_PREFIX}/fees/destinations/${d.id}`, {
				method: "PUT",
				body: JSON.stringify({ visaFeeCents: toCents(v.visa), biometricsFeeCents: toCents(v.biometrics) }),
			});
			say("success", `${d.name} saved.`);
			setTariffDraft((prev) => {
				const next = { ...prev };
				delete next[d.id];
				return next;
			});
			await load();
		} catch (err) {
			say("error", err instanceof ApiError ? err.message : `Could not save ${d.name}`);
		}
	}

	// ── exchange rate + split (settings) ────────────────────────────────
	const [rate, setRate] = useState<string>("");
	const [deposit, setDeposit] = useState<string>("");
	const [preDeparture, setPreDeparture] = useState<string>("");
	useEffect(() => {
		if (!cat) return;
		setRate(String(cat.exchangeRate));
		setDeposit(String(cat.serviceFeeSplit.depositPercent));
		setPreDeparture(String(cat.serviceFeeSplit.preDeparturePercent));
	}, [cat]);
	async function putSetting(key: string, value: string) {
		await apiFetch(`${API_PREFIX}/settings`, { method: "PUT", body: JSON.stringify({ key, value }) });
	}
	async function saveMoneyRules() {
		const r = Number(rate);
		const d = Number.parseInt(deposit, 10);
		const p = Number.parseInt(preDeparture, 10);
		if (!Number.isFinite(r) || r <= 0) return say("error", "The exchange rate must be a positive number.");
		if (!Number.isInteger(d) || !Number.isInteger(p) || d < 1 || p < 1 || d + p >= 100) return say("error", "Deposit and pre-departure must be whole percentages that leave something for after arrival.");
		try {
			await putSetting("PLATFORM_EXCHANGE_RATE", String(r));
			await putSetting("SERVICE_FEE_DEPOSIT_PERCENT", String(d));
			await putSetting("SERVICE_FEE_PRE_DEPARTURE_PERCENT", String(p));
			say("success", "Money rules saved — new invoices price from them.");
			await load();
		} catch (err) {
			say("error", err instanceof ApiError ? err.message : "Could not save");
		}
	}

	const century = items.filter((i) => i.kind === "century");
	const passThrough = items.filter((i) => i.kind === "pass_through");
	const post = cat ? cat.serviceFeeSplit.postArrivalPercent : 100 - (Number.parseInt(deposit, 10) || 0) - (Number.parseInt(preDeparture, 10) || 0);

	function ItemTable({ rows, empty }: { rows: FeeItem[]; empty: string }) {
		if (rows.length === 0) return <p className="muted text-sm">{empty}</p>;
		return (
			<div style={{ overflowX: "auto" }}>
				<table className="admin-table" style={{ width: "100%" }}>
					<thead>
						<tr>
							<th>Item</th>
							<th>Client reads</th>
							<th>Chapter</th>
							<th>When</th>
							<th style={{ textAlign: "right" }}>Amount</th>
							<th />
						</tr>
					</thead>
					<tbody>
						{rows.map((i) => (
							<tr key={i.key} style={{ opacity: i.active ? 1 : 0.55 }}>
								<td>
									<p className="text-sm--strong">{i.name}</p>
									{i.description && <p className="muted text-xs">{i.description}</p>}
								</td>
								<td className="text-sm">{i.clientLabel}</td>
								<td className="text-sm">{CHAPTER_LABELS[i.chapter] ?? i.chapter}</td>
								<td>
									<StatusPill tone={!i.active ? "void" : i.optional ? "waiting" : "current"}>{!i.active ? "Off" : i.optional ? "When ticked" : "Automatic"}</StatusPill>
								</td>
								<td className="mono" style={{ textAlign: "right" }}>
									{usd(i.amountCents)}
								</td>
								<td style={{ textAlign: "right" }}>
									{canEdit && (
										<button type="button" className="btn btn--sm btn--ghost" onClick={() => openItem(i)}>
											Edit
										</button>
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	return (
		<div className="admin-page">
			<div className="admin-section-head" style={{ marginBottom: "1.5rem" }}>
				<div>
					<h2 className="section-title">Fee schedule</h2>
					<p className="muted" style={{ marginTop: "0.25rem" }}>
						Century's fee is the package's service fee plus the items below. Everything else is paid on the client's behalf, at cost.
						Prices are in USD; the client is charged in GHS at the rate at the bottom.
					</p>
				</div>
			</div>

			{loading && !cat ? (
				<div className="route-loading" role="status" aria-live="polite">
					<span className="route-loading__spinner" aria-hidden="true" />
				</div>
			) : (
				<div className="cn-stack" style={{ gap: "1.25rem" }}>
					<section className="card">
						<div className="between mb-2" style={{ alignItems: "baseline", flexWrap: "wrap", gap: "0.75rem" }}>
							<p className="eyebrow" style={{ margin: 0 }}>
								{FEE_KIND_LABELS.century}
							</p>
							<Link to="/packages" className="btn btn--sm btn--ghost">
								Service fee by package →
							</Link>
						</div>
						<p className="muted text-xs mb-3">The service fee covers every chapter's work. These are the only fees Century charges on top of it.</p>
						<ItemTable rows={century} empty="No items." />
					</section>

					<section className="card">
						<p className="eyebrow mb-2">{FEE_KIND_LABELS.pass_through} · optional items</p>
						<p className="muted text-xs mb-3">Third-party costs recovered at cost, offered as tick-boxes when an invoice is raised or approved. University application fees are set on each university; visa costs by country are below.</p>
						<ItemTable rows={passThrough} empty="No items." />
					</section>

					<section className="card">
						<p className="eyebrow mb-2">{FEE_KIND_LABELS.pass_through} · visa costs by country</p>
						<p className="muted text-xs mb-3">The embassy's visa fee and the visa centre's biometrics fee, in USD. The visa invoice takes the accepted school's country.</p>
						{cat && cat.destinations.length > 0 ? (
							<div style={{ overflowX: "auto" }}>
								<table className="admin-table" style={{ width: "100%" }}>
									<thead>
										<tr>
											<th>Country</th>
											<th style={{ width: "10rem" }}>Visa fee</th>
											<th style={{ width: "10rem" }}>Biometrics</th>
											<th />
										</tr>
									</thead>
									<tbody>
										{cat.destinations.map((d) => {
											const v = tariffValue(d);
											const dirty = Boolean(tariffDraft[d.id]);
											return (
												<tr key={d.id}>
													<td className="text-sm--strong">{d.name}</td>
													<td>
														<input className="input input--sm" inputMode="decimal" value={v.visa} disabled={!canEdit} onChange={(e) => setTariffDraft({ ...tariffDraft, [d.id]: { ...v, visa: e.target.value } })} />
													</td>
													<td>
														<input className="input input--sm" inputMode="decimal" value={v.biometrics} disabled={!canEdit} onChange={(e) => setTariffDraft({ ...tariffDraft, [d.id]: { ...v, biometrics: e.target.value } })} />
													</td>
													<td style={{ textAlign: "right" }}>
														{canEdit && dirty && (
															<button type="button" className="btn btn--sm btn--primary" onClick={() => void saveTariff(d)}>
																Save
															</button>
														)}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						) : (
							<p className="muted text-sm">No destinations in the catalogue yet.</p>
						)}
					</section>

					<section className="card">
						<p className="eyebrow mb-2">Money rules</p>
						<div className="cn-facts">
							<label>
								<span className="muted text-xs">Exchange rate — GHS per USD (the client is charged at this)</span>
								<input className="input input--sm" inputMode="decimal" value={rate} disabled={!canEdit} onChange={(e) => setRate(e.target.value)} />
							</label>
							<div />
							<label>
								<span className="muted text-xs">Service fee · deposit %</span>
								<input className="input input--sm" inputMode="numeric" value={deposit} disabled={!canEdit} onChange={(e) => setDeposit(e.target.value)} />
							</label>
							<label>
								<span className="muted text-xs">Service fee · pre-departure % (after the visa, before travel)</span>
								<input className="input input--sm" inputMode="numeric" value={preDeparture} disabled={!canEdit} onChange={(e) => setPreDeparture(e.target.value)} />
							</label>
						</div>
						<p className="muted text-xs mt-2">
							Post-arrival: {Number.isFinite(post) ? post : "—"} %. Changes apply to invoices raised from now on; drafts and issued invoices keep their figures.
						</p>
						{canEdit && (
							<div className="mt-3">
								<button type="button" className="btn btn--sm btn--primary" onClick={() => void saveMoneyRules()}>
									Save money rules
								</button>
							</div>
						)}
					</section>
				</div>
			)}

			<Sheet open={Boolean(editing)} onClose={() => setEditing(null)} title={editing ? `Edit · ${editing.name}` : "Edit"}>
				{editing && (
					<div className="cn-stack">
						<p className="muted text-sm">
							{FEE_KIND_LABELS[editing.kind]} · {CHAPTER_LABELS[editing.chapter] ?? editing.chapter} · key <code>{editing.key}</code>
						</p>
						<label>
							<span className="muted text-xs">Name (ops)</span>
							<input className="input input--sm" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
						</label>
						<label>
							<span className="muted text-xs">What the client reads on the invoice</span>
							<input className="input input--sm" value={draft.clientLabel} onChange={(e) => setDraft({ ...draft, clientLabel: e.target.value })} />
						</label>
						<label>
							<span className="muted text-xs">Description (ops)</span>
							<input className="input input--sm" value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
						</label>
						<label>
							<span className="muted text-xs">Amount (USD)</span>
							<input className="input input--sm" inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
						</label>
						<label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
							<input type="checkbox" checked={draft.optional} onChange={(e) => setDraft({ ...draft, optional: e.target.checked })} />
							<span className="text-sm">Offered as a tick-box when raising or approving (otherwise added automatically)</span>
						</label>
						<label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
							<input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
							<span className="text-sm">Active</span>
						</label>
						<div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
							<button type="button" className="btn btn--sm btn--ghost" onClick={() => setEditing(null)} disabled={saving}>
								Cancel
							</button>
							<button type="button" className="btn btn--sm btn--primary" onClick={() => void saveItem()} disabled={saving || !draft.name.trim() || !draft.clientLabel.trim()}>
								{saving ? "Saving…" : "Save"}
							</button>
						</div>
						{sheetError && <p className="cn-assign__error">{sheetError}</p>}
					</div>
				)}
			</Sheet>

			{toast && <Toast type={toast.type} message={toast.message} onDone={() => setToast(null)} />}
		</div>
	);
}
