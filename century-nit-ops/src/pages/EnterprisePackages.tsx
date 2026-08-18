/**
 * Service Packages.
 *
 * The previous catalogue was a localStorage demo (packages, savePackage,
 * togglePackage on OpsStateContext) with no real persistence. Those context
 * fields have been removed. A real packages API does not exist yet — when it
 * does, this page will list and manage bundles built from the official fee
 * schedule. Until then, this honest empty state is shown.
 */
export function EnterprisePackages() {
	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem" }}>
				<h1 className="page-title">Service Packages</h1>
				<p className="lead mt-2">
					Service packages are managed via the fee schedule.
				</p>
			</div>
			<div className="card" style={{ padding: "3rem", textAlign: "center" }}>
				<p className="muted">
					No packages configured. This feature will be available once the API is built.
				</p>
			</div>
		</div>
	);
}
