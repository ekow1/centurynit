import { Outlet, useLocation } from "react-router-dom";
import { Nav } from "./Nav";
import { Footer } from "./Footer";

const hideChrome = ["/apply/wizard", "/apply/payment", "/apply/success", "/apply/email"];

export function Layout() {
	const { pathname } = useLocation();
	const minimal =
		hideChrome.some((p) => pathname.startsWith(p)) ||
		pathname.startsWith("/book-consultation/");

	return (
		<>
			<a href="#main" className="skip-link">
				Skip to content
			</a>
			{!minimal && <Nav />}
			<main id="main" className="page">
				<Outlet />
			</main>
			{!minimal && <Footer />}
		</>
	);
}

/** Full chrome for booking landing; wizard steps use minimal shell */
export function PublicLayout() {
	return (
		<>
			<a href="#main" className="skip-link">
				Skip to content
			</a>
			<Nav />
			<main id="main" className="page">
				<Outlet />
			</main>
			<Footer />
		</>
	);
}
