// The Operations Center Worker.
//
// The assets binding with `not_found_handling: "single-page-application"`
// serves the built SPA: real assets are served from disk, and any unmatched
// path falls back to index.html so React Router can client-route. No custom
// request handling is needed here — the Worker exists only to attach the
// assets binding.
export default {
	fetch(request: Request, env: { ASSETS: Fetcher }): Response | Promise<Response> {
		return env.ASSETS.fetch(request);
	},
};
