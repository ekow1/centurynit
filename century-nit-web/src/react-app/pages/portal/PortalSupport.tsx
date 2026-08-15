import { useState } from "react";
import { useAppState } from "../../context/AppState";
import { useApplicantTickets } from "../../data/opsTicketBridge";
import type { TicketCategory } from "century-nit-core/ops";

/**
 * Support — the applicant's side of the helpdesk.
 *
 * Split view: the request list on the left, the selected conversation on the
 * right. Tickets raised here are written straight into the ops store as
 * `external`, which is what puts them in the staff triage queue, and staff
 * replies come back through the same record — one conversation, not two
 * disconnected inboxes.
 */

const CATEGORIES: { id: TicketCategory; label: string; blurb: string }[] = [
	{ id: "Application", label: "My application", blurb: "Schools, offers, or your journey stage" },
	{ id: "Documents", label: "Documents", blurb: "Uploads, verification, or a rejected file" },
	{ id: "Billing", label: "Payments", blurb: "Invoices, receipts, or a payment that didn't land" },
	{ id: "Visa", label: "Visa & travel", blurb: "Appointments, evidence, or pre-departure" },
	{ id: "Technical", label: "Something is broken", blurb: "The portal isn't working as expected" },
	{ id: "Other", label: "Something else", blurb: "Anything not covered above" },
];

