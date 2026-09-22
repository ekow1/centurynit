// Generates a print-ready HTML from DOCUMENTATION.md, then prints to PDF
// via headless Chrome/Edge + Paged.js (page numbers, running heads,
// chapter page breaks). Usage:
//   node docs/print.mjs            → writes docs/print.html
//   node docs/print.mjs --pdf      → also runs the browser print step
import { readFileSync, writeFileSync } from "node:fs";
import { existsSync } from "node:fs";

const md = readFileSync(new URL("../DOCUMENTATION.md", import.meta.url), "utf8");

function inline(s) {
	return s
		.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\*([^*]+)\*/g, "<em>$1</em>")
		.replace(/`([^`]+)`/g, "<code>$1</code>");
}

const roman = (n) => {
	const t = [[1000,"M"],[900,"CM"],[500,"D"],[400,"CD"],[100,"C"],[90,"XC"],[50,"L"],[40,"XL"],[10,"X"],[9,"IX"],[5,"V"],[4,"IV"],[1,"I"]];
	let s = "";
	for (const [v, r] of t) while (n >= v) { s += r; n -= v; }
	return s;
};

const lines = md.split(/\r?\n/);
const out = [];
const front = []; // paragraphs before Part 1 → rendered on the contents page
const toc = [];
let i = 0;
let firstH1 = true;
let seenH2 = false;
const emit = (html) => (seenH2 ? out : front).push(html);

while (i < lines.length) {
	const line = lines[i];

	if (/^# /.test(line)) {
		if (!firstH1) out.push(`<h1>${inline(line.slice(2))}</h1>`);
		else firstH1 = false; // the doc title is rendered by the cover block
		i++; continue;
	}
	if (/^## /.test(line)) {
		const t = line.slice(3).trim();
		const id = t.toLowerCase().replace(/[^a-z0-9]+/g, "-");
		const m = t.match(/^Part (\d+):\s*(.*)$/);
		const kicker = m ? `<span class="kicker">Part ${roman(+m[1])}</span>` : "";
		const title = m ? m[2] : t;
		toc.push({ id, part: m ? roman(+m[1]) : "", title });
		seenH2 = true;
		out.push(`<h2 id="${id}">${kicker}${inline(title)}</h2>`);
		i++; continue;
	}
	if (/^### /.test(line)) {
		emit(`<h3>${inline(line.slice(4))}</h3>`);
		i++; continue;
	}
	if (/^---\s*$/.test(line)) { i++; continue; }

	// Table block
	if (line.startsWith("|")) {
		const rows = [];
		while (i < lines.length && lines[i].startsWith("|")) {
			const cells = lines[i].split("|").slice(1, -1).map((c) => c.trim());
			if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells);
			i++;
		}
		if (rows.length) {
			const [head, ...body] = rows;
			emit("<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
				body.map((r) => "<tr>" + r.map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
		}
		continue;
	}

	// Bullet list
	if (/^- /.test(line)) {
		const items = [];
		while (i < lines.length && (/^- /.test(lines[i]) || /^  \S/.test(lines[i]))) {
			if (/^- /.test(lines[i])) items.push(lines[i].slice(2));
			else items[items.length - 1] += " " + lines[i].trim();
			i++;
		}
		emit("<ul>" + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ul>");
		continue;
	}

	// Numbered list
	if (/^\d+\. /.test(line)) {
		const items = [];
		while (i < lines.length && (/^\d+\. /.test(lines[i]) || /^   \S/.test(lines[i]))) {
			if (/^\d+\. /.test(lines[i])) items.push(lines[i].replace(/^\d+\. /, ""));
			else items[items.length - 1] += " " + lines[i].trim();
			i++;
		}
		emit("<ol>" + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ol>");
		continue;
	}

	// Paragraph (gather until blank/structural line)
	if (line.trim() !== "") {
		const parts = [line.trim()];
		i++;
		while (i < lines.length && lines[i].trim() !== "" &&
			!/^(#{1,3} |- |\d+\. |\||---)/.test(lines[i])) {
			parts.push(lines[i].trim());
			i++;
		}
		emit(`<p>${inline(parts.join(" "))}</p>`);
		continue;
	}
	i++;
}

const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Century NIT: Complete Documentation</title>
<style>
@page {
	size: A4;
	margin: 23mm 21mm 24mm;
	@bottom-center {
		content: counter(page);
		font-family: Georgia, "Times New Roman", serif;
		font-size: 9pt; color: #6b655c;
	}
}
@page :left {
	@top-left {
		content: "Century NIT Consult";
		font-family: Georgia, "Times New Roman", serif;
		font-style: italic; font-size: 8pt; color: #999;
	}
}
@page :right {
	@top-right {
		content: "Complete Platform Documentation";
		font-family: Georgia, "Times New Roman", serif;
		font-style: italic; font-size: 8pt; color: #999;
	}
}
@page cover {
	@top-left { content: none; }
	@top-right { content: none; }
	@bottom-center { content: none; }
}
@page toc {
	@top-left { content: none; }
	@top-right { content: none; }
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; }
body {
	font-family: Georgia, "Times New Roman", serif;
	font-size: 10.2pt; line-height: 1.62; color: #211d19; margin: 0;
	hyphens: auto;
}

/* — Cover — */
.cover { page: cover; break-after: page; height: 244mm;
	border: 0.75pt solid #2a2620; outline: 0.4pt solid #2a2620;
	outline-offset: 4pt; padding: 0 18mm;
	display: flex; flex-direction: column; }
.cover .top { padding-top: 26mm; text-align: center; }
.cover .brand { font-family: "Segoe UI", Calibri, sans-serif;
	font-size: 9.5pt; letter-spacing: 0.42em; text-transform: uppercase;
	color: #211d19; }
.cover .doc { margin-top: 3.5pt; font-family: "Segoe UI", sans-serif;
	font-size: 7pt; letter-spacing: 0.22em; text-transform: uppercase;
	color: #9a948a; }
.cover .mid { flex: 1; display: flex; flex-direction: column;
	justify-content: center; text-align: center; }
.cover h1 { font-weight: 400; font-size: 33pt; line-height: 1.28;
	margin: 0; color: #211d19; }
.cover .rule { width: 46pt; margin: 22pt auto; border-top: 0.6pt solid #2a2620; }
.cover .sub { font-style: italic; font-size: 11.5pt; color: #57514a;
	line-height: 1.7; max-width: 118mm; margin: 0 auto; }
.cover .bottom { padding-bottom: 24mm; text-align: center;
	font-family: "Segoe UI", sans-serif; font-size: 8pt; color: #7d776e;
	letter-spacing: 0.14em; text-transform: uppercase; }
.cover .bottom .sep { color: #c9c3b8; margin: 0 8pt; }

/* — Contents — */
.toc { page: toc; break-after: page; }
.toc .toc-title { font-weight: 400; font-size: 20pt; text-align: center;
	margin: 8mm 0 6mm; }
.toc .toc-rule { width: 46pt; margin: 0 auto 10mm;
	border-top: 0.6pt solid #2a2620; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { display: flex; align-items: baseline; margin: 0 0 8.5pt; }
.toc .n { font-size: 9.5pt; color: #8a857c; font-variant: small-caps;
	letter-spacing: 0.06em; flex: 0 0 40pt; white-space: nowrap; }
.toc .t { font-size: 11pt; white-space: nowrap; }
.toc .dots { flex: 1; border-bottom: 0.6pt dotted #b8b2a6; margin: 0 7pt 3pt; }
.toc a { text-decoration: none; color: inherit; }
.toc a.pg { font-size: 10pt; color: #57514a; }
.toc .note { margin-top: 12mm; border-top: 0.6pt solid #d8d3c8;
	padding-top: 5mm; font-size: 9.5pt; color: #6b655c;
	font-style: italic; max-width: 140mm; line-height: 1.65; }

/* — Body — */
main { text-align: left; }
/* paged.js re-justifies last lines of split elements — never let it
   stretch headings, table cells or list items */
h2, h3, th, td, li, .toc .t { text-align-last: left !important; }
h2 {
	font-weight: 400; font-size: 19pt; color: #211d19;
	margin: 32pt 0 6pt; text-align: left;
	padding: 12pt 0 10pt; border-top: 3pt double #2a2620;
	break-after: avoid; break-inside: avoid;
}
h2 .kicker { display: block; font-family: "Segoe UI", sans-serif;
	font-size: 8pt; letter-spacing: 0.32em; text-transform: uppercase;
	color: #9a948a; margin-bottom: 9pt; }
h3 {
	font-weight: 400; font-size: 12.5pt; margin: 18pt 0 6pt;
	break-after: avoid; color: #211d19;
	font-variant: small-caps; letter-spacing: 0.05em; text-align: left;
}
p { margin: 0; orphans: 3; widows: 3; }
p + p { text-indent: 1.5em; }
h2 + p, h3 + p, table + p, ul + p, ol + p { text-indent: 0; }
ul, ol { margin: 7pt 0 10pt; padding-left: 20pt; }
li { margin: 3.5pt 0; padding-left: 3pt; }
li::marker { color: #9a948a; }
strong { font-weight: 700; }
em { font-style: italic; }
code { font-family: Consolas, "Courier New", monospace;
	font-size: 8.8pt; color: #4a443c; }

/* Tables — tinted header band, quiet row rules, roomier cells */
table { border-collapse: collapse; width: 100%; margin: 15pt 0;
	font-size: 9pt; line-height: 1.5; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { padding: 6.5pt 10pt 6.5pt 8pt; text-align: left;
	vertical-align: top; border: none; }
th { font-family: "Segoe UI", sans-serif; font-size: 7.8pt;
	text-transform: uppercase; letter-spacing: 0.08em;
	color: #211d19; font-weight: 600;
	background: #efece4;
	border-top: 0.9pt solid #2a2620;
	border-bottom: 0.75pt solid #2a2620; }
tbody tr { border-bottom: 0.45pt solid #ddd8cc; }
tbody tr:last-child { border-bottom: 0.9pt solid #2a2620; }
td { color: #3a352f; }
td:first-child, th:first-child { padding-left: 8pt; }

.closing { margin-top: 36pt; text-align: center; }
.closing .ornament { color: #b8b2a6; letter-spacing: 1.2em;
	font-size: 9pt; margin-bottom: 8pt; }
.closing .line { font-family: "Segoe UI", sans-serif; font-size: 7.5pt;
	color: #9a948a; letter-spacing: 0.16em; text-transform: uppercase; }
</style></head><body>
<div class="cover">
	<div class="top">
		<div class="brand">Century NIT Consult</div>
		<div class="doc">Platform Documentation</div>
	</div>
	<div class="mid">
		<h1>Complete Platform<br>Documentation</h1>
		<div class="rule"></div>
		<p class="sub">The study-abroad platform end to end. What it
		does, how it is built, how the client journey works, and how it
		runs in production.</p>
	</div>
	<div class="bottom">
		<span>Client Portal</span><span class="sep">·</span>
		<span>Operations Center</span><span class="sep">·</span>
		<span>API &amp; Workers</span><br><br>
		<span style="letter-spacing: 0.08em; text-transform: none; font-family: Georgia, serif; font-style: italic;">${new Date().toISOString().slice(0, 10)}</span>
	</div>
</div>
<nav class="toc">
	<div class="toc-title">Contents</div>
	<div class="toc-rule"></div>
	<ol>${toc.map((t) => `<li><span class="n">${t.part ? "Part " + t.part : ""}</span><span class="t">${t.title}</span><span class="dots"></span><a class="pg" href="#${t.id}"></a></li>`).join("")}</ol>
	<div class="note">${front.join(" ")}</div>
</nav>
<main>
${out.join("\n")}
<div class="closing"><div class="ornament">·&nbsp;·&nbsp;·</div><div class="line">Century NIT Consult &nbsp;·&nbsp; Generated from DOCUMENTATION.md</div></div>
</main>
<script src="./vendor/paged.polyfill.js"></script>
</body></html>`;

