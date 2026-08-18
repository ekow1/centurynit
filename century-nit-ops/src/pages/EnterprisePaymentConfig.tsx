/**
 * Payment Configuration.
 *
 * The previous screen pushed "directives" to the portal (issueScheduleConfig
 * on OpsStateContext) to control which post-arrival payment schedules an
 * applicant could choose. That directive system is obsolete — JourneyStage is
 * now unified and payment configuration lives in the Fee Schedule and Platform
 * Settings. Those context fields have been removed, so this page is now an
 * honest empty state.
 */
export function EnterprisePaymentConfig() {
	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem" }}>
				<h1 className="page-title">Payment Configuration</h1>
				<p className="lead mt-2">
					Payment configuration is managed via the Fee Schedule and Platform Settings.
				</p>
			</div>
			<div className="card" style={{ padding: "3rem", textAlign: "center" }}>
				<p className="muted">
					No payment configuration to set here. Schedules, fee items, and platform-wide
					defaults are all controlled from their dedicated pages.
				</p>
			</div>
		</div>
	);
}
