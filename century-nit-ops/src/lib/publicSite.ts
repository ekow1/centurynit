/**
 * Absolute URL of the public marketing site / applicant portal.
 *
 * Ops is a separate origin, so `<Link to="/">` stays inside the console.
 * Override with VITE_PUBLIC_SITE_URL when the public host is not the default.
 */
export function publicSiteUrl(): string {
	const fromEnv = import.meta.env.VITE_PUBLIC_SITE_URL;
	if (typeof fromEnv === "string" && fromEnv.length > 0) return fromEnv.replace(/\/$/, "");
	if (import.meta.env.DEV) return "http://localhost:5173";
	return "https://centurynit.softclicksolutions.com";
}
