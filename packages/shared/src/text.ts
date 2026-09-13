/**
 * Title-case free text that arrived shouted or mumbled — "UNITED KINGDOM",
 * "computer science" — without touching what was typed with care: a word
 * already in mixed case (MSc, McDonald, iPhone) is left as it is, and a
 * short all-caps word (UK, USA, MBA, IELTS) is read as an acronym.
 *
 * For catalogue-ish text a person typed — countries, programmes, intakes.
 * Never re-case a person's name on the way out; if a name needs fixing it
 * is fixed once, where it is written.
 */
export function titleCase(text: string | null | undefined): string {
	if (!text) return "";
	return text
		.trim()
		.split(/\s+/)
		.map((word) => {
			const upper = word.toUpperCase();
			const lower = word.toLowerCase();
			const shouted = word === upper && word !== lower;
			const mumbled = word === lower && word !== upper;
			if (shouted && word.length <= 5) return word; // acronym
			if (!shouted && !mumbled) return word; // mixed case: deliberate
			return lower.charAt(0).toUpperCase() + lower.slice(1);
		})
		.join(" ");
}
