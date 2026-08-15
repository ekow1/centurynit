import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useParams, Navigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { JourneyButton } from "../components/ui/JourneyButton";
import { Field, Input, Select, Textarea } from "../components/ui/Field";
import { EnquiryButton } from "../components/EnquiryContext";
import { Carousel } from "../components/Carousel";
import {
	articles,
	company,
	coreServices,
	destinations,
	events,
	faqs,
	getDestination,
	getProgram,
	dualAmount,
	getScholarship,
	getService,
	getUniversity,
	processSteps,
	programs,
	programsForUniversity,
	scholarships,
	stats,
	testimonials,
	universities,
	universitiesForDestination,
	videoTestimonials,
} from "century-nit-core";
import { useSiteContent } from "../data/useSiteContent";

function PageHeader({
	eyebrow,
	title,
	lead,
}: {
	eyebrow: string;
	title: string;
	lead: string;
}) {
	return (
		<header className="page-header">
			<div className="container">
				<p className="eyebrow">{eyebrow}</p>
				<h1 className="page-title mt-1">{title}</h1>
				<p className="lead">{lead}</p>
			</div>
		</header>
	);
}

export function About() {
	const pillars = [
		{
			t: "Licensed consultancy since 2011",
			d: "A recognised recruitment consultancy in Ghana, built to educate and assist students pursuing higher education abroad.",
		},
		{
			t: "Full journey support",
			d: "From education advice and admission documents to study visas and travel arrangements-we stay with you.",
		},
		{
			t: "Partner university network",
			d: "Guidance informed by partner institutions across the UK, USA, Canada, Germany, and more.",
		},
		{
			t: "Local presence",
			d: "Walk into Accra or Kumasi-or start online. Real offices, real advisors, real follow-through.",
		},
	];
	return (
		<>
			<PageHeader
				eyebrow={`${company.base} · Est. ${company.founded}`}
				title="About Century Nit Consult"
				lead={company.summary}
			/>
			<section className="section">
				<div className="container split">
					<div>
						<p className="drop-cap">{company.about}</p>
						<p className="eyebrow mt-4">Our mission</p>
						<ul className="stack mt-2">
							{company.mission.map((m) => (
								<li
									key={m}
									style={{
										borderBottom: "1px solid #e5e5e5",
										paddingBottom: "0.85rem",
										fontFamily: "var(--font-display)",
										fontSize: "1.2rem",
									}}
								>
									- {m}
								</li>
							))}
						</ul>
						<div className="row mt-4">
							<JourneyButton />
							<EnquiryButton>Enquire</EnquiryButton>
						</div>
					</div>
					<div className="img-border" style={{ aspectRatio: "4/5" }}>
						<img
							src="https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=900&q=80"
							alt="Library interior with long reading tables"
						/>
					</div>
				</div>
			</section>
			<hr className="section-rule" />
			<section className="section texture-grid">
				<div className="container">
					<p className="eyebrow">Difference</p>
					<h2 className="section-title mt-1">Why Choose Us</h2>
					<p className="lead mt-2" style={{ maxWidth: "36rem" }}>
						Restraint over noise. Strategy over templates. A firm that treats your future as architecture.
					</p>
					<div
						className="mt-5"
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
							gap: "2rem",
						}}
					>
						{pillars.map((p) => (
							<article key={p.t}>
								<h3 className="display" style={{ fontSize: "1.4rem" }}>
									{p.t}
								</h3>
								<p className="mt-2 muted" style={{ fontSize: "1rem", lineHeight: 1.6 }}>
									{p.d}
								</p>
							</article>
						))}
					</div>
					<div className="process-grid mt-6" style={{ borderTop: "1px solid #000" }}>
						{processSteps.map((s) => (
							<div key={s.step} className="process-step">
								<div className="process-step__num">{s.step}</div>
								<h3>{s.title}</h3>
								<p className="muted" style={{ fontSize: "1rem" }}>
									{s.description}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>
			<section className="stats texture-lines-light">
				<div className="container stats__grid">
					{stats.map((s) => (
						<div key={s.label}>
							<div className="stat__value">
								{s.value.toLocaleString()}
								{s.suffix}
							</div>
							<div className="stat__label">{s.label}</div>
						</div>
					))}
				</div>
			</section>
		</>
	);
}

export function WhyChooseUs() {
	const pillars = [
		{
			t: "Licensed consultancy since 2011",
			d: "A recognised recruitment consultancy in Ghana, built to educate and assist students pursuing higher education abroad.",
		},
		{
			t: "Full journey support",
			d: "From education advice and admission documents to study visas and travel arrangements-we stay with you.",
		},
		{
			t: "Partner university network",
			d: "Guidance informed by partner institutions across the UK, USA, Canada, Germany, and more.",
		},
		{
			t: "Local presence",
			d: "Walk into Accra or Kumasi-or start online. Real offices, real advisors, real follow-through.",
		},
	];
	return (
		<>
			<PageHeader
				eyebrow="Difference"
				title="Why Choose Us"
				lead="Restraint over noise. Strategy over templates. A firm that treats your future as architecture."
			/>
			<section className="section texture-grid">
				<div className="container">
					<div
						style={{
							display: "grid",
							gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
							gap: "2rem",
						}}
					>
						{pillars.map((p) => (
							<article key={p.t}>
								<h2 className="display" style={{ fontSize: "1.4rem" }}>
									{p.t}
								</h2>
								<p className="mt-2 muted" style={{ fontSize: "1rem", lineHeight: 1.6 }}>
									{p.d}
								</p>
							</article>
						))}
					</div>
					<div className="process-grid mt-6" style={{ borderTop: "1px solid #000" }}>
						{processSteps.map((s) => (
							<div key={s.step} className="process-step">
								<div className="process-step__num">{s.step}</div>
								<h3>{s.title}</h3>
								<p className="muted" style={{ fontSize: "1rem" }}>
									{s.description}
								</p>
							</div>
						))}
					</div>
					<div className="row mt-6">
						<JourneyButton />
						<EnquiryButton>Enquire</EnquiryButton>
					</div>
				</div>
			</section>
		</>
	);
}

export function Destinations() {
	return (
		<>
			<PageHeader
				eyebrow="World"
				title="Study Destinations"
				lead="Six regions. Hundreds of institutions. One disciplined approach to fit, funding, and future mobility."
			/>
			<section className="section">
				<div className="container">
					<div className="card-grid card-grid--3">
						{destinations.map((d) => (
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
									<h2 className="media-card__title">{d.name}</h2>
									<p className="media-card__text">
										{d.universities} universities · {d.programs} programs
									</p>
									<span className="media-card__cta">
										Explore destination <span aria-hidden>→</span>
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

export function DestinationDetail() {
	const { id } = useParams();
	const d = getDestination(id ?? "");
	if (!d) return <Navigate to="/destinations" replace />;
	const unis = universitiesForDestination(d.id);
	return (
		<>
			<header className="page-header">
				<div className="container">
					<p className="eyebrow">
						{d.flag} {d.region}
					</p>
					<h1 className="page-title mt-1">{d.name}</h1>
					<p className="lead">{d.tagline}</p>
				</div>
			</header>
			<section className="section">
				<div className="container split">
					<div>
						<p className="drop-cap">{d.description}</p>
						<ul className="mt-4 stack">
							{d.highlights.map((h) => (
								<li key={h} className="mono" style={{ borderBottom: "1px solid #e5e5e5", paddingBottom: "0.75rem" }}>
									- {h}
								</li>
							))}
						</ul>
						<div className="row mt-4">
							<JourneyButton />
						</div>
					</div>
					<div className="img-border" style={{ aspectRatio: "4/5" }}>
						<img src={d.image} alt={d.name} />
					</div>
				</div>
				<div className="container mt-6">
					<h2 className="section-title mb-4">Universities in {d.name}</h2>
					{unis.length === 0 ? (
						<div className="empty-state">
							<h3>No universities listed yet</h3>
							<p>Explore our full network or speak with an advisor.</p>
							<Button to="/universities">Browse universities</Button>
						</div>
					) : (
						<div className="card-grid card-grid--2">
							{unis.map((u) => (
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
										<span className="media-card__cta">
											View university <span aria-hidden>→</span>
										</span>
									</div>
								</Link>
							))}
						</div>
					)}
				</div>
			</section>
		</>
	);
}

export function Universities() {
	const [filter, setFilter] = useState("all");
	// CMS edits applied, unpublished records dropped
	const { live } = useSiteContent();
	const list = useMemo(() => {
		const published = live("universities", universities);
		return filter === "all" ? published : published.filter((u) => u.destinationId === filter);
	}, [filter, live]);
	return (
		<>
			<PageHeader
				eyebrow="Network"
				title="Universities"
				lead="A curated network of institutions where academic excellence meets long-term opportunity."
			/>
			<section className="section">
				<div className="container">
					<div className="filters" role="tablist" aria-label="Filter by destination">
						<button
							type="button"
							className={`filter-chip${filter === "all" ? " filter-chip--active" : ""}`}
							onClick={() => setFilter("all")}
						>
							All
						</button>
						{destinations.map((d) => (
							<button
								key={d.id}
								type="button"
								className={`filter-chip${filter === d.id ? " filter-chip--active" : ""}`}
								onClick={() => setFilter(d.id)}
							>
								{d.name}
							</button>
						))}
					</div>
					{list.length === 0 ? (
						<div className="empty-state">
							<h3>No universities match</h3>
							<p>Try another destination filter.</p>
							<Button type="button" onClick={() => setFilter("all")}>
								Reset filters
							</Button>
						</div>
					) : (
						<div className="card-grid card-grid--2">
							{list.map((u) => (
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
										<h2 className="media-card__title">{u.name}</h2>
										<p className="media-card__text">
											{u.city} · Acceptance {u.acceptance}
										</p>
										<span className="media-card__cta">
											View university <span aria-hidden>→</span>
										</span>
									</div>
								</Link>
							))}
						</div>
					)}
				</div>
			</section>
		</>
	);
}

export function UniversityDetail() {
	const { id } = useParams();
	const u = getUniversity(id ?? "");
	if (!u) return <Navigate to="/universities" replace />;
	const dest = getDestination(u.destinationId);
	const progs = programsForUniversity(u.id);
	return (
		<>
			<header className="page-header">
				<div className="container">
					<p className="eyebrow">
						{dest?.name} · {u.city}
					</p>
					<h1 className="page-title mt-1">{u.name}</h1>
					<p className="lead">{u.description}</p>
				</div>
			</header>
			<section className="section">
				<div className="container">
					<div className="split">
						<div className="img-border" style={{ aspectRatio: "16/11" }}>
							<img src={u.image} alt={u.name} />
						</div>
						<div>
							<dl className="meta-grid">
								<div>
									<dt>Ranking</dt>
									<dd>{u.ranking}</dd>
								</div>
								<div>
									<dt>Type</dt>
									<dd>{u.type}</dd>
								</div>
								<div>
									<dt>Acceptance</dt>
									<dd>{u.acceptance}</dd>
								</div>
								<div>
									<dt>Destination</dt>
									<dd>{dest?.name}</dd>
								</div>
							</dl>
							<div className="tags mt-3">
								{u.tags.map((t) => (
									<span key={t} className="badge">
										{t}
									</span>
								))}
							</div>
							<div className="row mt-4">
								<JourneyButton />
							</div>
						</div>
					</div>
					<h2 className="section-title mt-6 mb-4">Programs</h2>
					{progs.length === 0 ? (
						<div className="empty-state">
							<h3>Programs coming soon</h3>
							<p>Speak with a counselor for the full catalog.</p>
							<Button to="/programs">Browse all programs</Button>
						</div>
					) : (
						<div className="card-grid card-grid--2">
							{progs.map((p) => (
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
												{p.duration} · {p.tuition}
											</p>
										</div>
										<span className="media-card__cta">
											Explore program <span aria-hidden>→</span>
										</span>
									</div>
								</Link>
							))}
						</div>
					)}
				</div>
			</section>
		</>
	);
}

export function Programs() {
	const [level, setLevel] = useState("all");
	const { live } = useSiteContent();
	const list = useMemo(() => {
		const published = live("programs", programs);
		return level === "all" ? published : published.filter((p) => p.level === level);
	}, [level, live]);
	const levels = ["all", "Undergraduate", "Postgraduate", "PhD", "Diploma"] as const;
	return (
		<>
			<PageHeader
				eyebrow="Curriculum"
				title="Programs"
				lead="From undergraduate foundations to research doctorates-programs selected for academic weight and career velocity."
			/>
			<section className="section">
				<div className="container">
					<div className="filters">
						{levels.map((l) => (
							<button
								key={l}
								type="button"
								className={`filter-chip${level === l ? " filter-chip--active" : ""}`}
								onClick={() => setLevel(l)}
							>
								{l === "all" ? "All levels" : l}
							</button>
						))}
					</div>
					<div className="card-grid card-grid--2">
						{list.map((p) => {
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
											<h2 className="media-card__title">{p.name}</h2>
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
		</>
	);
}

export function ProgramDetail() {
	const { id } = useParams();
	const p = getProgram(id ?? "");
	if (!p) return <Navigate to="/programs" replace />;
	const uni = getUniversity(p.universityId);

	const quickFacts = [
		{ label: "University", value: uni?.name },
		{ label: "Duration", value: p.duration },
		{ label: "Tuition", value: p.tuition },
		{ label: "Intakes", value: p.intake.join(", ") },
		...(p.format ? [{ label: "Format", value: p.format }] : []),
		...(p.languageRequirement ? [{ label: "Language", value: p.languageRequirement }] : []),
		...(p.applicationDeadline ? [{ label: "Deadline", value: p.applicationDeadline }] : []),
	].filter((f) => f.value);

	return (
		<>
			<header className="page-header" style={{ paddingBlock: "2.5rem 1.5rem" }}>
				<div className="container">
					<p className="eyebrow">
						{p.level} · {p.field}
					</p>
					<h1 className="page-title mt-1">{p.name}</h1>
					<p className="lead" style={{ maxWidth: "48rem" }}>
						{p.description}
					</p>
				</div>
			</header>

			<section className="section" style={{ paddingTop: "3rem" }}>
				<div
					className="container detail-grid"
					style={{ maxWidth: "72rem" }}
				>
					{/* Main column */}
					<div>
						{p.facts && p.facts.length > 0 ? (
							<section style={{ marginBottom: "3.5rem" }}>
								<h2 className="section-title mb-4">At a glance</h2>
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
										gap: "1.5rem 1rem",
									}}
								>
									{p.facts.map((f) => (
										<div key={f.label}>
											<p
												className="mono muted"
												style={{ fontSize: "0.7rem", letterSpacing: "0.08em", margin: 0 }}
											>
												{f.label}
											</p>
											<p className="display mt-1" style={{ fontSize: "1.25rem" }}>
												{f.value}
											</p>
										</div>
									))}
								</div>
							</section>
						) : null}

						{p.entryRequirements && p.entryRequirements.length > 0 ? (
							<section style={{ marginBottom: "3.5rem" }}>
								<h2 className="section-title mb-4">Entry Requirements</h2>
								<ol
									style={{
										listStyle: "none",
										padding: 0,
										margin: 0,
										display: "flex",
										flexDirection: "column",
										gap: "0.75rem",
									}}
								>
									{p.entryRequirements.map((req, i) => (
										<li
											key={i}
											style={{
												display: "flex",
												alignItems: "baseline",
												gap: "0.75rem",
												paddingBottom: "0.75rem",
												borderBottom: "1px solid var(--border-light)",
											}}
										>
											<span
												className="mono"
												style={{
													flexShrink: 0,
													fontSize: "0.75rem",
													color: "var(--muted-foreground)",
												}}
											>
												{(i + 1).toString().padStart(2, "0")}
											</span>
											<p style={{ lineHeight: 1.6 }}>{req}</p>
										</li>
									))}
								</ol>
							</section>
						) : null}

						{p.curriculum && p.curriculum.length > 0 ? (
							<section style={{ marginBottom: "3.5rem" }}>
								<h2 className="section-title mb-4">Curriculum</h2>
								<ul
									style={{
										padding: 0,
										margin: 0,
										display: "flex",
										flexWrap: "wrap",
										gap: "0.6rem",
										listStyle: "none",
									}}
								>
									{p.curriculum.map((c, i) => (
										<li
											key={i}
											style={{
												padding: "0.35rem 0.75rem",
												background: "var(--muted)",
												fontSize: "0.85rem",
											}}
										>
											{c}
										</li>
									))}
								</ul>
							</section>
						) : null}

						{p.careerOutcomes && p.careerOutcomes.length > 0 ? (
							<section style={{ marginBottom: "3.5rem" }}>
								<h2 className="section-title mb-4">Career Outcomes</h2>
								<ul style={{ padding: 0, margin: 0, listStyle: "none" }}>
									{p.careerOutcomes.map((c, i) => (
										<li
											key={i}
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.75rem",
												padding: "0.6rem 0",
												borderBottom: "1px solid var(--border-light)",
											}}
										>
											<span style={{ color: "var(--foreground)", fontSize: "1.1rem" }}>→</span>
											<p style={{ lineHeight: 1.5 }}>{c}</p>
										</li>
									))}
								</ul>
							</section>
						) : null}

						{p.scholarshipsAvailable && p.scholarshipsAvailable.length > 0 ? (
							<section style={{ marginBottom: "3.5rem" }}>
								<h2 className="section-title mb-4">Scholarships Available</h2>
								<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
									{p.scholarshipsAvailable.map((s, i) => (
										<div
											key={i}
											style={{
												display: "flex",
												alignItems: "center",
												gap: "0.75rem",
												padding: "0.6rem 0",
												borderBottom: "1px solid var(--border-light)",
											}}
										>
											<span className="badge">Scholarship</span>
											<p style={{ lineHeight: 1.5, fontSize: "0.95rem" }}>{s}</p>
										</div>
									))}
								</div>
							</section>
						) : null}
					</div>

					{/* Sidebar */}
					<aside className="detail-aside">
						<h2
							className="section-title"
							style={{ fontSize: "1rem", marginBottom: "1rem" }}
						>
							Quick facts
						</h2>
						<dl style={{ display: "flex", flexDirection: "column", gap: "0.85rem", margin: 0 }}>
							{quickFacts.map((f) => (
								<div key={f.label}>
									<dt
										className="mono muted"
										style={{ fontSize: "0.65rem", letterSpacing: "0.1em", marginBottom: "0.15rem" }}
									>
										{f.label}
									</dt>
									<dd style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.5 }}>
										{f.label === "University" ? (
											<Link to={`/universities/${uni?.id}`} className="link-arrow">
												{f.value}
											</Link>
										) : (
											f.value
										)}
									</dd>
								</div>
							))}
						</dl>
						<div className="row mt-5" style={{ flexDirection: "column", gap: "0.75rem", alignItems: "stretch" }}>
							<JourneyButton />
							<EnquiryButton variant="secondary">Enquire</EnquiryButton>
						</div>
					</aside>
				</div>
			</section>

			<section className="section" style={{ paddingTop: 0 }}>
				<div
					className="container"
					style={{
						maxWidth: "48rem",
						padding: "2.5rem 2rem",
						background: "var(--foreground)",
						color: "var(--background)",
						borderTop: "1px solid var(--border)",
					}}
				>
					<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>
						Next step
					</p>
					<h2 className="display mt-2" style={{ fontSize: "2rem" }}>
						Ready to apply to {p.name}?
					</h2>
					<p className="mt-2" style={{ color: "rgba(255,255,255,0.8)", maxWidth: "38rem" }}>
						Our counselors will guide you through eligibility, documentation, and the full
						application timeline for {uni?.name}.
					</p>
					<div className="row mt-4">
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
		</>
	);
}

export function Scholarships() {
	const [type, setType] = useState("all");
	const types = ["all", "Merit", "Field-specific", "Need + Merit", "Destination"];
	const { live } = useSiteContent();
	const list = useMemo(() => {
		const published = live("scholarships", scholarships);
		return type === "all" ? published : published.filter((s) => s.type === type);
	}, [type, live]);
	return (
		<>
			<PageHeader
				eyebrow="Funding"
				title="Scholarships"
				lead="Merit, need, and destination awards-curated for students who plan funding as carefully as they plan applications."
			/>
			<section className="section">
				<div className="container" style={{ maxWidth: "64rem" }}>
					<div className="filters">
						{types.map((t) => (
							<button
								key={t}
								type="button"
								className={`filter-chip${type === t ? " filter-chip--active" : ""}`}
								onClick={() => setType(t)}
							>
								{t === "all" ? "All types" : t}
							</button>
						))}
					</div>
					<div className="scholar-list">
						{list.map((s) => {
							const amt = dualAmount(s.amountUsd);
							return (
								<Link key={s.id} to={`/scholarships/${s.id}`} className="scholar-card card--hover">
									<div className="scholar-card__body">
										<div className="scholar-card__meta">
											<span className="badge">{s.type}</span>
											<span className="mono muted" style={{ fontSize: "0.7rem" }}>
												Deadline · {s.deadline}
											</span>
										</div>
										<h2 className="display scholar-card__name">{s.name}</h2>
										<p className="muted scholar-card__desc">{s.description}</p>
										<p className="muted scholar-card__elig">{s.eligibility}</p>
									</div>

									{/* Cedi leads, USD beneath - the same pair used in the portal */}
									<div className="scholar-card__amount">
										{s.amountQualifier ? (
											<span className="scholar-card__qualifier mono">{s.amountQualifier}</span>
										) : null}
										<span className="scholar-card__ghs display">{amt.ghs}</span>
										<span className="scholar-card__usd mono">{amt.usd} USD</span>
										{s.amountNote ? (
											<span className="scholar-card__note mono">{s.amountNote}</span>
										) : null}
										<span className="scholar-card__cta mono">View details →</span>
									</div>
								</Link>
							);
						})}
					</div>
				</div>
			</section>
		</>
	);
}

export function ScholarshipDetail() {
	const { id } = useParams();
	const s = getScholarship(id ?? "");
	if (!s) return <Navigate to="/scholarships" replace />;
	const otherScholarships = scholarships.filter((x) => x.id !== s.id).slice(0, 3);
	return (
		<>
			<PageHeader
				eyebrow={`${s.type} · ${dualAmount(s.amountUsd).ghs} · ${dualAmount(s.amountUsd).usd}`}
				title={s.name}
				lead={`${s.eligibility} · Deadline ${s.deadline}`}
			/>
			<section className="section">
				<div
					className="container detail-grid"
					style={{ maxWidth: "64rem" }}
				>
					{/* Main column */}
					<div>
						<p style={{ fontSize: "1.1rem", lineHeight: 1.7 }}>{s.description}</p>

						<div className="detail-two-col">
							<div>
								<h2 className="section-title mb-3">Eligibility Criteria</h2>
								<ul style={{ paddingLeft: "1.25rem", lineHeight: 1.8, margin: 0 }}>
									{s.criteria.map((c, i) => (
										<li key={i} style={{ marginBottom: "0.4rem" }}>
											{c}
										</li>
									))}
								</ul>
							</div>
							<div>
								<h2 className="section-title mb-3">How to Apply</h2>
								<ol style={{ paddingLeft: "1.25rem", lineHeight: 1.8, margin: 0 }}>
									{s.apply.map((a, i) => (
										<li key={i} style={{ marginBottom: "0.4rem" }}>
											{a}
										</li>
									))}
								</ol>
							</div>
						</div>

						{s.benefits && s.benefits.length > 0 ? (
							<section style={{ marginTop: "3rem" }}>
								<h2 className="section-title mb-3">What You Receive</h2>
								<div
									style={{
										display: "grid",
										gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
										gap: "1.25rem",
									}}
								>
									{s.benefits.map((b, i) => (
										<div key={i} style={{ paddingBottom: "0.75rem", borderBottom: "1px solid var(--border-light)" }}>
											<p style={{ fontSize: "0.95rem", lineHeight: 1.5 }}>{b}</p>
										</div>
									))}
								</div>
							</section>
						) : null}

						{s.faq && s.faq.length > 0 ? (
							<section style={{ marginTop: "3rem" }}>
								<h2 className="section-title mb-3">Frequently Asked Questions</h2>
								<div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
									{s.faq.map((item, i) => (
										<div key={i} style={{ paddingBottom: "1rem", borderBottom: "1px solid var(--border-light)" }}>
											<p className="display" style={{ fontSize: "1.05rem", marginBottom: "0.4rem" }}>
												{item.q}
											</p>
											<p className="muted" style={{ fontSize: "0.95rem", lineHeight: 1.6 }}>
												{item.a}
											</p>
										</div>
									))}
								</div>
							</section>
						) : null}

						<div className="row mt-5">
							<JourneyButton />
							<EnquiryButton>Enquire</EnquiryButton>
						</div>
					</div>

					{/* Sidebar */}
					<aside className="detail-aside">
						<h2 className="section-title" style={{ fontSize: "1rem", marginBottom: "1rem" }}>
							At a glance
						</h2>
						<dl style={{ display: "flex", flexDirection: "column", gap: "0.85rem", margin: 0 }}>
							<div>
								<dt className="mono muted" style={{ fontSize: "0.7rem", letterSpacing: "0.08em" }}>Award type</dt>
								<dd className="display" style={{ fontSize: "1.05rem", margin: 0 }}>{s.type}</dd>
							</div>
							<div>
								<dt className="mono muted" style={{ fontSize: "0.7rem", letterSpacing: "0.08em" }}>Amount</dt>
								<dd className="display" style={{ fontSize: "1.05rem", margin: 0 }}>{s.amount}</dd>
							</div>
							<div>
								<dt className="mono muted" style={{ fontSize: "0.7rem", letterSpacing: "0.08em" }}>Deadline</dt>
								<dd className="display" style={{ fontSize: "1.05rem", margin: 0 }}>{s.deadline}</dd>
							</div>
							<div>
								<dt className="mono muted" style={{ fontSize: "0.7rem", letterSpacing: "0.08em" }}>Eligibility</dt>
								<dd style={{ fontSize: "0.9rem", margin: 0, lineHeight: 1.5 }}>{s.eligibility}</dd>
							</div>
						</dl>
						<hr style={{ border: "none", borderTop: "1px solid var(--border-light)", margin: "1.5rem 0" }} />
						<h2 className="section-title" style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>
							Other scholarships
						</h2>
						<div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
							{otherScholarships.map((o) => (
								<Link
									key={o.id}
									to={`/scholarships/${o.id}`}
									style={{ textDecoration: "none", color: "inherit" }}
								>
									<p className="display" style={{ fontSize: "0.9rem" }}>{o.name}</p>
									<p className="mono muted" style={{ fontSize: "0.7rem" }}>
										{dualAmount(o.amountUsd).ghs} · {dualAmount(o.amountUsd).usd}
									</p>
								</Link>
							))}
						</div>
					</aside>
				</div>
			</section>
		</>
	);
}

export function VisaServices() {
	return (
		<>
			<PageHeader
				eyebrow="Immigration"
				title="Visa Services"
				lead="Securing admission does not automatically guarantee a visa. We prepare embassy-ready files with professional, efficient delivery."
			/>
			<section className="section">
				<div className="container">
					<div className="card-grid card-grid--2">
						{coreServices
							.filter((s) => ["visa-docs", "study-visa", "admission-docs", "counseling"].includes(s.id))
							.map((i) => (
								<article key={i.id} className="card card--pad card--hover">
									<h2 className="display" style={{ fontSize: "1.5rem" }}>
										{i.title}
									</h2>
									<p className="mt-2 muted">{i.description}</p>
									<p className="mono mt-3" style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
										Typical: {i.duration}
									</p>
									<Link to={`/services/${i.id}`} className="card__cta">
										Learn more →
									</Link>
								</article>
							))}
					</div>
					<p className="mono muted mt-4">
						Need help now? Call {company.branches[0].phones[0]} or email {company.email}
					</p>
					<div className="row mt-4">
						<JourneyButton />
					</div>
				</div>
			</section>
		</>
	);
}

export function StudentServices() {
	return (
		<>
			<PageHeader
				eyebrow="What we offer"
				title="Student Services"
				lead="What we offer at Century Nit Consult-from first counselling session through travel arrangements after your visa."
			/>
			<section className="section texture-grid">
				<div className="container">
					<div className="card-grid card-grid--2">
						{coreServices.map((s) => (
							<article key={s.id} className="card card--pad card--hover">
								<span className="badge">{s.id}</span>
								<h2 className="display mt-2" style={{ fontSize: "1.5rem" }}>
									{s.title}
								</h2>
								<p className="mt-2 muted">{s.description}</p>
								<p className="mono mt-3" style={{ fontSize: "0.75rem", color: "var(--muted-foreground)" }}>
									Typical: {s.duration}
								</p>
								<Link to={`/services/${s.id}`} className="card__cta">
									Learn more →
								</Link>
							</article>
						))}
					</div>
					<div className="row mt-6">
						<JourneyButton />
						<EnquiryButton>Enquire</EnquiryButton>
					</div>
				</div>
			</section>
		</>
	);
}

export function SuccessStories() {
	const [playing, setPlaying] = useState<string | null>(null);

	return (
		<>
			<PageHeader
				eyebrow="The Red Seat"
				title="In their own words"
				lead="Clients who sat in the red seat, and where it took them."
			/>
			<section className="section">
				<div className="container">
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
											"
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

					<div className="row mt-6">
						<JourneyButton />
					</div>
				</div>
			</section>

			{playing ? (
				<VideoLightbox
					video={videoTestimonials.find((v) => v.id === playing)!}
					onClose={() => setPlaying(null)}
				/>
			) : null}
		</>
	);
}

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

export function Events() {
	const [type, setType] = useState("all");
	const types = ["all", "In-person", "News"];
	const list = useMemo(
		() => (type === "all" ? events : events.filter((e) => e.type === type)),
		[type],
	);
	return (
		<>
			<PageHeader
				eyebrow="Calendar"
				title="Events"
				lead="Fairs, masterclasses, and campus days-structured opportunities to meet advisors and institutions."
			/>
			<section className="section">
				<div className="container stack--lg">
					<div className="filters">
						{types.map((t) => (
							<button
								key={t}
								type="button"
								className={`filter-chip${type === t ? " filter-chip--active" : ""}`}
								onClick={() => setType(t)}
							>
								{t === "all" ? "All events" : t}
							</button>
						))}
					</div>
					{list.map((e) => (
						<article key={e.id} className="card card--pad card--hover between" style={{ alignItems: "flex-start" }}>
							<div>
								<span className="badge">{e.type}</span>
								<h2 className="display mt-2" style={{ fontSize: "1.75rem" }}>
									{e.title}
								</h2>
								<p className="muted mt-2">{e.description}</p>
								<p className="mono mt-3">
									{e.date} · {e.time}
								</p>
							</div>
							<JourneyButton size="sm" arrow={false} />
						</article>
					))}
				</div>
			</section>
		</>
	);
}

export function Blog() {
	const [category, setCategory] = useState("all");
	const categories = ["all", "Admissions", "Destinations", "Funding"];
	const list = useMemo(
		() => (category === "all" ? articles : articles.filter((a) => a.category === category)),
		[category],
	);
	return (
		<>
			<PageHeader
				eyebrow="Journal"
				title="Blog"
				lead="Admissions craft, destination strategy, and funding intelligence-written for serious applicants."
			/>
			<section className="section">
				<div className="container">
					<div className="filters">
						{categories.map((c) => (
							<button
								key={c}
								type="button"
								className={`filter-chip${category === c ? " filter-chip--active" : ""}`}
								onClick={() => setCategory(c)}
							>
								{c === "all" ? "All posts" : c}
							</button>
						))}
					</div>
					<div className="card-grid card-grid--3">
						{list.map((a) => (
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
										{a.category} · {a.date}
									</span>
									<h2 className="media-card__title">{a.title}</h2>
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

export function BlogPost() {
	const { id } = useParams();
	const a = articles.find((x) => x.id === id);
	if (!a) return <Navigate to="/blog" replace />;
	return (
		<>
			<header className="page-header">
				<div className="container" style={{ maxWidth: "48rem" }}>
					<p className="eyebrow">
						{a.category} · {a.readTime} · {a.date}
					</p>
					<h1 className="page-title mt-1">{a.title}</h1>
				</div>
			</header>
			<section className="section">
				<div className="container" style={{ maxWidth: "48rem" }}>
					<div className="blog-img mb-4">
						<img src={a.image} alt="" />
					</div>
					<p className="drop-cap">{a.excerpt}</p>
					<p className="mt-3 muted">
						This prototype article demonstrates editorial layout. In production, full long-form content
						would expand on frameworks, checklists, and counselor insights for {a.category.toLowerCase()}{" "}
						topics.
					</p>
					<div className="row mt-4">
						<JourneyButton />
						<Button to="/blog" variant="secondary">
							Back to journal
						</Button>
					</div>
				</div>
			</section>
		</>
	);
}

export function FAQs() {
	return (
		<>
			<PageHeader
				eyebrow="Clarity"
				title="FAQs"
				lead="Direct answers to the questions applicants ask before they commit."
			/>
			<section className="section">
				<div className="container" style={{ maxWidth: "48rem" }}>
					{faqs.map((f) => (
						<details key={f.q} className="faq-item">
							<summary>{f.q}</summary>
							<p>{f.a}</p>
						</details>
					))}
					<div className="row mt-6">
						<EnquiryButton variant="primary" arrow>
							Still have questions? Enquire
						</EnquiryButton>
						<JourneyButton variant="secondary" />
					</div>
				</div>
			</section>
		</>
	);
}

export function Contact() {
	const [sent, setSent] = useState(false);
	const [errors, setErrors] = useState<Record<string, string>>({});
	const [form, setForm] = useState({ name: "", email: "", topic: "", message: "" });

	function submit(e: FormEvent) {
		e.preventDefault();
		const next: Record<string, string> = {};
		if (!form.name.trim()) next.name = "Name is required";
		if (!form.email.includes("@")) next.email = "Valid email required";
		if (!form.message.trim()) next.message = "Message is required";
		setErrors(next);
		if (Object.keys(next).length) return;
		setSent(true);
	}

	return (
		<>
			<PageHeader
				eyebrow="Get in touch"
				title="Contact Us"
				lead={`Contact Century Nit Consult now. ${company.hours}.`}
			/>
			<section className="section">
				<div className="container split">
					{sent ? (
						<div className="card card--inverted card--pad">
							<p className="eyebrow" style={{ color: "rgba(255,255,255,0.6)" }}>
								Received
							</p>
							<h2 className="display mt-2" style={{ fontSize: "2rem" }}>
								Thank you. We will reply shortly.
							</h2>
							<div className="row mt-4">
								<Button to="/" variant="inverted">
									Return home
								</Button>
								<JourneyButton
									variant="secondary"
									style={{ borderColor: "#fff", color: "#fff" }}
								/>
							</div>
						</div>
					) : (
						<form onSubmit={submit} className="stack--lg" noValidate>
							{Object.keys(errors).length > 0 && (
								<div className="alert alert--error" role="alert">
									Please correct the highlighted fields.
								</div>
							)}
							<Field label="Full name" htmlFor="name" error={errors.name}>
								<Input
									id="name"
									value={form.name}
									onChange={(e) => setForm({ ...form, name: e.target.value })}
									error={!!errors.name}
									autoComplete="name"
								/>
							</Field>
							<Field label="Email" htmlFor="email" error={errors.email}>
								<Input
									id="email"
									type="email"
									value={form.email}
									onChange={(e) => setForm({ ...form, email: e.target.value })}
									error={!!errors.email}
									autoComplete="email"
								/>
							</Field>
							<Field label="Topic" htmlFor="topic">
								<Select
									id="topic"
									value={form.topic}
									onChange={(e) => setForm({ ...form, topic: e.target.value })}
								>
									<option value="">Select a topic</option>
									<option value="admissions">Admissions</option>
									<option value="visa">Study visa</option>
									<option value="counseling">Career counseling</option>
									<option value="travel">Travel arrangements</option>
									<option value="other">Other</option>
								</Select>
							</Field>
							<Field label="Message" htmlFor="message" error={errors.message}>
								<Textarea
									id="message"
									value={form.message}
									onChange={(e) => setForm({ ...form, message: e.target.value })}
									error={!!errors.message}
								/>
							</Field>
							<Button type="submit" arrow>
								Send message
							</Button>
						</form>
					)}
					<div className="stack--lg">
						{company.branches.map((b) => (
							<div key={b.id}>
								<p className="mono muted">{b.name}</p>
								<p className="display mt-1" style={{ fontSize: "1.35rem" }}>
									{b.address}
								</p>
								<p className="muted mt-2">
									{b.phones.map((p) => (
										<span key={p}>
											<a href={`tel:${p.replace(/\s/g, "")}`}>{p}</a>
											<br />
										</span>
									))}
								</p>
							</div>
						))}
						<hr className="divider" />
						<p className="mono muted">Email</p>
						<p>
							<a href={`mailto:${company.email}`}>{company.email}</a>
						</p>
						<p className="mono muted mt-2">{company.hours}</p>
						<div className="mt-3">
							<JourneyButton variant="secondary" />
						</div>
					</div>
				</div>
			</section>
		</>
	);
}

export function ServiceDetail() {
	const { id } = useParams<{ id: string }>();
	const service = id ? getService(id) : undefined;

	if (!service) {
		return <Navigate to="/student-services" replace />;
	}

	const related = coreServices.filter((s) => s.id !== service.id).slice(0, 3);

	return (
		<>
			<PageHeader
				eyebrow="Service"
				title={service.title}
				lead={service.description}
			/>
			<section className="section">
				<div className="container">
					<div className="detail-grid">
						<div>
							<p className="drop-cap" style={{ fontSize: "1.05rem", lineHeight: 1.7 }}>
								{service.detail}
							</p>

							<h2 className="section-title mt-6 mb-3" style={{ fontSize: "1.3rem" }}>
								What you get
							</h2>
							<ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.6rem" }}>
								{service.deliverables.map((d, i) => (
									<li
										key={i}
										style={{
											display: "flex",
											alignItems: "flex-start",
											gap: "0.6rem",
											fontSize: "0.95rem",
											borderBottom: "1px solid var(--border-light)",
											paddingBottom: "0.6rem",
										}}
									>
										<span style={{ flexShrink: 0, color: "var(--muted-foreground)" }}>→</span>
										{d}
									</li>
								))}
							</ul>

							<h2 className="section-title mt-6 mb-3" style={{ fontSize: "1.3rem" }}>
								How it works
							</h2>
							<ol style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: "0.8rem" }}>
								{service.process.map((step, i) => (
									<li
										key={i}
										style={{
											display: "flex",
											alignItems: "flex-start",
											gap: "0.8rem",
											fontSize: "0.95rem",
										}}
									>
										<span
											className="mono"
											style={{
												flexShrink: 0,
												fontSize: "0.75rem",
												color: "var(--muted-foreground)",
												border: "1px solid var(--border)",
												width: "28px",
												height: "28px",
												display: "flex",
												alignItems: "center",
												justifyContent: "center",
											}}
										>
											{String(i + 1).padStart(2, "0")}
										</span>
										{step}
									</li>
								))}
							</ol>

							<div className="row mt-6">
								<JourneyButton />
								<EnquiryButton>Enquire about this service</EnquiryButton>
							</div>
						</div>

						<aside className="detail-aside">
							<h2 className="section-title" style={{ fontSize: "1rem", marginBottom: "1rem" }}>
								At a glance
							</h2>
							<dl style={{ display: "flex", flexDirection: "column", gap: "0.85rem", margin: 0 }}>
								<div>
									<dt className="mono muted" style={{ fontSize: "0.7rem" }}>Service ID</dt>
									<dd style={{ margin: "0.2rem 0 0", fontSize: "0.9rem" }}>{service.id}</dd>
								</div>
								<div>
									<dt className="mono muted" style={{ fontSize: "0.7rem" }}>Typical duration</dt>
									<dd style={{ margin: "0.2rem 0 0", fontSize: "0.9rem" }}>{service.duration}</dd>
								</div>
								<div>
									<dt className="mono muted" style={{ fontSize: "0.7rem" }}>Deliverables</dt>
									<dd style={{ margin: "0.2rem 0 0", fontSize: "0.9rem" }}>{service.deliverables.length} items</dd>
								</div>
							</dl>

							<hr className="divider mt-4" />
							<h2 className="section-title mt-4" style={{ fontSize: "1rem", marginBottom: "0.75rem" }}>
								Other services
							</h2>
							<div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
								{related.map((s) => (
									<Link
										key={s.id}
										to={`/services/${s.id}`}
										style={{
											display: "block",
											fontSize: "0.85rem",
											padding: "0.5rem 0",
											borderBottom: "1px solid var(--border-light)",
										}}
									>
										{s.title}
									</Link>
								))}
							</div>
						</aside>
					</div>
				</div>
			</section>
		</>
	);
}
