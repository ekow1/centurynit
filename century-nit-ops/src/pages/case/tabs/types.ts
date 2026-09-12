/** What every chapter tab is handed by the case detail. */
export type Flash = (message: string) => void;
export type Fail = (err: unknown, fallback: string) => void;
export type TabId = "overview" | "consultation" | "enrolment" | "application" | "visa" | "travel" | "payments" | "documents";
