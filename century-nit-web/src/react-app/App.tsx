import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect, type ComponentType } from "react";
import { AppStateProvider } from "./context/AppState";
import { NotifierProvider } from "./components/notifier/Notifier";
import { EnquiryWidget } from "./components/EnquiryWidget";
import { NewsletterPopup } from "./components/NewsletterPopup";
import { EnquiryProvider } from "./components/EnquiryContext";
import { Nav } from "./components/layout/Nav";
import { Footer } from "./components/layout/Footer";
import { MobileTabBar } from "./components/layout/MobileTabBar";
import { Home } from "./pages/Home";
import { StartJourney } from "./pages/StartJourney";
import { RequireAuth } from "./pages/apply/RequireAuth";

/**
 * `React.lazy` wants a default export; every page here is a named one.
 *
 * Route-level splitting matters a lot for this app: the Operations Center and
 * the applicant portal together are the bulk of the code, and without this every
 * visitor to the marketing homepage downloads all of it. Vite emits one chunk
 * per module, so several named exports from the same file share a chunk.
 */
function lazyNamed<P extends object>(
	load: () => Promise<Record<string, unknown>>,
	name: string,
) {
	return lazy(async () => ({ default: (await load())[name] as ComponentType<P> }));
}

/* ── Marketing content — one chunk, loaded on first content-page visit ── */
const contentPages = () => import("./pages/ContentPages");
const About = lazyNamed(contentPages, "About");
const Blog = lazyNamed(contentPages, "Blog");
const BlogPost = lazyNamed(contentPages, "BlogPost");
const DestinationDetail = lazyNamed(contentPages, "DestinationDetail");
const Destinations = lazyNamed(contentPages, "Destinations");
const Events = lazyNamed(contentPages, "Events");
const FAQs = lazyNamed(contentPages, "FAQs");
const ProgramDetail = lazyNamed(contentPages, "ProgramDetail");
const Programs = lazyNamed(contentPages, "Programs");
const ScholarshipDetail = lazyNamed(contentPages, "ScholarshipDetail");
const Scholarships = lazyNamed(contentPages, "Scholarships");
const ServiceDetail = lazyNamed(contentPages, "ServiceDetail");
const StudentServices = lazyNamed(contentPages, "StudentServices");
const SuccessStories = lazyNamed(contentPages, "SuccessStories");
const Universities = lazyNamed(contentPages, "Universities");
const UniversityDetail = lazyNamed(contentPages, "UniversityDetail");
const VisaServices = lazyNamed(contentPages, "VisaServices");
const WhyChooseUs = lazyNamed(contentPages, "WhyChooseUs");

/* ── Applicant portal ── */
const portalPages = () => import("./pages/portal/PortalPages");
const portalSections = () => import("./pages/portal/PortalSections");
const PortalLayout = lazyNamed(() => import("./pages/portal/PortalLayout"), "PortalLayout");
const DashboardHome = lazyNamed(() => import("./pages/portal/DashboardHome"), "DashboardHome");
const PortalAgency = lazyNamed(portalPages, "PortalAgency");
const PortalApplicationHub = lazyNamed(portalPages, "PortalApplicationHub");
const PortalComplete = lazyNamed(portalPages, "PortalComplete");
const PortalConsultation = lazyNamed(portalPages, "PortalConsultation");
const PortalIndex = lazyNamed(portalPages, "PortalIndex");
const PortalPackage = lazyNamed(portalPages, "PortalPackage");
const PortalPayCallback = lazyNamed(portalPages, "PortalPayCallback");
const PortalPaymentPlan = lazyNamed(portalPages, "PortalPaymentPlan");
const PortalTrackingPage = lazyNamed(portalPages, "PortalTrackingPage");
const PortalVisa = lazyNamed(portalPages, "PortalVisa");
const PortalFinancial = lazyNamed(portalSections, "PortalFinancial");
const PortalJourney = lazyNamed(portalSections, "PortalJourney");
const PortalProfile = lazyNamed(portalSections, "PortalProfile");
const PortalDocumentVault = lazyNamed(() => import("./pages/portal/PortalDocumentVault"), "PortalDocumentVault");
const PortalAppointments = lazyNamed(() => import("./pages/portal/PortalAppointments"), "PortalAppointments");
const PortalSupport = lazyNamed(() => import("./pages/portal/PortalSupport"), "PortalSupport");
const PortalPreDeparture = lazyNamed(() => import("./pages/portal/PortalPreDeparture"), "PortalPreDeparture");
const PortalMfaSetup = lazyNamed(() => import("./pages/portal/PortalMfaSetup"), "PortalMfaSetup");


/**
 * Shown while a route chunk is in flight. Deliberately minimal — chunks are
 * small and local, so anything more elaborate flashes.
 */
function RouteFallback() {
	return (
		<div className="route-loading" role="status" aria-live="polite">
			<span className="route-loading__spinner" aria-hidden="true" />
			<span className="sr-only">Loading…</span>
		</div>
	);
}

