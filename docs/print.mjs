// Generates a print-ready HTML from DOCUMENTATION.md, then prints to PDF
// via headless Chrome/Edge. Usage:
//   node docs/print.mjs            → writes docs/print.html
//   node docs/print.mjs --pdf      → also runs the browser print step
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
const toc = [];
let i = 0;
let firstH1 = true;

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
		toc.push({ id, title: t });
		out.push(`<h2 id="${id}">${inline(t)}</h2>`);
		i++; continue;
	}
	if (/^### /.test(line)) {
		out.push(`<h3>${inline(line.slice(4))}</h3>`);
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
			out.push("<table><thead><tr>" + head.map((c) => `<th>${inline(c)}</th>`).join("") + "</tr></thead><tbody>" +
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
		out.push("<ul>" + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ul>");
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
		out.push("<ol>" + items.map((t) => `<li>${inline(t)}</li>`).join("") + "</ol>");
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
		out.push(`<p>${inline(parts.join(" "))}</p>`);
		continue;
	}
	i++;
}

const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Century NIT: Complete Documentation</title>
<style>
@page { size: A4; margin: 20mm 18mm; }
* { box-sizing: border-box; }
body {
	font-family: "Segoe UI", Calibri, "Helvetica Neue", Arial, sans-serif;
	font-size: 10pt; line-height: 1.55; color: #111; margin: 0 auto; max-width: 174mm;
}
.cover { border: 2.5pt solid #111; padding: 26pt 24pt; margin: 0 0 26pt; }
.cover .kicker { font-size: 9pt; letter-spacing: 0.22em; text-transform: uppercase; color: #555; }
.cover h1 { font-size: 27pt; margin: 10pt 0 8pt; line-height: 1.15; color: #111; }
.cover .sub { font-size: 11.5pt; color: #333; margin: 0 0 16pt; }
.cover .meta { border-top: 1.5pt solid #111; padding-top: 10pt; font-size: 9pt; color: #555;
	display: flex; justify-content: space-between; }
h2 {
	font-size: 15pt; color: #111; border-bottom: 2pt solid #111;
	padding-bottom: 4pt; margin: 26pt 0 9pt; page-break-after: avoid;
}
h3 { font-size: 11.5pt; color: #111; margin: 16pt 0 6pt; page-break-after: avoid;
	text-transform: uppercase; letter-spacing: 0.04em; }
p { margin: 6pt 0; }
ul, ol { margin: 5pt 0 10pt; padding-left: 18pt; }
li { margin: 3.5pt 0; }
table { border-collapse: collapse; width: 100%; margin: 10pt 0; font-size: 9pt;
	page-break-inside: auto; }
th, td { border: 1pt solid #999; padding: 4.5pt 7pt; text-align: left; vertical-align: top; }
th { background: #111; color: #fff; font-weight: 600; }
tr:nth-child(even) td { background: #f4f4f4; }
code { font-family: Consolas, "Courier New", monospace; background: #efefef;
	padding: 0 3pt; font-size: 9pt; }
strong { font-weight: 650; }
.toc { border: 1.5pt solid #111; padding: 14pt 16pt; margin: 0 0 10pt; }
.toc .kicker { font-size: 9pt; letter-spacing: 0.22em; text-transform: uppercase; color: #555;
	margin-bottom: 8pt; }
.toc ol { margin: 0; padding-left: 18pt; columns: 2; column-gap: 24pt; }
.toc li { margin: 2.5pt 0; font-size: 9.5pt; }
.closing { margin-top: 28pt; border-top: 1.5pt solid #111; padding-top: 8pt;
	font-size: 9pt; color: #555; }
</style></head><body>
<div class="cover">
	<div class="kicker">Century NIT Consult</div>
	<h1>Complete Platform Documentation</h1>
	<p class="sub">The study-abroad platform end to end: what it does, how it is
	built, how the client journey works, and how it runs in production.</p>
	<div class="meta"><span>Client portal &middot; Operations Center &middot; API</span><span>${new Date().toISOString().slice(0, 10)}</span></div>
</div>
<div class="toc"><div class="kicker">Contents</div>
<ol>${toc.map((t) => `<li>${t.title.replace(/^Part \d+: /, "")}</li>`).join("")}</ol>
</div>
${out.join("\n")}
<div class="closing">Century NIT Consult &middot; Complete Documentation &middot; generated from DOCUMENTATION.md</div>
</body></html>`;

const htmlPath = new URL("./print.html", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
writeFileSync(htmlPath, html);
console.log(`wrote ${htmlPath}`);

if (process.argv.includes("--pdf")) {
	const candidates = [
		"C:/Program Files/Google/Chrome/Application/chrome.exe",
		"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
	];
	const browser = candidates.find(existsSync);
	if (!browser) throw new Error("no chrome/edge found");
	const pdfPath = htmlPath.replace(/print\.html$/, "../DOCUMENTATION.pdf");
	execFileSync(browser, [
		"--headless", "--disable-gpu", "--no-pdf-header-footer",
		`--print-to-pdf=${pdfPath}`, `file:///${htmlPath}`,
	]);
	console.log(`wrote ${pdfPath}`);
}
