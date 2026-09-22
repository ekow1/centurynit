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
		const kicker = m ? `<span class="kicker">Part ${m[1]}</span>` : "";
		const title = m ? m[2] : t;
		toc.push({ id, part: m ? m[1] : "", title });
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
	margin: 20mm 18mm 20mm;
	@top-left {
		content: "CENTURY NIT CONSULT";
		font-family: "Segoe UI", sans-serif; font-size: 7.5pt;
		letter-spacing: 0.18em; color: #999;
	}
	@top-right {
		content: "Complete Platform Documentation";
		font-family: Georgia, "Times New Roman", serif;
		font-style: italic; font-size: 8.5pt; color: #777;
	}
	@bottom-left {
		content: "Century NIT Consult · Internal documentation";
		font-size: 8pt; color: #999; letter-spacing: 0.06em;
	}
	@bottom-right {
		content: "Page " counter(page) " of " counter(pages);
		font-family: Georgia, serif; font-size: 9pt; color: #555;
	}
}
@page cover {
	@top-left { content: none; }
	@top-right { content: none; }
	@bottom-left { content: none; }
	@bottom-right { content: none; }
}
@page toc {
	@top-left { content: none; }
	@top-right { content: none; }
}
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; }
body {
	font-family: "Segoe UI", Calibri, "Helvetica Neue", Arial, sans-serif;
	font-size: 9.8pt; line-height: 1.55; color: #1c1c1c; margin: 0;
	hyphens: auto;
}

/* — Cover — */
.cover { page: cover; break-after: page; height: 250mm;
	display: flex; flex-direction: column; justify-content: center; }
.cover .brand { font-size: 9pt; letter-spacing: 0.34em; text-transform: uppercase;
	color: #777; margin-bottom: 30pt; }
.cover .rule { width: 42pt; border-top: 2.5pt solid #1c1c1c; margin-bottom: 24pt; }
.cover h1 { font-family: Georgia, "Times New Roman", serif; font-weight: 400;
	font-size: 34pt; line-height: 1.22; margin: 0 0 18pt; color: #1c1c1c; }
.cover .sub { font-size: 12pt; color: #444; max-width: 128mm; line-height: 1.6;
	margin: 0 0 48pt; }
.cover .meta { font-size: 9pt; color: #777; letter-spacing: 0.08em;
	border-top: 0.6pt solid #bbb; padding-top: 12pt; width: 128mm;
	display: flex; justify-content: space-between; }
.cover .control { margin-top: 46pt; width: 128mm; border-collapse: collapse;
	font-size: 8.5pt; }
.cover .control td { border-top: 0.5pt solid #ccc; padding: 6pt 10pt 6pt 0;
	color: #555; vertical-align: top; }
.cover .control td:first-child { color: #999; text-transform: uppercase;
	letter-spacing: 0.1em; font-size: 7.5pt; width: 34mm; padding-top: 7pt; }

/* — Contents — */
.toc { page: toc; break-after: page; }
.toc .toc-title { font-family: Georgia, serif; font-weight: 400; font-size: 21pt;
	margin: 0 0 22pt; }
.toc ol { list-style: none; margin: 0; padding: 0; }
.toc li { display: flex; align-items: baseline; margin: 0 0 7pt; }
.toc .n { font-family: Georgia, serif; font-size: 9pt; color: #999;
	flex: 0 0 38pt; white-space: nowrap; }
.toc .t { font-size: 10.5pt; white-space: nowrap; }
.toc .dots { flex: 1; border-bottom: 0.6pt dotted #aaa; margin: 0 6pt 2.5pt; }
.toc a { text-decoration: none; color: inherit; }
.toc a.pg { font-family: Georgia, serif; font-size: 10pt; color: #555; }
.toc .note { margin-top: 26pt; border-top: 0.6pt solid #bbb; padding-top: 10pt;
	font-size: 9pt; color: #666; font-style: italic; max-width: 130mm;
	line-height: 1.55; }

/* — Body — */
main { text-align: left; }
/* paged.js re-justifies last lines of split elements — never let it
   stretch headings, table cells or list items */
h2, h3, th, td, li, .toc .t { text-align-last: left !important; }
h2 {
	font-family: Georgia, "Times New Roman", serif; font-weight: 400;
	font-size: 18pt; color: #1c1c1c;
	margin: 30pt 0 4pt; text-align: left;
	padding: 12pt 0 9pt; border-top: 2.5pt solid #1c1c1c;
	break-after: avoid; break-inside: avoid;
}
h2 .kicker { display: block; font-family: "Segoe UI", sans-serif;
	font-size: 8pt; letter-spacing: 0.3em; text-transform: uppercase;
	color: #999; margin-bottom: 8pt; }
h3 {
	font-family: Georgia, serif; font-weight: 400; font-size: 12pt;
	margin: 17pt 0 5pt; break-after: avoid; color: #1c1c1c;
	font-variant: small-caps; letter-spacing: 0.05em; text-align: left;
}
p { margin: 5pt 0; orphans: 3; widows: 3; }
ul, ol { margin: 5pt 0 9pt; padding-left: 17pt; }
li { margin: 3pt 0; padding-left: 2pt; }
li::marker { color: #999; }
strong { font-weight: 600; }
em { font-style: italic; }
code { font-family: Consolas, "Courier New", monospace; background: #f2f2f2;
	padding: 0 3pt; font-size: 9pt; }

/* Tables: booktabs style — rules only, no boxes */
table { border-collapse: collapse; width: 100%; margin: 14pt 0;
	font-size: 8.8pt; line-height: 1.45; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { padding: 5pt 8pt 5pt 0; text-align: left; vertical-align: top;
	border: none; }
th { font-size: 8.2pt; text-transform: uppercase; letter-spacing: 0.06em;
	color: #1c1c1c; font-weight: 600;
	border-bottom: 1pt solid #1c1c1c; }
tbody tr { border-bottom: 0.5pt solid #d8d8d8; }
tbody tr:last-child { border-bottom: 1pt solid #1c1c1c; }
td { color: #333; }

.closing { margin-top: 40pt; border-top: 0.6pt solid #bbb; padding-top: 10pt;
	font-size: 8pt; color: #999; letter-spacing: 0.06em;
	display: flex; justify-content: space-between; }
</style></head><body>
<div class="cover">
	<div class="brand">Century NIT Consult</div>
	<div class="rule"></div>
	<h1>Complete Platform<br>Documentation</h1>
	<p class="sub">The study-abroad platform end to end. What it does,
	how it is built, how the client journey works, and how it runs in
	production.</p>
	<div class="meta"><span>Client portal · Operations Center · API</span><span>${new Date().toISOString().slice(0, 10)}</span></div>
	<table class="control">
		<tr><td>Document</td><td>Complete Platform Documentation</td></tr>
		<tr><td>Applies to</td><td>Public website, client portal, Operations Center, API and workers</td></tr>
		<tr><td>Status</td><td>Current — generated from DOCUMENTATION.md</td></tr>
		<tr><td>Audience</td><td>Internal, partners, technical stakeholders</td></tr>
	</table>
</div>
<nav class="toc">
	<div class="toc-title">Contents</div>
	<ol>${toc.map((t) => `<li><span class="n">${t.part ? "Part " + t.part : ""}</span><span class="t">${t.title}</span><span class="dots"></span><a class="pg" href="#${t.id}"></a></li>`).join("")}</ol>
	<div class="note">${front.join(" ")}</div>
</nav>
<main>
${out.join("\n")}
<div class="closing"><span>Century NIT Consult · Complete Documentation</span><span>Generated from DOCUMENTATION.md</span></div>
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
