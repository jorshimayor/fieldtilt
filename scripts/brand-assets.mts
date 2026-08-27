/**
 * Brand asset generator — icon, wordmark, X avatar, X banner, favicon.
 * Parameterized so a rename is one constant + rerun.
 *
 *   npx tsx scripts/brand-assets.mts [outDir]
 *
 * Design: broadcast-grade analytics graphic, not a mascot. A REAL pitch
 * (true proportions, full markings, mow stripes) in Chelsea royal blue,
 * tilted 8°, with the field-tilt metric drawn as a gold territorial
 * overlay ending at 62% — plus an xG shot-map texture on the banner.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const BRAND = "fieldtilt";
const TAGLINE = "FOOTBALL INTELLIGENCE, PUBLISHED";
const MICRO = "xG · form · live — every claim with receipts";
const TILT = 0.62; // the metric, drawn

const BG = "#0B0C0F";
const INK = "#FFFFFF";
const MUTE = "#878D99";
const NAVY_DEEP = "#04101F";
const NAVY = "#072A54";
const PITCH_BLUE = "#0747A0"; // Chelsea royal, grass-lit
const PITCH_BLUE_DK = "#053578";
const STRIPE = "#1258B8";
const GOLD = "#D9A31A"; // crest-gold
const LINE_A = 0.92; // pitch line opacity

const outDir = process.argv[2] || "brand";
mkdirSync(outDir, { recursive: true });

await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
const fonts = [
  readFileSync("packages/render/fonts/Montserrat-Regular.ttf"),
  readFileSync("packages/render/fonts/Montserrat-Bold.ttf"),
  readFileSync("packages/render/fonts/Montserrat-ExtraBold.ttf"),
];

const LION_HEAD_URI = `data:image/jpeg;base64,${readFileSync("brand/source/lion-head-sq512.jpg").toString("base64")}`;

let uid = 0;

/**
 * A real pitch at true 105x68 proportions with full markings: boundary,
 * halfway line, center circle + spot, penalty areas, six-yard boxes,
 * penalty spots + arcs, corner arcs, mow stripes — tilted 8°, with the
 * field-tilt territorial overlay in gold up to TILT of the length.
 */
