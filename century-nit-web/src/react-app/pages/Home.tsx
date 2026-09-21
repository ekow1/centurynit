import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { JourneyButton } from "../components/ui/JourneyButton";
import { EnquiryButton } from "../components/EnquiryContext";
import { HeroCarousel, type HeroSlide } from "../components/HeroCarousel";
import { Carousel } from "../components/Carousel";
import { useAppState } from "../context/AppState";
import {
	articles,
	company,
	coreServices,
	destinations,
	programs,
	scholarships,
	stats,
	testimonials,
	universities,
	getUniversity,
	videoTestimonials,
} from "century-nit-core";
import { SERVICE_STAGES, SERVICE_STAGE_LABELS, type ServiceStage } from "century-nit-shared";
import { STAGE_SHORT } from "../data/stageLabels";

/** The purchasable stage strip — consultation is the entry, the rest compose. */
const STAGE_REQ: Record<string, string> = {
	admissions: "Counsel · docs · offers",
	visa: "File · biometrics · interview",
	departure: "Flight · briefing · landing",
};
const STAGE_INCLUDES: Record<string, string[]> = {
	admissions: [
		"Counselling & programme shortlist",
		"Admission documentation per university",
		"Submission + offer tracking",
	],
	visa: ["Embassy-ready visa file", "Forms filed, biometrics booked", "Mock interview + decision tracking"],
	departure: ["Flight & housing coordination", "Pre-departure briefing", "First-week check-in"],
};
/** Which journey stage each à-la-carte service belongs to. */
const SERVICE_STAGE_TAG: Record<string, string> = {
	counseling: "Admissions",
	"admission-docs": "Admissions",
	"visa-docs": "Visa",
	"study-visa": "Visa",
	travel: "Departure",
};

/** The Explore tabs — destinations, partners, programs and funding share one section. */
const EXPLORE_TABS = [
	{ id: "d", label: "Destinations", caption: "6 countries", foot: "All 6 destinations live on their own page", to: "/destinations", thumb: destinations[0]?.image },
	{ id: "u", label: "Universities", caption: "100+ partners", foot: "100+ partner institutions", to: "/universities", thumb: universities[0]?.image },
	{ id: "p", label: "Programs", caption: "Featured", foot: "Full program catalogue", to: "/programs", thumb: universities[2]?.image },
	{ id: "f", label: "Funding", caption: "Scholarships", foot: "All scholarships & deadlines", to: "/scholarships", thumb: scholarships[0]?.image },
] as const;
type ExploreTab = (typeof EXPLORE_TABS)[number]["id"];
/** The pathways the old spotlight row featured — they lead the destinations grid. */
const FEATURED_DESTINATION_IDS = new Set(["uk", "germany", "canada"]);

/** The journey scopes — picking one lights the route and swaps the consequence strip. */
const PROCESS_SCOPES = [
	{
		id: "full",
		label: "Full journey",
		stages: ["admissions", "visa", "departure"] as ServiceStage[],
		recommended: [] as ServiceStage[],
		form: "The full intake",
		formDetail: "Every section — academics, finances, preferences, documents.",
		plan: [{ text: "I · II · III — all unlocked", off: false }],
		docsTitle: "The full checklist",
		docs: [
			{ text: "Transcripts & certificates", off: false },
			{ text: "Bank statements & sponsor", off: false },
			{ text: "Offer letter once it lands", off: false },
		],
	},
	{
		id: "a",
		label: "Admissions only",
		stages: ["admissions"] as ServiceStage[],
		recommended: ["visa"] as ServiceStage[],
		form: "Admissions entry",
		formDetail: "Academics, preferences, goals — no visa questions yet.",
		plan: [
			{ text: "I · Admissions — unlocked", off: false },
			{ text: "II · Visa — recommended later", off: false },
			{ text: "III · Departure — not on this plan", off: true },
		],
		docsTitle: "The checklist matches",
		docs: [
			{ text: "Transcripts & certificates", off: false },
			{ text: "Passport & CV", off: false },
			{ text: "Bank statements — later, for the visa", off: true },
		],
	},
	{
		id: "av",
		label: "Admissions + Visa",
		stages: ["admissions", "visa"] as ServiceStage[],
		recommended: ["departure"] as ServiceStage[],
		form: "Admissions + visa entry",
		formDetail: "The full file minus arrival details.",
		plan: [
			{ text: "I · II — unlocked", off: false },
			{ text: "III · Departure — recommended later", off: false },
		],
		docsTitle: "The checklist matches",
		docs: [
			{ text: "Transcripts & certificates", off: false },
			{ text: "Bank statements & sponsor", off: false },
			{ text: "Offer letter once it lands", off: false },
		],
	},
	{
		id: "v",
		label: "Visa only",
		stages: ["visa"] as ServiceStage[],
		recommended: ["departure"] as ServiceStage[],
		form: "Visa entry",
		formDetail: "Your offer, visa history, finances — no school questions.",
		plan: [
			{ text: "I · Admissions — skipped", off: true },
			{ text: "II · Visa — unlocked", off: false },
			{ text: "III · Departure — recommended later", off: false },
		],
		docsTitle: "The checklist matches",
		docs: [
			{ text: "Offer letter / CAS or I-20", off: false },
			{ text: "Bank statements & sponsor", off: false },
			{ text: "Transcripts — not asked", off: true },
		],
	},
] as const;
type ProcessScopeId = (typeof PROCESS_SCOPES)[number]["id"];

