import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{ ignores: ["dist"] },
	{
		extends: [js.configs.recommended, ...tseslint.configs.recommended],
		files: ["**/*.{ts,tsx}"],
		languageOptions: {
			ecmaVersion: 2020,
			globals: globals.browser,
		},
		plugins: {
			"react-hooks": reactHooks,
			"react-refresh": reactRefresh,
		},
		rules: {
			...reactHooks.configs.recommended.rules,
			"react-refresh/only-export-components": [
				"warn",
				{ allowConstantExport: true },
			],
		},
	},
	{
		// Design-system guardrail. Pages compose shared components and classes;
		// they do not carry their own colours or inline layout. Everything the
		// two apps kept re-implementing by hand (pills, money, invoice cards,
		// assignment) lives in century-nit-core/ui — use those. Reported as a
		// warning so the existing backlog is visible without blocking builds;
		// new pages should land clean.
		files: ["src/pages/**/*.tsx", "src/react-app/pages/**/*.tsx"],
		rules: {
			"no-restricted-syntax": [
				"warn",
				{
					selector: "JSXAttribute[name.name='style']",
					message: "No inline styles in pages — use a class from base.css/components.css or a shared component (century-nit-core/ui).",
				},
				{
					selector: "Literal[value=/#[0-9a-fA-F]{6}\b/]",
					message: "No hard-coded colours — use a token (var(--…)) or a StatusPill tone.",
				},
				{
					selector: "TemplateElement[value.raw=/#[0-9a-fA-F]{6}\b/]",
					message: "No hard-coded colours — use a token (var(--…)) or a StatusPill tone.",
				},
			],
		},
	},
);