function pitch(
  cx: number,
  cy: number,
  scale: number,
  opts?: { detail?: boolean; shots?: boolean; tagSize?: number; lionUri?: string }
): string {
  const id = `p${uid++}`;
  const W = 600 * scale, H = 390 * scale;
  const x = cx - W / 2, y = cy - H / 2;
  const lw = 2.4 * scale; // line weight — broadcast-thin
  const detail = opts?.detail !== false;
  // true metric proportions of a 105x68 pitch
  const penD = 0.157 * W, penH = 0.593 * H;
  const sixD = 0.052 * W, sixH = 0.269 * H;
  const spot = 0.105 * W;
  const ccR = 0.087 * W;
  const arcDy = Math.sqrt(ccR * ccR - (penD - spot) * (penD - spot));
  const corner = 0.03 * W;
  const box = (bx: number, mirror: boolean) => {
    const m = (d: number) => (mirror ? x + W - d : x + d);
    return `
    <rect x="${Math.min(m(0), m(penD))}" y="${cy - penH / 2}" width="${penD}" height="${penH}" fill="none" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>
    <rect x="${Math.min(m(0), m(sixD))}" y="${cy - sixH / 2}" width="${sixD}" height="${sixH}" fill="none" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>
    <circle cx="${m(spot)}" cy="${cy}" r="${lw * 1.1}" fill="${INK}" opacity="${LINE_A}"/>
    <path d="M ${m(penD)} ${cy - arcDy} A ${ccR} ${ccR} 0 0 ${mirror ? 0 : 1} ${m(penD)} ${cy + arcDy}" fill="none" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>`;
  };
  // deterministic xG shot map — final third, sized like shot quality
  const shots = [
    [0.07, 0.42, 2.6, 0.9], [0.11, 0.55, 2.0, 0.7], [0.05, 0.5, 3.2, 1.0],
    [0.14, 0.36, 1.6, 0.55], [0.09, 0.64, 2.2, 0.8], [0.17, 0.5, 1.4, 0.5],
    [0.12, 0.47, 1.9, 0.65], [0.2, 0.58, 1.2, 0.45], [0.06, 0.58, 2.4, 0.85],
    [0.16, 0.63, 1.5, 0.5], [0.22, 0.42, 1.1, 0.4], [0.1, 0.3, 1.5, 0.5],
  ] as const;
  const tagSize = opts?.tagSize ?? 0;
  return `
  <g transform="rotate(-8 ${cx} ${cy})">
    <defs>
      <linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${PITCH_BLUE}"/>
        <stop offset="1" stop-color="${PITCH_BLUE_DK}"/>
      </linearGradient>
      <linearGradient id="${id}t" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${GOLD}" stop-opacity="0.06"/>
        <stop offset="0.72" stop-color="${GOLD}" stop-opacity="0.2"/>
        <stop offset="1" stop-color="${GOLD}" stop-opacity="0.46"/>
      </linearGradient>
      <clipPath id="${id}c"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="${6 * scale}"/></clipPath>
    </defs>
    <rect x="${x - 10 * scale}" y="${y - 10 * scale}" width="${W + 20 * scale}" height="${H + 20 * scale}" rx="${10 * scale}" fill="url(#${id}g)"/>
    <g clip-path="url(#${id}c)">
      ${Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0 ? "" : `<rect x="${x + (i * W) / 10}" y="${y}" width="${W / 10}" height="${H}" fill="${STRIPE}" opacity="0.28"/>`
      ).join("")}
      <rect x="${x}" y="${y}" width="${W * TILT}" height="${H}" fill="url(#${id}t)"/>
    </g>
    <rect x="${x}" y="${y}" width="${W}" height="${H}" fill="none" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>
    <line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + H}" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>
    ${opts?.lionUri
      ? `<clipPath id="${id}l"><circle cx="${cx}" cy="${cy}" r="${ccR * 1.9}"/></clipPath>
         <image href="${opts.lionUri}" x="${cx - ccR * 1.9}" y="${cy - ccR * 1.9}" width="${ccR * 3.8}" height="${ccR * 3.8}" clip-path="url(#${id}l)" preserveAspectRatio="xMidYMid slice"/>
         <circle cx="${cx}" cy="${cy}" r="${ccR * 1.9}" fill="none" stroke="${GOLD}" stroke-width="${lw * 1.6}"/>`
      : `<circle cx="${cx}" cy="${cy}" r="${ccR}" fill="none" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>
         <circle cx="${cx}" cy="${cy}" r="${lw * 1.1}" fill="${INK}" opacity="${LINE_A}"/>`}
    ${detail ? box(0, false) + box(0, true) : ""}
    ${detail
      ? `<path d="M ${x} ${y + corner} A ${corner} ${corner} 0 0 0 ${x + corner} ${y}" fill="none" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>
         <path d="M ${x + W - corner} ${y} A ${corner} ${corner} 0 0 0 ${x + W} ${y + corner}" fill="none" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>
         <path d="M ${x + W} ${y + H - corner} A ${corner} ${corner} 0 0 0 ${x + W - corner} ${y + H}" fill="none" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>
         <path d="M ${x + corner} ${y + H} A ${corner} ${corner} 0 0 0 ${x} ${y + H - corner}" fill="none" stroke="${INK}" stroke-width="${lw}" opacity="${LINE_A}"/>`
      : ""}
    <line x1="${x + W * TILT}" y1="${y}" x2="${x + W * TILT}" y2="${y + H}" stroke="${GOLD}" stroke-width="${lw * 1.4}" stroke-dasharray="${8 * scale} ${6 * scale}"/>
    ${opts?.shots
      ? shots.map(([sx, sy, r, o]) =>
          `<circle cx="${x + sx * W}" cy="${y + sy * H}" r="${r * 2.6 * scale}" fill="${GOLD}" opacity="${o * 0.85}"/>`
        ).join("")
      : ""}
    ${tagSize
      ? `<g>
          <rect x="${x + W * TILT - 118 * scale}" y="${y - 34 * scale}" width="${236 * scale}" height="${26 * scale}" rx="${4 * scale}" fill="${GOLD}"/>
          <text x="${x + W * TILT}" y="${y - 15.5 * scale}" font-family="Montserrat" font-size="${tagSize * scale}" font-weight="800" fill="${NAVY_DEEP}" text-anchor="middle" letter-spacing="${2.4 * scale}">FIELD TILT ${Math.round(TILT * 100)}%</text>
        </g>`
      : ""}
  </g>`;
}

