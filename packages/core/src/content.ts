export type Destination = {
	id: string;
	name: string;
	region: string;
	tagline: string;
	description: string;
	highlights: string[];
	universities: number;
	programs: number;
	image: string;
	flag: string;
};

export type University = {
	id: string;
	name: string;
	destinationId: string;
	city: string;
	ranking: string;
	type: string;
	acceptance: string;
	description: string;
	image: string;
	tags: string[];
};

export type Program = {
	id: string;
	name: string;
	level: "Undergraduate" | "Postgraduate" | "PhD" | "Diploma";
	field: string;
	universityId: string;
	duration: string;
	tuition: string;
	/**
	 * Indicative annual tuition in USD.
	 *
	 * `tuition` is a display string in the university's own currency, so it
	 * cannot be summed or converted — this is the figure used for shortlist
	 * totals and GH₵ conversion. Paid to the institution, never to Century NIT.
	 */
	tuitionUsd: number;
	intake: string[];
	description: string;
	format?: string;
	languageRequirement?: string;
	applicationDeadline?: string;
	entryRequirements?: string[];
	curriculum?: string[];
	careerOutcomes?: string[];
	scholarshipsAvailable?: string[];
	facts?: { label: string; value: string }[];
};

export type Consultant = {
	id: string;
	name: string;
	title: string;
	specialties: string[];
	destinations: string[];
	languages: string[];
	experience: string;
	rating: number;
	sessions: number;
	image: string;
	bio: string;
};

export type ServicePackage = {
	id: string;
	name: string;
	price: number;
	priceGHS: number;
	currency: string;
	description: string;
	features: string[];
	exclusions?: string[];
	popular?: boolean;
};

/** Exchange rate: 1 USD = 15 GHS (Ghanaian Cedi) */
export const GHS_RATE = 15;

/** Format an amount in USD as a dual-currency string: "GH₵1,125 / $75 USD" */
export function formatDualCurrency(usd: number): string {
	const ghs = Math.round(usd * GHS_RATE);
	return `GH₵${ghs.toLocaleString()} / $${usd.toLocaleString()} USD`;
}

/** Format just the GHS equivalent of a USD amount */
export function toGHS(usd: number): string {
	return `GH₵${Math.round(usd * GHS_RATE).toLocaleString()}`;
}

/** "GH₵375,000" / "$25,000" as a pair, for stacked display */
export function dualAmount(usd: number): { ghs: string; usd: string } {
	return {
		ghs: `GH₵${Math.round(usd * GHS_RATE).toLocaleString()}`,
		usd: `$${usd.toLocaleString()}`,
	};
}

export const destinations: Destination[] = [
	{
		id: "uk",
		name: "United Kingdom",
		region: "Europe",
		tagline: "World-class universities, rich academic heritage",
		description:
			"Study in the birthplace of modern higher education. The UK offers globally ranked institutions, shorter degree programs, and unmatched research opportunities across every discipline.",
		highlights: ["2-year post-study work visa", "Russell Group access", "Shorter degrees", "Global recognition"],
		universities: 48,
		programs: 620,
		image: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&q=80",
		flag: "🇬🇧",
	},
	{
		id: "usa",
		name: "United States",
		region: "North America",
		tagline: "Innovation campuses and unlimited opportunity",
		description:
			"The United States remains the world's most popular study destination-home to Ivy League excellence, cutting-edge research labs, and career pathways that redefine global mobility.",
		highlights: ["OPT & STEM extensions", "Ivy & top-50 access", "Flexible curricula", "Industry partnerships"],
		universities: 72,
		programs: 980,
		image: "https://images.unsplash.com/photo-1485738422979-f5c462d49f74?w=1200&q=80",
		flag: "🇺🇸",
	},
	{
		id: "canada",
		name: "Canada",
		region: "North America",
		tagline: "Safe, welcoming, and pathway-rich",
		description:
			"Canada combines academic excellence with a clear route to permanent residency. Study in a multicultural society with world-class cities and generous post-graduation work permits.",
		highlights: ["PGWP up to 3 years", "PR pathways", "Affordable excellence", "High quality of life"],
		universities: 36,
		programs: 410,
		image: "https://images.unsplash.com/photo-1517935706615-2717063c2225?w=1200&q=80",
		flag: "🇨🇦",
	},
	{
		id: "australia",
		name: "Australia",
		region: "Oceania",
		tagline: "Research powerhouses by the ocean",
		description:
			"Australia's Group of Eight universities lead in research intensity while offering an extraordinary student lifestyle-from Sydney harbours to Melbourne culture.",
		highlights: ["Post-study work rights", "Group of Eight", "Research excellence", "Vibrant student cities"],
		universities: 28,
		programs: 340,
		image: "https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=1200&q=80",
		flag: "🇦🇺",
	},
	{
		id: "germany",
		name: "Germany",
		region: "Europe",
		tagline: "Tuition-free excellence in the heart of Europe",
		description:
			"Germany offers exceptional public universities with low or no tuition, engineering and STEM supremacy, and a gateway to the European job market.",
		highlights: ["Low / no tuition", "STEM leadership", "18-month job seeker visa", "EU mobility"],
		universities: 32,
		programs: 280,
		image: "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=1200&q=80",
		flag: "🇩🇪",
	},
	{
		id: "uae",
		name: "United Arab Emirates",
		region: "Middle East",
		tagline: "Global branch campuses in a dynamic hub",
		description:
			"Dubai and Abu Dhabi host international branch campuses of leading Western universities-combining world-class degrees with tax-free careers and regional access.",
		highlights: ["Branch campuses", "Tax-free careers", "Regional hub", "Modern lifestyle"],
		universities: 18,
		programs: 160,
		image: "https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=1200&q=80",
		flag: "🇦🇪",
	},
];

export const universities: University[] = [
	{
		id: "oxford",
		name: "University of Oxford",
		destinationId: "uk",
		city: "Oxford",
		ranking: "#1 UK · #3 World",
		type: "Public Research",
		acceptance: "17%",
		description: "The oldest university in the English-speaking world. Tutorial-based learning, collegiate life, and research that shapes policy and science globally.",
		image: "https://images.unsplash.com/photo-1580537659466-0a9bfa916a54?w=900&q=80",
		tags: ["Russell Group", "Research Intensive", "Tutorial System"],
	},
	{
		id: "imperial",
		name: "Imperial College London",
		destinationId: "uk",
		city: "London",
		ranking: "#2 UK · #6 World",
		type: "Public Research",
		acceptance: "14%",
		description: "A world leader in science, engineering, medicine and business-situated in the heart of London's innovation corridor.",
		image: "https://images.unsplash.com/photo-1529655683826-aba9b3e77383?w=900&q=80",
		tags: ["STEM Focus", "Russell Group", "Industry Links"],
	},
	{
		id: "ucl",
		name: "University College London",
		destinationId: "uk",
		city: "London",
		ranking: "#3 UK · #9 World",
		type: "Public Research",
		acceptance: "30%",
		description: "London's global university. Interdisciplinary excellence across arts, sciences, engineering, and the built environment.",
		image: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=900&q=80",
		tags: ["Russell Group", "Diverse", "Central London"],
	},
	{
		id: "mit",
		name: "Massachusetts Institute of Technology",
		destinationId: "usa",
		city: "Cambridge, MA",
		ranking: "#1 USA · #1 World",
		type: "Private Research",
		acceptance: "4%",
		description: "The definitive institute for science and technology. MIT graduates lead the companies and laboratories that invent the future.",
		image: "https://images.unsplash.com/photo-1562774053-701939374585?w=900&q=80",
		tags: ["Ivy-equivalent", "Innovation", "STEM"],
	},
	{
		id: "stanford",
		name: "Stanford University",
		destinationId: "usa",
		city: "Stanford, CA",
		ranking: "#2 USA · #3 World",
		type: "Private Research",
		acceptance: "4%",
		description: "Silicon Valley's intellectual home. Entrepreneurial culture meets rigorous academics on a legendary California campus.",
		image: "https://images.unsplash.com/photo-1541339907198-e08756dedf3f?w=900&q=80",
		tags: ["Entrepreneurship", "Research", "West Coast"],
	},
	{
		id: "toronto",
		name: "University of Toronto",
		destinationId: "canada",
		city: "Toronto",
		ranking: "#1 Canada · #21 World",
		type: "Public Research",
		acceptance: "43%",
		description: "Canada's flagship research university. Vibrant urban campus, unmatched research output, and a launchpad for North American careers.",
		image: "https://images.unsplash.com/photo-1503614472-8c93d56e92ce?w=900&q=80",
		tags: ["U15", "Research", "Urban Campus"],
	},
	{
		id: "melbourne",
		name: "University of Melbourne",
		destinationId: "australia",
		city: "Melbourne",
		ranking: "#1 Australia · #14 World",
		type: "Public Research",
		acceptance: "70%",
		description: "Australia's leading university and a Group of Eight cornerstone-renowned for research, employability, and Melbourne's cultural capital.",
		image: "https://images.unsplash.com/photo-1514395462725-fb4566210144?w=900&q=80",
		tags: ["Group of Eight", "Research", "Employability"],
	},
	{
		id: "tum",
		name: "Technical University of Munich",
		destinationId: "germany",
		city: "Munich",
		ranking: "#1 Germany · #28 World",
		type: "Public Technical",
		acceptance: "8%",
		description: "Germany's premier technical university. Engineering, natural sciences, and entrepreneurship with deep industry integration.",
		image: "https://images.unsplash.com/photo-1599946347371-68eb71b16afc?w=900&q=80",
		tags: ["TU9", "Engineering", "Industry"],
	},
];

