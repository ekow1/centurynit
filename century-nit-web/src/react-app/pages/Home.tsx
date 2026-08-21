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
	processSteps,
	programs,
	scholarships,
	spotlightOffers,
	stats,
	testimonials,
	universities,
	getUniversity,
	videoTestimonials,
} from "century-nit-core";
import { STAGE_SHORT } from "../data/stageLabels";

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
	const [playing, setPlaying] = useState<string | null>(null);
	const { isAuthenticated, journeyPhase } = useAppState();

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

			{/* Spotlight from live site themes */}
			<section className="section">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">Favourite pathways</p>
							<h2 className="section-title">Germany · UK · Canada</h2>
						</div>
						<Link to="/destinations" className="link-arrow">
							All countries →
						</Link>
					</div>
					<div className="card-grid card-grid--3">
						{spotlightOffers.map((s) => (
							<Link key={s.id} to={s.to} className="media-card">
								<span className="media-card__hint" aria-hidden>
									→
								</span>
								<div className="media-card__body media-card__body--text">
									<div className="stack" style={{ gap: "0.85rem" }}>
										<span className="eyebrow">Featured</span>
										<h3 className="media-card__title">{s.title}</h3>
										<p className="media-card__text">{s.blurb}</p>
									</div>
									<span className="media-card__cta">
										Read more <span aria-hidden>→</span>
									</span>
								</div>
							</Link>
						))}
					</div>
				</div>
			</section>

			<hr className="section-rule" />

			{/* Core services */}
			<section className="section texture-grid">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">What we offer</p>
							<h2 className="section-title">Our services</h2>
						</div>
						<Link to="/visa-services" className="link-arrow">
							Visa desk →
						</Link>
					</div>
					<div className="card-grid card-grid--3">
						{coreServices.map((s) => (
							<Link key={s.id} to={`/services/${s.id}`} className="card card--pad card--hover">
								<span className="eyebrow">{s.id.replace("-", " ")}</span>
								<h3 className="display mt-2" style={{ fontSize: "1.45rem" }}>
									{s.title}
								</h3>
								<p className="mt-2 muted" style={{ fontSize: "1.05rem" }}>
									{s.description}
								</p>
								<span className="card__cta">Learn more →</span>
							</Link>
						))}
					</div>
				</div>
			</section>

			<hr className="section-rule" />

			{/* Destinations */}
			<section className="section">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">Favourite destinations</p>
							<h2 className="section-title">Choose your country</h2>
						</div>
						<Link to="/destinations" className="link-arrow">
							View all →
						</Link>
					</div>
					<div className="card-grid card-grid--3">
						{destinations.slice(0, 6).map((d) => (
							<Link
								key={d.id}
								to={`/destinations/${d.id}`}
								className="media-card"
								aria-label={`Explore ${d.name}`}
							>
								<span className="media-card__hint" aria-hidden>
									→
								</span>
								<div className="media-card__img">
									<img src={d.image} alt="" />
								</div>
								<div className="media-card__body">
									<span className="eyebrow">
										{d.flag} {d.region}
									</span>
									<h3 className="media-card__title">{d.name}</h3>
									<p className="media-card__text">{d.tagline}</p>
									<span className="media-card__cta">
										Explore destination <span aria-hidden>→</span>
									</span>
								</div>
							</Link>
						))}
					</div>
				</div>
			</section>

			<hr className="section-rule" />

			{/* Universities */}
			<section className="section texture-grid">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">Partner network</p>
							<h2 className="section-title">Popular universities</h2>
						</div>
						<Link to="/universities" className="link-arrow">
							Browse network →
						</Link>
					</div>
					<div className="card-grid card-grid--2">
						{universities.slice(0, 4).map((u) => (
							<Link
								key={u.id}
								to={`/universities/${u.id}`}
								className="media-card media-card--cover"
								aria-label={`View ${u.name}`}
							>
								<span className="media-card__hint" aria-hidden>
									→
								</span>
								<div className="media-card__cover-img">
									<img src={u.image} alt="" />
								</div>
								<div className="media-card__body">
									<span className="eyebrow">{u.ranking}</span>
									<h3 className="media-card__title">{u.name}</h3>
									<p className="media-card__text">
										{u.city} · {u.type}
									</p>
									<span className="media-card__cta">
										View university <span aria-hidden>→</span>
									</span>
								</div>
							</Link>
						))}
					</div>
				</div>
			</section>

			<hr className="section-rule" />

			{/* Programs */}
			<section className="section">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">Featured programs</p>
							<h2 className="section-title">Programs with gravity</h2>
						</div>
						<Link to="/programs" className="link-arrow">
							All programs →
						</Link>
					</div>
					<div className="card-grid card-grid--2">
						{programs.slice(0, 4).map((p) => {
							const uni = getUniversity(p.universityId);
							return (
								<Link
									key={p.id}
									to={`/programs/${p.id}`}
									className="media-card"
									aria-label={`Explore ${p.name}`}
								>
									<span className="media-card__hint" aria-hidden>
										→
									</span>
									<div className="media-card__body media-card__body--text">
										<div className="stack" style={{ gap: "0.85rem" }}>
											<span className="eyebrow">
												{p.level} · {p.field}
											</span>
											<h3 className="media-card__title">{p.name}</h3>
											<p className="media-card__text">
												{uni?.name} · {p.duration} · {p.tuition}
											</p>
										</div>
										<span className="media-card__cta">
											Explore program <span aria-hidden>→</span>
										</span>
									</div>
								</Link>
							);
						})}
					</div>
				</div>
			</section>

			<hr className="section-rule" />

			{/* The Red Seat — written and on-camera, three per view */}
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

			{/* Methodology — four stages on one spine. No durations: they set an
			    expectation the business cannot honour per applicant. */}
			<section className="section texture-diagonal">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">Methodology</p>
							<h2 className="section-title">How the process works</h2>
							<p className="lead mt-2" style={{ maxWidth: "36rem" }}>
								Four disciplined stages, from first consultation to departure. Every stage has
								named deliverables and a dedicated advisor.
							</p>
						</div>
					</div>

					<ol className="method">
						{processSteps.map((s, i) => (
							<li key={s.step} className="method__stage">
								<div className="method__marker" aria-hidden>
									<span className="method__num">{s.step}</span>
									{i < processSteps.length - 1 ? <span className="method__line" /> : null}
								</div>
								<div className="method__body">
									<h3 className="method__title display">{s.title}</h3>
									<p className="method__detail muted">{s.detail}</p>
									<ul className="method__list">
										{s.deliverables.map((d) => (
											<li key={d}>{d}</li>
										))}
									</ul>
								</div>
							</li>
						))}
					</ol>
				</div>
			</section>

			<hr className="section-rule" />

			{/* Scholarships */}
			<section className="section">
				<div className="container">
					<div className="section__head">
						<div>
							<p className="eyebrow">Funding</p>
							<h2 className="section-title">Scholarship opportunities</h2>
						</div>
						<Link to="/scholarships" className="link-arrow">
							View all →
						</Link>
					</div>
					<div className="card-grid card-grid--2">
						{scholarships.slice(0, 4).map((s) => (
							<Link
								key={s.id}
								to={`/scholarships/${s.id}`}
								className="card card--pad card--hover scholarship-card"
								style={{ textDecoration: "none", color: "inherit" }}
							>
								<span className="badge">{s.type}</span>
								<h3 className="display mt-3" style={{ fontSize: "1.65rem", lineHeight: 1.2 }}>
									{s.name}
								</h3>
								<p className="display mt-3" style={{ fontSize: "2.25rem" }}>
									{s.amount}
								</p>
								<p className="muted mt-2" style={{ fontSize: "1.05rem", lineHeight: 1.55 }}>
									{s.eligibility}
								</p>
								<p className="mono mt-3">Deadline · {s.deadline}</p>
							</Link>
						))}
					</div>
				</div>
			</section>

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
		</>
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
				aria-label={`${video.name} — video testimonial`}
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
						/* No file wired up yet — say so rather than showing a dead player */
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
