import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { OpsAuthProvider, useOpsAuth, ROLE_HOME } from "./pages/OpsAuthContext";
import { OpsRequireAuth, OpsRequireModule } from "./pages/OpsRequireAuth";
import { OpsStateProvider } from "./pages/OpsStateContext";

/**
 * Operations Center — a standalone app deployed as its own Cloudflare
 * Worker ("console"), separate from the public web app.
 */

/** `React.lazy` wants a default export; these pages are all named exports. */
function lazyNamed<P extends object>(
	load: () => Promise<Record<string, unknown>>,
	name: string,
) {
	return lazy(async () => ({ default: (await load())[name] as ComponentType<P> }));
}

const EnterpriseLayout = lazyNamed(() => import("./pages/EnterpriseLayout"), "EnterpriseLayout");
const EnterpriseDashboard = lazyNamed(() => import("./pages/EnterpriseDashboard"), "EnterpriseDashboard");
const CalendarSettings = lazyNamed(() => import("./pages/CalendarSettings"), "CalendarSettings");
const AcceptInvite = lazyNamed(() => import("./pages/AcceptInvite"), "AcceptInvite");
const MfaSetup = lazyNamed(() => import("./pages/MfaSetup"), "MfaSetup");
const EnterpriseLeads = lazyNamed(() => import("./pages/EnterpriseLeads"), "EnterpriseLeads");
const EnterpriseCases = lazyNamed(() => import("./pages/EnterpriseCases"), "EnterpriseCases");
const EnterpriseWorkflow = lazyNamed(() => import("./pages/EnterpriseWorkflow"), "EnterpriseWorkflow");
const EnterpriseVisa = lazyNamed(() => import("./pages/EnterpriseVisa"), "EnterpriseVisa");
const EnterpriseTravel = lazyNamed(() => import("./pages/EnterpriseTravel"), "EnterpriseTravel");
const EnterpriseDocuments = lazyNamed(() => import("./pages/EnterpriseDocuments"), "EnterpriseDocuments");
const EnterpriseFinance = lazyNamed(() => import("./pages/EnterpriseFinance"), "EnterpriseFinance");
const EnterpriseInvoices = lazyNamed(() => import("./pages/EnterpriseInvoices"), "EnterpriseInvoices");
const EnterprisePaymentConfig = lazyNamed(() => import("./pages/EnterprisePaymentConfig"), "EnterprisePaymentConfig");
const EnterpriseLedger = lazyNamed(() => import("./pages/EnterpriseLedger"), "EnterpriseLedger");
const EnterprisePaymentsLog = lazyNamed(() => import("./pages/EnterprisePaymentsLog"), "EnterprisePaymentsLog");
const EnterpriseHelpdesk = lazyNamed(() => import("./pages/EnterpriseHelpdesk"), "EnterpriseHelpdesk");
const EnterpriseCampaigns = lazyNamed(() => import("./pages/EnterpriseCampaigns"), "EnterpriseCampaigns");
const EnterpriseAdministration = lazyNamed<{ section: string }>(() => import("./pages/EnterpriseAdministration"), "EnterpriseAdministration");
const EnterpriseConsultations = lazyNamed(() => import("./pages/EnterpriseConsultations"), "EnterpriseConsultations");
const EnterpriseApplicants = lazyNamed(() => import("./pages/EnterpriseApplicants"), "EnterpriseApplicants");
const EnterpriseUniversities = lazyNamed(() => import("./pages/EnterpriseUniversities"), "EnterpriseUniversities");
const EnterprisePrograms = lazyNamed(() => import("./pages/EnterprisePrograms"), "EnterprisePrograms");
const EnterprisePackages = lazyNamed(() => import("./pages/EnterprisePackages"), "EnterprisePackages");
const EnterpriseReports = lazyNamed(() => import("./pages/EnterpriseReports"), "EnterpriseReports");
const EnterpriseAppointments = lazyNamed(() => import("./pages/EnterpriseAppointments"), "EnterpriseAppointments");
const EnterpriseInbox = lazyNamed(() => import("./pages/EnterpriseInbox"), "EnterpriseInbox");
const EnterpriseFeeSchedule = lazyNamed(() => import("./pages/EnterpriseFeeSchedule"), "EnterpriseFeeSchedule");
const EnterpriseAuditLogs = lazyNamed(() => import("./pages/EnterpriseAuditLogs"), "EnterpriseAuditLogs");
const ClientDirectory = lazyNamed(() => import("./pages/ClientDirectory"), "ClientDirectory");
const OpsLogin = lazyNamed(() => import("./pages/OpsLogin"), "OpsLogin");

/** Short alias — the route table reads better without the long name. */
const Ops = OpsRequireModule;

/** Sends each role to its own landing page - admins never see the ops dashboard. */
function OpsHome() {
	const { opsRole } = useOpsAuth();
	return <Navigate to={opsRole ? ROLE_HOME[opsRole] : "/login"} replace />;
}

function ScrollToTop() {
	const { pathname } = useLocation();
	useEffect(() => {
		window.scrollTo(0, 0);
	}, [pathname]);
	return null;
}

function RouteFallback() {
	return (
		<div className="route-loading" role="status" aria-live="polite">
			<span className="route-loading__spinner" aria-hidden="true" />
			<span className="sr-only">Loading…</span>
		</div>
	);
}