export const programs: Program[] = [
	{
		id: "ox-cs-msc",
		name: "MSc Computer Science",
		level: "Postgraduate",
		field: "Computer Science",
		universityId: "oxford",
		duration: "1 year",
		tuition: "£38,760",
		tuitionUsd: 49200,
		intake: ["October 2026", "October 2027"],
		description:
			"A rigorous one-year master's combining theoretical foundations with advanced topics in AI, systems, and software engineering.",
		format: "Full-time, on-campus",
		languageRequirement: "IELTS 7.5 (minimum 7.0 in each component) · TOEFL iBT 110",
		applicationDeadline: "January 8, 2026 (for October 2026 entry)",
		entryRequirements: [
			"First-class or strong upper second-class honours degree (or equivalent) in Computer Science or a closely related subject",
			"Solid mathematical background, including linear algebra, probability, and discrete mathematics",
			"Proficiency in at least one programming language (Python, Java, C++, or equivalent)",
			"Two academic references supporting research potential",
			"Statement of purpose outlining research interests and career goals (max 1,000 words)",
		],
		curriculum: [
			"Advanced Algorithms & Complexity",
			"Machine Learning & Deep Learning",
			"Distributed Systems & Cloud Computing",
			"Formal Methods & Software Verification",
			"Computer Security & Cryptography",
			"Advanced Databases & Data Modelling",
			"Research Project / Dissertation (50% of final grade)",
		],
		careerOutcomes: [
			"Software Engineer at Google, Microsoft, Meta, or Amazon",
			"Quantitative Researcher at investment banks & hedge funds",
			"AI/ML Research Scientist at DeepMind, OpenAI, or Anthropic",
			"PhD candidate at Oxford, Cambridge, MIT, or ETH Zurich",
			"Technology Consultant at McKinsey, BCG, or Bain",
		],
		scholarshipsAvailable: [
			"Clarendon Fund - full tuition + stipend (merit-based)",
			"Rhodes Scholarship - full funding for outstanding students worldwide",
			"Department of Computer Science Studentship - partial tuition remission",
			"Commonwealth Scholarship - for students from Commonwealth nations",
		],
		facts: [
			{ label: "Class size", value: "~32 students" },
			{ label: "Supervision ratio", value: "1:4 (faculty:student)" },
			{ label: "Research output", value: "80% of graduates publish within 2 years" },
			{ label: "Employment rate", value: "97% within 6 months of graduation" },
			{ label: "Average starting salary", value: "£72,000 (UK) · $145,000 (US)" },
			{ label: "Accreditation", value: "BCS - The Chartered Institute for IT" },
		],
	},
	{
		id: "imp-ai-msc",
		name: "MSc Artificial Intelligence",
		level: "Postgraduate",
		field: "Artificial Intelligence",
		universityId: "imperial",
		duration: "1 year",
		tuition: "£41,750",
		tuitionUsd: 53000,
		intake: ["October 2026"],
		description:
			"Industry-aligned AI curriculum covering machine learning, deep learning, robotics, and ethical AI deployment.",
		format: "Full-time, on-campus",
		languageRequirement: "IELTS 7.0 (minimum 6.5 in each component) · TOEFL iBT 100",
		applicationDeadline: "January 15, 2026 (for October 2026 entry)",
		entryRequirements: [
			"First-class honours degree (or equivalent) in Computer Science, Mathematics, or Engineering",
			"Strong programming skills in Python and familiarity with ML frameworks (PyTorch, TensorFlow)",
			"Mathematical maturity in linear algebra, calculus, and probability",
			"Personal statement and two academic references",
		],
		curriculum: [
			"Foundations of Machine Learning",
			"Deep Learning & Neural Networks",
			"Reinforcement Learning & Decision Making",
			"Computer Vision & Image Processing",
			"Natural Language Processing",
			"Robotics & Autonomous Systems",
			"Ethics, Safety & Governance of AI",
			"Individual Research Project",
		],
		careerOutcomes: [
			"ML Engineer at Google DeepMind, OpenAI, or Microsoft Research",
			"Data Scientist at Spotify, Netflix, or Airbnb",
			"AI Consultant at Accenture or Deloitte",
			"Research Engineer at ARM, NVIDIA, or Tesla",
			"PhD candidate at Imperial, UCL, Stanford, or CMU",
		],
		scholarshipsAvailable: [
			"Imperial College President's Scholarship - full tuition + stipend",
			"DeepMind Scholarship - for underrepresented groups in AI",
			"Faculty of Engineering Bursary - partial tuition support",
		],
		facts: [
			{ label: "Class size", value: "~60 students" },
			{ label: "Industry partnerships", value: "Google DeepMind, NVIDIA, ARM" },
			{ label: "Employment rate", value: "98% within 3 months of graduation" },
			{ label: "Average starting salary", value: "£78,000 (UK) · $155,000 (US)" },
			{ label: "Research output", value: "Top 3 globally for AI publications" },
			{ label: "Accreditation", value: "IET - Institution of Engineering and Technology" },
		],
	},
	{
		id: "ucl-arch-bsc",
		name: "BSc Architecture",
		level: "Undergraduate",
		field: "Architecture",
		universityId: "ucl",
		duration: "3 years",
		tuition: "£31,100 / year",
		tuitionUsd: 39500,
		intake: ["September 2026", "September 2027"],
		description:
			"RIBA Part 1 accredited architecture education in the heart of London's design ecosystem.",
		format: "Full-time, on-campus",
		languageRequirement: "IELTS 7.0 (minimum 6.5 in each component) · TOEFL iBT 100",
		applicationDeadline: "January 25, 2026 (UCAS deadline)",
		entryRequirements: [
			"A-levels: AAA (preferably including Art, Mathematics, or Physics)",
			"Portfolio of creative work (drawings, models, sketches, digital design)",
			"Personal statement demonstrating passion for the built environment",
			"Interview with portfolio review",
		],
		curriculum: [
			"Architectural Design Studio (core each year)",
			"History & Theory of Architecture",
			"Building Technology & Environmental Design",
			"Urban Design & City Planning",
			"Digital Fabrication & Computational Design",
			"Structures, Materials & Construction",
			"Professional Practice & Ethics",
		],
		careerOutcomes: [
			"Architectural Assistant at Foster + Partners, ZHA, or BIG",
			"Urban Planner at Arup, AECOM, or Mott MacDonald",
			"Design Technologist at Heatherwick Studio or Amanda Levete",
			"RIBA Part 2 progression (MArch) at UCL, AA, or Cambridge",
			"Set Designer or Creative Director in film & media",
		],
		scholarshipsAvailable: [
			"UCL Undergraduate Bursary - for UK students from lower-income households",
			"International Student Scholarship - partial tuition support",
			"RIBA Wynn Owen Undergraduate Scholarship - for architecture students",
		],
		facts: [
			{ label: "Class size", value: "~100 students per cohort" },
			{ label: "Studio culture", value: "24/7 studio access with dedicated workspace" },
			{ label: "Employment rate", value: "94% within 6 months of graduation" },
			{ label: "Average starting salary", value: "£32,000 (UK)" },
			{ label: "Accreditation", value: "RIBA Part 1 & ARB prescribed" },
			{ label: "Field trips", value: "Annual international study visit" },
		],
	},
	{
		id: "mit-ee-bs",
		name: "SB Electrical Engineering & Computer Science",
		level: "Undergraduate",
		field: "Engineering",
		universityId: "mit",
		duration: "4 years",
		tuition: "$59,750 / year",
		tuitionUsd: 59750,
		intake: ["Fall 2026", "Fall 2027"],
		description:
			"MIT's flagship EECS program-the gold standard for engineers who build the systems that run the world.",
		format: "Full-time, on-campus",
		languageRequirement: "TOEFL iBT 100 · IELTS 7.0 · Duolingo 120",
		applicationDeadline: "January 4, 2026 (Regular Action, for Fall 2026 entry)",
		entryRequirements: [
			"Outstanding high school transcript with rigorous coursework in calculus, physics, and chemistry",
			"Standardized test scores (SAT/ACT - test-optional for 2026 cycle)",
			"Two teacher evaluations (preferably STEM teachers)",
			"Extracurricular profile showing initiative in engineering, coding, or research",
			"MIT application essays and supplemental questions",
		],
		curriculum: [
			"6.1010 Fundamentals of EE",
			"6.1210 Introduction to Algorithms",
			"6.1900 Computer System Engineering",
			"6.3100 Dynamical Systems & Feedback Control",
			"6.3900 Introduction to Machine Learning",
			"6.5830 Database Systems",
			"6.S977/6.S978 EECS Senior Thesis Project",
		],
		careerOutcomes: [
			"Software Engineer at Google, Apple, Meta, or Microsoft",
			"Hardware Engineer at NVIDIA, AMD, or Intel",
			"Quantitative Analyst at Jane Street, Citadel, or Two Sigma",
			"Founder of venture-backed startup (MIT delta v program)",
			"PhD candidate at MIT, Stanford, CMU, or UC Berkeley",
		],
		scholarshipsAvailable: [
			"MIT Need-Based Aid - meets 100% of demonstrated financial need (no loans)",
			"MIT Presidential Fellowship - for exceptional applicants",
			"External: Knight-Hennessy, NSF GRFP for future researchers",
		],
		facts: [
			{ label: "Class size", value: "~250 undergraduates per year in EECS" },
			{ label: "Research labs", value: "CSAIL, RLE, LIDS - 100+ research groups" },
			{ label: "Employment rate", value: "99% within 3 months of graduation" },
			{ label: "Average starting salary", value: "$145,000 (US) · £110,000 (UK)" },
			{ label: "Startup founders", value: "30% of EECS alumni found a company" },
			{ label: "Accreditation", value: "ABET - Computing & Engineering accreditation" },
		],
	},
	{
		id: "stanford-mba",
		name: "MBA",
		level: "Postgraduate",
		field: "Business",
		universityId: "stanford",
		duration: "2 years",
		tuition: "$82,455 / year",
		tuitionUsd: 82450,
		intake: ["September 2026"],
		description:
			"A transformative MBA experience rooted in entrepreneurship, leadership, and Silicon Valley networks.",
		format: "Full-time, on-campus",
		languageRequirement: "TOEFL iBT 100 · IELTS 7.0 · PTE 68",
		applicationDeadline: "September 9, 2025 (Round 1) · January 7, 2026 (Round 2, for September 2026 entry)",
		entryRequirements: [
			"Bachelor's degree from an accredited institution (all disciplines welcome)",
			"GMAT or GRE score (median GMAT: 738)",
			"2+ years of professional work experience preferred",
			"Two letters of recommendation (one from a direct supervisor)",
			"Essays: What matters most to you, and why? · Why Stanford?",
			"Interview (by invitation only)",
		],
		curriculum: [
			"Strategic Leadership & Organizational Behaviour",
			"Financial Accounting & Corporate Finance",
			"Microeconomics for Managers",
			"Data Analysis & Decision Making",
			"Entrepreneurship & Venture Capital",
			"Negotiation & Conflict Resolution",
			"Global Management & International Business",
			"GSB Sloan Master's Project / Independent Study",
		],
		careerOutcomes: [
			"Product Manager at Google, Apple, or Microsoft",
			"Associate at McKinsey, BCG, or Bain",
			"Investment Banker at Goldman Sachs or Morgan Stanley",
			"Venture Capital Associate at Sequoia, a16z, or Benchmark",
			"Founder & CEO of venture-backed startup",
		],
		scholarshipsAvailable: [
			"Stanford GSB Need-Based Fellowship - up to full tuition + living costs",
			"Knight-Hennessy Scholars - full funding for 3 years of graduate study",
			"Fellowships for underrepresented groups: Forté, ROMBA, Toigo",
		],
		facts: [
			{ label: "Class size", value: "~436 students per cohort" },
			{ label: "International students", value: "41% of class" },
			{ label: "Employment rate", value: "93% within 3 months of graduation" },
			{ label: "Average starting salary", value: "$175,000 + $40,000 signing bonus" },
			{ label: "Entrepreneurship rate", value: "16% start a company at graduation" },
			{ label: "Alumni network", value: "31,000+ GSB alumni worldwide" },
		],
	},
	{
		id: "utoronto-ds-msc",
		name: "MSc Applied Computing - Data Science",
		level: "Postgraduate",
		field: "Data Science",
		universityId: "toronto",
		duration: "16 months",
		tuition: "CAD $62,250",
		tuitionUsd: 45450,
		intake: ["September 2026", "January 2027"],
		description:
			"Professional master's with industry internship, designed for data scientists ready for the Canadian tech market.",
		format: "Full-time, on-campus (includes 4-month industry practicum)",
		languageRequirement: "TOEFL iBT 93 · IELTS 7.0 (minimum 6.5 per band)",
		applicationDeadline: "February 1, 2026 (for September 2026 entry)",
		entryRequirements: [
			"Four-year bachelor's degree in Computer Science, Statistics, or related field with B+ average",
			"Programming proficiency in Python or R, plus SQL",
			"Coursework in statistics, linear algebra, and machine learning",
			"Two academic or professional references",
			"Statement of interest describing data science career goals",
		],
		curriculum: [
			"Statistical Learning & Inference",
			"Big Data Systems & Cloud Computing",
			"Deep Learning for Data Science",
			"Data Visualization & Storytelling",
			"Natural Language Processing & Text Mining",
			"Applied Optimization & Operations Research",
			"Industry Practicum (4-month paid internship)",
			"Capstone Data Science Project",
		],
		careerOutcomes: [
			"Data Scientist at Shopify, Royal Bank of Canada, or Scotiabank",
			"ML Engineer at Amazon, NVIDIA, or Thomson Reuters",
			"Analytics Consultant at Deloitte, Accenture, or KPMG",
			"Research Scientist at Vector Institute or MaRS Discovery District",
			"Data Engineer at Bell, Telus, or Rogers Communications",
		],
		scholarshipsAvailable: [
			"Ontario Graduate Scholarship (OGS) - CAD $15,000 per term",
			"Vector Institute Scholarship in AI - CAD $17,500",
			"University of Toronto Graduate Award - partial tuition support",
		],
		facts: [
			{ label: "Class size", value: "~80 students per cohort" },
			{ label: "Practicum placement rate", value: "100% (guaranteed industry internship)" },
			{ label: "PGWP eligible", value: "Yes - 3-year post-graduation work permit" },
			{ label: "Average starting salary", value: "CAD $95,000 · $72,000 USD" },
			{ label: "PR pathway", value: "Canadian Express Entry eligible upon graduation" },
			{ label: "Industry partners", value: "Vector Institute, Google Brain, Royal Bank" },
		],
	},
	{
		id: "melb-med-md",
		name: "Doctor of Medicine",
		level: "Postgraduate",
		field: "Medicine",
		universityId: "melbourne",
		duration: "4 years",
		tuition: "AUD $98,000 / year",
		tuitionUsd: 63700,
		intake: ["January 2027"],
		description:
			"Graduate-entry MD with clinical placements across Victoria's leading hospitals and research institutes.",
		format: "Full-time, on-campus (clinical rotations in years 3–4)",
		languageRequirement: "IELTS 7.0 (minimum 7.0 in each band) · TOEFL iBT 100",
		applicationDeadline: "May 31, 2026 (for January 2027 intake)",
		entryRequirements: [
			"Bachelor's degree in any discipline with GPA of 5.0/7.0 or higher",
			"GAMSAT or MCAT score (competitive score required)",
			"Prerequisite subjects: anatomy, physiology, and biochemistry at undergraduate level",
			"Multiple Mini Interview (MMI) - in person or virtual",
			"Criminal record check and immunisation compliance",
		],
		curriculum: [
			"Human Structure & Function (Anatomy & Physiology)",
			"Molecular & Cellular Basis of Medicine",
			"Population Health & Epidemiology",
			"Clinical Skills & Patient-centred Care",
			"Internal Medicine & Surgery rotations",
			"Paediatrics, Psychiatry & Obstetrics rotations",
			"Elective rotations & overseas clinical placement",
			"MD Research Project / Scholarly Activity",
		],
		careerOutcomes: [
			"Resident Medical Officer at Royal Melbourne or Monash Health",
			"General Practitioner in urban or rural Australia",
			"Surgeon, Cardiologist, or Neurologist (after specialist training)",
			"Medical Researcher at WEHI or Peter MacCallum Cancer Centre",
			"Global health roles with WHO, Médecins Sans Frontières, or Red Cross",
		],
		scholarshipsAvailable: [
			"Melbourne Medical School Scholarship - AUD $50,000 per year",
			"Rural Medical Student Scholarship - for rural-background students",
			"MD/PhD combined program funding - for students pursuing academic medicine",
		],
		facts: [
			{ label: "Class size", value: "~330 students per cohort" },
			{ label: "Clinical placement hospitals", value: "20+ affiliated teaching hospitals" },
			{ label: "AMC accreditation", value: "Fully accredited by Australian Medical Council" },
			{ label: "Licensing", value: "Eligible for AMC specialist registration" },
			{ label: "Average starting salary", value: "AUD $110,000 (intern) · AUD $200,000+ (specialist)" },
			{ label: "Global recognition", value: "Recognised in UK, US, Canada, and New Zealand" },
		],
	},
	{
		id: "tum-me-msc",
		name: "MSc Mechanical Engineering",
		level: "Postgraduate",
		field: "Engineering",
		universityId: "tum",
		duration: "2 years",
		tuition: "€0 – €3,000 / year",
		tuitionUsd: 3250,
		intake: ["October 2026", "April 2027"],
		description:
			"Research-driven mechanical engineering with access to Bavaria's automotive and industrial ecosystem.",
		format: "Full-time, on-campus (German-taught or English-taught tracks available)",
		languageRequirement: "English track: IELTS 6.5 · German track: DSH-2 or TestDaF 4×4",
		applicationDeadline: "July 15, 2026 (for October 2026 intake) · January 15, 2027 (for April 2027 intake)",
		entryRequirements: [
			"Bachelor's degree in Mechanical Engineering or related field (at least 6 semesters)",
			"Minimum GPA of 2.5 (German scale) or equivalent",
			"Fundamentals in mathematics, mechanics, thermodynamics, and engineering design",
			"APS certificate required for applicants from China, India, and Vietnam",
			"Letter of motivation describing academic and research interests",
		],
		curriculum: [
			"Advanced Engineering Mechanics & Dynamics",
			"Thermodynamics & Heat Transfer",
			"Fluid Mechanics & Computational Fluid Dynamics (CFD)",
			"Robotics & Mechatronics",
			"Automotive Engineering & Vehicle Dynamics",
			"Manufacturing Technologies & Industry 4.0",
			"Finite Element Methods & Numerical Simulation",
			"Master's Thesis (6 months, often industry-sponsored)",
		],
		careerOutcomes: [
			"Design Engineer at BMW, Audi, or Porsche",
			"Simulation Engineer at Siemens, Bosch, or MAN",
			"R&D Engineer at Airbus, Rolls-Royce, or Liebherr",
			"Manufacturing Engineer at Volkswagen or Continental",
			"Consultant at McKinsey, Roland Berger, or Porsche Consulting",
		],
		scholarshipsAvailable: [
			"Deutschlandstipendium - €300/month (merit-based, for all nationalities)",
			"DAAD Scholarship - full funding for international master's students",
			"TUM Graduate School Funding - for outstanding thesis projects",
			"Erasmus+ - for EU mobility and exchange semesters",
		],
		facts: [
			{ label: "Class size", value: "~120 students per intake" },
			{ label: "Tuition", value: "Free for EU students · €0–3,000/year for non-EU" },
			{ label: "Industry partnerships", value: "BMW, Siemens, Airbus, Bosch - Germany's engineering elite" },
			{ label: "Average starting salary", value: "€58,000 (Germany) · €65,000 (Switzerland)" },
			{ label: "Post-study work visa", value: "18-month job seeker visa after graduation" },
			{ label: "Accreditation", value: "ASIIN - Accreditation for Engineering Programs" },
		],
	},
];

