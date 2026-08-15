export function EnterpriseNotifications() {
	return (
		<div className="page-content fade-in">
			<div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "2rem" }}>
				<div>
					<h1 className="page-title">Notifications Hub</h1>
					<p className="lead mt-2">Manage email, SMS, and push notification templates and history.</p>
				</div>
				<button className="btn btn--primary">Send Manual Notification</button>
			</div>

			<div className="ops-grid" style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "2rem" }}>
				<div className="card">
					<h2 className="section-title mb-3">Templates</h2>
					<ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
						<li style={{ padding: "1rem 0", borderBottom: "1px solid var(--border-light)", cursor: "pointer" }}>
							<p style={{ fontWeight: 500 }}>Application Approved</p>
							<p className="muted mt-1" style={{ fontSize: "0.875rem" }}>Trigger: Status changes to Offer Letter</p>
						</li>
						<li style={{ padding: "1rem 0", borderBottom: "1px solid var(--border-light)", cursor: "pointer" }}>
							<p style={{ fontWeight: 500 }}>Missing Documents Reminder</p>
							<p className="muted mt-1" style={{ fontSize: "0.875rem" }}>Trigger: Scheduled (Weekly)</p>
						</li>
						<li style={{ padding: "1rem 0", cursor: "pointer" }}>
							<p style={{ fontWeight: 500 }}>Payment Overdue</p>
							<p className="muted mt-1" style={{ fontSize: "0.875rem" }}>Trigger: Invoice &gt; 3 days overdue</p>
						</li>
					</ul>
				</div>

				<div className="card">
					<h2 className="section-title mb-3">Notification History</h2>
					<div className="ops-table-wrap">
						<table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left" }}>
							<thead>
								<tr style={{ borderBottom: "2px solid var(--border)" }}>
									<th style={{ padding: "1rem" }}>Recipient</th>
									<th style={{ padding: "1rem" }}>Channel</th>
									<th style={{ padding: "1rem" }}>Template</th>
									<th style={{ padding: "1rem" }}>Status</th>
									<th style={{ padding: "1rem" }}>Sent At</th>
								</tr>
							</thead>
							<tbody>
								{[1,2,3,4].map((i) => (
									<tr key={i} style={{ borderBottom: "1px solid var(--border-light)" }}>
										<td style={{ padding: "1rem", fontWeight: 500 }}>Client {i}</td>
										<td style={{ padding: "1rem" }} className="muted">{i % 2 === 0 ? "Email" : "SMS"}</td>
										<td style={{ padding: "1rem" }}>Application Approved</td>
										<td style={{ padding: "1rem" }}>
											<span className="portal-pill">Delivered</span>
										</td>
										<td style={{ padding: "1rem" }} className="muted">10 mins ago</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</div>
	);
}