export default function App() {
	return (
		<BrowserRouter>
			<OpsAuthProvider>
				<OpsStateProvider>
					<ScrollToTop />
					<a href="#main" className="skip-link">
						Skip to content
					</a>
					<main id="main" className="page">
						<Suspense fallback={<RouteFallback />}>
							<Routes>
								{/* Unprotected: reached before an account exists or before a
								    second factor is enrolled, so neither can sit behind the guard. */}
								<Route path="/login" element={<OpsLogin />} />
								<Route path="/accept-invite" element={<AcceptInvite />} />
								<Route
									path="/mfa-setup"
									element={
										<OpsRequireAuth>
											<MfaSetup />
										</OpsRequireAuth>
									}
								/>

								<Route
									path="/"
									element={
										<OpsRequireAuth>
											<EnterpriseLayout />
										</OpsRequireAuth>
									}
								>
									<Route index element={<OpsHome />} />

									{/* Operations. Every route is gated on the same permission
									    matrix the sidebar uses — without this, typing a URL
									    reaches any module. */}
									<Route path="dashboard" element={<Ops module="dashboard"><EnterpriseDashboard /></Ops>} />
									<Route path="applications" element={<Ops module="applications"><EnterpriseCases /></Ops>} />
									<Route path="consultations" element={<Ops module="consultations"><EnterpriseConsultations /></Ops>} />
									<Route path="applicants" element={<Ops module="applicants"><EnterpriseApplicants /></Ops>} />
									<Route path="clients" element={<Ops module="dashboard"><ClientDirectory /></Ops>} />
									<Route path="leads" element={<Ops module="leads"><EnterpriseLeads /></Ops>} />
									<Route path="crm" element={<Ops module="crm"><EnterpriseLeads /></Ops>} />
									<Route path="helpdesk" element={<Ops module="helpdesk"><EnterpriseHelpdesk /></Ops>} />
									<Route path="marketing/email" element={<Ops module="marketing"><EnterpriseCampaigns /></Ops>} />
									<Route path="marketing/sms" element={<Ops module="marketing"><EnterpriseCampaigns /></Ops>} />
									<Route path="workflow" element={<Ops module="workflow"><EnterpriseWorkflow /></Ops>} />
									<Route path="visa" element={<Ops module="visa"><EnterpriseVisa /></Ops>} />
									<Route path="travel" element={<Ops module="travel"><EnterpriseTravel /></Ops>} />
									<Route path="documents" element={<Ops module="documents"><EnterpriseDocuments /></Ops>} />
									<Route path="invoices" element={<Ops module="invoices"><EnterpriseInvoices /></Ops>} />
									<Route path="ledger" element={<Ops module="ledger"><EnterpriseLedger /></Ops>} />
									<Route path="payments" element={<Ops module="payments"><EnterprisePaymentsLog /></Ops>} />
									<Route path="fee-schedule" element={<Ops module="finance"><EnterpriseFeeSchedule /></Ops>} />
									<Route path="payment-config" element={<Ops module="payment-config"><EnterprisePaymentConfig /></Ops>} />
									<Route path="finance" element={<Ops module="finance"><EnterpriseFinance /></Ops>} />
									<Route path="appointments" element={<Ops module="appointments"><EnterpriseAppointments /></Ops>} />
									<Route path="universities" element={<Ops module="universities"><EnterpriseUniversities /></Ops>} />
									<Route path="programs" element={<Ops module="programs"><EnterprisePrograms /></Ops>} />
									<Route path="packages" element={<Ops module="packages"><EnterprisePackages /></Ops>} />
									<Route path="reports" element={<Ops module="reports"><EnterpriseReports /></Ops>} />
									<Route path="marketing" element={<Ops module="marketing"><EnterpriseCampaigns /></Ops>} />
									{/* Personal calendar connection. Gated on "dashboard" rather than
									    "settings": consultants must reach this, admins never take bookings. */}
									<Route path="my-calendar" element={<Ops module="dashboard"><CalendarSettings /></Ops>} />
									<Route path="inbox" element={<Ops module="dashboard"><EnterpriseInbox /></Ops>} />

									{/* Platform administration - admin only */}
									<Route path="system" element={<Ops module="system"><EnterpriseAdministration section="system" /></Ops>} />
									<Route path="users" element={<Ops module="users"><EnterpriseAdministration section="users" /></Ops>} />
									<Route path="auth" element={<Ops module="auth"><EnterpriseAdministration section="auth" /></Ops>} />
									<Route path="audit" element={<Ops module="system"><EnterpriseAuditLogs /></Ops>} />
									<Route path="cms" element={<Ops module="cms"><EnterpriseAdministration section="cms" /></Ops>} />
									<Route path="site" element={<Ops module="site"><EnterpriseAdministration section="site" /></Ops>} />
									<Route path="notifications" element={<Ops module="notifications"><EnterpriseAdministration section="notifications" /></Ops>} />
									<Route path="settings" element={<Ops module="settings"><EnterpriseAdministration section="settings" /></Ops>} />

									<Route path="*" element={<OpsHome />} />
								</Route>

								{/* Unknown routes fall back to the role home page. */}
								<Route path="*" element={<OpsHome />} />
							</Routes>
						</Suspense>
					</main>
				</OpsStateProvider>
			</OpsAuthProvider>
		</BrowserRouter>
	);
}