export const consultants: Consultant[] = [
	{
		id: "c1",
		name: "Amara Owusu",
		title: "Senior Education Strategist",
		specialties: ["UK Admissions", "Scholarships", "Personal Statements"],
		destinations: ["uk", "germany"],
		languages: ["English", "Twi", "French"],
		experience: "12 years",
		rating: 4.98,
		sessions: 1840,
		image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=400&q=80",
		bio: "Former Oxford admissions advisor. Specializes in competitive UK offers and full-ride scholarship strategy for West African students.",
	},
	{
		id: "c2",
		name: "Efua Owusu",
		title: "US & Ivy League Counselor",
		specialties: ["Ivy League", "Liberal Arts", "SAT/ACT Strategy"],
		destinations: ["usa", "canada"],
		languages: ["English", "Ga"],
		experience: "15 years",
		rating: 4.96,
		sessions: 2105,
		image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=400&q=80",
		bio: "Ex-Columbia admissions reader. Guides students through holistic US applications with precision storytelling.",
	},
	{
		id: "c3",
		name: "Kwame Agyeman",
		title: "STEM Pathways Lead",
		specialties: ["STEM Programs", "Canada PR", "Visa Strategy"],
		destinations: ["canada", "australia", "usa"],
		languages: ["English", "Twi"],
		experience: "9 years",
		rating: 4.99,
		sessions: 1520,
		image: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=400&q=80",
		bio: "Engineer-turned-counselor. Maps STEM applicants to high-ROI programs with clear immigration pathways.",
	},
	{
		id: "c4",
		name: "Yaw Boateng",
		title: "Europe & Germany Specialist",
		specialties: ["Germany", "Tuition-Free Options", "EU Mobility"],
		destinations: ["germany", "uk", "uae"],
		languages: ["English", "German", "Twi"],
		experience: "11 years",
		rating: 4.94,
		sessions: 980,
		image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&q=80",
		bio: "Berlin-based advisor helping West African students unlock free and low-cost European degrees without sacrificing quality.",
	},
];

export const servicePackages: ServicePackage[] = [
	{
		id: "standard",
		name: "Official Study Abroad & Visa Advisory Package",
		price: 1500,
		priceGHS: 1500 * GHS_RATE,
		currency: "USD",
		description:
			"Complete study abroad guidance covering credential review, university matching, visa filing processes, and end-to-end advisor assistance.",
		features: [
			"Comprehensive document reviewing & credential verification",
			"University and academic program selection matching",
			"Statement of Purpose (SOP) & essay review assistance",
			"Visa application processes & consular document preparation",
			"Embassy visa interview preparation & coaching",
			"Traveling assistance (flight & accommodation coordination)",
			"Dedicated case consultant & step-by-step advisory support",
		],
		exclusions: [
			"School / university direct application fees",
			"Embassy / government visa filing and biometrics fees",
			"Initial advisory consultation fee",
		],
		popular: true,
	},
	{
		id: "premium",
		name: "Comprehensive Admission, Visa & Relocation Package",
		price: 2500,
		priceGHS: 2500 * GHS_RATE,
		currency: "USD",
		description:
			"All-inclusive support including priority document notarization, scholarship audits, visa processing, pre-departure briefing, and housing assistance.",
		features: [
			"Comprehensive document reviewing, notarization & credential evaluation",
			"Priority multi-institution application processing & scholarship matching",
			"End-to-end visa application filing process & document verification",
			"1-on-1 mock embassy visa interview coaching sessions",
			"Traveling assistance (flight itinerary, baggage allowance & travel insurance)",
			"Student housing, accommodation search & airport pickup coordination",
			"Pre-departure orientation & arrival transition support",
			"Continuous dedicated senior advisor assistance from start to arrival",
		],
		exclusions: [
			"School / university direct application fees",
			"Embassy / government visa filing and biometrics fees",
			"Initial advisory consultation fee",
		],
	},
];

export const CONSULTATION_FEE = 75;

export const consultationTypes = [
	{
		id: "online" as const,
		name: "Online Consultation",
		blurb: "Video call with a Century NIT consultant - join from anywhere.",
		duration: "45–60 min",
	},
	{
		id: "in_person" as const,
		name: "In-Person Consultation",
		blurb: "Meet at a Century NIT branch office for a face-to-face session.",
		duration: "45–60 min",
	},
];

export type Branch = {
	id: string;
	name: string;
	city: string;
	region: string;
	country: string;
	address: string;
	phone: string;
	hours: string;
	mapsUrl: string;
	timezone: string;
};