export function PortalSupport() {
	const { authUser, application, booking } = useAppState();
	const { tickets: mine, createTicket, replyToTicket } = useApplicantTickets(authUser?.email);

	const [composing, setComposing] = useState(false);
	const [openId, setOpenId] = useState<string | null>(null);
	const [filter, setFilter] = useState<"open" | "all">("open");
	const [reply, setReply] = useState("");

	const [category, setCategory] = useState<TicketCategory | null>(null);
	const [subject, setSubject] = useState("");
	const [body, setBody] = useState("");

	const me = authUser?.name ?? "Applicant";
	const myRef = application.applicationId ?? booking.confirmationId ?? undefined;

	/* `mine` comes from useApplicantTickets above — already scoped to this
	 * applicant's own external tickets and sorted newest first. */

	const listed = filter === "all" ? mine : mine.filter((t) => t.status !== "Resolved");

	/**
	 * Derived, not synchronised: with nothing explicitly selected the newest
	 * request opens by default, so the right pane is never blank when the
	 * applicant has history. An effect here would just be state chasing props.
	 */
	const active = openId ? (mine.find((t) => t.id === openId) ?? null) : (listed[0] ?? null);

	function submit(e: React.FormEvent) {
		e.preventDefault();
		if (!category || !subject.trim() || !body.trim()) return;
		createTicket({
			title: subject.trim(),
			description: body.trim(),
			category,
			createdBy: me,
			createdByEmail: authUser?.email ?? "",
			applicantRef: myRef,
		});
		setCategory(null);
		setSubject("");
		setBody("");
		setComposing(false);
		setOpenId(null);
	}

	return (
		<div className="portal-page">
			<header className="portal-page__header sup-header">
				<div>
					<p className="eyebrow">Support</p>
					<h1 className="page-title mt-1">Get help</h1>
					<p className="lead mt-2">
						Raise a request and our team will pick it up. You'll see every reply here.
					</p>
				</div>
				<button
					type="button"
					className="btn btn--primary"
					onClick={() => {
						setComposing(true);
						setOpenId(null);
					}}
				>
					Raise a request →
				</button>
			</header>

			<div className="sup-split mt-5">
				{/* Requests */}
				<aside className="sup-pane sup-pane--list">
					<div className="sup-pane__head">
						<span className="eyebrow">Your requests</span>
						<div className="sup-filter">
							{(["open", "all"] as const).map((f) => (
								<button
									key={f}
									type="button"
									className={`sup-filter__btn${filter === f ? " sup-filter__btn--on" : ""}`}
									onClick={() => setFilter(f)}
								>
									{f === "open" ? "Open" : "All"}
								</button>
							))}
						</div>
					</div>

					<div className="sup-pane__body">
						{listed.length === 0 ? (
							<p className="sup-none muted">
								{filter === "open" ? "Nothing open right now." : "No requests yet."}
							</p>
						) : (
							listed.map((t) => (
								<button
									key={t.id}
									type="button"
									className={`sup-row${active?.id === t.id && !composing ? " sup-row--active" : ""}`}
									onClick={() => {
										setOpenId(t.id);
										setComposing(false);
										setReply("");
									}}
								>
									<span className="sup-row__top">
										<span className="sup-row__ref mono">{t.ref}</span>
										<span className={`sup-status sup-status--${t.status.toLowerCase().replace(/\s+/g, "-")}`}>
											{t.status}
										</span>
									</span>
									<span className="sup-row__title">{t.title}</span>
									<span className="sup-row__meta mono">
										{t.category} · {new Date(t.updatedAt).toLocaleDateString()}
									</span>
								</button>
							))
						)}
					</div>
				</aside>

				{/* Detail */}
				<section className="sup-pane sup-pane--detail">
					{composing ? (
						<form className="sup-compose" onSubmit={submit}>
							<div className="sup-pane__head">
								<span className="eyebrow">New request</span>
								<button type="button" className="btn btn--ghost btn--sm" onClick={() => setComposing(false)}>
									Cancel
								</button>
							</div>

							<div className="sup-pane__body sup-compose__body">
								<p className="eyebrow">What do you need help with?</p>
								<div className="sup-cats mt-2">
									{CATEGORIES.map((c) => (
										<button
											key={c.id}
											type="button"
											className={`sup-cat${category === c.id ? " sup-cat--on" : ""}`}
											onClick={() => setCategory(c.id)}
										>
											<span className="sup-cat__label">{c.label}</span>
											<span className="sup-cat__blurb">{c.blurb}</span>
										</button>
									))}
								</div>

								<label className="sup-field mt-4">
									<span className="eyebrow">Subject</span>
									<input
										className="input"
										value={subject}
										onChange={(e) => setSubject(e.target.value)}
										placeholder="A one-line summary"
									/>
								</label>

								<label className="sup-field mt-3">
									<span className="eyebrow">Tell us what happened</span>
									<textarea
										className="input"
										rows={6}
										value={body}
										onChange={(e) => setBody(e.target.value)}
										placeholder="Include anything that would help — dates, reference numbers, what you expected."
									/>
								</label>
							</div>

							<div className="sup-pane__foot">
								<button
									type="submit"
									className="btn btn--primary btn--sm"
									disabled={!category || !subject.trim() || !body.trim()}
								>
									Send request
								</button>
								{!category ? <span className="mono muted sup-hint">Pick a category to continue</span> : null}
							</div>
						</form>
					) : active ? (
						<>
							<div className="sup-thread__head">
								<div style={{ minWidth: 0 }}>
									<p className="sup-thread__title display">{active.title}</p>
									<p className="mono muted sup-thread__meta">
										{active.ref} · {active.category} ·{" "}
										{active.assignedTo ? `Handled by ${active.assignedTo}` : "Awaiting a handler"}
									</p>
								</div>
								<span className={`sup-status sup-status--${active.status.toLowerCase().replace(/\s+/g, "-")}`}>
									{active.status}
								</span>
							</div>

							<div className="sup-pane__body sup-thread">
								{active.messages.map((m) => (
									<div key={m.id} className={`sup-msg sup-msg--${m.role}`}>
										<p className="sup-msg__body">{m.body}</p>
										<p className="sup-msg__meta mono">
											{m.role === "applicant" ? "You" : m.author} ·{" "}
											{new Date(m.at).toLocaleString()}
										</p>
									</div>
								))}
							</div>

							{active.status !== "Resolved" ? (
								<div className="sup-pane__foot sup-reply">
									<textarea
										className="input"
										rows={3}
										value={reply}
										onChange={(e) => setReply(e.target.value)}
										placeholder="Add to this request…"
									/>
									<button
										type="button"
										className="btn btn--primary btn--sm mt-2"
										disabled={!reply.trim()}
										onClick={() => {
											replyToTicket(active.id, reply.trim(), me);
											setReply("");
										}}
									>
										Send
									</button>
								</div>
							) : (
								<div className="sup-pane__foot">
									<p className="mono muted sup-hint">
										This request is closed. Raise a new one if you still need help.
									</p>
								</div>
							)}
						</>
					) : (
						/* Nothing selected — offer the other routes rather than dead space */
						<div className="sup-blank">
							<p className="sup-blank__title display">How can we help?</p>
							<p className="muted sup-blank__body">
								Raise a request and it appears here with the full conversation, so you can pick
								up where you left off.
							</p>
							<ul className="sup-alt__list">
								<li>
									<span className="sup-alt__label">Your consultant</span>
									<span className="sup-alt__value">
										{booking.consultantName ?? "Assigned after your consultation"}
									</span>
								</li>
								<li>
									<span className="sup-alt__label">Email</span>
									<a className="sup-alt__value sup-alt__link" href="mailto:support@centurynit.com">
										support@centurynit.com
									</a>
								</li>
								<li>
									<span className="sup-alt__label">Phone</span>
									<a className="sup-alt__value sup-alt__link" href="tel:+233302000000">
										+233 30 200 0000
									</a>
								</li>
								<li>
									<span className="sup-alt__label">Hours</span>
									<span className="sup-alt__value">Mon–Fri 09:00–17:00 GMT</span>
								</li>
							</ul>
						</div>
					)}
				</section>
			</div>
		</div>
	);
}
