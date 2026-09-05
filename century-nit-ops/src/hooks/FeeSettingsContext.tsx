import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { API_PREFIX, DEFAULT_FEE_CENTS } from "century-nit-shared";
import { apiFetch } from "../lib/api";

export type InvoiceMode = "proforma" | "issued";

/** Per-fee-key issuance modes — e.g. { CONSULTATION_FEE_CENTS: "issued", VISA_BASE_FEE_CENTS: "proforma" } */
export type FeeIssuanceModes = Record<string, InvoiceMode>;

/** Default per-fee modes used when no DB setting exists yet. */
const DEFAULT_FEE_MODES: FeeIssuanceModes = {
	CONSULTATION_FEE_CENTS: "issued",
	APP_BASE_FEE_CENTS: "proforma",
	APP_PER_SCHOOL_FEE_CENTS: "proforma",
	APP_DOC_VERIFY_FEE_CENTS: "proforma",
	APP_MATCH_REVIEW_FEE_CENTS: "proforma",
	VISA_BASE_FEE_CENTS: "proforma",
	VISA_BIOMETRICS_FEE_CENTS: "proforma",
	VISA_TRANSLATION_FEE_CENTS: "proforma",
	TRAVEL_COORDINATION_FEE_CENTS: "proforma",
	HOUSING_ASSISTANCE_FEE_CENTS: "proforma",
	PRE_DEPARTURE_BRIEFING_FEE_CENTS: "proforma",
};

export interface FeeSettingsState {
	feeCents: typeof DEFAULT_FEE_CENTS;
	feeModes: FeeIssuanceModes;
	loading: boolean;
	refresh: () => Promise<void>;
}

const FEE_CENTS_MAPPING: Record<string, keyof typeof DEFAULT_FEE_CENTS> = {
	APP_BASE_FEE_CENTS: "appBase",
	APP_PER_SCHOOL_FEE_CENTS: "appPerSchool",
	APP_DOC_VERIFY_FEE_CENTS: "appDocVerify",
	APP_MATCH_REVIEW_FEE_CENTS: "appMatchReview",
	VISA_BASE_FEE_CENTS: "visaBase",
	VISA_BIOMETRICS_FEE_CENTS: "visaBiometrics",
	VISA_TRANSLATION_FEE_CENTS: "visaTranslation",
	CONSULTATION_FEE_CENTS: "consultation",
};

const FeeSettingsContext = createContext<FeeSettingsState | null>(null);

export function useFeeSettings() {
	const ctx = useContext(FeeSettingsContext);
	if (!ctx) throw new Error("useFeeSettings must be used within FeeSettingsProvider");
	return ctx;
}

export function FeeSettingsProvider({ children }: { children: ReactNode }) {
	const [feeCents, setFeeCents] = useState<typeof DEFAULT_FEE_CENTS>(DEFAULT_FEE_CENTS);
	const [feeModes, setFeeModes] = useState<FeeIssuanceModes>(DEFAULT_FEE_MODES);
	const [loading, setLoading] = useState(true);

	const refresh = async () => {
		try {
			const res = await apiFetch<{ settings: { key: string; valueMasked: string | null }[] }>(`${API_PREFIX}/settings`);
			
			// --- fee amounts ---
			const nextFees = { ...DEFAULT_FEE_CENTS } as Record<keyof typeof DEFAULT_FEE_CENTS, number>;
			for (const [dbKey, objKey] of Object.entries(FEE_CENTS_MAPPING)) {
				const found = res.settings.find((s) => s.key === dbKey);
				if (found && found.valueMasked) {
					const val = parseInt(found.valueMasked, 10);
					if (!isNaN(val)) nextFees[objKey] = val;
				}
			}
			setFeeCents(nextFees as typeof DEFAULT_FEE_CENTS);

			// --- per-fee issuance modes ---
			const modesSetting = res.settings.find((s) => s.key === "FEE_ISSUANCE_MODES");
			if (modesSetting && modesSetting.valueMasked) {
				try {
					const parsed = JSON.parse(modesSetting.valueMasked);
					setFeeModes((prev) => ({ ...prev, ...parsed }));
				} catch (e) {
					console.error("Failed to parse FEE_ISSUANCE_MODES", e);
				}
			}
		} catch (e) {
			console.error("Failed to fetch fee settings", e);
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void refresh();
	}, []);

	return (
		<FeeSettingsContext.Provider value={{ feeCents, feeModes, loading, refresh }}>
			{children}
		</FeeSettingsContext.Provider>
	);
}
