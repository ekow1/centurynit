import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { API_PREFIX } from "century-nit-shared";
import { Button } from "../ui/Button";
import { Input } from "../ui/Field";
import { EnquiryButton } from "../EnquiryContext";
import { company } from "century-nit-core";

export function Footer() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`${API_PREFIX}/newsletter/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: trimmed, name: "" }),
        credentials: "include",
      });
      if (!response.ok) {
        // API errors are shaped { error: { code, message } }
        let errorMsg = "Failed to subscribe";
        try {
          const err = await response.json();
          errorMsg = err?.error?.message ?? err?.message ?? errorMsg;
        } catch (_) {/* ignore */}
        setError(errorMsg);
        return;
      }
      // Assuming the API returns {ok:true, message:...} on success
      setDone(true);
      setEmail("");
    } catch (err) {
      console.error(err);
      setError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <footer className="footer texture-lines-light">
      <div className="container">
        <div className="footer__grid">
          <div>
            <div className="footer__brand">Century NIT</div>
            <p style={{ color: "rgba(255,255,255,0.7)", maxWidth: "28rem", marginBottom: "1rem" }}>
              {company.summary}
            </p>
            <p className="mono" style={{ color: "rgba(255,255,255,0.55)", marginBottom: "1.5rem" }}>
              Since {company.founded} · {company.base}
            </p>
            <form className="newsletter" onSubmit={onSubmit} aria-label="Newsletter signup">
              {done ? (
                <p className="mono" style={{ color: "rgba(255,255,255,0.85)" }}>
                  Subscribed - welcome to the list.
                </p>
              ) : (
                <>
                  {error && <p className="mono" style={{ color: "rgba(255,0,0,0.8)" }}>{error}</p>}
                  <Input
                    type="email"
                    placeholder="Email for insights"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    aria-label="Email address"
                    style={{ background: "#fff", color: "#000" }}
                    fullBorder
                  />
                  <Button type="submit" variant="inverted" disabled={submitting}>
                    {submitting ? "Subscribing…" : "Subscribe"}
                  </Button>
                </>
              )}
            </form>
          </div>

					<div className="footer__col">
						<h4>Explore</h4>
						<ul>
							<li>
								<Link to="/destinations">Study abroad</Link>
							</li>
							<li>
								<Link to="/visa-services">Visa services</Link>
							</li>
							<li>
								<Link to="/student-services">Student services</Link>
							</li>
							<li>
								<Link to="/red-seat">Red Seat</Link>
							</li>
							<li>
								<EnquiryButton
									variant="secondary"
									size="sm"
									style={{
										background: "transparent",
										borderColor: "rgba(255,255,255,0.3)",
										color: "#fff",
										padding: "0.25rem 0",
										border: "none",
									}}
								>
									Enquire
								</EnquiryButton>
							</li>
						</ul>
					</div>

					<div className="footer__col">
						<h4>Accra</h4>
						<ul>
							<li>
								<span style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.9rem" }}>
									{company.branches[0].address}
								</span>
							</li>
							{company.branches[0].phones.map((p) => (
								<li key={p}>
									<a href={`tel:${p.replace(/\s/g, "")}`}>{p}</a>
								</li>
							))}
							<li>
								<a href={`mailto:${company.email}`}>{company.email}</a>
							</li>
						</ul>
					</div>

					<div className="footer__col">
						<h4>Kumasi</h4>
						<ul>
							<li>
								<span style={{ color: "rgba(255,255,255,0.75)", fontSize: "0.9rem" }}>
									{company.branches[1].address}
								</span>
							</li>
							{company.branches[1].phones.map((p) => (
								<li key={p}>
									<a href={`tel:${p.replace(/\s/g, "")}`}>{p}</a>
								</li>
							))}
							<li>
								<span style={{ color: "rgba(255,255,255,0.55)", fontSize: "0.85rem" }}>
									{company.hours}
								</span>
							</li>
							<li>
								<EnquiryButton
									variant="secondary"
									size="sm"
									style={{
										background: "transparent",
										borderColor: "rgba(255,255,255,0.3)",
										color: "#fff",
										padding: "0.35rem 0.9rem",
									}}
								>
									Enquire
								</EnquiryButton>
							</li>
						</ul>
					</div>
				</div>

				<div className="footer__bottom">
					<span>
						© {new Date().getFullYear()} {company.legalName}
					</span>
					<span>
						<a
							href={company.website}
							target="_blank"
							rel="noreferrer"
							style={{ color: "inherit" }}
						>
							centurynit.org
						</a>
						{" · "}
						Prototype Phase 1
					</span>
				</div>
			</div>
		</footer>
	);
}
