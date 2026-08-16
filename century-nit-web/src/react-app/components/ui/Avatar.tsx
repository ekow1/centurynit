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
	const [url, setUrl] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);

	const initials = name
		.split(/\s+/)
		.map((p) => p[0])
		.filter(Boolean)
		.slice(0, 2)
		.join("")
		.toUpperCase();

	useEffect(() => {
		if (!image) {
			setUrl(null);
			setFailed(false);
			return;
		}
		let active = true;
		setFailed(false);
		meApi
			.avatarUrl()
			.then((res) => {
				if (active) setUrl(res.url);
			})
			.catch(() => {
				if (active) setUrl(null);
			});
		return () => {
			active = false;
		};
	}, [image]);

	if (url && !failed) {
		return <img src={url} alt={name} className={className} onError={() => setFailed(true)} />;
	}
	return (
		<span className={className} aria-hidden>
			{initials}
		</span>
	);
}
