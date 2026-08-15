/** Link data shared by the desktop nav and the mobile tab bar / menu sheet. */

export type NavLinkItem = { to: string; label: string };

/** Shown inline in the desktop nav bar */
export const MAIN_LINKS: NavLinkItem[] = [
	{ to: "/about", label: "About" },
	{ to: "/destinations", label: "Destinations" },
	{ to: "/universities", label: "Universities" },
	{ to: "/programs", label: "Programs" },
	{ to: "/scholarships", label: "Scholarships" },
	{ to: "/red-seat", label: "Red Seat" },
	{ to: "/faqs", label: "FAQs" },
];

/** Only reachable from the mobile sheet / footer */
export const SECONDARY_LINKS: NavLinkItem[] = [
	{ to: "/why-choose-us", label: "Why Choose Us" },
	{ to: "/visa-services", label: "Visa Services" },
	{ to: "/student-services", label: "Student Services" },
	{ to: "/events", label: "Events" },
	{ to: "/blog", label: "Blog" },
];

/** Grouped for the mobile menu sheet - grouping is what makes a long list scannable on a phone */
export const MENU_GROUPS: { title: string; links: NavLinkItem[] }[] = [
	{
		title: "Explore",
		links: [
			{ to: "/destinations", label: "Destinations" },
			{ to: "/universities", label: "Universities" },
			{ to: "/programs", label: "Programs" },
			{ to: "/scholarships", label: "Scholarships" },
		],
	},
	{
		title: "Services",
		links: [
			{ to: "/visa-services", label: "Visa Services" },
			{ to: "/student-services", label: "Student Services" },
			{ to: "/why-choose-us", label: "Why Choose Us" },
		],
	},
	{
		title: "Company",
		links: [
			{ to: "/about", label: "About" },
			{ to: "/red-seat", label: "Red Seat" },
			{ to: "/events", label: "Events" },
			{ to: "/blog", label: "Blog" },
			{ to: "/faqs", label: "FAQs" },
		],
	},
];
