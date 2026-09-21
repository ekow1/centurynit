// Markdown → styled HTML for FEATURES_PLAIN.md → PDF via headless Chrome.
// Adds: cover page, table of contents, running footer, section anchors.
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync(process.argv[2], "utf-8");
const lines = md.split(/\r?\n/);

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) =>
	esc(s)
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/\*([^*]+)\*/g, "<em>$1</em>")
		.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
const stripMd = (s) => s.replace(/[*`]/g, "");

// Pull the document title (first h1) and subtitle (first italic paragraph) for the cover.
let title = "Century NIT", subtitle = "";
for (const l of lines) {
	if (/^#\s/.test(l)) { title = l.replace(/^#\s*/, ""); break; }
}
for (const l of lines) {
	if (/^\*[^*]/.test(l)) { subtitle = stripMd(l); break; }
}

const toc = [];
let html = [];
let i = 0;
let skippedTitle = false;
while (i < lines.length) {
	const line = lines[i];

	if (/^---+\s*$/.test(line)) { html.push("<hr>"); i++; continue; }
	if (/^#{1,3}\s/.test(line)) {
		const level = line.match(/^#+/)[0].length;
		const text = line.replace(/^#+\s*/, "");
		if (level === 1 && !skippedTitle && text === title) { skippedTitle = true; i++; continue; }
		const [t, sub] = text.split(" · ");
		const head = sub ?? t;
		const id = `s${toc.length}`;
		if (level <= 2) toc.push({ level, text: sub ? `${t} · ${sub}` : t, id });
		html.push(`${sub ? `<p class="hsub">${inline(t)}</p>` : ""}<h${level} id="${id}">${inline(head)}</h${level}>`);
		i++; continue;
	}
	if (/^\|/.test(line)) {
		const rows = [];
		while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
		const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
		const head = cells(rows[0]);
		const body = rows.slice(2);
		html.push(
			"<table><thead><tr>" +
				head.map((c) => `<th>${inline(c)}</th>`).join("") +
				"</tr></thead><tbody>" +
				body.map((r) => "<tr>" + cells(r).map((c) => `<td>${inline(c)}</td>`).join("") + "</tr>").join("") +
				"</tbody></table>",
		);
		continue;
	}
	if (/^>\s?/.test(line)) {
		const buf = [];
		while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, "")); i++; }
		html.push(`<blockquote>${buf.map(inline).join("<br>")}</blockquote>`);
		continue;
	}
	if (/^-\s/.test(line)) {
		const items = [];
		while (i < lines.length && /^\s*-\s/.test(lines[i])) { items.push(lines[i].replace(/^\s*-\s*/, "")); i++; }
		html.push("<ul>" + items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ul>");
		continue;
	}
	if (/^\d+\.\s/.test(line)) {
		const items = [];
		while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s*/, "")); i++; }
		html.push("<ol>" + items.map((it) => `<li>${inline(it)}</li>`).join("") + "</ol>");
		continue;
	}
	if (line.trim() === "") { i++; continue; }
	const buf = [];
	while (i < lines.length && lines[i].trim() !== "" && !/^[#|>\-\d]/.test(lines[i].trim()) && !/^---/.test(lines[i])) { buf.push(lines[i]); i++; }
	html.push(`<p>${buf.map(inline).join(" ")}</p>`);
}

const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
const cover = `
	<section class="cover">
		<p class="cover__brand">CENTURY NIT</p>
		<div>
			<h1 class="cover__title">${inline(title)}</h1>
			<p class="cover__sub">${inline(subtitle)}</p>
			<p class="cover__meta">Feature overview · ${date}</p>
		</div>
	</section>`;

const tocHtml = `
	<section class="toc">
		<p class="hsub toc__kick">Contents</p>
		${toc
			.map(
				(t) =>
					`<a class="toc__row toc__row--l${t.level}" href="#${t.id}"><span>${esc(t.text)}</span></a>`,
			)
			.join("")}
	</section>`;

const css = `
	@page { size: A4; margin: 16mm 15mm 16mm; }
	:root { --ink: #17161a; --paper: #faf9f6; --muted: #6e6a60; --amber: #b97a10; --line: #d9d4c9; --line-lt: #eae7de; }
	* { box-sizing: border-box; print-color-adjust: exact; -webkit-print-color-adjust: exact; }
	body { font-family: Georgia, "Times New Roman", serif; color: var(--ink); font-size: 10.5pt; line-height: 1.6; max-width: 700px; margin: 0 auto; }

	h1 { font-size: 26pt; line-height: 1.15; margin: 0 0 6pt; padding-top: 16pt; border-top: 4px solid var(--ink); page-break-before: always; }
	h2 { font-size: 15pt; margin: 20pt 0 6pt; padding-top: 10pt; border-top: 1.5px solid var(--ink); page-break-after: avoid; }
	h3 { font-size: 11.5pt; margin: 14pt 0 4pt; page-break-after: avoid; }
	.hsub { font-family: "Courier New", ui-monospace, monospace; font-size: 8pt; letter-spacing: 0.16em; text-transform: uppercase; color: var(--amber); margin: 20pt 0 2pt; page-break-after: avoid; }
	.hsub + h2 { margin-top: 0; padding-top: 0; border-top: 0; }
	h1 + p em, h1 ~ p:first-of-type em { color: var(--muted); }

	p { margin: 0 0 8pt; }
	strong { font-weight: 700; }
	code { font-family: "Courier New", ui-monospace, monospace; font-size: 9pt; background: #f3f1ea; padding: 0 3pt; }

	ul, ol { margin: 0 0 10pt; padding: 0; list-style: none; }
	li { margin-bottom: 4pt; padding-left: 14pt; position: relative; }
	li::before { content: ""; position: absolute; left: 0; top: 0.6em; width: 6pt; height: 6pt; background: var(--ink); }
	ol { counter-reset: oli; }
	ol li::before { content: counter(oli); counter-increment: oli; background: none; font-family: "Courier New", ui-monospace, monospace; font-size: 9pt; top: 0.1em; }

	blockquote { margin: 12pt 0; padding: 10pt 14pt; border-left: 4px solid var(--amber); background: #faf7f0; font-size: 10pt; }
	hr { border: 0; border-top: 1px solid var(--line); margin: 18pt 0; }

	table { width: 100%; border-collapse: collapse; margin: 8pt 0 14pt; font-size: 9.5pt; }
	th { font-family: "Courier New", ui-monospace, monospace; font-size: 7.5pt; letter-spacing: 0.1em; text-transform: uppercase; text-align: left; color: var(--muted); border-top: 1.5px solid var(--ink); border-bottom: 1px solid var(--line); padding: 5pt 8pt 5pt 0; }
	td { padding: 5pt 8pt 5pt 0; border-bottom: 1px solid var(--line-lt); vertical-align: top; }
	tr { page-break-inside: avoid; }
	a { color: var(--ink); text-decoration: none; }

	.cover { height: 252mm; background: var(--ink); color: var(--paper); display: flex; flex-direction: column; justify-content: space-between; padding: 22mm 18mm 16mm; page-break-after: always; }
	.cover__brand { font-family: "Courier New", ui-monospace, monospace; font-size: 10pt; letter-spacing: 0.34em; color: var(--amber); margin: 0; }
	.cover__title { font-size: 38pt; line-height: 1.08; margin: 0 0 16pt; color: var(--paper); border: 0; padding: 0; page-break-before: avoid; }
	.cover__sub { font-size: 11.5pt; line-height: 1.6; color: #b8b4a8; font-style: italic; max-width: 36em; margin: 0 0 26pt; }
	.cover__meta { font-family: "Courier New", ui-monospace, monospace; font-size: 8.5pt; letter-spacing: 0.14em; text-transform: uppercase; color: #8a867b; margin: 0; border-top: 1px solid #3a382f; padding-top: 10pt; }

	.toc { page-break-after: always; }
	.toc__kick { margin-top: 0; }
	.toc__row { display: block; padding: 5pt 0; border-bottom: 1px solid var(--line-lt); font-size: 10.5pt; }
	.toc__row--l1 { font-weight: 700; margin-top: 12pt; border-bottom: 1.5px solid var(--ink); font-family: "Courier New", ui-monospace, monospace; font-size: 9pt; letter-spacing: 0.1em; text-transform: uppercase; }
	.toc__row--l2 { padding-left: 14pt; }

`;

const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${cover}${tocHtml}${html.join("\n")}</body></html>`;
writeFileSync(process.argv[3], doc);
console.log("wrote", process.argv[3]);
