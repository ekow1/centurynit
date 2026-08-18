import { useState, useEffect } from "react";
import { apiFetch } from "../lib/api";
import { useCasesApi } from "../hooks/useCasesApi";
import type { CatalogScholarship, StudentScholarship } from "century-nit-shared";

export function AssignScholarshipModal({
	applicantId,
	onClose,
}: {
	applicantId: string;
	onClose: () => void;
}) {
	const { listScholarships, assignScholarship, removeScholarship } = useCasesApi();

	const [catalog, setCatalog] = useState<CatalogScholarship[]>([]);
	const [assigned, setAssigned] = useState<StudentScholarship[]>([]);
	const [loading, setLoading] = useState(true);
	
	const [selectedScholarshipId, setSelectedScholarshipId] = useState("");
	const [terms, setTerms] = useState("");
	
	const [actionLoading, setActionLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const loadData = async () => {
		try {
			setLoading(true);
			const [catRes, assignedRes] = await Promise.all([
				apiFetch<{ scholarships: CatalogScholarship[] }>("/api/v1/catalog/scholarships"),
				listScholarships(applicantId)
			]);
			setCatalog(catRes.scholarships);
			setAssigned(assignedRes.scholarships);
			if (catRes.scholarships.length > 0) setSelectedScholarshipId(catRes.scholarships[0].id);
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to load scholarships");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void loadData();
	}, [applicantId]);

	const handleAssign = async (e: React.FormEvent) => {
		e.preventDefault();
		if (!selectedScholarshipId) return;
		
		try {
			setActionLoading(true);
			setError(null);
			await assignScholarship(applicantId, {
				scholarshipId: selectedScholarshipId,
				notes: terms || undefined,
			});
			await loadData();
			setTerms("");
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to assign scholarship");
		} finally {
			setActionLoading(false);
		}
	};

	const handleRemove = async (id: string) => {
		try {
			setActionLoading(true);
			setError(null);
			await removeScholarship(applicantId, id);
			await loadData();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to remove scholarship");
		} finally {
			setActionLoading(false);
		}
	};

	return (
		<div className="ops-modal">
			<div className="ops-modal__backdrop" onClick={onClose} />
			<div className="ops-modal__content" style={{ maxWidth: "600px" }}>
				<button type="button" className="ops-modal__close" onClick={onClose}>
					&times;
				</button>
				<h2 className="heading-3 mb-2">Manage Scholarships</h2>
				<p className="muted mb-4" style={{ fontSize: "var(--text-sm)" }}>
					Assign or remove scholarships for this applicant.
				</p>

				{error && <p className="ops-modal__error mb-4">{error}</p>}

				{loading ? (
					<p>Loading...</p>
				) : (
					<div style={{ display: "flex", flexDirection: "column", gap: "2rem" }}>
						<div>
							<h3 className="heading-4 mb-2">Assigned Scholarships</h3>
							{assigned.length === 0 ? (
								<p className="muted" style={{ fontSize: "var(--text-sm)" }}>No scholarships assigned yet.</p>
							) : (
								<ul style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
									{assigned.map(s => {
										const catalogMatch = catalog.find(c => c.id === s.scholarshipId);
										return (
										<li key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.75rem", background: "var(--muted)", borderRadius: "var(--radius-sm)" }}>
											<div>
												<p style={{ fontWeight: 600 }}>{catalogMatch?.name ?? s.scholarshipId}</p>
												<p className="muted" style={{ fontSize: "var(--text-xs)" }}>
													Amount: {catalogMatch?.amount ?? "N/A"}
												</p>
											</div>
											<button
												onClick={() => void handleRemove(s.id)}
												disabled={actionLoading}
												className="btn btn--danger btn--sm"
											>
												Remove
											</button>
										</li>
									)})}
								</ul>
							)}
						</div>

						<hr style={{ borderTop: "1px solid var(--border-light)" }} />

						<form onSubmit={(e) => void handleAssign(e)} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
							<h3 className="heading-4">Assign New Scholarship</h3>
							
							<label>
								<span className="eyebrow" style={{ display: "block", marginBottom: "0.25rem" }}>Select Scholarship</span>
								<select
									className="input"
									style={{ width: "100%" }}
									value={selectedScholarshipId}
									onChange={(e) => setSelectedScholarshipId(e.target.value)}
									required
								>
									{catalog.map(c => (
										<option key={c.id} value={c.id}>{c.name}</option>
									))}
								</select>
							</label>

							<label>
								<span className="eyebrow" style={{ display: "block", marginBottom: "0.25rem" }}>Terms / Notes (Optional)</span>
								<textarea
									className="input"
									style={{ width: "100%", minHeight: "80px" }}
									value={terms}
									onChange={(e) => setTerms(e.target.value)}
								/>
							</label>

							<div style={{ display: "flex", justifyContent: "flex-end", gap: "1rem", marginTop: "1rem" }}>
								<button type="button" className="btn btn--outline" onClick={onClose} disabled={actionLoading}>
									Close
								</button>
								<button type="submit" className="btn btn--primary" disabled={actionLoading}>
									Assign Scholarship
								</button>
							</div>
						</form>
					</div>
				)}
			</div>
		</div>
	);
}
