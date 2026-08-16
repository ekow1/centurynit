import { useEffect, useState } from "react";
import { meApi } from "century-nit-core/api";

/**
 * The signed-in user's photo when one is set, initials otherwise.
 *
 * The photo lives in private storage, so every render needs a fresh signed
 * URL — the API answers `GET /me/avatar` with one, and it is fetched only when
 * `image` (the auth flag) says a photo exists. Signed URLs are short-lived, so
 * the fetch happens per-mount and is never cached: an expired URL would be a
 * broken image, not a bug.
 */
export function Avatar({
	name,
	image,
	className,
}: {
	name: string;
	image?: string | null;
	className?: string;
}) {
	const [resolved, setResolved] = useState<{ key: string; url: string | null }>({
		key: "",
		url: null,
	});

	useEffect(() => {
		if (!image) return;
		let active = true;
		meApi
			.avatarUrl()
			.then((res) => {
				if (active) setResolved({ key: image, url: res.url });
			})
			.catch(() => {
				if (active) setResolved({ key: image, url: null });
			});
		return () => {
			active = false;
		};
	}, [image]);

	// Only trust a resolved URL while it matches the photo flag it was fetched
	// for; otherwise (photo just cleared, or still loading) show the initials.
	const src = image && resolved.key === image ? resolved.url : null;

	const initials = name
		.split(/\s+/)
		.map((p) => p[0])
		.filter(Boolean)
		.slice(0, 2)
		.join("")
		.toUpperCase();

	if (src) {
		return (
			<img
				src={src}
				alt={name}
				className={className}
				onError={() =>
					setResolved((r) => (r.key === image ? { key: r.key, url: null } : r))
				}
			/>
		);
	}
	return (
		<span className={className} aria-hidden>
			{initials}
		</span>
	);
}
