import { useEffect, useState } from "react";
import { API_PREFIX, DEFAULT_BRAND, type Brand, type NavItem } from "century-nit-shared";

/**
 * The published brand record — the same `cms_brand` row the ops CMS edits.
 *
 * Fetched once per session from /brand.json (edge-cached 60 s + SWR). On
 * resolve the colour tokens are written to CSS variables and the document
 * title is rebased on the real name, so a brand publish reaches the site
 * without a redeploy. DEFAULT_BRAND is the render fallback — the site must
 * still look right if the endpoint is down.
 */

let cache: Brand | null = null;
let navCache: NavItem[] | null = null;
let inflight: Promise<{ brand: Brand; nav: NavItem[] }> | null = null;

async function fetchBrand(): Promise<{ brand: Brand; nav: NavItem[] }> {
	if (cache) return { brand: cache, nav: navCache ?? [] };
	inflight ??= (async () => {
		const [b, n] = await Promise.all([
			fetch(`${API_PREFIX}/brand.json`).then((r) => (r.ok ? r.json() : null)),
			fetch(`${API_PREFIX}/nav/header`).then((r) => (r.ok ? r.json() : null)),
		]);
		const brand = (b?.brand as Brand | undefined) ?? DEFAULT_BRAND;
		const nav = (n?.items as NavItem[] | undefined) ?? [];
		cache = brand;
		navCache = nav;
		return { brand, nav };
	})();
	try {
		return await inflight;
	} finally {
		inflight = null;
	}
}

const FONT_STACKS: Record<string, string> = {
	serif: "Georgia, 'Times New Roman', Times, serif",
	sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
	mono: "ui-monospace, 'Cascadia Code', 'SF Mono', Consolas, monospace",
};

function applyBrandVars(brand: Brand) {
	const root = document.documentElement.style;
	const c = brand.colors;
	root.setProperty("--brand-primary", c.primary);
	root.setProperty("--brand-accent", c.accent);
	root.setProperty("--brand-ink", c.ink);
	root.setProperty("--brand-surface", c.surface);
	root.setProperty("--brand-muted", c.muted);
	root.setProperty("--brand-success", c.success);
	root.setProperty("--brand-warn", c.warn);
	root.setProperty("--brand-danger", c.danger);
	root.setProperty("--brand-font-display", FONT_STACKS[brand.fonts.display] ?? brand.fonts.display);
	root.setProperty("--brand-font-body", FONT_STACKS[brand.fonts.body] ?? brand.fonts.body);
	root.setProperty("--brand-font-mono", FONT_STACKS[brand.fonts.mono] ?? brand.fonts.mono);
}

export function useBrand(): { brand: Brand; nav: NavItem[]; ready: boolean } {
	const [state, setState] = useState<{ brand: Brand; nav: NavItem[]; ready: boolean }>({
		brand: cache ?? DEFAULT_BRAND,
		nav: navCache ?? [],
		ready: Boolean(cache),
	});
	useEffect(() => {
		let alive = true;
		void fetchBrand()
			.then((res) => {
				if (!alive) return;
				setState({ ...res, ready: true });
				applyBrandVars(res.brand);
				if (document.title && !document.title.includes(res.brand.names.short)) {
					document.title = `${res.brand.names.brand} — ${res.brand.names.tagline}`;
				}
			})
			.catch(() => { if (alive) setState((s) => ({ ...s, ready: true })); });
		return () => { alive = false; };
	}, []);
	return state;
}
