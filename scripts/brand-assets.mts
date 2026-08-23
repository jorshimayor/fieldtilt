/**
 * Brand asset generator — icon, wordmark, X avatar, X banner, favicon.
 * Parameterized so a rename is one constant + rerun.
 *
 *   npx tsx scripts/brand-assets.mts [outDir]
 *
 * Design: the fieldtilt mark is a pitch tilted 8° with ~62% of it shaded —
 * the field-tilt metric itself. Editorial palette from the design system.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const BRAND = "fieldtilt";
const TAGLINE = "FOOTBALL INTELLIGENCE, PUBLISHED";
const MICRO = "xG · form · live — every claim with receipts";

const BG = "#0B0C0F";
const INK = "#FFFFFF";
const MUTE = "#878D99";
const ACCENT = "#3D6BFF";

const outDir = process.argv[2] || "brand";
mkdirSync(outDir, { recursive: true });

await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
const fonts = [
  readFileSync("packages/render/fonts/Montserrat-Regular.ttf"),
  readFileSync("packages/render/fonts/Montserrat-Bold.ttf"),
  readFileSync("packages/render/fonts/Montserrat-ExtraBold.ttf"),
];

/** The mark: a tilted pitch, majority half shaded accent = field tilt. */
function pitchMark(cx: number, cy: number, scale: number, opts?: { dim?: boolean }): string {
  const W = 600 * scale, H = 400 * scale, R = 28 * scale;
  const x = cx - W / 2, y = cy - H / 2;
  const stroke = 26 * scale;
  const tiltShare = 0.62; // the metric, drawn
  const alpha = opts?.dim ? 0.55 : 1;
  return `
  <g transform="rotate(-8 ${cx} ${cy})" opacity="${alpha}">
    <clipPath id="pitch-${cx}-${cy}"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="${R}"/></clipPath>
    <rect x="${x}" y="${y}" width="${W * tiltShare}" height="${H}" clip-path="url(#pitch-${cx}-${cy})" fill="${ACCENT}"/>
    <rect x="${x}" y="${y}" width="${W}" height="${H}" rx="${R}" fill="none" stroke="${INK}" stroke-width="${stroke}"/>
    <line x1="${x + W * tiltShare}" y1="${y}" x2="${x + W * tiltShare}" y2="${y + H}" stroke="${INK}" stroke-width="${stroke * 0.75}"/>
    <circle cx="${x + W * tiltShare}" cy="${cy}" r="${64 * scale}" fill="none" stroke="${INK}" stroke-width="${stroke * 0.75}"/>
  </g>`;
}

function render(name: string, svg: string, width?: number) {
  const r = new Resvg(svg, {
    background: BG,
    fitTo: width ? { mode: "width", value: width } : undefined,
    font: { fontBuffers: fonts, defaultFontFamily: "Montserrat", loadSystemFonts: false },
  });
  const png = r.render().asPng();
  writeFileSync(`${outDir}/${name}`, png);
  console.log(`${name}  ${(png.length / 1024).toFixed(0)}KB`);
}

// ---- 1. App icon / X avatar (square 1024) ----
const icon = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<rect width="1024" height="1024" rx="180" fill="${BG}"/>
${pitchMark(512, 470, 1.1)}
<text x="512" y="852" font-family="Montserrat" font-size="118" font-weight="800" fill="${INK}" text-anchor="middle" letter-spacing="-2">${BRAND}.</text>
</svg>`;
render("icon-1024.png", icon);
render("x-avatar-400.png", icon, 400);
render("favicon-64.png", icon, 64);

// ---- 2. Wordmark lockup (1600x420, mark left) ----
const lockup = `<svg width="1600" height="420" viewBox="0 0 1600 420" xmlns="http://www.w3.org/2000/svg">
<rect width="1600" height="420" fill="${BG}"/>
${pitchMark(230, 210, 0.5)}
<text x="450" y="248" font-family="Montserrat" font-size="150" font-weight="800" fill="${INK}" letter-spacing="-4">${BRAND}.</text>
<text x="456" y="316" font-family="Montserrat" font-size="30" font-weight="700" fill="${MUTE}" letter-spacing="8">${TAGLINE}</text>
</svg>`;
render("logo-lockup.png", lockup);

// ---- 3. X banner (1500x500) ----
const banner = `<svg width="1500" height="500" viewBox="0 0 1500 500" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="g" cx="0.85" cy="0.5" r="1">
    <stop offset="0" stop-color="#12172b"/>
    <stop offset="0.6" stop-color="${BG}"/>
    <stop offset="1" stop-color="#060709"/>
  </radialGradient>
</defs>
<rect width="1500" height="500" fill="url(#g)"/>
${pitchMark(1210, 250, 0.85, { dim: true })}
<text x="96" y="238" font-family="Montserrat" font-size="120" font-weight="800" fill="${INK}" letter-spacing="-3">${BRAND}.</text>
<text x="102" y="300" font-family="Montserrat" font-size="26" font-weight="700" fill="${MUTE}" letter-spacing="7">${TAGLINE}</text>
<text x="102" y="382" font-family="Montserrat" font-size="22" fill="${MUTE}">${MICRO}</text>
<rect x="100" y="326" width="64" height="5" rx="2.5" fill="${ACCENT}"/>
</svg>`;
render("x-banner-1500x500.png", banner);

console.log(`\nassets in ${outDir}/`);