function render(name: string, svg: string, width?: number, bg: string = BG) {
  const r = new Resvg(svg, {
    background: bg,
    fitTo: width ? { mode: "width", value: width } : undefined,
    font: { fontBuffers: fonts, defaultFontFamily: "Montserrat", loadSystemFonts: false },
  });
  const png = r.render().asPng();
  writeFileSync(`${outDir}/${name}`, png);
  console.log(`${name}  ${(png.length / 1024).toFixed(0)}KB`);
}

// ---- 1. App icon / X avatar (square 1024, deep navy, broadcast pitch) ----
const icon = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="ig" cx="0.5" cy="0.34" r="1">
    <stop offset="0" stop-color="${NAVY}"/>
    <stop offset="1" stop-color="${NAVY_DEEP}"/>
  </radialGradient>
</defs>
<rect width="1024" height="1024" rx="180" fill="url(#ig)"/>
${pitch(512, 450, 1.16, { tagSize: 15, lionUri: LION_HEAD_URI })}
<text x="512" y="856" font-family="Montserrat" font-size="112" font-weight="800" fill="${INK}" text-anchor="middle" letter-spacing="-2">${BRAND}.</text>
</svg>`;
render("icon-1024.png", icon, undefined, NAVY_DEEP);
render("x-avatar-400.png", icon, 400, NAVY_DEEP);

// ---- 2. Favicon: simplified pitch (legible at tab size) ----
const favicon = `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
<rect width="256" height="256" rx="48" fill="${NAVY_DEEP}"/>
${pitch(128, 128, 0.335, { detail: false, lionUri: LION_HEAD_URI })}
</svg>`;
render("favicon-64.png", favicon, 64, NAVY_DEEP);
render("favicon-256.png", favicon, undefined, NAVY_DEEP);

// ---- 3. Wordmark lockup (1600x420, mark left) ----
const lockup = `<svg width="1600" height="420" viewBox="0 0 1600 420" xmlns="http://www.w3.org/2000/svg">
<rect width="1600" height="420" fill="${BG}"/>
${pitch(230, 210, 0.5, { lionUri: LION_HEAD_URI })}
<text x="450" y="248" font-family="Montserrat" font-size="150" font-weight="800" fill="${INK}" letter-spacing="-4">${BRAND}.</text>
<text x="456" y="316" font-family="Montserrat" font-size="30" font-weight="700" fill="${MUTE}" letter-spacing="8">${TAGLINE}</text>
</svg>`;
render("logo-lockup.png", lockup);

// ---- 4. X banner (1500x500): editorial left, shot-map pitch right ----
const banner = `<svg width="1500" height="500" viewBox="0 0 1500 500" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="g" cx="0.82" cy="0.5" r="1.05">
    <stop offset="0" stop-color="${NAVY}"/>
    <stop offset="0.55" stop-color="${BG}"/>
    <stop offset="1" stop-color="#060709"/>
  </radialGradient>
</defs>
<rect width="1500" height="500" fill="url(#g)"/>
${pitch(1150, 262, 0.92, { shots: true, tagSize: 13, lionUri: LION_HEAD_URI })}
<text x="96" y="222" font-family="Montserrat" font-size="120" font-weight="800" fill="${INK}" letter-spacing="-3">${BRAND}.</text>
<text x="102" y="284" font-family="Montserrat" font-size="26" font-weight="700" fill="${MUTE}" letter-spacing="7">${TAGLINE}</text>
<rect x="100" y="312" width="64" height="5" rx="2.5" fill="${GOLD}"/>
<text x="102" y="366" font-family="Montserrat" font-size="23" fill="#9FB6D6">${MICRO}</text>
</svg>`;
render("x-banner-1500x500.png", banner);


console.log(`\nassets in ${outDir}/`);
