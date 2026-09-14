import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
	DEFAULT_POST_ARRIVAL_CATALOGUE,
	DEFAULT_SERVICE_FEE_SPLIT,
	POST_ARRIVAL_FREQUENCY_LABELS,
	postArrivalInstalments,
	type ApiInvoice,
	type PostArrivalFrequency,
} from "century-nit-shared";
import { formatMoney } from "century-nit-core/ui";
import { meApi, ApiError } from "century-nit-core/api";
import { Button } from "../../components/ui/Button";
import { useAppState } from "../../context/AppState";
import { useNotifier } from "../../components/notifier/Notifier";
import { ChapterGate } from "./PortalLayout";

/**
 * Chapter V · Fees before you go. The service fee as the ledger carries it:
 * the deposit (paid at enrolment), the pre-departure milestone — due once
 * the visa is approved, it releases the travel documents — and the
 * post-arrival remainder, spread over a duration and frequency the client
 * picks here and paid as dated instalments. The flight never waits on any
 * of it.
 */
export function PortalFeesChapter() {
	return (
		<ChapterGate chapter="payment_execution">
			<FeesChapterInner />
		</ChapterGate>
	);
}

const ghs = (cents: number) => formatMoney(cents, "ghs");
const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : null);
const shortDay = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" }) : null);