/** Century NIT branches that manage consultations & applications */
export const branches: Branch[] = [
	{
		id: "accra-hq",
		name: "Accra Headquarters",
		city: "Accra",
		region: "Greater Accra",
		country: "Ghana",
		address: "Airport Residential Area, Accra",
		phone: "+233 30 000 0000",
		hours: "Mon–Fri 09:00–17:00 GMT",
		mapsUrl: "https://www.google.com/maps?q=Airport+Residential+Area+Accra+Ghana",
		timezone: "Africa/Accra",
	},
	{
		id: "kumasi",
		name: "Kumasi Branch",
		city: "Kumasi",
		region: "Ashanti",
		country: "Ghana",
		address: "Ahodwo Roundabout, Kumasi",
		phone: "+233 32 000 0000",
		hours: "Mon–Fri 09:00–17:00 GMT",
		mapsUrl: "https://www.google.com/maps?q=Ahodwo+Roundabout+Kumasi+Ghana",
		timezone: "Africa/Accra",
	},
	{
		id: "takoradi",
		name: "Takoradi Branch",
		city: "Takoradi",
		region: "Western",
		country: "Ghana",
		address: "Market Circle, Takoradi",
		phone: "+233 31 000 0000",
		hours: "Mon–Fri 09:00–16:30 GMT",
		mapsUrl: "https://www.google.com/maps?q=Market+Circle+Takoradi+Ghana",
		timezone: "Africa/Accra",
	},
	{
		id: "tamale",
		name: "Tamale Branch",
		city: "Tamale",
		region: "Northern",
		country: "Ghana",
		address: "Education Ridge, Tamale",
		phone: "+233 37 000 0000",
		hours: "Mon–Fri 09:00–16:30 GMT",
		mapsUrl: "https://www.google.com/maps?q=Education+Ridge+Tamale+Ghana",
		timezone: "Africa/Accra",
	},
	{
		id: "lagos",
		name: "Lagos Partner Desk",
		city: "Lagos",
		region: "Lagos",
		country: "Nigeria",
		address: "Victoria Island, Lagos",
		phone: "+234 1 000 0000",
		hours: "Mon–Fri 09:00–17:00 WAT",
		mapsUrl: "https://www.google.com/maps?q=Victoria+Island+Lagos+Nigeria",
		timezone: "Africa/Lagos",
	},
	{
		id: "abuja",
		name: "Abuja Partner Desk",
		city: "Abuja",
		region: "FCT",
		country: "Nigeria",
		address: "Wuse Zone 2, Abuja",
		phone: "+234 9 000 0000",
		hours: "Mon–Fri 09:00–17:00 WAT",
		mapsUrl: "https://www.google.com/maps?q=Wuse+Zone+2+Abuja+Nigeria",
		timezone: "Africa/Lagos",
	},
];

export function branchesForLocation(country: string, region?: string, city?: string) {
	let list = branches.filter(
		(b) => b.country.toLowerCase() === country.toLowerCase() || !country,
	);
	if (!list.length) list = [...branches];
	if (region) {
		const regional = list.filter((b) =>
			b.region.toLowerCase().includes(region.toLowerCase()),
		);
		if (regional.length) list = regional;
	}
	if (city) {
		const cityMatch = list.filter((b) =>
			b.city.toLowerCase().includes(city.toLowerCase()),
		);
		if (cityMatch.length) return cityMatch;
	}
	return list.length ? list : branches;
}

export function getBranch(id: string) {
	return branches.find((b) => b.id === id);
}

