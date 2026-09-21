import { useEffect, useState } from "react";
import { API_PREFIX, DEFAULT_BRAND, type Brand } from "century-nit-shared";

/**
 * The published brand record for console chrome — the same `cms_brand` row the
 * CMS Brand tab edits. Public endpoint, module-cached, DEFAULT_BRAND fallback.
 */
let cache: Brand | null = null;
let inflight: Promise<Brand> | null = null;

function fetchBrand(): Promise<Brand> {
	if (cache) return Promise.resolve(cache);
	inflight ??= fetch(`${API_PREFIX}/brand.json`)
		.then((r) => (r.ok ? r.json() : null))
		.then((b) => {
			cache = (b?.brand as Brand | undefined) ?? DEFAULT_BRAND;
			return cache;
		})
		.finally(() => { inflight = null; });
	return inflight;
}

export function useBrand(): Brand {
	const [brand, setBrand] = useState<Brand>(cache ?? DEFAULT_BRAND);
	useEffect(() => {
		let alive = true;
		void fetchBrand().then((b) => { if (alive) setBrand(b); }).catch(() => {});
		return () => { alive = false; };
	}, []);
	return brand;
}
