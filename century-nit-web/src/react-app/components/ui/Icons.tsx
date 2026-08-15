/**
 * Thin-stroke line icons for the mobile shell.
 * Deliberately 1.5px hairlines so they sit with the editorial monochrome type
 * rather than shouting like a typical app icon set.
 */

type IconProps = { size?: number; className?: string };

function Svg({ size = 22, className, children }: IconProps & { children: React.ReactNode }) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden="true"
			focusable="false"
			className={className}
		>
			{children}
		</svg>
	);
}

export const IconHome = (p: IconProps) => (
	<Svg {...p}>
		<path d="M3 10.5 12 3l9 7.5" />
		<path d="M5.5 9.5V20h13V9.5" />
	</Svg>
);

export const IconCompass = (p: IconProps) => (
	<Svg {...p}>
		<circle cx="12" cy="12" r="9" />
		<path d="m15.5 8.5-2 5-5 2 2-5z" />
	</Svg>
);

export const IconSpark = (p: IconProps) => (
	<Svg {...p}>
		<path d="M12 3v18M3 12h18" />
	</Svg>
);

export const IconUser = (p: IconProps) => (
	<Svg {...p}>
		<circle cx="12" cy="8" r="3.5" />
		<path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
	</Svg>
);

export const IconMenu = (p: IconProps) => (
	<Svg {...p}>
		<path d="M4 7h16M4 12h16M4 17h16" />
	</Svg>
);

export const IconRoute = (p: IconProps) => (
	<Svg {...p}>
		<circle cx="6" cy="18" r="2.5" />
		<circle cx="18" cy="6" r="2.5" />
		<path d="M15.5 6H10a4 4 0 0 0 0 8h4a4 4 0 0 1 0 8H8.5" />
	</Svg>
);

export const IconDoc = (p: IconProps) => (
	<Svg {...p}>
		<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z" />
		<path d="M14 3v4h4" />
		<path d="M9.5 12.5h5M9.5 16h5" />
	</Svg>
);

export const IconWallet = (p: IconProps) => (
	<Svg {...p}>
		<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
		<path d="M3 8h15" />
		<circle cx="16.5" cy="13" r="1" />
	</Svg>
);

export const IconBell = (p: IconProps) => (
	<Svg {...p}>
		<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
		<path d="M13.73 21a2 2 0 0 1-3.46 0" />
	</Svg>
);

export const IconChevronLeft = (p: IconProps) => (
	<Svg {...p}>
		<path d="m15 5-7 7 7 7" />
	</Svg>
);

export const IconExternal = (p: IconProps) => (
	<Svg {...p}>
		<path d="M14 4h6v6" />
		<path d="M20 4 10 14" />
		<path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
	</Svg>
);

export const IconLogout = (p: IconProps) => (
	<Svg {...p}>
		<path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4" />
		<path d="m16 8 4 4-4 4" />
		<path d="M20 12H10" />
	</Svg>
);

export const IconLifebuoy = (p: IconProps) => (
	<Svg {...p}>
		<circle cx="12" cy="12" r="9" />
		<circle cx="12" cy="12" r="3.5" />
		<path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" />
	</Svg>
);