function FeesChapterInner() {
	const { application, booking, fees, payAgencyInstallment, syncFromServer, syncTick } = useAppState();
	const { toast } = useNotifier();
	const [invoice, setInvoice] = useState<ApiInvoice | null>(null);
	const [loading, setLoading] = useState(true);
	const [paying, setPaying] = useState(false);
	const [months, setMonths] = useState<number | null>(application.postArrivalMonths ?? null);
	const [frequency, setFrequency] = useState<PostArrivalFrequency | null>((application.postArrivalFrequency as PostArrivalFrequency | null) ?? null);
	const [savingSchedule, setSavingSchedule] = useState(false);

	useEffect(() => {
		let cancelled = false;
		meApi
			.invoices({ type: "agency" })
			.then((res) => {
				if (cancelled) return;
				const live = res.invoices.filter((i) => i.status !== "void").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
				setInvoice(live[0] ?? null);
			})
			.catch(() => {})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [syncTick]);

	useEffect(() => {
		setMonths(application.postArrivalMonths ?? null);
		setFrequency((application.postArrivalFrequency as PostArrivalFrequency | null) ?? null);
	}, [application.postArrivalMonths, application.postArrivalFrequency]);

	const split = fees?.catalogue.serviceFeeSplit ?? DEFAULT_SERVICE_FEE_SPLIT;
	const catalogue = fees?.catalogue.postArrival ?? DEFAULT_POST_ARRIVAL_CATALOGUE;
	const plan = application.paymentPlanId;
	const isInstalments = plan === "installment";
	const reference = application.appNumber ?? booking.confirmationId ?? null;
	const handler = application.assignedStaffName ?? null;
	const handlerFirst = handler ? handler.split(" ")[0] : "your consultant";

	// The lines, each covered or not by the payments so far.
	const rows = useMemo(() => {
		if (!invoice) return [];
		let cum = 0;
		const lastPay = [...invoice.payments].sort((a, b) => b.at.localeCompare(a.at))[0];
		return invoice.lines.map((l, i) => {
			const before = cum;
			cum += l.amountCents;
			const covered = invoice.paidCents >= cum;
			const remaining = covered ? 0 : cum - Math.max(invoice.paidCents, before);
			const isNext = !covered && invoice.paidCents >= before;
			const days = l.dueAt ? Math.round((new Date(l.dueAt).getTime() - new Date().getTime()) / 86_400_000) : null;
			return { l, i, covered, remaining, isNext, days, paidAt: covered ? (lastPay?.at ?? null) : null };
		});
	}, [invoice]);
	const deposit = rows[0] ?? null;
	const milestone = rows[1] ?? null;
	const postRows = rows.slice(2);
	const postCents = postRows.reduce((n, r) => n + r.l.amountCents, 0);
	const postPaid = postRows.filter((r) => r.covered).length;
	const scheduleLocked = postRows.some((r) => r.covered || (invoice ? invoice.paidCents > (deposit?.l.amountCents ?? 0) + (milestone?.l.amountCents ?? 0) : false));
	const milestoneDone = Boolean(milestone?.covered);
	const dueNow = rows.find((r) => r.isNext) ?? null;
	const total = invoice?.subtotalCents ?? 0;
	const paidPct = total > 0 && invoice ? Math.round((invoice.paidCents / total) * 100) : 0;

	// The schedule preview from the catalogue's maths — dates only once arrival is known.
	const preview = useMemo(() => {
		if (!months || !frequency || postCents <= 0) return [];
		return postArrivalInstalments({ amountCents: postCents, months, frequency, anchor: null, graceDays: catalogue.graceDays });
	}, [months, frequency, postCents, catalogue.graceDays]);
	const chosen = Boolean(application.postArrivalMonths && application.postArrivalFrequency);
	const dirty = months !== (application.postArrivalMonths ?? null) || frequency !== (application.postArrivalFrequency ?? null);

	async function pay() {
		setPaying(true);
		try {
			await payAgencyInstallment();
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Could not start the payment. Please try again.");
			setPaying(false);
		}
	}

	async function keepSchedule() {
		if (!months || !frequency) return;
		setSavingSchedule(true);
		try {
			await meApi.choosePostArrivalSchedule({ months, frequency });
			await syncFromServer();
			toast.success("Your schedule is set. The instalments are on your service-fee invoice.");
		} catch (err) {
			toast.error(err instanceof ApiError ? err.message : "Could not save your schedule.");
		} finally {
			setSavingSchedule(false);
		}
	}

	const now = !plan
		? "choose your payment plan"
		: milestoneDone
			? postRows.length > 0 && postPaid < postRows.length
				? dueNow?.l.dueAt
					? `instalment ${postPaid + 1} of ${postRows.length} · ${ghs(dueNow.remaining)} · due ${shortDay(dueNow.l.dueAt)}`
					: chosen
						? "your schedule starts after you arrive"
						: "choose how to spread the rest"
				: "your service fee is settled"
			: milestone
				? `pay the pre-departure milestone · ${ghs(milestone.remaining)}`
				: "your service-fee invoice is being raised";

	const stepState = (k: 0 | 1 | 2) => {
		const r = k === 2 ? (postRows.length > 0 ? { covered: postPaid === postRows.length } : null) : rows[k] ?? null;
		if (!r) return "later";
		if (r.covered) return "done";
		return k === 0 || (k === 1 && deposit?.covered) || (k === 2 && milestoneDone) ? "on" : "later";
	};

	return (
		<div className="portal-page">
			<header className="portal-page__header">
				<div>
					<p className="eyebrow">Chapter V · Departure · Fees</p>
					<h1 className="page-title mt-1">Fees before you go</h1>
					<p className="lead mt-2">
						{milestoneDone
							? "Your pre-departure milestone is paid and your travel documents are released. What remains follows the schedule you chose."
							: "Your visa is approved. The pre-departure milestone releases your admission letter, your visa documents and your e-ticket. Your flight is being booked meanwhile — it does not wait on this."}
					</p>
				</div>
				{reference || handler ? (
					<p className="pref">
						{reference}
						{reference && handler ? <br /> : null}
						{handler ? `Handler ${handler}` : null}
					</p>
				) : null}
			</header>

			<div className="pday">
				<span className="pday__now">Now · {now}</span>
				<span>
					<strong>{split.depositPercent}%</strong> {deposit?.covered ? "paid" : "deposit"}
				</span>
				{isInstalments ? (
					<>
						<span>
							<strong>{split.preDeparturePercent}%</strong> {milestoneDone ? "paid" : "after your visa"}
						</span>
						<span>
							<strong>{split.postArrivalPercent}%</strong> after arrival
						</span>
					</>
				) : plan === "full" ? (
					<span>
						<strong>{100 - split.depositPercent}%</strong> {milestoneDone ? "paid" : "after your visa"}
					</span>
				) : null}
				{plan ? <span>{isInstalments ? "instalment plan" : "full payment"}</span> : null}
				{invoice ? <span>{paidPct}% paid</span> : null}
			</div>

			<div className="psteps4" style={{ gridTemplateColumns: `repeat(${isInstalments ? 3 : 2}, minmax(0, 1fr))` }}>
				{[
					{ label: `Deposit · ${split.depositPercent}%`, fact: deposit?.covered ? `paid${deposit.paidAt ? ` ${shortDay(deposit.paidAt)}` : ""}` : deposit ? ghs(deposit.remaining) : "" },
					{ label: isInstalments ? `Pre-departure · ${split.preDeparturePercent}%` : `Balance · ${100 - split.depositPercent}%`, fact: milestone ? (milestone.covered ? `paid${milestone.paidAt ? ` ${shortDay(milestone.paidAt)}` : ""}` : ghs(milestone.remaining)) : "" },
					...(isInstalments ? [{ label: `Post-arrival · ${split.postArrivalPercent}%`, fact: postRows.length > 0 ? `${postPaid} of ${postRows.length}` : chosen ? `${application.postArrivalMonths} months` : "" }] : []),
				].map((st, i) => {
					const state = stepState(i as 0 | 1 | 2);
					return (
						<div key={st.label} className={`pstep${state === "done" ? " pstep--done" : state === "on" ? " pstep--on" : ""}`}>
							<span className="pstep__m">{state === "done" ? "✓" : i + 1}</span>
							<span className="pstep__l">{st.label}</span>
							{st.fact ? <span className="pstep__s">{st.fact}</span> : null}
						</div>
					);
				})}
			</div>

			<div className="psplit mt-5">
				<div>
					{!plan ? (
						<section className="psec">
							<div className="psec__h">
								<span className="psec__no">1</span>
								<span className="psec__title">Choose your payment plan</span>
							</div>
							<p className="psec__later">
								Your plan is chosen on your enrolment page. <Link to="/portal/package" className="plnk">Open enrolment →</Link>
							</p>
						</section>
					) : null}

					{/* 2 · the milestone */}
					<section className={`psec${milestoneDone || !milestone ? " psec--later" : ""}`}>
						<div className="psec__h">
							<span className={`psec__no${milestoneDone ? " psec__no--done" : !milestone ? " psec__no--later" : ""}`}>{milestoneDone ? "✓" : "2"}</span>
							<span className="psec__title">{isInstalments ? "The pre-departure milestone" : "The balance"}</span>
							<span className="psec__hint">
								{milestone ? `${isInstalments ? split.preDeparturePercent : 100 - split.depositPercent}% of ${ghs(total)}` : loading ? "loading" : "not raised yet"}
							</span>
						</div>
						{!milestone ? (
							<p className="psec__later">{loading ? "Reading your ledger…" : `Your service-fee invoice is raised by ${handlerFirst} once your plan is on file.`}</p>
						) : milestoneDone ? (
							<p className="psec__later">
								Paid{milestone.paidAt ? ` ${day(milestone.paidAt)}` : ""} — your admission letter, visa documents and e-ticket are released. <Link to="/portal/documents" className="plnk">Documents →</Link>
							</p>
						) : (
							<div className="sharp-card sharp-card--key">
								<div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "1rem", flexWrap: "wrap" }}>
									<span className="amt">
										{ghs(milestone.remaining)}
										{milestone.remaining !== milestone.l.amountCents ? <small>of {ghs(milestone.l.amountCents)}</small> : null}
									</span>
									<span className="psec__hint" style={{ margin: 0 }}>due before your documents are released</span>
								</div>
								<p className="pfoot__note mt-2">
									Paying this releases everything you need to travel. Your flight is booked by your departure officer whichever comes first.
								</p>
								<div className="rel">
									<div>
										<b>Releases</b>Admission letter
									</div>
									<div>
										<b>Releases</b>Visa documents
									</div>
									<div>
										<b>Releases</b>E-ticket handover
									</div>
								</div>
								<div className="pfoot" style={{ marginTop: "0.8rem" }}>
									<Button type="button" onClick={() => void pay()} disabled={paying || !deposit?.covered} arrow>
										{paying ? "Connecting to Paystack…" : `Pay ${ghs(milestone.remaining)}`}
									</Button>
									<span className="pfoot__note">{deposit?.covered ? "Paystack · card or mobile money · exactly this milestone, nothing more." : "Your deposit comes first — pay it from your enrolment page."}</span>
								</div>
							</div>
						)}
					</section>

					{/* 3 · after you arrive */}
					{isInstalments && (
						<section className={`psec${postCents <= 0 ? " psec--later" : ""}`}>
							<div className="psec__h">
								<span className={`psec__no${postRows.length > 0 && postPaid === postRows.length ? " psec__no--done" : postCents <= 0 ? " psec__no--later" : ""}`}>
									{postRows.length > 0 && postPaid === postRows.length ? "✓" : "3"}
								</span>
								<span className="psec__title">After you arrive · the remaining {split.postArrivalPercent}%</span>
								<span className="psec__hint">{postCents > 0 ? `${ghs(postCents)} · ${chosen && !scheduleLocked ? "change until the first instalment" : chosen ? "on your schedule" : "choose how"}` : ""}</span>
							</div>
							{postCents <= 0 ? (
								<p className="psec__later">Nothing remains after arrival on this invoice.</p>
							) : scheduleLocked ? (
								<div className="sharp-card sharp-card--soft">
									<span className="psec__hint" style={{ margin: 0 }}>
										Your schedule · {postRows.length} × {ghs(postRows[0]?.l.amountCents ?? 0)} · {application.postArrivalFrequency ? POST_ARRIVAL_FREQUENCY_LABELS[application.postArrivalFrequency as PostArrivalFrequency]?.toLowerCase() : ""}
									</span>
									<InstalmentRows rows={postRows} onPay={() => void pay()} paying={paying} />
								</div>
							) : (
								<>
									<p className="pfoot__note">
										Pick how long to spread it over and how often you pay. Your first instalment falls {catalogue.graceDays} days after you arrive. You can change this until then.
									</p>
									<p className="psec__hint" style={{ margin: "0.2rem 0 0" }}>Over</p>
									<div className="pchips">
										{catalogue.durations.map((m) => {
											const count = frequency ? postArrivalInstalments({ amountCents: postCents, months: m, frequency, anchor: null, graceDays: 0 }).length : m;
											return (
												<button key={m} type="button" className={`pchip${months === m ? " pchip--on" : ""}`} onClick={() => setMonths(m)} aria-pressed={months === m}>
													{m} months
													<small>{ghs(Math.floor(postCents / count))} × {count}</small>
												</button>
											);
										})}
									</div>
									<p className="psec__hint" style={{ margin: "0.6rem 0 0" }}>Paid</p>
									<div className="pchips">
										{catalogue.frequencies.map((f) => {
											const count = months ? postArrivalInstalments({ amountCents: postCents, months, frequency: f, anchor: null, graceDays: 0 }).length : null;
											return (
												<button key={f} type="button" className={`pchip${frequency === f ? " pchip--on" : ""}`} onClick={() => setFrequency(f)} aria-pressed={frequency === f}>
													{POST_ARRIVAL_FREQUENCY_LABELS[f]}
													<small>{count ? `${count} payments` : "pick a duration"}</small>
												</button>
											);
										})}
									</div>
									{preview.length > 0 && (
										<div className="sharp-card sharp-card--soft mt-3">
											<span className="psec__hint" style={{ margin: 0 }}>
												Your schedule · {preview.length} × {ghs(preview[0].amountCents)} · {frequency ? POST_ARRIVAL_FREQUENCY_LABELS[frequency].toLowerCase() : ""} · from {catalogue.graceDays} days after arrival
											</span>
											<div className="inst mt-2">
												{(postRows.length === preview.length && postRows.some((r) => r.l.dueAt) && !dirty ? postRows.map((r) => ({ n: r.i - 1, amount: r.l.amountCents, dueAt: r.l.dueAt })) : preview.map((p) => ({ n: p.n, amount: p.amountCents, dueAt: p.dueAt }))).slice(0, 4).map((p) => (
													<div key={p.n} className="inst__r">
														<span className="inst__i">{p.n} / {preview.length}</span>
														<span className="inst__d">{day(p.dueAt) ?? (p.n === 1 ? `${catalogue.graceDays} days after arrival` : "then on schedule")}</span>
														<span>Post-arrival instalment</span>
														<span className="inst__a">{ghs(p.amount)}</span>
													</div>
												))}
												{preview.length > 4 && (
													<div className="inst__r">
														<span className="inst__i">…</span>
														<span className="inst__d">to instalment {preview.length}</span>
														<span />
														<span className="inst__a" />
													</div>
												)}
											</div>
											<div className="pfoot" style={{ marginTop: "0.6rem" }}>
												<Button type="button" variant="secondary" onClick={() => void keepSchedule()} disabled={savingSchedule || !dirty}>
													{savingSchedule ? "Saving…" : chosen ? "Keep this change" : "Keep this schedule"}
												</Button>
												<span className="pfoot__note">A reminder comes {catalogue.remindDays} days before each one; you can pay early at any time.</span>
											</div>
										</div>
									)}
									{chosen && !dirty && postRows.length > 0 && (
										<div className="sharp-card sharp-card--soft mt-3">
											<span className="psec__hint" style={{ margin: 0 }}>Your schedule as it stands</span>
											<InstalmentRows rows={postRows} onPay={() => void pay()} paying={paying} />
										</div>
									)}
								</>
							)}
						</section>
					)}
				</div>

				<div className="prail">
					<div className="prail__ink">
						<p className="prail__ink-k">Your position</p>
						<p className="prail__ink-big">{dueNow ? `${ghs(dueNow.remaining)} due` : invoice ? "Settled" : "—"}</p>
						<p className="prail__ink-s">
							{split.depositPercent}% {deposit?.covered ? "paid" : "due"} · {isInstalments ? `${split.preDeparturePercent}% ${milestoneDone ? "paid" : "due"} · ${split.postArrivalPercent}% after arrival` : `${100 - split.depositPercent}% ${milestoneDone ? "paid" : "due"}`}
						</p>
					</div>
					{dueNow && deposit?.covered && (
						<div className="sharp-card">
							<Button type="button" onClick={() => void pay()} disabled={paying} arrow>
								{paying ? "Connecting…" : `Pay ${ghs(dueNow.remaining)}`}
							</Button>
							<p className="prail__note">
								{dueNow.i === 1 ? "Releases your admission letter, visa documents and e-ticket. Your flight is booked meanwhile." : dueNow.l.dueAt ? `Instalment ${dueNow.i - 1} of ${postRows.length} · due ${day(dueNow.l.dueAt)}.` : "Your next instalment — dated once you arrive."}
							</p>
						</div>
					)}
					{invoice && (
						<div className="sharp-card">
							<p className="eyebrow">Your service fee</p>
							<div style={{ marginTop: "0.4rem" }}>
								<div className="pkv">
									<span className="pkv__k">Service fee</span>
									<span className="pkv__v">{ghs(total)}</span>
								</div>
								{rows.slice(0, 2).map((r) => (
									<div key={r.l.id} className={`pkv${r.isNext ? " pkv--due" : ""}`}>
										<span className="pkv__k">
											{r.l.label.replace(/^Service fee · /, "")}
											{r.covered ? ` · paid${r.paidAt ? ` ${shortDay(r.paidAt)}` : ""}` : r.isNext ? " · due now" : ""}
										</span>
										<span className="pkv__v">{ghs(r.l.amountCents)}</span>
									</div>
								))}
								{isInstalments && postCents > 0 && (
									<div className="pkv">
										<span className="pkv__k">Post-arrival{chosen ? ` · ${postRows.length || preview.length} ${application.postArrivalFrequency ? POST_ARRIVAL_FREQUENCY_LABELS[application.postArrivalFrequency as PostArrivalFrequency]?.toLowerCase() : ""}` : ""}</span>
										<span className="pkv__v">{ghs(postCents)}</span>
									</div>
								)}
								<div className="pkv">
									<span className="pkv__k">Plan</span>
									<span className="pkv__v">{isInstalments ? "Instalments" : "Full payment"}</span>
								</div>
								<div className="pkv">
									<span className="pkv__k">Invoice</span>
									<span className="pkv__v">{invoice.invoiceNumber}</span>
								</div>
							</div>
						</div>
					)}
					<div className="sharp-card sharp-card--soft">
						<p className="eyebrow">Meanwhile</p>
						<p className="prail__note" style={{ marginTop: "0.3rem" }}>
							Your departure officer is booking your flight — the ticket invoice lands in Money when it is ready, whether or not this milestone is paid. <Link to="/portal/pre-departure" className="plnk">Departure →</Link>
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

function InstalmentRows({
	rows,
	onPay,
	paying,
}: {
	rows: { l: ApiInvoice["lines"][number]; i: number; covered: boolean; remaining: number; isNext: boolean; days: number | null; paidAt: string | null }[];
	onPay: () => void;
	paying: boolean;
}) {
	return (
		<div className="inst mt-2">
			{rows.map((r) => (
				<div key={r.l.id} className={`inst__r${r.covered ? " inst__r--paid" : r.isNext ? " inst__r--due" : ""}`}>
					<span className="inst__i">{r.i - 1} / {rows.length}</span>
					<span className="inst__d">{day(r.l.dueAt) ?? "after arrival"}</span>
					<span>Post-arrival instalment</span>
					<span className="inst__a">{ghs(r.l.amountCents)}</span>
					<span className="inst__s">
						{r.covered ? (
							`✓ paid${r.paidAt ? ` ${shortDay(r.paidAt)}` : ""}`
						) : r.isNext ? (
							<>
								{r.days !== null ? (r.days < 0 ? `${-r.days} days late · ` : r.days === 0 ? "due today · " : `due in ${r.days} days · `) : ""}
								<button type="button" className="plnk" onClick={onPay} disabled={paying}>
									Pay →
								</button>
							</>
						) : (
							""
						)}
					</span>
				</div>
			))}
		</div>
	);
}
