import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "./ui/Button";

export type HeroSlide = {
	id: string;
	kicker: string;
	title: string;
	titleEm?: string;
	lead: string;
	image: string;
	imageAlt: string;
	primary: { label: string; to: string };
	secondary: { label: string; to: string };
	meta: { label: string; value: string }[];
};

const AUTO_MS = 6000;
const FADE_MS = 700;

type Props = {
	slides: HeroSlide[];
};

export function HeroCarousel({ slides }: Props) {
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	const [animKey, setAnimKey] = useState(0);
	const indexRef = useRef(0);
	const pausedRef = useRef(false);
	const touchX = useRef<number | null>(null);
	const transitioning = useRef(false);

	// Keep refs in sync without restarting timers
	useEffect(() => {
		pausedRef.current = paused;
	}, [paused]);

	// Preload images so transitions never flash empty frames
	useEffect(() => {
		slides.forEach((s) => {
			const img = new Image();
			img.src = s.image;
		});
	}, [slides]);

	const go = useCallback(
		(nextIndex: number) => {
			const len = slides.length;
			if (len < 2) return;
			const resolved = ((nextIndex % len) + len) % len;
			if (resolved === indexRef.current) return;
			if (transitioning.current) return;

			transitioning.current = true;
			indexRef.current = resolved;
			setIndex(resolved);
			setAnimKey((k) => k + 1);

			window.setTimeout(() => {
				transitioning.current = false;
			}, FADE_MS);
		},
		[slides.length],
	);

	const next = useCallback(() => go(indexRef.current + 1), [go]);
	const prev = useCallback(() => go(indexRef.current - 1), [go]);

	// Single stable autoplay loop - never torn down on pause
	useEffect(() => {
		if (slides.length < 2) return;
		if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

		const id = window.setInterval(() => {
			if (pausedRef.current || document.hidden || transitioning.current) return;
			go(indexRef.current + 1);
		}, AUTO_MS);

		return () => window.clearInterval(id);
	}, [go, slides.length]);

	useEffect(() => {
		function onKey(e: KeyboardEvent) {
			const target = e.target as HTMLElement | null;
			if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
			if (e.key === "ArrowRight") next();
			if (e.key === "ArrowLeft") prev();
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [next, prev]);

	return (
		<section
			className={`hero-carousel texture-lines${paused ? " hero-carousel--paused" : ""}`}
			aria-roledescription="carousel"
			aria-label="Featured stories"
			onTouchStart={(e) => {
				touchX.current = e.changedTouches[0]?.clientX ?? null;
			}}
			onTouchEnd={(e) => {
				if (touchX.current == null) return;
				const dx = (e.changedTouches[0]?.clientX ?? 0) - touchX.current;
				touchX.current = null;
				if (Math.abs(dx) < 48) return;
				if (dx < 0) next();
				else prev();
			}}
		>
			<div className="hero-carousel__viewport">
				{slides.map((slide, i) => {
					const active = i === index;
					const TitleTag = active ? "h1" : "p";
					return (
						<article
							key={slide.id}
							className={`hero-slide${active ? " hero-slide--active" : ""}`}
							aria-hidden={!active}
							aria-roledescription="slide"
							aria-label={`${i + 1} of ${slides.length}`}
						>
							<div className="hero-slide__copy">
								<div className="hero-slide__kicker">
									<span className="hero-slide__index">
										{String(i + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")}
									</span>
									<span className="hero-slide__rule" aria-hidden />
									<span className="eyebrow">{slide.kicker}</span>
								</div>
								<TitleTag className="hero-slide__title">
									{slide.title}
									{slide.titleEm ? (
										<>
											{" "}
											<em>{slide.titleEm}</em>
										</>
									) : null}
								</TitleTag>
								<p className="hero-slide__lead">{slide.lead}</p>
								<div className="hero-slide__actions">
									<Button to={slide.primary.to} arrow>
										{slide.primary.label}
									</Button>
									<Button to={slide.secondary.to} variant="secondary">
										{slide.secondary.label}
									</Button>
								</div>
								{slide.meta.length > 0 ? (
									<dl className="hero-slide__meta">
										{slide.meta.map((m) => (
											<div key={m.label}>
												<dt>{m.label}</dt>
												<dd>{m.value}</dd>
											</div>
										))}
									</dl>
								) : null}
							</div>
							<div className="hero-slide__media">
								<img
									src={slide.image}
									alt={active ? slide.imageAlt : ""}
									draggable={false}
									loading={i === 0 ? "eager" : "lazy"}
									decoding="async"
								/>
							</div>
						</article>
					);
				})}
			</div>

			<div
				className="hero-carousel__controls"
				onMouseEnter={() => setPaused(true)}
				onMouseLeave={() => setPaused(false)}
				onFocusCapture={() => setPaused(true)}
				onBlurCapture={(e) => {
					if (!e.currentTarget.contains(e.relatedTarget as Node)) setPaused(false);
				}}
			>
				<div className="hero-carousel__controls-inner">
					<div className="hero-carousel__nav">
						<button
							type="button"
							className="hero-carousel__btn"
							onClick={prev}
							aria-label="Previous slide"
						>
							←
						</button>
						<button
							type="button"
							className="hero-carousel__btn"
							onClick={next}
							aria-label="Next slide"
						>
							→
						</button>
					</div>

					<div className="hero-carousel__dots" role="tablist" aria-label="Select slide">
						{slides.map((s, i) => (
							<button
								key={s.id}
								type="button"
								role="tab"
								aria-selected={i === index}
								className={`hero-carousel__dot${i === index ? " hero-carousel__dot--active" : ""}`}
								onClick={() => go(i)}
							>
								{String(i + 1).padStart(2, "0")} · {s.kicker}
							</button>
						))}
					</div>

					<div className="hero-carousel__progress-wrap" aria-hidden>
						<span className="hero-carousel__progress-label">
							{paused ? "Paused" : "Autoplay"}
						</span>
						<div className="hero-carousel__progress">
							<div
								key={animKey}
								className="hero-carousel__progress-bar"
								style={{ animationDuration: `${AUTO_MS}ms` }}
							/>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}