const baseHeroSlides: Omit<HeroSlide, "primary" | "secondary">[] = [
	{
		id: "study",
		kicker: company.tagline,
		title: "Study abroad.",
		titleEm: "With us.",
		lead: company.promise,
		image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=1600&q=80",
		imageAlt: "Students walking through a historic university courtyard",
		meta: [
			{ label: "Since", value: String(company.founded) },
			{ label: "Base", value: "Ghana · Accra & Kumasi" },
			{ label: "Focus", value: "Admission · Visa · Travel" },
		],
	},
	{
		id: "uk",
		kicker: "United Kingdom",
		title: "UK universities.",
		titleEm: "Global rank.",
		lead: "UK universities hold an impressive international reputation. We guide Ghanaian students from programme choice through study-visa success.",
		image: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1600&q=80",
		imageAlt: "London cityscape with historic architecture",
		meta: [
			{ label: "Service", value: "Study visa" },
			{ label: "Support", value: "Docs · Interview" },
			{ label: "Office", value: "Accra · Kumasi" },
		],
	},
	{
		id: "germany",
		kicker: "Germany",
		title: "Study in",
		titleEm: "Germany.",
		lead: "For ambitious students seeking world-class education-strong STEM, research intensity, and clear counselling from first enquiry.",
		image: "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=1600&q=80",
		imageAlt: "German architecture and university city",
		meta: [
			{ label: "Focus", value: "Master's & STEM" },
			{ label: "Docs", value: "WASSCE · Degree" },
			{ label: "After visa", value: "Travel support" },
		],
	},
	{
		id: "canada",
		kicker: "Canada",
		title: "Study in",
		titleEm: "Canada.",
		lead: "Canada hosts nearly half a million international students-world-class education with post-study opportunity. We map the path.",
		image: "https://images.unsplash.com/photo-1517935706615-2717063c2225?w=1600&q=80",
		imageAlt: "Canadian city skyline",
		meta: [
			{ label: "Pathway", value: "PGWP-ready" },
			{ label: "Counsel", value: "Career fit" },
			{ label: "Email", value: company.email },
		],
	},
];

