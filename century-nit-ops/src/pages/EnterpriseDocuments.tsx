import { DocumentReviewQueue } from "./DocumentReviewQueue";

/**
 * Document Vault.
 *
 * The legacy demo folder view (built from localStorage applicant records with
 * in-memory verdict overrides) has been removed. The real, API-backed
 * DocumentReviewQueue below is the only document review surface — it lists
 * files applicants actually uploaded, stored in Supabase, and records
 * verdicts through documentsApi.review().
 */
export function EnterpriseDocuments() {
	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "1.5rem" }}>
				<h1 className="page-title">Document Vault</h1>
				<p className="lead mt-2">
					Review, verify, and reject documents uploaded by applicants.
				</p>
			</div>
			<DocumentReviewQueue />
		</div>
	);
}