const htmlPath = new URL("./print.html", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
writeFileSync(htmlPath, html);
console.log(`wrote ${htmlPath}`);

if (process.argv.includes("--pdf")) {
	const candidates = [
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	];
	const executablePath = candidates.find(existsSync);
	if (!executablePath) throw new Error("no chrome/edge found");
	const pdfPath = htmlPath.replace(/print\.html$/, "../DOCUMENTATION.pdf");

	const puppeteer = await import("puppeteer-core");
	const browser = await puppeteer.launch({ executablePath, headless: true });
	const page = await browser.newPage();
	await page.goto(`file:///${htmlPath}`, { waitUntil: "networkidle0" });

	// Wait for Paged.js: pagination is done when the last element sits
	// inside the last rendered page
	await page.waitForFunction(() => {
		const pages = document.querySelectorAll(".pagedjs_page");
		return pages.length > 2 &&
			pages[pages.length - 1].querySelector(".closing") !== null;
	}, { timeout: 180000, polling: 500 });

	// Fill contents-page numbers with the real page index of each part
	await page.evaluate((ids) => {
		const pages = [...document.querySelectorAll(".pagedjs_page")];
		for (const id of ids) {
			const idx = pages.findIndex((p) => p.querySelector(`[id="${id}"]`));
			const a = document.querySelector(`.toc a.pg[href="#${id}"]`);
			if (a && idx > -1) a.textContent = String(idx + 1);
		}
	}, toc.map((t) => t.id));

	await page.pdf({
		path: pdfPath,
		preferCSSPageSize: true,
		printBackground: true,
	});
	await browser.close();
	console.log(`wrote ${pdfPath}`);
}