function useCountUp(target: number, active: boolean) {
	const [value, setValue] = useState(0);
	useEffect(() => {
		if (!active) return;
		const duration = 900;
		const start = performance.now();
		let raf = 0;
		const tick = (now: number) => {
			const t = Math.min(1, (now - start) / duration);
			const stepped = Math.round(t * 12) / 12;
			setValue(Math.round(target * stepped));
			if (t < 1) raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [target, active]);
	return value;
}

function StatItem({
	value,
	suffix,
	label,
	active,
}: {
	value: number;
	suffix: string;
	label: string;
	active: boolean;
}) {
	const n = useCountUp(value, active);
	return (
		<div>
			<div className="stat__value">
				{n.toLocaleString()}
				{suffix}
			</div>
			<div className="stat__label">{label}</div>
		</div>
	);
}

export function Home() {
	const statsRef = useRef<HTMLElement>(null);
	const [statsActive, setStatsActive] = useState(false);
	const [explore, setExplore] = useState<ExploreTab>("d");
	const [scope, setScope] = useState<ProcessScopeId>("full");
	const scopeData = PROCESS_SCOPES.find((x) => x.id === scope)!;
	// Featured pathways lead the destinations grid — the old spotlight row, in-grid.
	const featuredDestinations = [...destinations].sort(
		(a, b) => Number(FEATURED_DESTINATION_IDS.has(b.id)) - Number(FEATURED_DESTINATION_IDS.has(a.id)),
	);
	const [playing, setPlaying] = useState<string | null>(null);
	const { isAuthenticated, journeyPhase } = useAppState();
	const [searchParams, setSearchParams] = useSearchParams();
	const nav = useNavigate();

	// Social login redirect failure. Better Auth sends back to the root URL
	// with ?error=account_not_linked when the Google email matches an existing
	// account that hasn't linked Google yet. Show a modal explaining what to do
	// instead of silently landing on the homepage with no feedback.
	const [socialError, setSocialError] = useState<string | null>(null);
	useEffect(() => {
		const err = searchParams.get("error");
		if (err === "account_not_linked") {
			setSocialError("account_not_linked");
		} else if (err) {
			setSocialError(err);
		}
		if (err) setSearchParams({}, { replace: true });
	}, [searchParams, setSearchParams]);

	// Short stage name - the full phase label ("Choose school application
	// package") overflows a hero button on any phone.
	const journeyLabel = isAuthenticated
		? `Continue · ${STAGE_SHORT[journeyPhase.stage] ?? journeyPhase.label}`
		: "Start Journey";
	const journeyTo = isAuthenticated ? "/portal/home" : "/start";

	const heroSlides: HeroSlide[] = baseHeroSlides.map((s, i) => {
		if (i === 0) {
			return {
				...s,
				primary: { label: journeyLabel, to: journeyTo },
				secondary: { label: "Explore destinations", to: "/destinations" },
			};
		}
		if (s.id === "germany" || s.id === "canada") {
			return {
				...s,
				primary: {
					label: `Explore ${s.id === "germany" ? "Germany" : "Canada"}`,
					to: `/destinations/${s.id}`,
				},
				secondary: { label: journeyLabel, to: journeyTo },
			};
		}
		// UK slide
		return {
			...s,
			primary: { label: "Explore UK", to: "/destinations/uk" },
			secondary: { label: "Visa services", to: "/visa-services" },
		};
	});

	useEffect(() => {
		const el = statsRef.current;
		if (!el) return;
		const obs = new IntersectionObserver(
			([e]) => {
				if (e.isIntersecting) setStatsActive(true);
			},
			{ threshold: 0.3 },
		);
		obs.observe(el);
		return () => obs.disconnect();
	}, []);

	return (
		<>
			<HeroCarousel slides={heroSlides} />

			{/* Stats */}
			<section className="stats texture-lines-light" ref={statsRef} aria-label="Impact statistics">
				<div className="container stats__grid">
					{stats.map((s) => (
						<StatItem
							key={s.label}
							value={s.value}
							suffix={s.suffix}
							label={s.label}
							active={statsActive}
						/>
					))}
				</div>
			</section>

			{/* Core services — a plain list of what we offer */}
			<section className="section texture-grid">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">What we offer</p>
							<h2 className="section-title">Our services</h2>
						</div>
						<Link to="/student-services" className="link-arrow">
							Student services →
						</Link>
					</div>
					<div className="svc">
						{coreServices.map((s, i) => (
							<Link key={s.id} to={`/services/${s.id}`} className="svc__row">
								<span className="svc__img">
									<span className="no">{String.fromCharCode(65 + i)}</span>
									<img src={s.image} alt="" />
								</span>
								<span className="svc__body">
									<span className="svc__eyebrow">Part of <b>{SERVICE_STAGE_TAG[s.id] ?? "the journey"}</b></span>
									<span className="svc__title">{s.title}</span>
									<ul className="svc__list">
										{s.deliverables.slice(0, 2).map((d) => (
											<li key={d}>{d}</li>
										))}
									</ul>
									<span className="svc__meta">
										<span className="svc__dur">{s.duration}</span>
										<span className="svc__cta">View service →</span>
									</span>
								</span>
							</Link>
						))}
					</div>
					<div className="svc__foot">
						<p>
							Every engagement starts with one consultation — <b>online or in person</b>
						</p>
						<Link className="btn btn--sm" to="/start">
							Book consultation →
						</Link>
					</div>
				</div>
			</section>

			<hr className="section-rule" />

			{/* Explore — destinations, universities, programs and funding as tabs */}
			<section className="section">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">Explore</p>
							<h2 className="section-title">Where could you go?</h2>
						</div>
						<Link to="/start" className="link-arrow">
							Talk it through →
						</Link>
					</div>

					<div className="xp">
						<div className="xp__tabs" role="tablist" aria-label="Explore">
							{EXPLORE_TABS.map((t) => (
								<button
									key={t.id}
									type="button"
									role="tab"
									aria-selected={explore === t.id}
									className="xp__tab"
									onClick={() => setExplore(t.id)}
								>
									{t.thumb && (
										<span className="thumb" aria-hidden>
											<img src={t.thumb} alt="" />
										</span>
									)}
									<span className="tx">
										<span className="nm">{t.label}</span>
										<span className="ct">{t.caption}</span>
									</span>
								</button>
							))}
						</div>
						<div className="xp__body">

						{explore === "d" && (
							<div className="xp__pane" data-open>
								<div className="card-grid card-grid--3">
									{featuredDestinations.map((d) => (
										<Link key={d.id} to={`/destinations/${d.id}`} className="media-card" aria-label={`Explore ${d.name}`}>
											<span className="media-card__hint" aria-hidden>→</span>
											<div className="media-card__img">
												{FEATURED_DESTINATION_IDS.has(d.id) && <span className="media-card__feat">Featured</span>}
												<img src={d.image} alt="" />
											</div>
											<div className="media-card__body">
												<span className="eyebrow">{d.flag} {d.region}</span>
												<h3 className="media-card__title">{d.name}</h3>
												<p className="media-card__text">{d.tagline}</p>
												<span className="media-card__cta">Explore destination <span aria-hidden>→</span></span>
											</div>
										</Link>
									))}
								</div>
							</div>
						)}

						{explore === "u" && (
							<div className="xp__pane" data-open>
								<div>
									{universities.slice(0, 6).map((u) => (
										<Link key={u.id} to={`/universities/${u.id}`} className="ucard" aria-label={`View ${u.name}`}>
											<span className="ucard__img">
												<img src={u.image} alt="" />
												<span className="ucard__rank">{u.ranking}</span>
											</span>
											<span className="ucard__body">
												<span className="ucard__title">{u.name}</span>
												<span className="ucard__meta">{u.city} · {u.type}</span>
												<span className="ucard__tags">{u.tags.join(" · ")}</span>
											</span>
											<span className="ucard__go" aria-hidden>→</span>
										</Link>
									))}
								</div>
							</div>
						)}

						{explore === "p" && (
							<div className="xp__pane" data-open>
								<div className="card-grid card-grid--3">
									{programs.slice(0, 6).map((p) => {
										const uni = getUniversity(p.universityId);
										return (
											<Link key={p.id} to={`/programs/${p.id}`} className="media-card" aria-label={`Explore ${p.name}`}>
												<span className="media-card__hint" aria-hidden>→</span>
												<div className="media-card__img media-card__img--band">
													{uni?.image && <img src={uni.image} alt="" />}
													<span className="media-card__feat">{uni?.name ?? "Partner"}</span>
												</div>
												<div className="media-card__body">
													<span className="eyebrow">{p.level} · {p.field}</span>
													<h3 className="media-card__title">{p.name}</h3>
													<p className="media-card__text">{p.duration} · {p.tuition} · {p.intake[0]}</p>
													<span className="media-card__cta">View program <span aria-hidden>→</span></span>
												</div>
											</Link>
										);
									})}
								</div>
							</div>
						)}

						{explore === "f" && (
							<div className="xp__pane" data-open>
								<div className="fgrid">
									{scholarships.slice(0, 4).map((s) => (
										<Link key={s.id} to={`/scholarships/${s.id}`} className="fcard" aria-label={`View ${s.name}`}>
											<span className="fcard__amt">
												<b>{s.amount.replace(/^Up to\s*/i, "")}</b>
												<span>{s.amountQualifier ? `${s.amountQualifier} · ${s.type}` : s.type}</span>
											</span>
											<span className="fcard__img">
												<img src={s.image} alt="" />
												<span>{s.name}</span>
											</span>
											<span className="fcard__meta">
												<span>{s.eligibility}</span>
												<b>{s.deadline === "Rolling" ? "Rolling" : `Closes ${s.deadline}`}</b>
											</span>
										</Link>
									))}
								</div>
							</div>
						)}

							<div className="xp__foot">
								<p>{EXPLORE_TABS.find((t) => t.id === explore)?.foot}</p>
								<Link className="link-arrow" to={EXPLORE_TABS.find((t) => t.id === explore)?.to ?? "/"}>
									View all →
								</Link>
							</div>
						</div>
					</div>
				</div>
			</section>

			<hr className="section-rule" />

			{/* The Red Seat. Written and on-camera, three per view */}
			<section className="section">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">The Red Seat</p>
							<h2 className="section-title">In their own words</h2>
							<p className="lead mt-2" style={{ maxWidth: "34rem" }}>
								Clients who sat in the red seat, and where it took them.
							</p>
						</div>
						<Link to="/red-seat" className="link-arrow">
							All stories →
						</Link>
					</div>

					<div className="redseat">
						<div className="redseat__part">
							<div className="redseat__part-head">
								<h3 className="redseat__part-title">Written</h3>
								<span className="mono muted redseat__count">{testimonials.length} accounts</span>
							</div>
							<Carousel label="Written testimonials">
								{testimonials.map((t) => (
									<blockquote key={t.id} className="rs-quote carousel__item">
										<span className="rs-quote__mark" aria-hidden>
											“
										</span>
										<p className="rs-quote__text">{t.quote}</p>
										<footer className="rs-quote__meta">
											<img src={t.image} alt="" loading="lazy" />
											<span>
												<strong className="rs-quote__name display">{t.name}</strong>
												<span className="mono muted rs-quote__sub">
													{t.program} · {t.country}
												</span>
											</span>
										</footer>
									</blockquote>
								))}
							</Carousel>
						</div>

						<div className="redseat__part">
							<div className="redseat__part-head">
								<h3 className="redseat__part-title">On camera</h3>
								<span className="mono muted redseat__count">
									{videoTestimonials.length} films
								</span>
							</div>
							<Carousel label="Video testimonials">
								{videoTestimonials.map((v) => (
									<article key={v.id} className="rs-video carousel__item">
										<button
											type="button"
											className="rs-video__frame"
											onClick={() => setPlaying(v.id)}
											aria-label={`Play ${v.name}'s story`}
										>
											<img src={v.poster} alt="" loading="lazy" />
											<span className="rs-video__play" aria-hidden>
												▶
											</span>
											<span className="rs-video__length mono">{v.length}</span>
										</button>
										<p className="rs-video__headline display">{v.headline}</p>
										<p className="rs-video__meta mono muted">
											{v.name} · {v.program}
										</p>
										<p className="rs-video__meta mono muted">{v.country}</p>
									</article>
								))}
							</Carousel>
						</div>
					</div>
				</div>
			</section>

			{/* Video lightbox */}
			{playing ? (
				<VideoLightbox
					video={videoTestimonials.find((v) => v.id === playing)!}
					onClose={() => setPlaying(null)}
				/>
			) : null}

			<hr className="section-rule" />

			{/* Methodology. Four stages on one spine. No durations: they set an
			    expectation the business cannot honour per applicant. */}
			<section className="section texture-diagonal">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">Methodology</p>
							<h2 className="section-title">How the process works</h2>
							<p className="lead mt-2" style={{ maxWidth: "38rem" }}>
								One consultation opens your file. From there the journey is three stages —
								pick one, or take them all. Choose a scope and watch the route light up.
							</p>
						</div>
					</div>

					{/* Scope picker — the route lights up to match */}
					<div className="route-ctl" role="group" aria-label="Pick a journey scope">
						{PROCESS_SCOPES.map((sc) => (
							<button
								key={sc.id}
								type="button"
								className={`route-ctl__btn${scope === sc.id ? " is-on" : ""}`}
								aria-pressed={scope === sc.id}
								onClick={() => setScope(sc.id)}
							>
								{sc.label}
							</button>
						))}
					</div>

					<ol className="route">
						<li className="route__stage route__stage--entry">
							<span className="route__rail" aria-hidden><i className="route__dot" /><i className="route__seg" /></span>
							<p className="route__no">Start</p>
							<h3 className="route__name">Consultation</h3>
							<p className="route__req">The door in — online or in person, Accra or Kumasi</p>
							<ul className="route__list">
								<li>You pick your scope here</li>
								<li>Your file opens the same day</li>
							</ul>
						</li>
						{SERVICE_STAGES.map((stage, i) => {
							const s = PROCESS_SCOPES.find((x) => x.id === scope)!;
							const off = !s.stages.includes(stage) && !s.recommended.includes(stage);
							const rec = s.recommended.includes(stage);
							return (
								<li key={stage} className={`route__stage${off ? " is-off" : ""}${rec ? " is-rec" : ""}`}>
									<span className="route__rail" aria-hidden><i className="route__dot" /><i className="route__seg" /></span>
									<p className="route__no">{["First", "Then", "Last"][i]}</p>
									<h3 className="route__name">{SERVICE_STAGE_LABELS[stage]}</h3>
									<p className="route__req">{STAGE_REQ[stage]}</p>
									<ul className="route__list">
										{STAGE_INCLUDES[stage].map((x) => (
											<li key={x}>{x}</li>
										))}
									</ul>
								</li>
							);
						})}
					</ol>

					{/* the consequence strip swaps with the scope */}
					<div className="fx">
						<div className="fx__cell">
							<p className="fx__k">Consultation form</p>
							<h5>{scopeData.form}</h5>
							<p>{scopeData.formDetail}</p>
						</div>
						<div className="fx__cell">
							<p className="fx__k">Stages</p>
							<h5>Your plan</h5>
							<ul>
								{scopeData.plan.map((t) => (
									<li key={t.text} className={t.off ? "off" : "on"}>{t.text}</li>
								))}
							</ul>
						</div>
						<div className="fx__cell">
							<p className="fx__k">Documents</p>
							<h5>{scopeData.docsTitle}</h5>
							<ul>
								{scopeData.docs.map((t) => (
									<li key={t.text} className={t.off ? "off" : ""}>{t.text}</li>
								))}
							</ul>
						</div>
						<div className="fx__cell">
							<p className="fx__k">Portal</p>
							<h5>Your file opens scoped</h5>
							<p>Stages, tasks and invoices exist only for what you bought.</p>
						</div>
					</div>

					<div className="route-foot">
						<p>Bundle pricing beats buying stages apart — the consultation is where the exact quote lands.</p>
						<Link className="btn" to="/start">Book a consultation →</Link>
					</div>
				</div>
			</section>

			<hr className="section-rule" />

			{/* CTA band */}
			<section className="cta-band texture-lines-light">
				<div className="container cta-band__inner">
					<div>
						<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>
							Ready to begin?
						</p>
						<h2 className="section-title mt-2" style={{ maxWidth: "32rem" }}>
							One journey - consultation through visa - in your dashboard.
						</h2>
						<p className="mono mt-2" style={{ color: "rgba(255,255,255,0.65)" }}>
							{company.branches[0].phones[0]} · {company.email}
						</p>
					</div>
					<div className="row">
						<JourneyButton variant="inverted" />
						<EnquiryButton
							variant="secondary"
							style={{ borderColor: "#fff", color: "#fff" }}
						>
							Enquire
						</EnquiryButton>
					</div>
				</div>
			</section>

			{/* Articles */}
			<section className="section">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">Journal</p>
							<h2 className="section-title">Latest articles</h2>
						</div>
						<Link to="/blog" className="link-arrow">
							All articles →
						</Link>
					</div>
					<div className="card-grid card-grid--3">
						{articles.map((a) => (
							<Link
								key={a.id}
								to={`/blog/${a.id}`}
								className="media-card"
								aria-label={`Read: ${a.title}`}
							>
								<span className="media-card__hint" aria-hidden>
									→
								</span>
								<div className="blog-img">
									<img src={a.image} alt="" />
								</div>
								<div className="media-card__body">
									<span className="eyebrow">
										{a.category} · {a.readTime}
									</span>
									<h3 className="media-card__title">{a.title}</h3>
									<p className="media-card__text">{a.excerpt}</p>
									<span className="media-card__cta">
										Read article <span aria-hidden>→</span>
									</span>
								</div>
							</Link>
						))}
					</div>
				</div>
			</section>

			{socialError && (
				<SocialAuthErrorModal
					error={socialError}
					onClose={() => setSocialError(null)}
					onSignIn={() => {
						setSocialError(null);
						nav("/start");
					}}
				/>
			)}
		</>
	);
}

/** Modal shown when a social login redirect fails on the root URL. */
function SocialAuthErrorModal({
	error,
	onClose,
	onSignIn,
}: {
	error: string;
	onClose: () => void;
	onSignIn: () => void;
}) {
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	const isAccountNotLinked = error === "account_not_linked";
	const title = isAccountNotLinked ? "Account already exists" : "Sign-in failed";
	const message = isAccountNotLinked
		? "An account with this email already exists. Sign in with your password to continue. You can link your Google account from your profile settings after signing in."
		: "We couldn't complete social sign-in. Please try again or sign in with your email and password.";

	return createPortal(
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="social-auth-error-title"
			onClick={onClose}
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: "center",
				position: "fixed",
				inset: 0,
				backgroundColor: "rgba(0,0,0,0.6)",
				zIndex: 9999,
				padding: "1rem",
			}}
		>
			<div
				className="card fade-in"
				onClick={(e) => e.stopPropagation()}
				style={{
					width: "100%",
					maxWidth: "440px",
					padding: "2rem",
					boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)",
				}}
			>
				<h2 id="social-auth-error-title" style={{ marginBottom: "0.75rem", fontSize: "1.4rem" }}>
					{title}
				</h2>
				<p style={{ color: "var(--muted-foreground)", marginBottom: "1.5rem", fontSize: "0.9rem", lineHeight: 1.5 }}>
					{message}
				</p>
				<div style={{ display: "flex", gap: "0.75rem", justifyContent: "flex-end" }}>
					<button
						type="button"
						onClick={onClose}
						style={{
							padding: "0.5rem 1rem",
							background: "transparent",
							border: "1px solid var(--border)",
							borderRadius: "var(--radius)",
							cursor: "pointer",
							fontSize: "0.9rem",
							color: "var(--foreground)",
						}}
					>
						Dismiss
					</button>
					<button
						type="button"
						onClick={onSignIn}
						style={{
							padding: "0.5rem 1rem",
							background: "var(--foreground)",
							color: "var(--background)",
							border: "none",
							borderRadius: "var(--radius)",
							cursor: "pointer",
							fontSize: "0.9rem",
							fontWeight: 600,
						}}
					>
						Go to Sign In
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

/** Full-screen player for a Red Seat film. Portalled so no ancestor transform
    can capture its fixed positioning. */
function VideoLightbox({
	video,
	onClose,
}: {
	video: (typeof videoTestimonials)[number];
	onClose: () => void;
}) {
	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") onClose();
		}
		document.addEventListener("keydown", onKey);
		const prev = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		return () => {
			document.removeEventListener("keydown", onKey);
			document.body.style.overflow = prev;
		};
	}, [onClose]);

	return createPortal(
		<div className="rs-lightbox" onClick={onClose} role="presentation">
			<div
				className="rs-lightbox__panel"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-label={`${video.name}. Video testimonial`}
			>
				<button type="button" className="rs-lightbox__close" onClick={onClose} aria-label="Close">
					✕
				</button>

				<div className="rs-lightbox__stage">
					{video.videoUrl ? (
						<iframe
							src={video.videoUrl}
							title={`${video.name} testimonial`}
							allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture"
							allowFullScreen
						/>
					) : (
						/* No file wired up yet. Say so rather than showing a dead player */
						<div className="rs-lightbox__placeholder" style={{ backgroundImage: `url(${video.poster})` }}>
							<p className="mono">Film not uploaded yet</p>
						</div>
					)}
				</div>

				<div className="rs-lightbox__meta">
					<p className="display rs-lightbox__headline">{video.headline}</p>
					<p className="mono muted">
						{video.name} · {video.program} · {video.country}
					</p>
				</div>
			</div>
		</div>,
		document.body,
	);
}
