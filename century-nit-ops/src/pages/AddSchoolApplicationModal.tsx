import { useState, useEffect } from "react";
import { apiFetch } from "../lib/api";
import type { CatalogDestination, CatalogUniversity, CatalogProgram } from "century-nit-shared";
import { useCases } from "../hooks/useCases";

export function AddSchoolApplicationModal({
	onClose,
	onAdd,
}: {
	onClose: () => void;
	onAdd: (applicantId: string, destId: string, uniId: string, progId: string, intake: string) => Promise<void>;
}) {
	const { applicants } = useCases();
	const [applicantId, setApplicantId] = useState("");
	
	const [destinations, setDestinations] = useState<CatalogDestination[]>([]);
	const [destinationId, setDestinationId] = useState("");
	
	const [universities, setUniversities] = useState<CatalogUniversity[]>([]);
	const [universityId, setUniversityId] = useState("");
	
	const [programs, setPrograms] = useState<CatalogProgram[]>([]);
	const [programId, setProgramId] = useState("");
	
	const [intake, setIntake] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);

	// Load destinations
	useEffect(() => {
		apiFetch<{destinations: CatalogDestination[]}>(`/api/v1/catalog/destinations`).then((res) => {
			setDestinations(res.destinations);
			if (res.destinations.length > 0) setDestinationId(res.destinations[0].id);
		});
	}, []);

	// Load universities when destination changes
	useEffect(() => {
		if (!destinationId) return;
		apiFetch<{universities: CatalogUniversity[]}>(`/api/v1/catalog/universities?destinationId=${destinationId}`).then((res) => {
			setUniversities(res.universities);
			setUniversityId(res.universities.length > 0 ? res.universities[0].id : "");
		});
	}, [destinationId]);

	// Load programs when university changes
	useEffect(() => {
		if (!universityId) return;
		apiFetch<{programs: CatalogProgram[]}>(`/api/v1/catalog/programs?universityId=${universityId}`).then((res) => {
			setPrograms(res.programs);
			setProgramId(res.programs.length > 0 ? res.programs[0].id : "");
		});
	}, [universityId]);
	
	// Update intake when program changes
	useEffect(() => {
		if (!programId) return;
		const prog = programs.find((p) => p.id === programId);
		if (prog && prog.intake && prog.intake.length > 0) {
			setIntake(prog.intake[0]);
		} else {
			setIntake("September 2026"); // Fallback
		}
	}, [programId, programs]);

	const selectedProgram = programs.find(p => p.id === programId);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (!applicantId || !destinationId || !universityId || !programId || !intake) {
			setError("Please fill out all fields.");
			return;
		}
		setLoading(true);
		setError(null);
		try {
			await onAdd(applicantId, destinationId, universityId, programId, intake);
			onClose();
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to add application");
		} finally {
			setLoading(false);
		}
	}

	return (
		<div style={{
			position: "fixed", top: 0, left: 0, width: "100%", height: "100%",
			background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center",
			justifyContent: "center", zIndex: 9999
		}}>
			<div className="card fade-in" style={{
				background: "var(--background)",
				padding: "1.5rem",
				width: "100%",
				maxWidth: "500px",
				boxShadow: "0 10px 25px rgba(0,0,0,0.5)",
				border: "1px solid var(--border)"
			}}>
				<h3 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-lg)", marginBottom: "1rem" }}>
					Add School Application
				</h3>
				{error && <p className="ops-modal__error" style={{ marginBottom: "1rem" }}>{error}</p>}
				
				<form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
					<label>
						<span className="eyebrow" style={{ display: "block", marginBottom: "0.25rem" }}>Select Applicant</span>
						<select
							className="input input--sm"
							style={{ width: "100%" }}
							value={applicantId}
							onChange={(e) => setApplicantId(e.target.value)}
							required
						>
							<option value="">-- Choose Applicant --</option>
							{applicants.map(app => (
								<option key={app.id} value={app.id}>{app.name} ({app.applicantId})</option>
							))}
						</select>
					</label>

					<label>
						<span className="eyebrow" style={{ display: "block", marginBottom: "0.25rem" }}>Target Country</span>
						<select
							className="input input--sm"
							style={{ width: "100%" }}
							value={destinationId}
							onChange={(e) => setDestinationId(e.target.value)}
							required
						>
							{destinations.map(d => (
								<option key={d.id} value={d.id}>{d.name}</option>
							))}
						</select>
					</label>

					<label>
						<span className="eyebrow" style={{ display: "block", marginBottom: "0.25rem" }}>Target University</span>
						<select
							className="input input--sm"
							style={{ width: "100%" }}
							value={universityId}
							onChange={(e) => setUniversityId(e.target.value)}
							disabled={!destinationId || universities.length === 0}
							required
						>
							{universities.map(u => (
								<option key={u.id} value={u.id}>{u.name}</option>
							))}
						</select>
					</label>

					<label>
						<span className="eyebrow" style={{ display: "block", marginBottom: "0.25rem" }}>Target Program</span>
						<select
							className="input input--sm"
							style={{ width: "100%" }}
							value={programId}
							onChange={(e) => setProgramId(e.target.value)}
							disabled={!universityId || programs.length === 0}
							required
						>
							{programs.map(p => (
								<option key={p.id} value={p.id}>{p.name} ({p.level})</option>
							))}
						</select>
					</label>
					
					{selectedProgram && (
						<div style={{ background: "var(--muted)", padding: "0.75rem", fontSize: "var(--text-xs)" }}>
							<p><strong>Tuition Hint:</strong> {selectedProgram.tuition ? `£${selectedProgram.tuition}` : "N/A"}</p>
							<p><strong>Duration Hint:</strong> {selectedProgram.duration ? `${selectedProgram.duration}` : "N/A"}</p>
						</div>
					)}

					<label>
						<span className="eyebrow" style={{ display: "block", marginBottom: "0.25rem" }}>Intake Period</span>
						<select
							className="input input--sm"
							style={{ width: "100%" }}
							value={intake}
							onChange={(e) => setIntake(e.target.value)}
							required
						>
							{selectedProgram?.intake?.map(i => (
								<option key={i} value={i}>{i}</option>
							))}
							{!selectedProgram?.intake?.length && (
								<option value="September 2026">September 2026</option>
							)}
						</select>
					</label>

					<div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1rem" }}>
						<button type="button" className="btn btn--ghost" onClick={onClose} disabled={loading}>
							Cancel
						</button>
						<button type="submit" className="btn btn--primary" disabled={loading}>
							{loading ? "Adding..." : "Add Application"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
}
