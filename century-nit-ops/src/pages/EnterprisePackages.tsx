import { useState } from "react";
import { createPortal } from "react-dom";
import { useOpsAuth } from "./OpsAuthContext";
import { useOpsState } from "./OpsStateContext";
import type { ServicePackage } from "century-nit-core/ops";
import { fmtBoth, fmtGhs, fmtUsd } from "./currency";

/**
 * Service packages. Finance owns the catalogue; every other role that can see
 * this module gets a read-only view.
 */
export function EnterprisePackages() {
	const { opsUser, canEditPackages } = useOpsAuth();
	const { packages, savePackage, togglePackage } = useOpsState();
	const [editing, setEditing] = useState<ServicePackage | null>(null);

	const by = opsUser?.name ?? "Finance";

	function startNew() {
		setEditing({
			id: `pkg-${Date.now().toString(36)}`,
			name: "",
			price: 0,
			description: "",
			services: [],
			active: true,
		});
	}

	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem", gap: "1rem", flexWrap: "wrap" }}>
				<div>
					<h1 className="page-title">Service Packages</h1>
					<p className="lead mt-2">
					{canEditPackages
						? "Manage pricing, included services, and availability."
						: "Pricing and included services. The manager maintains this catalogue."}
					</p>
				</div>
				{canEditPackages ? (
					<button className="btn btn--primary" onClick={startNew}>+ Create Package</button>
				) : (
					<span className="portal-pill" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-xs)" }}>
						🔒 Read only
					</span>
				)}
			</div>

			<div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "2rem" }}>
				{packages.map((pkg) => (
					<div
						key={pkg.id}
						className="card"
						style={{ display: "flex", flexDirection: "column", opacity: pkg.active ? 1 : 0.55 }}
					>
						<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "0.5rem", flexWrap: "wrap" }}>
							<h2 className="section-title mb-1">{pkg.name}</h2>
							{!pkg.active && (
								<span className="portal-pill" style={{ fontSize: "var(--text-xs)" }}>Retired</span>
							)}
						</div>
						<p className="page-title mt-2 mb-1">{fmtGhs(pkg.price)}</p>
					<p className="muted mb-3" style={{ fontSize: "var(--text-xs)" }}>≈ {fmtUsd(pkg.price)} USD</p>
						<p className="muted mb-4">{pkg.description}</p>

						<div style={{ flexGrow: 1 }}>
							<p className="eyebrow mb-2">Included Services</p>
							<ul style={{ paddingLeft: "1.2rem", fontSize: "0.875rem", marginBottom: "1.5rem" }}>
								{pkg.services.map((s) => (
									<li key={s}>{s}</li>
								))}
							</ul>
						</div>

						{canEditPackages ? (
							<div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
								<button className="btn btn--ghost btn--sm" style={{ flex: 1 }} onClick={() => setEditing(pkg)}>
									Edit
								</button>
								<button className="btn btn--ghost btn--sm" style={{ flex: 1 }} onClick={() => togglePackage(pkg.id, by)}>
									{pkg.active ? "Retire" : "Activate"}
								</button>
							</div>
						) : (
							<p className="mono muted" style={{ fontSize: "var(--text-xs)" }}>
								{pkg.active ? "Available to applicants" : "Not currently offered"}
							</p>
						)}
					</div>
				))}
			</div>

			{editing && canEditPackages && (
				<PackageEditor
					pkg={editing}
					onCancel={() => setEditing(null)}
					onSave={(next) => {
						savePackage(next, by);
						setEditing(null);
					}}
				/>
			)}
		</div>
	);
}

function PackageEditor({
	pkg,
	onSave,
	onCancel,
}: {
	pkg: ServicePackage;
	onSave: (pkg: ServicePackage) => void;
	onCancel: () => void;
}) {
	const [name, setName] = useState(pkg.name);
	const [price, setPrice] = useState(String(pkg.price));
	const [description, setDescription] = useState(pkg.description);
	const [services, setServices] = useState(pkg.services.join("\n"));

	function submit(e: React.FormEvent) {
		e.preventDefault();
		onSave({
			...pkg,
			name: name.trim() || "Untitled package",
			price: Number(price) || 0,
			description: description.trim(),
			services: services
				.split("\n")
				.map((s) => s.trim())
				.filter(Boolean),
		});
	}

	/* Portalled to <body> - see the note on the invoice builder: a transformed
	   ancestor captures position:fixed and pins the scrim to the content column. */
	return createPortal(
		<div
			onClick={onCancel}
			style={{
				position: "fixed",
				inset: 0,
				zIndex: 1500,
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				padding: "2rem",
				background: "rgba(0,0,0,0.6)",
				backdropFilter: "blur(2px)",
			}}
		>
			<form
				onClick={(e) => e.stopPropagation()}
				onSubmit={submit}
				className="card"
				style={{ width: "100%", maxWidth: "520px", maxHeight: "85vh", overflowY: "auto" }}
			>
				<h2 className="section-title mb-3">{pkg.name ? "Edit package" : "New package"}</h2>

				<Field label="Name">
					<input className="input" style={{ width: "100%" }} value={name} onChange={(e) => setName(e.target.value)} />
				</Field>
				<Field label="Price (USD)">
					<input
						className="input"
						style={{ width: "100%" }}
						type="number"
						min="0"
						value={price}
						onChange={(e) => setPrice(e.target.value)}
					/>
					<span className="muted" style={{ fontSize: "var(--text-xs)" }}>
						{Number(price) > 0 ? `≈ ${fmtBoth(Number(price))}` : "Enter a USD amount - the cedi equivalent is shown automatically."}
					</span>
				</Field>
				<Field label="Description">
					<textarea
						className="input"
						style={{ width: "100%" }}
						rows={2}
						value={description}
						onChange={(e) => setDescription(e.target.value)}
					/>
				</Field>
				<Field label="Included services - one per line">
					<textarea
						className="input"
						style={{ width: "100%" }}
						rows={5}
						value={services}
						onChange={(e) => setServices(e.target.value)}
					/>
				</Field>

				<div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem", flexWrap: "wrap" }}>
					<button type="submit" className="btn btn--primary" style={{ flex: 1 }}>Save package</button>
					<button type="button" className="btn btn--ghost" style={{ flex: 1 }} onClick={onCancel}>Cancel</button>
				</div>
			</form>
		</div>,
		document.body,
	);
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<label style={{ display: "block", marginBottom: "1rem" }}>
			<span className="eyebrow" style={{ display: "block", marginBottom: "0.35rem", fontSize: "var(--text-xs)" }}>
				{label}
			</span>
			{children}
		</label>
	);
}