function ScrollToTop() {
	const { pathname } = useLocation();
	useEffect(() => {
		window.scrollTo(0, 0);
	}, [pathname]);
	return null;
}

function useMinimalChrome(pathname: string) {
	// Only dashboard + start (sign-in) use full-bleed chrome
	if (pathname.startsWith("/portal")) return true;
	if (pathname === "/start" || pathname.startsWith("/start/")) return true;
	return false;
}

function AppShell() {
	const { pathname } = useLocation();
	const minimal = useMinimalChrome(pathname);

	return (
		<>
			<a href="#main" className="skip-link">
				Skip to content
			</a>
			{!minimal && <Nav />}
			<main id="main" className={minimal && pathname.startsWith("/portal") ? "page page--portal" : "page"}>
				<Suspense fallback={<RouteFallback />}>
				<Routes>
					<Route path="/" element={<Home />} />
					<Route path="/about" element={<About />} />
					<Route path="/why-choose-us" element={<WhyChooseUs />} />
					<Route path="/destinations" element={<Destinations />} />
					<Route path="/destinations/:id" element={<DestinationDetail />} />
					<Route path="/universities" element={<Universities />} />
					<Route path="/universities/:id" element={<UniversityDetail />} />
					<Route path="/programs" element={<Programs />} />
					<Route path="/programs/:id" element={<ProgramDetail />} />
					<Route path="/scholarships" element={<Scholarships />} />
					<Route path="/scholarships/:id" element={<ScholarshipDetail />} />
					<Route path="/visa-services" element={<VisaServices />} />
					<Route path="/student-services" element={<StudentServices />} />
					<Route path="/services/:id" element={<ServiceDetail />} />
					<Route path="/red-seat" element={<SuccessStories />} />
					<Route path="/events" element={<Events />} />
					<Route path="/blog" element={<Blog />} />
					<Route path="/blog/:id" element={<BlogPost />} />
					<Route path="/faqs" element={<FAQs />} />
					<Route path="/contact" element={<Navigate to="/" replace />} />

					{/* Single entry into the journey */}
					<Route path="/start" element={<StartJourney />} />

					{/* Legacy URLs → one start / one dashboard */}
					<Route path="/apply" element={<Navigate to="/start" replace />} />
					<Route path="/apply/*" element={<Navigate to="/start" replace />} />
					<Route path="/book-consultation" element={<Navigate to="/start" replace />} />
					<Route path="/book-consultation/*" element={<Navigate to="/start" replace />} />

					{/* Unified applicant dashboard - all stages live here */}
					<Route
						path="/portal"
						element={
							<RequireAuth>
								<PortalLayout />
							</RequireAuth>
						}
					>
						<Route index element={<PortalIndex />} />
						<Route path="home" element={<DashboardHome />} />
						<Route path="profile" element={<PortalProfile />} />
						<Route path="journey" element={<PortalJourney />} />
						<Route path="financial" element={<PortalFinancial />} />
						<Route path="consultation" element={<PortalConsultation />} />
						<Route path="package" element={<PortalPackage />} />
						<Route path="application" element={<PortalApplicationHub />} />
						<Route path="tracking" element={<PortalTrackingPage />} />
						<Route path="visa" element={<PortalVisa />} />
						<Route path="pay" element={<PortalPayCallback />} />
						{/* Retired stages — kept as redirects so old links still resolve */}
						<Route path="payment-plan" element={<PortalPaymentPlan />} />
						<Route path="agency" element={<PortalAgency />} />
						<Route path="pre-departure" element={<PortalPreDeparture />} />
						<Route path="complete" element={<PortalComplete />} />
						{/* Server-backed appointments: booking, reschedule and cancel go to
						    the API, unlike the simulated journey around them. */}
						<Route path="appointments" element={<PortalAppointments />} />
						<Route path="documents" element={<PortalDocumentVault />} />
						<Route path="support" element={<PortalSupport />} />
						<Route path="security" element={<PortalMfaSetup />} />
						<Route path="messages" element={<Navigate to="/portal/home" replace />} />
						{/* old nested paths */}
						<Route path="*" element={<Navigate to="/portal/home" replace />} />
					</Route>

					{/* /ops/* is a separate application (century-nit-ops) served from this
					    same origin. It is deliberately absent from this router: the
					    Worker hands those paths to the other build, so a public visitor
					    never downloads a byte of the Operations Center. */}

					<Route path="*" element={<Navigate to="/" replace />} />
				</Routes>
				</Suspense>
			</main>
			{!minimal && <Footer />}
			{!minimal && <EnquiryWidget />}
			{!minimal && <NewsletterPopup />}
			{!minimal && <MobileTabBar />}
		</>
	);
}

export default function App() {
	return (
		<BrowserRouter>
			<NotifierProvider>
				<AppStateProvider>
					<EnquiryProvider>
						<ScrollToTop />
						<AppShell />
					</EnquiryProvider>
				</AppStateProvider>
			</NotifierProvider>
		</BrowserRouter>
	);
}
