import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { API_PREFIX, DEFAULT_FEE_CENTS } from "century-nit-shared";
import { apiFetch } from "../lib/api";
import type { InvoiceType } from "century-nit-core/ops";

export type InvoiceMode = "proforma" | "issued";

export interface FeeSettingsState {
	feeCents: typeof DEFAULT_FEE_CENTS;
	issuanceDefaults: Record<string, InvoiceMode>;
	loading: boolean;
	refresh: () => Promise<void>;
}

const FeeSettingsContext = createContext<FeeSettingsState | null>(null);

export function useFeeSettings() {
	const ctx = useContext(FeeSettingsContext);
	if (!ctx) throw new Error("useFeeSettings must be used within FeeSettingsProvider");
	return ctx;
}

export function FeeSettingsProvider({ children }: { children: ReactNode }) {
	const [feeCents, setFeeCents] = useState<typeof DEFAULT_FEE_CENTS>(DEFAULT_FEE_CENTS);
	const [issuanceDefaults, setIssuanceDefaults] = useState<Record<string, InvoiceMode>>({
		Consultation: "issued",
		Application: "proforma",
		Visa: "proforma",
		Travel: "proforma",
		Agency: "proforma",
		Custom: "issued",
	});
	const [loading, setLoading] = useState(true);

	const refresh = async () => {
		try {
			const res = await apiFetch<{ settings: { key: string; valueMasked: string | null }[] }>(`${API_PREFIX}/settings`);
			
			const nextFees = { ...DEFAULT_FEE_CENTS };
			const mapping: Record<string, keyof typeof DEFAULT_FEE_CENTS> = {
				APP_BASE_FEE_CENTS: "appBase",
				APP_PER_SCHOOL_FEE_CENTS: "appPerSchool",
				APP_DOC_VERIFY_FEE_CENTS: "appDocVerify",
				APP_MATCH_REVIEW_FEE_CENTS: "appMatchReview",
				VISA_BASE_FEE_CENTS: "visaBase",
				VISA_BIOMETRICS_FEE_CENTS: "visaBiometrics",
				VISA_TRANSLATION_FEE_CENTS: "visaTranslation",
				CONSULTATION_FEE_CENTS: "consultation",
			};

			for (const [dbKey, objKey] of Object.entries(mapping)) {
				const found = res.settings.find((s) => s.key === dbKey);
				if (found && found.valueMasked) {
					const val = parseInt(found.valueMasked, 10);
					if (!isNaN(val)) nextFees[objKey] = val;
				}
			}
			setFeeCents(nextFees);

			const defaultsSetting = res.settings.find((s) => s.key === "INVOICE_ISSUANCE_DEFAULTS");
			if (defaultsSetting && defaultsSetting.valueMasked) {
				try {
					const parsed = JSON.parse(defaultsSetting.valueMasked);
					setIssuanceDefaults((prev) => ({ ...prev, ...parsed }));
				} catch (e) {
					console.error("Failed to parse INVOICE_ISSUANCE_DEFAULTS", e);
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
		<FeeSettingsContext.Provider value={{ feeCents, issuanceDefaults, loading, refresh }}>
			{children}
		</FeeSettingsContext.Provider>
	);
}
