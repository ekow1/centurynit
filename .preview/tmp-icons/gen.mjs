import sharp from "sharp";

// Brand: black square, Georgia-serif letter. Web = "C" white; ops = "C" amber
// so the installed console is distinguishable on a phone home screen.
const JOBS = [
	// [svg text size %, fill, out]
	...gen("century-nit-web", "#ffffff"),
	...gen("century-nit-ops", "#b97a10"),
];

function gen(app, fill) {
	const out = `${app}/public/icons`;
	return [
		// Standard icons — glyph fills ~62% of the tile
		["icon-192.png", 192, 62, fill, `${out}/icon-192.png`],
		["icon-512.png", 512, 62, fill, `${out}/icon-512.png`],
		// Maskable: glyph inside the central safe circle (~50%)
		["icon-maskable-192.png", 192, 48, fill, `${out}/icon-maskable-192.png`],
		["icon-maskable-512.png", 512, 48, fill, `${out}/icon-maskable-512.png`],
		// Apple touch icon — no transparency allowed
		["apple-touch-icon.png", 180, 58, fill, `${out}/apple-touch-icon.png`],
	].map(([name, size, glyphPct, f, dest]) => ({ name, size, glyphPct, fill: f, dest }));
}

for (const job of JOBS) {
	const s = job.size;
	const fontSize = Math.round(s * (job.glyphPct / 100));
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
		<rect width="${s}" height="${s}" fill="#000"/>
		<text x="${s / 2}" y="${s / 2 + fontSize * 0.36}" text-anchor="middle"
			font-family="Georgia, 'Times New Roman', serif" font-size="${fontSize}" fill="${job.fill}">C</text>
	</svg>`;
	await sharp(Buffer.from(svg), { density: 300 })
		.png()
		.toFile(job.dest);
	console.log("wrote", job.dest);
}
