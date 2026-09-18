/* One-off codemod: strip em dashes (—) and box-drawing dashes (─) from the
 * portal source. Rules:
 *   "—"            -> "N/A"      (standalone empty-value placeholders)
 *   " — x" (lower) -> ". X"      (sentence split, capitalized)
 *   " — ${"        -> " · ${"    (label separator, matches join(" · ") style)
 *   " — {"         -> " · {"     (spaced JSX expression keeps the space)
 *   " —{"          -> ".{"       (tight JSX expression, e.g. —{" "})
 *   " —"<punct>    -> "."+punct  (dash before closing quote/bracket/comment end)
 *   " —\n"         -> ",\n"      (line-ending dash = continuation)
 *   "// — text"    -> "// text"  (comment lead-in)
 *   ">— text"      -> ">Text"    (JSX text placeholder, e.g. >— due)
 *   " — "          -> ". "       (catch-all for spaced dashes)
 *   "—<"           -> ".<"       (dash before JSX close tag)
 *   "a—b"          -> "a.b"      (tight in-word dash)
 * Box-drawing "─" runs are comment decoration: drop pure-divider lines and
 * strip the chars otherwise.
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOTS = [
	"century-nit-web/src",
	"century-nit-web/public",
	"packages/chat-ui/src",
	"packages/core/src",
	"packages/shared/src",
];
const EXTRA_FILES = ["century-nit-web/index.html"];
const EXTS = new Set([".ts", ".tsx", ".css", ".js", ".html", ".webmanifest", ".json"]);

function* walk(dir) {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) {
			if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
			yield* walk(p);
		} else if (EXTS.has(extname(name))) {
			yield p;
		}
	}
}

function stripBoxChars(src) {
	const lines = src.split("\n");
	const out = [];
	for (const line of lines) {
		if (!line.includes("─")) {
			out.push(line);
			continue;
		}
		if (/^[\s─*\/]+$/.test(line)) continue; // pure divider line
		let l = line.replace(/ ?─+ ?/g, " ");
		l = l.replace(/(?<=\S) {2,}/g, " ").replace(/[ \t]+$/, "");
		if (/^\s*(\/\*\s*\*\/|\/\/|\*|\*\/|\/\*)$/.test(l)) continue; // emptied comment
		out.push(l);
	}
	return out.join("\n");
}

function stripEmDashes(src) {
	return src
		.replace(/(["'`])—\1/g, "$1N/A$1")
		.replace(/ — ([a-z])/g, (_, c) => `. ${c.toUpperCase()}`)
		.replace(/ — \$\{/g, " · ${")
		.replace(/ — \{/g, " · {")
		.replace(/ —\{/g, ".{")
		.replace(/ —(["'`)\]}>*\/])/g, ".$1")
		.replace(/(\S) ?—[ \t]*\n/g, "$1,\n")
		.replace(/(\/\/ +|\* +)— /g, "$1")
		.replace(/>—\s*([a-z])/g, (_, c) => `>${c.toUpperCase()}`)
		.replace(/>—/g, ">")
		.replace(/(["'`])— ([a-z])/g, (_, q, c) => `${q}${c.toUpperCase()}`)
		.replace(/ — /g, ". ")
		.replace(/—</g, ".<")
		.replace(/(\w)—(\w)/g, "$1.$2");
}

const leftovers = [];
let touched = 0;
for (const root of ROOTS) {
	for (const file of walk(root)) {
		const src = readFileSync(file, "utf8");
		const next = stripEmDashes(stripBoxChars(src));
		if (next !== src) {
			writeFileSync(file, next);
			touched++;
			console.log("updated", file);
		}
	}
}
for (const file of EXTRA_FILES) {
	const src = readFileSync(file, "utf8");
	const next = stripEmDashes(stripBoxChars(src));
	if (next !== src) {
		writeFileSync(file, next);
		touched++;
		console.log("updated", file);
	}
}

// Report anything the ordered rules didn't catch for manual review.
for (const root of ROOTS) {
	for (const file of walk(root)) {
		const src = readFileSync(file, "utf8");
		src.split("\n").forEach((line, i) => {
			if (line.includes("—") || line.includes("─")) leftovers.push(`${file}:${i + 1}: ${line.trim()}`);
		});
	}
}
for (const file of EXTRA_FILES) {
	const src = readFileSync(file, "utf8");
	src.split("\n").forEach((line, i) => {
		if (line.includes("—") || line.includes("─")) leftovers.push(`${file}:${i + 1}: ${line.trim()}`);
	});
}
console.log(`\n${touched} files updated, ${leftovers.length} leftover dash chars`);
leftovers.forEach((l) => console.log("  LEFT", l));
