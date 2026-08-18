/**
 * Content Management.
 *
 * The previous CMS manager wrote edits into a localStorage `cmsOverlay` on
 * OpsStateContext (saveCmsRecord, setCmsStatus, revertCmsRecord) and resolved
 * records against it. There is no real CMS API and those context fields have
 * been removed, so this page is now an honest empty state. When a CMS API is
 * built, this page will list and edit content from it directly.
 */
export function CmsManager() {
	return (
		<div className="page-content fade-in">
			<div style={{ marginBottom: "2rem" }}>
				<h1 className="page-title">Content Management</h1>
				<p className="lead mt-2">
					Pages, programmes, destinations, and blog content on the public site.
				</p>
			</div>
			<div className="card" style={{ padding: "3rem", textAlign: "center" }}>
				<p className="muted">
					Content management is not yet available.
				</p>
			</div>
		</div>
	);
}