export function getBranchName(branchIdOrName?: string | null): string {
	if (!branchIdOrName) return "Accra Headquarters";
	const trimmed = branchIdOrName.trim();
	const b = branches.find((br) => br.id.toLowerCase() === trimmed.toLowerCase() || br.name.toLowerCase() === trimmed.toLowerCase());
	if (b?.name) return b.name;
	const lower = trimmed.toLowerCase();
	if (lower === "accra-hq" || lower === "accra" || lower === "accra headquarters" || lower === "accra-headquarters") return "Accra Headquarters";
	if (lower === "kumasi" || lower === "kumasi branch" || lower === "kumasi-branch") return "Kumasi Branch";
	if (lower === "takoradi" || lower === "takoradi branch" || lower === "takoradi-branch") return "Takoradi Branch";
	if (lower === "tamale" || lower === "tamale branch") return "Tamale Branch";
	if (lower === "sunyani" || lower === "sunyani branch") return "Sunyani Branch";
	if (lower === "cape-coast" || lower === "cape coast") return "Cape Coast Branch";
	if (lower === "ho" || lower === "ho branch") return "Ho Branch";
	if (lower === "koforidua") return "Koforidua Branch";
	return trimmed
		.replace(/-hq$/i, " Headquarters")
		.replace(/[-_]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function getConsultant(id: string | null | undefined) {
	if (!id) return undefined;
	return consultants.find((c) => c.id === id);
}

/**
 * Pick the consultant a branch would assign to this applicant.
 *
 * Prefers someone who covers a destination the applicant named in their
 * assessment, then falls back to the whole roster. The choice is derived from
 * `seed` (the booking reference) rather than Math.random so the same booking
 * always resolves to the same person - a consultant who changed identity on
 * reload would undermine every message thread and appointment that names them.
 */
export function pickConsultantFor(preferredCountries: string, seed: string): Consultant {
	const wanted = preferredCountries.toLowerCase();

	const matches = consultants.filter((c) =>
		c.destinations.some((d) => {
			if (wanted.includes(d)) return true;
			const name = destinations.find((dest) => dest.id === d)?.name.toLowerCase();
			return name ? wanted.includes(name) : false;
		}),
	);

	const pool = matches.length ? matches : consultants;

	let hash = 0;
	for (let i = 0; i < seed.length; i++) {
		hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
	}
	return pool[hash % pool.length];
}

export const APPLICANT_COUNTRIES = [
	"Ghana",
	"Nigeria",
	"Kenya",
	"South Africa",
	"United Kingdom",
	"United States",
	"Canada",
	"Other",
];

export const CONSULTATION_DOCUMENTS = [
	{ id: "passport", name: "Passport", required: true, hint: "Bio page, colour scan" },
	{ id: "certificates", name: "Academic certificates", required: true, hint: "Highest qualification" },
	{ id: "transcripts", name: "Academic transcripts", required: true, hint: "Official or certified" },
	{ id: "cv", name: "CV / Resume", required: true, hint: "PDF preferred" },
	{ id: "english", name: "English test results", required: false, hint: "IELTS / TOEFL if available" },
	{ id: "financial", name: "Financial documents", required: true, hint: "Bank statement or proof of funds" },
	{ id: "sponsorship", name: "Sponsorship documents", required: false, hint: "If sponsored" },
	{ id: "additional", name: "Additional supporting documents", required: false, hint: "Optional extras" },
] as const;

export const ASSESSMENT_SECTIONS = [
	{ id: "personal", label: "Personal information" },
	{ id: "passport", label: "Passport information" },
	{ id: "education", label: "Educational background" },
	{ id: "employment", label: "Employment information" },
	{ id: "english", label: "English proficiency" },
	{ id: "study", label: "Study preferences" },
	{ id: "financial", label: "Financial information" },
	{ id: "documents", label: "Supporting documents" },
	{ id: "review", label: "Review assessment" },
] as const;

export const CONSULTATION_SLOTS = [
	"09:00",
	"10:00",
	"11:00",
	"12:00",
	"13:00",
	"14:00",
	"15:00",
	"16:00",
	"17:00",
];

export const CONSULTATION_DURATIONS = [
	{ id: "30", label: "30 min", slots: ["09:00", "09:30", "10:00", "10:30", "11:00", "11:30", "13:00", "13:30", "14:00", "14:30", "15:00", "15:30", "16:00", "16:30"] },
	{ id: "45", label: "45 min", slots: ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"] },
	{ id: "60", label: "60 min", slots: ["09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00"] },
] as const;

/** Days each branch is open for consultations (0=Sun, 6=Sat) */
export const BRANCH_AVAILABILITY: Record<string, number[]> = {
	"accra-hq": [1, 2, 3, 4, 5],
	"kumasi": [1, 2, 3, 4, 5],
	"takoradi": [1, 2, 3, 4, 5],
	"tamale": [1, 2, 4, 5],
	"lagos": [1, 2, 3, 4, 5, 6],
	"abuja": [1, 2, 3, 4, 5],
};

/*
 * Slot occupancy and calendar rules live in ./availability.ts.
 *
 * `BOOKED_SLOTS` and `isSlotBooked` used to sit here as a hard-coded list of six
 * absolute dates that nothing ever wrote to — so real bookings never took a slot
 * and the seeded dates expired into the past. `isBranchOpenOnDay` moved with
 * them to keep every scheduling rule in one place.
 */

/** Real company profile grounded in centurynit.org */
export const company = {
	legalName: "Century Nit Consult Limited",
	brandName: "Century NIT Consult",
	tagline: "Immigration & Visa Consultancy Worldwide",
	founded: 2011,
	base: "Ghana, West Africa",
	email: "info@centurynit.com",
	website: "https://www.centurynit.org",
	hours: "Mon – Fri 8am–5pm · Sat 9am–12pm",
	summary:
		"Ghana’s most reliable visa and immigration consultancy since 2011-licensed to educate and assist students pursuing degree programmes and higher education at foreign universities.",
	about:
		"Century Nit Consult Limited is a non-governmental consultancy based in Ghana, West Africa. It is a licensed and recognised recruitment consultancy, formed to set the pace in educating and assisting students and individuals to pursue or continue their education at foreign universities abroad. Officially founded in 2011, the company provides access to all-especially students who want to pursue degree programmes and higher education in various academic disciplines abroad.",
	mission: [
		"Become an established organisation renowned for excellence.",
		"Become the consultancy of first choice for schools and colleges in the regions we serve.",
		"Enhance the standard of education provision in the region, aiding local social and living standards.",
	],
	promise:
		"World-class educational opportunities and total customer satisfaction from the moment you express interest in studying abroad.",
	branches: [
		{
			id: "accra",
			name: "Accra Branch",
			address: "Mile 7 Aku Link, Pentecost Junction, Accra",
			phones: ["+233 554 717 878", "+233 554 914 101"],
			map: "https://maps.app.goo.gl/KfoL22E8oam48iLu5",
		},
		{
			id: "kumasi",
			name: "Kumasi Branch",
			address: "Santasi, Adjacent the Post Office, Kumasi",
			phones: ["+233 545 130 650", "+233 537 594 408"],
			map: "https://maps.app.goo.gl/KfoL22E8oam48iLu5",
		},
	],
	social: [
		{ label: "Instagram", href: "https://www.instagram.com/century_nit_consult/" },
		{ label: "LinkedIn", href: "https://gh.linkedin.com/in/century-nit-consult-cnc-423b9256" },
		{ label: "Facebook", href: "https://www.facebook.com/centurynitconsult/" },
		{ label: "YouTube", href: "https://www.youtube.com/channel/UCcA0E4RgYSPwV9xcq0f7XSg" },
		{ label: "TikTok", href: "https://www.tiktok.com/@century_nit_consult" },
	],
};

export const coreServices = [
	{
		id: "counseling",
		title: "Education Advice & Career Counseling",
		description:
			"We match academic strengths, finances, subjects of interest, and future plans to the right course and university-guided by partner-university representatives for Bachelor's, Master's, and PhD pathways.",
		detail:
			"Your counselling journey begins with a deep-dive session where we assess your academic background, career aspirations, budget, and preferred destinations. Our advisors have direct relationships with partner universities across six countries, meaning you get insider guidance-not generic advice. We help you shortlist programmes, understand entry requirements, compare costs, and plan a realistic timeline from application to arrival.",
		deliverables: [
			"One-on-one consultation (in-office or online)",
			"Personalised programme and university shortlist",
			"Career pathway mapping",
			"Budget planning with scholarship opportunities",
		],
		process: [
			"Book a consultation at our Accra or Kumasi office",
			"Share your academic transcripts and CV",
			"Receive a tailored shortlist within 5 working days",
			"Refine choices with your advisor and confirm targets",
		],
		duration: "1–2 sessions",
	},
	{
		id: "admission-docs",
		title: "Admission Documentation",
		description:
			"Meticulous support gathering WASSCE/SSCE, degree certificates, transcripts, recommendations, English proofs, passport, CV, and more-aligned to each university's requirements.",
		detail:
			"Every university has its own documentation checklist, and a single missing or incorrectly formatted document can delay your application by weeks. We review every document before submission-transcripts, personal statements, recommendation letters, English proficiency certificates, passports, and CVs. We also coach you on personal statement structure and content, ensuring your application stands out to admissions committees.",
		deliverables: [
			"Complete document checklist per university",
			"Personal statement review and coaching",
			"Recommendation letter guidance",
			"Application submission and confirmation tracking",
		],
		process: [
			"Submit all original documents for review",
			"We format and organise per university requirements",
			"Personal statement coaching session",
			"Applications submitted and tracked to decision",
		],
		duration: "2–6 weeks",
	},
	{
		id: "visa-docs",
		title: "Visa Documentation",
		description:
			"Embassy-ready financial and supporting documents prepared so your student visa file is complete, consistent, and credible.",
		detail:
			"A visa refusal can undo months of admission work. We assemble embassy-ready visa files with meticulous attention to financial evidence, sponsorship letters, CAS/LOA documents, and embassy-specific forms. Every document is cross-checked for consistency-dates, names, amounts, and sponsors-so your file tells a coherent, credible story to the visa officer.",
		deliverables: [
			"Embassy-ready visa file",
			"Financial evidence review and organisation",
			"Sponsorship letter templates and guidance",
			"Document consistency check",
		],
		process: [
			"Receive your admission offer and CAS/LOA",
			"Submit financial documents for review",
			"We assemble and cross-check the complete file",
			"File ready for embassy submission",
		],
		duration: "1–3 weeks",
	},
	{
		id: "study-visa",
		title: "Study Visa",
		description:
			"Admission alone does not guarantee a visa. We guide you through the full study-visa process with professional, efficient delivery.",
		detail:
			"We handle the full study-visa application process-from filing the embassy forms to scheduling biometrics appointments and preparing you for the visa interview. Our team has years of experience with UK, USA, Canada, Germany, Australia, and UAE visa processes. We conduct mock interviews, review your supporting evidence, and track your application through to decision.",
		deliverables: [
			"Complete visa application filed",
			"Biometrics appointment scheduled",
			"Mock visa interview preparation",
			"Application tracking through to decision",
		],
		process: [
			"Visa file assembled and reviewed",
			"Embassy forms completed and filed",
			"Biometrics and interview preparation",
			"Visa decision tracked and communicated",
		],
		duration: "2–8 weeks",
	},
	{
		id: "travel",
		title: "Travel Arrangements",
		description:
			"Support continues after the visa-travel preparation and arrival guidance for students navigating the journey for the first time.",
		detail:
			"Once your visa is approved, we help you prepare for departure. This includes flight booking guidance, airport pickup arrangements, accommodation recommendations near your university, and a comprehensive pre-departure briefing. We cover practical topics-banking, SIM cards, weather preparation, cultural adjustment, and what to pack-so you arrive confident and ready to start your studies.",
		deliverables: [
			"Flight booking guidance and tips",
			"Airport pickup and accommodation support",
			"Pre-departure briefing (banking, SIM, culture)",
			"Post-arrival support network",
		],
		process: [
			"Visa approved-travel planning begins",
			"Flights and accommodation arranged",
			"Pre-departure briefing session",
			"Departure and post-arrival check-in",
		],
		duration: "1–2 weeks",
	},
];

export function getService(id: string) {
	return coreServices.find((s) => s.id === id);
}

export const testimonials = [
	{
		id: "t1",
		quote:
			"The support Century Nit Consult provided during my visa application was above and beyond. Their professionalism and efficient service delivery made a seemingly difficult visa application successful.",
		name: "Augustine Boateng",
		program: "Study abroad · Century Nit client",
		image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=80",
		country: "Ghana → Abroad",
	},
	{
		id: "t2",
		quote:
			"Before contacting Century Nit Consult, I was skeptical-but their team gave me the best results. Today I am in the UK pursuing my master’s. They’re just the best.",
		name: "Evans Sam",
		program: "Master’s · United Kingdom",
		image: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=200&q=80",
		country: "Ghana → UK",
	},
	{
		id: "t3",
		quote:
			"Ever grateful for their professional advice during my school and programme selection. I am currently doing my master’s in Germany thanks to Century Nit Consult.",
		name: "Godbless Adu",
		program: "Master’s · Germany",
		image: "https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=200&q=80",
		country: "Ghana → Germany",
	},
	{
		id: "t4",
		quote:
			"Century Nit Consult helped me throughout my entire process-from application through visa processing-stress-free. I recommend them to everyone interested in studying overseas.",
		name: "Bartels Kwesi Buabeng",
		program: "Study abroad · Full-service client",
		image: "https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200&q=80",
		country: "Ghana → Abroad",
	},
	{
		id: "t5",
		quote:
			"I would not hesitate to recommend Century Nit Consult to any potential student who seeks admission overseas.",
		name: "Ruth Nyamekye",
		program: "International admission",
		image: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&q=80",
		country: "Ghana → Abroad",
	},
	{
		id: "t6",
		quote:
			"God bless Century Nit Consult for helping me gain my UK study visa. Good customer service and great communication. I’m recommending you to my friends.",
		name: "Loius Dela Semeko",
		program: "UK Study Visa",
		image: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=200&q=80",
		country: "Ghana → UK",
	},
];

/**
 * Video testimonials for the Red Seat.
 *
 * NOTE: `videoUrl` values are placeholders — swap them for the real uploads
 * (or a YouTube/Vimeo embed URL) before this goes live. `poster` is what the
 * card shows until the viewer presses play.
 */
export const videoTestimonials = [
	{
		id: "v1",
		name: "Augustine Boateng",
		program: "MSc Public Health",
		country: "Ghana → United Kingdom",
		length: "2:14",
		headline: "“The visa file was airtight — I walked in confident.”",
		poster: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=800&q=80",
		videoUrl: "",
	},
	{
		id: "v2",
		name: "Evans Sam",
		program: "MBA International Business",
		country: "Ghana → United Kingdom",
		length: "1:48",
		headline: "“I was sceptical. Six months later I was in Manchester.”",
		poster: "https://images.unsplash.com/photo-1519085360753-af0119f7cbe7?w=800&q=80",
		videoUrl: "",
	},
	{
		id: "v3",
		name: "Priscilla Mensah",
		program: "BSc Computer Science",
		country: "Ghana → Canada",
		length: "3:02",
		headline: "“They shortlisted schools I would never have found.”",
		poster: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800&q=80",
		videoUrl: "",
	},
	{
		id: "v4",
		name: "Kwabena Osei",
		program: "MEng Mechanical Engineering",
		country: "Ghana → Germany",
		length: "2:37",
		headline: "“Tuition-free Germany was a real option, not a rumour.”",
		poster: "https://images.unsplash.com/photo-1560250097-0b93528c311a?w=800&q=80",
		videoUrl: "",
	},
	{
		id: "v5",
		name: "Ama Serwaa Adjei",
		program: "MSc Data Science",
		country: "Ghana → Canada",
		length: "1:55",
		headline: "“Mock interviews were the difference on the day.”",
		poster: "https://images.unsplash.com/photo-1580489944761-15a19d654956?w=800&q=80",
		videoUrl: "",
	},
	{
		id: "v6",
		name: "Yaw Antwi",
		program: "LLM International Law",
		country: "Ghana → Australia",
		length: "2:21",
		headline: "“Someone answered every time I called. Every time.”",
		poster: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=800&q=80",
		videoUrl: "",
	},
];


export const stats = [
	{ value: 2011, suffix: "", label: "Founded in Ghana" },
	{ value: 2, suffix: "", label: "Branches · Accra & Kumasi" },
	{ value: 6, suffix: "+", label: "Study destinations" },
	{ value: 100, suffix: "+", label: "Partner institutions" },
];

export const processSteps = [
	{
		step: "01",
		title: "Counsel",
		description:
			"Education advice and career counselling-matching strengths, budget, and ambitions to the right programme.",
		detail:
			"We start with a one-on-one consultation at our Accra or Kumasi office, or online. Your advisor reviews your academic background, career goals, budget, and preferred destinations, then maps a personalised study-abroad strategy.",
		deliverables: [
			"Personalised study-abroad roadmap",
			"Destination and programme shortlist",
			"Budget and funding plan",
		],
		duration: "1–2 sessions",
	},
	{
		step: "02",
		title: "Admit",
		description:
			"Admission documentation and applications prepared to each university's exact requirements.",
		detail:
			"We prepare and submit your university applications-transcripts, personal statements, recommendation letters, and English proficiency proof-tailored to each institution's requirements. We track every application and communicate with admissions offices on your behalf.",
		deliverables: [
			"Complete application file per university",
			"Statement of purpose review and coaching",
			"Admission offer tracking",
		],
		duration: "2–6 weeks",
	},
	{
		step: "03",
		title: "Visa",
		description:
			"Visa documentation and study-visa filing with embassy-ready financial and supporting evidence.",
		detail:
			"Once admitted, we assemble your visa file-financial evidence, sponsorship letters, CAS/LOA, and embassy forms. We conduct mock interviews, review every document, and file your study-visa application with confidence.",
		deliverables: [
			"Embassy-ready visa file",
			"Mock visa interview preparation",
			"Visa filing and tracking",
		],
		duration: "2–8 weeks",
	},
	{
		step: "04",
		title: "Travel",
		description:
			"Travel arrangements and departure support so you arrive prepared-not alone.",
		detail:
			"After your visa is approved, we help with flight bookings, airport pickup, accommodation guidance, and a pre-departure briefing covering banking, SIM cards, and what to expect in your new city.",
		deliverables: [
			"Flight and accommodation guidance",
			"Pre-departure briefing",
			"Post-arrival support network",
		],
		duration: "1–2 weeks",
	},
];

export const scholarships = [
	{
		id: "s1",
		name: "Century Global Excellence Award",
		amount: "Up to $25,000",
		amountUsd: 25000,
		amountQualifier: "Up to",
		deadline: "15 Mar 2026",
		eligibility: "Outstanding academic profile · Any destination",
		type: "Merit",
		description:
			"Our flagship award recognises students with exceptional academic records and clear, ambitious study goals. It is open to all destinations and levels of study.",
		criteria: [
			"First-class or equivalent undergraduate degree",
			"Demonstrated leadership or extracurricular impact",
			"Strong statement of purpose",
			"Offer from a partner university",
		],
		apply: [
			"Complete your Century Nit Consult journey registration",
			"Submit transcripts, CV, and statement of purpose",
			"Receive conditional or unconditional university offer",
			"Our team nominates your profile to the award committee",
		],
		benefits: [
			"Tuition coverage up to $25,000",
			"One-on-one mentorship with a senior strategist",
			"Priority visa and travel support",
			"Recognition on the Century Nit Scholars wall",
		],
		faq: [
			{ q: "Can I apply before receiving an offer?", a: "Yes - register your journey first. We nominate you after your university offer is confirmed." },
			{ q: "Is the award renewable?", a: "It is a one-time award applied toward your first year of study." },
			{ q: "Do I need to attend a specific university?", a: "No. The award is destination-agnostic and applies to any partner university." },
		],
	},
	{
		id: "s2",
		name: "STEM Futures Fellowship",
		amount: "Up to $15,000",
		amountUsd: 15000,
		amountQualifier: "Up to",
		deadline: "30 Apr 2026",
		eligibility: "STEM postgraduate applicants · UK, USA, Canada",
		type: "Field-specific",
		description:
			"Designed for students pursuing advanced degrees in science, technology, engineering, or mathematics at leading institutions in the UK, USA, or Canada.",
		criteria: [
			"STEM degree at bachelor's level or equivalent",
			"Research or industry experience in a STEM field",
			"Offer from an eligible STEM program",
			"Commitment to a career in science or technology",
		],
		apply: [
			"Indicate STEM field of interest during counselling",
			"Submit technical CV and reference letters",
			"Secure an offer from a listed STEM program",
			"Fellowship reviewed quarterly by the advisory board",
		],
		benefits: [
			"Fellowship stipend up to $15,000",
			"Access to STEM industry mentor network",
			"Conference travel grant (up to $1,500)",
			"Research publication coaching",
		],
		faq: [
			{ q: "Which fields qualify as STEM?", a: "Engineering, computer science, mathematics, physics, chemistry, biology, and related disciplines." },
			{ q: "Is the fellowship paid as a lump sum?", a: "No - it is disbursed in two instalments aligned with your academic terms." },
			{ q: "Can undergraduate students apply?", a: "This fellowship is for postgraduate applicants only." },
		],
	},
	{
		id: "s3",
		name: "Women in Leadership Bursary",
		amount: "$10,000",
		amountUsd: 10000,
		amountQualifier: "",
		deadline: "1 May 2026",
		eligibility: "Female applicants · Business & Public Policy",
		type: "Need + Merit",
		description:
			"This bursary supports women entering business, public policy, and leadership programs. It combines need-based and merit-based review.",
		criteria: [
			"Female applicant to business or public policy program",
			"Demonstrated leadership potential",
			"Financial need statement where applicable",
			"Admissions offer from an eligible institution",
		],
		apply: [
			"Share your leadership story with your counselor",
			"Submit a short goals statement and references",
			"Confirm program offer",
			"Bursary committee issues a decision within 4 weeks",
		],
		benefits: [
			"Bursary of $10,000 toward tuition",
			"Leadership coaching sessions (4 per term)",
			"Access to the Women in Leadership alumnae network",
			"Priority internship placement support",
		],
		faq: [
			{ q: "Do I need to prove financial need?", a: "A need statement is requested but not mandatory - the bursary considers both merit and need." },
			{ q: "Is this open to online programs?", a: "Yes, as long as the program is at an eligible institution." },
			{ q: "Can I hold another scholarship alongside this?", a: "Yes, up to the total cost of tuition." },
		],
	},
	{
		id: "s4",
		name: "Destination Canada Pathway Grant",
		amount: "CAD $8,000",
		amountUsd: 5900,
		amountQualifier: "",
		amountNote: "CAD $8,000",
		deadline: "Rolling",
		eligibility: "Canadian universities · PGWP-eligible programs",
		type: "Destination",
		description:
			"A destination grant for students choosing Canada and a post-graduation work permit-eligible program. It is awarded on a rolling basis as funds remain.",
		criteria: [
			"Offer from a Canadian university",
			"Program is PGWP-eligible",
			"Intended start within 12 months",
			"Study permit application in progress",
		],
		apply: [
			"Confirm your Canadian university offer",
			"Start your study permit documentation",
			"Request grant nomination through your counselor",
			"Grant disbursed after visa decision",
		],
		benefits: [
			"Grant of CAD $8,000",
			"Free study permit application support",
			"Post-arrival settlement briefing",
			"PGWP planning session",
		],
		faq: [
			{ q: "What if my program is not PGWP-eligible?", a: "Unfortunately this grant requires a PGWP-eligible program. Ask your counselor about alternatives." },
			{ q: "When is the deadline?", a: "Rolling - we review nominations as funds remain, so apply early." },
			{ q: "Is the grant paid before or after visa?", a: "After your visa is approved, to confirm enrolment intent." },
		],
	},
];

export const articles = [
	{
		id: "a1",
		title: "How top applicants structure a personal statement in 2026",
		category: "Admissions",
		readTime: "8 min",
		date: "12 Jul 2026",
		image: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=800&q=80",
		excerpt: "A framework used by our counselors to help students write statements that admissions committees actually remember.",
	},
	{
		id: "a2",
		title: "UK vs Canada: choosing your post-study work strategy",
		category: "Destinations",
		readTime: "11 min",
		date: "28 Jun 2026",
		image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=800&q=80",
		excerpt: "Compare Graduate Route and PGWP pathways-and decide which aligns with your long-term mobility goals.",
	},
	{
		id: "a3",
		title: "Scholarship timelines you cannot afford to miss",
		category: "Funding",
		readTime: "6 min",
		date: "5 Jun 2026",
		image: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=800&q=80",
		excerpt: "Deadlines, documents, and decision windows for the awards that fund real students every cycle.",
	},
];

export const faqs = [
	{
		q: "Where is Century Nit Consult based?",
		a: "We are headquartered in Ghana with branches in Accra (Mile 7 Aku Link, Pentecost Junction) and Kumasi (Santasi, adjacent the post office). Hours: Mon–Fri 8am–5pm, Sat 9am–12pm.",
	},
	{
		q: "What services do you offer?",
		a: "Education advice and career counselling, admission documentation, visa documentation, study visas, and travel arrangements-from first interest through departure.",
	},
	{
		q: "Which countries can I study in?",
		a: "Favourite destinations include the United Kingdom, United States, Canada, Germany, Australia, and the UAE-plus partner institutions across our network.",
	},
	{
		q: "What documents do I typically need for admission?",
		a: "Common requirements include WASSCE/SSCE or degree certificates, transcripts, academic or professional recommendation letters, English proficiency proof, a valid passport, and a CV. We guide you to each university’s exact list.",
	},
	{
		q: "Do you help after the visa is approved?",
		a: "Yes. Our travel arrangements support continues after the visa so you can prepare for departure with confidence.",
	},
	{
		q: "How do I start an online application on this platform?",
		a: "Sign in (social, email, or OTP), complete the multi-step form, pay the application fee, and receive your Application ID with portal activation instructions.",
	},
	{
		q: "How can I reach you?",
		a: "Email info@centurynit.com. Accra: +233 554 717 878 / +233 554 914 101. Kumasi: +233 545 130 650 / +233 537 594 408.",
	},
];

export const events = [
	{
		id: "e1",
		title: "Accra consultation day",
		date: "Rolling",
		time: "By appointment · Accra branch",
		type: "In-person",
		description: "Meet advisors at Mile 7 Aku Link for programme selection, admission, and visa planning.",
	},
	{
		id: "e2",
		title: "Kumasi walk-in hours",
		date: "Mon – Sat",
		time: "Branch hours · Santasi",
		type: "In-person",
		description: "Visit our Kumasi office for study-abroad counselling and documentation support.",
	},
	{
		id: "e3",
		title: "News & Red Seat stories",
		date: "Ongoing",
		time: "Online",
		type: "News",
		description: "Follow client success stories and latest news via our Red Seat and news channels.",
	},
];

export const successStories = [
	{
		id: "ss1",
		name: "Evans Sam",
		from: "Ghana",
		to: "United Kingdom",
		program: "Master’s studies",
		image: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?w=600&q=80",
		summary:
			"Trusted the consult after initial skepticism-and is now pursuing a master’s in the UK with Century Nit’s full support.",
	},
	{
		id: "ss2",
		name: "Godbless Adu",
		from: "Ghana",
		to: "Germany",
		program: "Master’s studies",
		image: "https://images.unsplash.com/photo-1467269204594-9661b134dd2b?w=600&q=80",
		summary:
			"Professional school and programme selection guidance led to a master’s pathway in Germany.",
	},
	{
		id: "ss3",
		name: "Solomon Donkor",
		from: "Ghana",
		to: "United Kingdom",
		program: "UK study pathway",
		image: "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=600&q=80",
		summary:
			"What once felt complicated became clear-Century Nit made the UK study dream a reality.",
	},
];

export const spotlightOffers = [
	{
		id: "sp1",
		title: "Study in Germany",
		blurb: "World-class education with strong STEM and research pathways for ambitious students.",
		to: "/destinations/germany",
	},
	{
		id: "sp2",
		title: "Study & care pathways in the UK",
		blurb: "UK higher education with global recognition-and guidance through competitive visa processes.",
		to: "/destinations/uk",
	},
	{
		id: "sp3",
		title: "Study in Canada",
		blurb: "Renowned education quality with post-study work and long-term mobility options.",
		to: "/destinations/canada",
	},
];

export function getUniversity(id: string) {
	return universities.find((u) => u.id === id);
}

export function getDestination(id: string) {
	return destinations.find((d) => d.id === id);
}

export function getProgram(id: string) {
	return programs.find((p) => p.id === id);
}

export function getScholarship(id: string) {
	return scholarships.find((s) => s.id === id);
}

export function programsForUniversity(universityId: string) {
	return programs.filter((p) => p.universityId === universityId);
}

export function universitiesForDestination(destinationId: string) {
	return universities.filter((u) => u.destinationId === destinationId);
}

/** Legacy apply wizard fee (kept for old routes) */
export const APPLICATION_FEE = 150;
/** Stage invoice amounts */
export const APPLICATION_STAGE_FEE = 250;
export const VISA_STAGE_FEE = 350;

export const STORAGE_KEY = "century-nit-application";
export const BOOKING_STORAGE_KEY = "century-nit-booking";
export const AUTH_STORAGE_KEY = "century-nit-auth";
export const PORTAL_DOCS_KEY = "century-nit-portal-docs";
export const PORTAL_INTERVIEW_KEY = "century-nit-portal-interview";
export const SCHOOL_APPS_KEY = "century-nit-school-apps";
export const MESSAGES_KEY = "century-nit-messages";
export const NOTIFICATIONS_KEY = "century-nit-notifications";
export const PRE_DEPARTURE_KEY = "century-nit-pre-departure";

/**
 * Application process (invoices gate the work):
 * Consultation → Package → Select schools → Application invoice (pay) → Tracking
 * → Admitted → Visa invoice (pay) → Visa tracking → Payment plan → Agency → Complete
 */
export type ProcessStageId =
	| "new"
	| "consultation"
	| "eligibility"
	| "proceed"
	| "school_package"
	| "school_select"
	| "application_invoice"
	| "school_tracking"
	| "visa_invoice"
	| "visa"
	| "pre_departure"
	| "completed";

export const PROCESS_STAGES: {
	id: ProcessStageId;
	index: number;
	label: string;
	detail: string;
	owner: "you" | "counselor" | "system";
	path?: string;
	band: "consultation" | "application" | "visa" | "travel" | "done";
}[] = [
	{
		id: "new",
		index: 0,
		label: "New",
		detail: "Start your application journey",
		owner: "you",
		path: "/portal/home",
		band: "consultation",
	},
	{
		id: "consultation",
		index: 1,
		label: "Stage I · Consultation",
		detail: "Type, branch, assessment & documents",
		owner: "you",
		path: "/portal/consultation",
		band: "consultation",
	},
	{
		id: "eligibility",
		index: 2,
		label: "Eligibility",
		detail: "Handler outcome after consultation",
		owner: "counselor",
		path: "/portal/consultation",
		band: "consultation",
	},
	{
		id: "proceed",
		index: 3,
		label: "Start your application",
		detail: "Confirm you want to proceed after your eligibility result",
		owner: "you",
		path: "/portal/application",
		band: "application",
	},
	{
		id: "school_package",
		index: 4,
		label: "School application package",
		detail: "Scholarship / non-scholarship · degree level",
		owner: "you",
		path: "/portal/package",
		band: "application",
	},
	{
		id: "school_select",
		index: 5,
		label: "Select schools",
		detail: "Choose schools & programmes first",
		owner: "you",
		path: "/portal/application",
		band: "application",
	},
	{
		id: "application_invoice",
		index: 6,
		label: "Application invoice",
		detail: "Raised after selection - pay before tracking starts",
		owner: "you",
		path: "/portal/application",
		band: "application",
	},
	{
		id: "school_tracking",
		index: 7,
		label: "Application tracking",
		detail: "Process begins only after invoice is paid",
		owner: "counselor",
		path: "/portal/application",
		band: "application",
	},
	{
		id: "visa_invoice",
		index: 8,
		label: "Visa invoice",
		detail: "Raised on admission - pay before visa process starts",
		owner: "you",
		path: "/portal/visa",
		band: "visa",
	},
	{
		id: "visa",
		index: 9,
		label: "Visa tracking",
		detail: "Simulated visa processing after payment",
		owner: "counselor",
		path: "/portal/visa",
		band: "visa",
	},
	{
		id: "pre_departure",
		index: 10,
		label: "Travel & pre-departure",
		detail: "Flights, accommodation, insurance & arrival briefing",
		owner: "you",
		path: "/portal/pre-departure",
		band: "travel",
	},
	{
		id: "completed",
		index: 11,
		label: "Complete",
		detail: "Journey finished - last step",
		owner: "system",
		path: "/portal/complete",
		band: "done",
	},
];

/** Fee simulation amounts (USD) - GHS equivalents derived via GHS_RATE */
import { usdFromCents, type FeeSchedule } from "century-nit-shared";

/** Legacy apply wizard fee (kept for old routes) */
export const APPLICATION_FEE_GHS = APPLICATION_FEE * GHS_RATE;
export const APPLICATION_STAGE_FEE_GHS = APPLICATION_STAGE_FEE * GHS_RATE;
export const VISA_STAGE_FEE_GHS = VISA_STAGE_FEE * GHS_RATE;

export type InvoiceLine = {
	id: string;
	label: string;
	detail: string;
	amount: number;
};

export function appInvoiceEstimateLines(schoolCount: number, fees: FeeSchedule): InvoiceLine[] {
	const count = Math.max(0, schoolCount);
	const base = usdFromCents(fees.appBaseCents);
	const perSchool = usdFromCents(fees.appPerSchoolCents);
	return [
		{
			id: "app-base",
			label: "Application processing",
			detail: "Century desk setup, document handling & case opening",
			amount: base,
		},
		...(count > 0
			? [
					{
						id: "app-per-school",
						label: `University applications (${count} × $${perSchool})`,
						detail: "Per-institution submission & liaison fee",
						amount: count * perSchool,
					},
				]
			: []),
	];
}

export function appInvoiceActualLines(schoolCount: number, fees: FeeSchedule): InvoiceLine[] {
	const docVerify = usdFromCents(fees.appDocVerifyCents);
	const matchReview = usdFromCents(fees.appMatchReviewCents);
	return [
		...appInvoiceEstimateLines(schoolCount, fees),
		{
			id: "app-docs",
			label: "Document verification & courier",
			detail: "Transcripts and certificates verified and shipped",
			amount: docVerify,
		},
		{
			id: "app-review",
			label: "Course matching review",
			detail: "Programme fit, credit mapping & offer comparison",
			amount: matchReview,
		},
	];
}

export function visaInvoiceEstimateLines(fees: FeeSchedule): InvoiceLine[] {
	const visaBase = usdFromCents(fees.visaBaseCents);
	return [
		{
			id: "visa-case",
			label: "Visa case processing",
			detail: "Visa desk opens your case and prepares the file",
			amount: visaBase,
		},
	];
}

export function visaInvoiceActualLines(fees: FeeSchedule): InvoiceLine[] {
	const visaBase = usdFromCents(fees.visaBaseCents);
	const bio = usdFromCents(fees.visaBiometricsCents);
	const trans = usdFromCents(fees.visaTranslationCents);
	return [
		{
			id: "visa-case",
			label: "Visa case processing",
			detail: "Visa desk prepares your file and application pack",
			amount: visaBase,
		},
		{
			id: "visa-bio",
			label: "Biometrics appointment",
			detail: "Embassy biometrics slot booking & guidance",
			amount: bio,
		},
		{
			id: "visa-trans",
			label: "Translation & courier",
			detail: "Document translation and embassy courier",
			amount: trans,
		},
	];
}

export function sumInvoiceLines(lines: InvoiceLine[]) {
	return lines.reduce((sum, l) => sum + l.amount, 0);
}

/**
 * Sidebar stages - unlock one by one as you click Next / complete steps.
 * Schools (select + pay) and Tracking are separate pages.
 */
export type PortalChapterId =
	| "journey"
	| "consultation"
	| "package"
	| "application"
	| "tracking"
	| "visa"
	| "pre_departure"
	| "complete";

export const PORTAL_CHAPTERS: {
	id: PortalChapterId;
	step: string;
	label: string;
	blurb: string;
	unlockHint: string;
	path: string;
}[] = [
	{
		id: "journey",
		step: "⌂",
		label: "Home",
		blurb: "Dashboard overview",
		unlockHint: "Always open",
		path: "/portal/home",
	},
	{
		id: "consultation",
		step: "I",
		label: "Consultation",
		blurb: "First stage",
		unlockHint: "Start here",
		path: "/portal/consultation",
	},
	{
		id: "package",
		step: "II",
		label: "School package",
		blurb: "Scholarship · degree",
		unlockHint: "Unlocks after eligibility",
		path: "/portal/package",
	},
	{
		id: "application",
		step: "III",
		label: "Schools & pay",
		blurb: "Select schools · invoice",
		unlockHint: "Unlocks after school package",
		path: "/portal/application",
	},
	{
		id: "tracking",
		step: "IV",
		label: "Tracking & offers",
		blurb: "Process · offer review",
		unlockHint: "Unlocks after application invoice paid",
		path: "/portal/tracking",
	},
	{
		id: "visa",
		step: "V",
		label: "Visa & travel",
		blurb: "Invoice then tracking",
		unlockHint: "Unlocks when admitted",
		path: "/portal/visa",
	},
	{
		id: "pre_departure",
		step: "VIII",
		label: "Pre-departure",
		blurb: "Travel checklist",
		unlockHint: "Unlocks after agency settled",
		path: "/portal/pre-departure",
	},
	{
		id: "complete",
		step: "✓",
		label: "Complete",
		blurb: "Last step",
		unlockHint: "Unlocks when settled",
		path: "/portal/complete",
	},
];

/** School application packages - funding track × degree level (not service tiers) */
export type SchoolFundingTrack = "scholarship" | "non_scholarship" | "hybrid";
export type SchoolDegreeLevel =
	| "diploma"
	| "bachelor"
	| "masters"
	| "phd"
	| "professional";

export const SCHOOL_FUNDING_TRACKS: {
	id: SchoolFundingTrack;
	name: string;
	tagline: string;
	blurb: string;
}[] = [
	{
		id: "scholarship",
		name: "Scholarship package",
		tagline: "Funded / award-led path",
		blurb: "Prioritise institutions and programmes with scholarships, waivers, and funding windows.",
	},
	{
		id: "non_scholarship",
		name: "Non-scholarship package",
		tagline: "Self-funded / family-funded",
		blurb: "Focus on programme fit and clear self-funding capacity - no scholarship dependency.",
	},
	{
		id: "hybrid",
		name: "Hybrid package",
		tagline: "Partial award + self-fund",
		blurb: "Mix of scholarship targets and self-funded backups on the same tracking board.",
	},
];

export const SCHOOL_DEGREE_LEVELS: {
	id: SchoolDegreeLevel;
	name: string;
	short: string;
	blurb: string;
}[] = [
	{
		id: "diploma",
		name: "Diploma / Certificate",
		short: "Diploma",
		blurb: "Foundation, HND, or professional certificate tracks.",
	},
	{
		id: "bachelor",
		name: "Bachelor's (BSc / BA)",
		short: "BSc / BA",
		blurb: "Undergraduate degrees across STEM, business, and arts.",
	},
	{
		id: "masters",
		name: "Master's",
		short: "Master's",
		blurb: "MSc, MA, MBA and taught postgraduate programmes.",
	},
	{
		id: "phd",
		name: "PhD / Research",
		short: "PhD",
		blurb: "Doctoral and research-led pathways.",
	},
	{
		id: "professional",
		name: "Professional / PG diploma",
		short: "Professional",
		blurb: "Post-experience and conversion programmes.",
	},
];

export type PaymentPlanId = "full" | "installment";

export const PAYMENT_PLANS = [
	{
		id: "full" as const,
		name: "Full payment",
		blurb: "Pay the remaining balance in one payment.",
		discountLabel: "Preferred",
	},
	{
		id: "installment" as const,
		name: "Installment plan",
		blurb: "Split the remaining balance: one payment before departure, one after arrival.",
		discountLabel: "Flexible",
	},
];

/** Agency settlement milestones (Stage IV) */
/**
 * Century NIT's own service fee, by funding track.
 *
 * Separate from the three stage invoices (consultation, application, visa) and
 * known the moment a package is chosen — which is why the package step now
 * discloses it up front rather than surfacing it after the visa is granted.
 */
export function serviceFeeFor(track: SchoolFundingTrack | ""): number {
	if (!track) return 0;
	const id = track === "scholarship" ? "standard" : "premium";
	return servicePackages.find((p) => p.id === id)?.price ?? 0;
}

/** Required deposit before a payment plan can be chosen */
export const AGENCY_DEPOSIT_PORTION = 0.1;

/**
 * Milestones for the service fee settlement.
 *
 * The deposit is paid first and gates plan selection. The remaining balance
 * is then split per the chosen plan — full or installments. Payment can
 * continue after departure; only the deposit is required upfront.
 */
export const AGENCY_STAGES = [
	{
		id: "agency_deposit",
		label: "Service fee · deposit",
		detail: "Required before choosing your payment plan",
		portion: AGENCY_DEPOSIT_PORTION,
	},
	{
		id: "agency_predeparture",
		label: "Service fee · pre-departure",
		detail: "Due before you travel to your destination",
		portion: 0.5,
	},
	{
		id: "agency_postarrival",
		label: "Service fee · post-arrival",
		detail: "Settle after you've arrived — no deadline pressure",
		portion: 0.4,
	},
] as const;

/**
 * Recurring schedule options for the post-arrival portion of the installment plan.
 *
 * After choosing the installment plan and paying the pre-departure milestone,
 * the applicant picks a frequency for the remaining 40%. Each option splits
 * the balance into equal payments with a grace period before the first one.
 */
export const POST_ARRIVAL_SCHEDULES = [
	{
		id: "weekly" as const,
		label: "Weekly",
		detail: "8 payments — every week",
		payments: 8,
		intervalDays: 7,
		graceDays: 14,
	},
	{
		id: "biweekly" as const,
		label: "Bi-weekly",
		detail: "4 payments — every 2 weeks",
		payments: 4,
		intervalDays: 14,
		graceDays: 14,
	},
	{
		id: "monthly" as const,
		label: "Monthly",
		detail: "4 payments — every month",
		payments: 4,
		intervalDays: 30,
		graceDays: 30,
	},
	{
		id: "quarterly" as const,
		label: "Quarterly",
		detail: "2 payments — every 3 months",
		payments: 2,
		intervalDays: 90,
		graceDays: 30,
	},
] as const;

export type PostArrivalScheduleId =
	(typeof POST_ARRIVAL_SCHEDULES)[number]["id"];

export type SchoolTrackStatus =
	| "queued"
	| "submitted"
	| "under_review"
	| "additional_info"
	| "offer"
	| "accepted"
	| "rejected"
	| "withdrawn";

export const SCHOOL_TRACK_STATUS_LABELS: Record<SchoolTrackStatus, string> = {
	queued: "Queued",
	submitted: "Submitted (tracking)",
	under_review: "Under review",
	additional_info: "Additional info",
	offer: "Offer received",
	accepted: "Accepted",
	rejected: "Rejected",
	withdrawn: "Withdrawn",
};

export const REQUIRED_DOCUMENTS = [
	{
		id: "passport",
		name: "Passport bio page",
		hint: "Clear colour scan of the photo page — all four corners visible, valid 6+ months beyond travel",
	},
	{
		id: "transcript",
		name: "Academic transcript",
		hint: "Official or certified copy — every page, with legible stamps and signatures",
	},
	{
		id: "diploma",
		name: "Diploma / certificate",
		hint: "Highest completed qualification — the final award certificate, not a result slip",
	},
	{
		id: "statement",
		name: "Personal statement",
		hint: "PDF preferred, 500–800 words — why this course, and why this country",
	},
	{
		id: "recommendation",
		name: "Recommendation letter",
		hint: "On institutional letterhead, signed and dated within the last 12 months",
	},
	{
		id: "english",
		name: "English proficiency",
		hint: "IELTS / TOEFL score report, or a waiver letter from your institution",
	},
] as const;

/**
 * Maps a document‑type id (the `documentType` stored on the row) to a
 * human‑readable category shown in the ops Document Vault.
 *
 * The vault groups and labels documents by this category so reviewers can
 * scan at a glance rather than reading raw type slugs.
 */
export const DOCUMENT_TYPE_CATEGORIES: Record<string, string> = {
	passport: "IDENTITY",
	transcript: "ACADEMIC",
	transcripts: "ACADEMIC",
	diploma: "ACADEMIC",
	certificates: "ACADEMIC",
	cv: "PROFESSIONAL",
	english: "LANGUAGE",
	financial: "FINANCIAL",
	statement: "FINANCIAL",
	sponsorship: "FINANCIAL",
	recommendation: "ACADEMIC",
	additional: "OTHER",
};

/** Resolve a documentType to a display category, falling back gracefully. */
export function documentCategory(documentType: string): string {
	return DOCUMENT_TYPE_CATEGORIES[documentType] ?? "OTHER";
}

export const INTERVIEW_SLOTS = [
	{ id: "mon-10", day: "Monday", date: "2026-09-08", time: "10:00", label: "Mon · 10:00 GMT" },
	{ id: "mon-14", day: "Monday", date: "2026-09-08", time: "14:00", label: "Mon · 14:00 GMT" },
	{ id: "tue-11", day: "Tuesday", date: "2026-09-09", time: "11:00", label: "Tue · 11:00 GMT" },
	{ id: "wed-09", day: "Wednesday", date: "2026-09-10", time: "09:00", label: "Wed · 09:00 GMT" },
	{ id: "wed-15", day: "Wednesday", date: "2026-09-10", time: "15:30", label: "Wed · 15:30 GMT" },
	{ id: "thu-13", day: "Thursday", date: "2026-09-11", time: "13:00", label: "Thu · 13:00 GMT" },
	{ id: "fri-10", day: "Friday", date: "2026-09-12", time: "10:30", label: "Fri · 10:30 GMT" },
] as const;

/* ========== Messaging ========== */

export type ChatMessage = {
	id: string;
	sender: "applicant" | "consultant" | "ai" | "support";
	authorName: string;
	text: string;
	at: string;
};

/* ========== Notifications ========== */

export type AppNotification = {
	id: string;
	type: "stage" | "invoice" | "document" | "visa" | "message" | "payment";
	title: string;
	body: string;
	at: string;
	read: boolean;
	link?: string;
};

/* ========== Pre-departure checklist ========== */

export type PreDepartureTask = {
	id: string;
	category: "travel" | "accommodation" | "documents" | "health" | "finance" | "orientation";
	label: string;
	detail: string;
	done: boolean;
};

export const PRE_DEPARTURE_TASKS: PreDepartureTask[] = [
	{ id: "pd-flights", category: "travel", label: "Book flights", detail: "Book your flight to arrive at least 1 week before orientation.", done: false },
	{ id: "pd-airport", category: "travel", label: "Arrange airport pickup", detail: "Check if your university offers free airport pickup for international students.", done: false },
	{ id: "pd-accommodation", category: "accommodation", label: "Confirm accommodation", detail: "Secure on-campus housing or private rental before departure.", done: false },
	{ id: "pd-utilities", category: "accommodation", label: "Set up utilities", detail: "If renting privately, arrange internet, electricity, and water connections.", done: false },
	{ id: "pd-visa-copy", category: "documents", label: "Print visa & passport copies", detail: "Keep physical and digital copies of your visa, passport, and admission letter.", done: false },
	{ id: "pd-insurance", category: "health", label: "Arrange health insurance", detail: "Purchase international student health insurance or enroll in the university plan.", done: false },
	{ id: "pd-vaccinations", category: "health", label: "Check vaccination requirements", detail: "Review required vaccinations for your destination country.", done: false },
	{ id: "pd-budget", category: "finance", label: "Set up banking access", detail: "Open a local bank account or arrange international card access for your destination.", done: false },
	{ id: "pd-tuition", category: "finance", label: "Confirm tuition payment plan", detail: "Verify tuition payment deadlines and methods with your university.", done: false },
	{ id: "pd-orientation", category: "orientation", label: "Register for orientation", detail: "Sign up for international student orientation day.", done: false },
	{ id: "pd-sim", category: "orientation", label: "Get a local SIM card", detail: "Arrive with a plan to get a local phone number within 48 hours.", done: false },
	{ id: "pd-packing", category: "travel", label: "Review packing checklist", detail: "Pack for the climate, bring adapters, and keep essentials in carry-on.", done: false },
];

/* ========== CRM Lead Pipeline ========== */

export type LeadStage = "new" | "contacted" | "consultation_booked" | "assessment_complete" | "converted" | "lost";

export type Lead = {
	id: string;
	name: string;
	email: string;
	phone: string;
	source: string;
	country: string;
	stage: LeadStage;
	assignedTo: string;
	createdAt: string;
	lastContactAt: string;
	notes: string;
	consultationId?: string | null;
	applicationId?: string | null;
};

export const LEAD_STAGE_LABELS: Record<LeadStage, string> = {
	new: "New Lead",
	contacted: "Contacted",
	consultation_booked: "Consultation Booked",
	assessment_complete: "Assessment Complete",
	converted: "Enrolled",
	lost: "Lost",
};

export const LEAD_STAGE_ORDER: LeadStage[] = [
	"new",
	"contacted",
	"consultation_booked",
	"assessment_complete",
	"converted",
	"lost",
];

export const SEED_LEADS: Lead[] = [
	{
		id: "lead-1",
		name: "Kofi Asante",
		email: "kofi.asante@example.com",
		phone: "+233 24 555 0123",
		source: "Website form",
		country: "Ghana",
		stage: "new",
		assignedTo: "Efua Owusu",
		createdAt: new Date(Date.now() - 86400000).toISOString(),
		lastContactAt: new Date(Date.now() - 86400000).toISOString(),
		notes: "Interested in UK computer science programs.",
	},
	{
		id: "lead-2",
		name: "Abena Frimpong",
		email: "abena.f@example.com",
		phone: "+233 27 765 4321",
		source: "Instagram ad",
		country: "Ghana",
		stage: "contacted",
		assignedTo: "Efua Owusu",
		createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
		lastContactAt: new Date(Date.now() - 86400000 * 2).toISOString(),
		notes: "Looking for scholarship options in Canada.",
	},
	{
		id: "lead-3",
		name: "Kwame Mensah",
		email: "kwame.m@example.com",
		phone: "+233 24 123 4567",
		source: "Referral",
		country: "Ghana",
		stage: "assessment_complete",
		assignedTo: "Kwame Agyeman",
		createdAt: new Date(Date.now() - 86400000 * 5).toISOString(),
		lastContactAt: new Date(Date.now() - 86400000 * 4).toISOString(),
		notes: "PhD in Engineering - full funding required.",
	},
	{
		id: "lead-4",
		name: "Nana Adwoa",
		email: "nana.adwoa@example.com",
		phone: "+233 20 334 5566",
		source: "Google search",
		country: "Ghana",
		stage: "consultation_booked",
		assignedTo: "Efua Owusu",
		createdAt: new Date(Date.now() - 86400000 * 7).toISOString(),
		lastContactAt: new Date(Date.now() - 86400000 * 3).toISOString(),
		notes: "Consultation booked for Friday. Interested in Australia.",
	},
	{
		id: "lead-5",
		name: "Daniel Osei",
		email: "daniel.o@example.com",
		phone: "+233 20 987 6543",
		source: "Career fair",
		country: "Ghana",
		stage: "assessment_complete",
		assignedTo: "Kwame Agyeman",
		createdAt: new Date(Date.now() - 86400000 * 10).toISOString(),
		lastContactAt: new Date(Date.now() - 86400000 * 5).toISOString(),
		notes: "Strong candidate - 3.8 GPA, 2 years experience. Recommended UK MSc programs.",
	},
	{
		id: "lead-6",
		name: "Ama Serwaa",
		email: "ama.serwaa@example.com",
		phone: "+233 26 998 1122",
		source: "Referral",
		country: "Ghana",
		stage: "converted",
		assignedTo: "Efua Owusu",
		createdAt: new Date(Date.now() - 86400000 * 15).toISOString(),
		lastContactAt: new Date(Date.now() - 86400000 * 8).toISOString(),
		notes: "Converted to applicant. Now in active application pipeline.",
	},
	{
		id: "lead-7",
		name: "Emmanuel Owusu",
		email: "emmanuel.o@example.com",
		phone: "+233 24 667 8899",
		source: "Website form",
		country: "Ghana",
		stage: "lost",
		assignedTo: "Kwame Agyeman",
		createdAt: new Date(Date.now() - 86400000 * 20).toISOString(),
		lastContactAt: new Date(Date.now() - 86400000 * 14).toISOString(),
		notes: "Decided to apply independently. No longer interested in agency services.",
	},
];
