/**
 * Brand asset generator — icon, wordmark, X avatar, X banner, favicon.
 * Parameterized so a rename is one constant + rerun.
 *
 *   npx tsx scripts/brand-assets.mts [outDir]
 *
 * Design: the fieldtilt mark is a pitch tilted 8° with ~62% of it shaded —
 * the field-tilt metric itself. Chelsea-era dressing: royal-blue field,
 * crest-gold tilt, and an ORIGINAL geometric lion in the pitch's center
 * circle (never the trademarked club crest). Stat glyphs on the banner.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { initWasm, Resvg } from "@resvg/resvg-wasm";

const BRAND = "fieldtilt";
const TAGLINE = "FOOTBALL INTELLIGENCE, PUBLISHED";
const MICRO = "Chelsea first — xG · form · live · every claim with receipts";

const BG = "#0B0C0F";
const INK = "#FFFFFF";
const MUTE = "#878D99";
const ACCENT = "#3D6BFF";
const CHELSEA = "#034694"; // royal blue
const CHELSEA_DEEP = "#02356F";
const GOLD = "#D9A31A"; // crest-gold

const outDir = process.argv[2] || "brand";
mkdirSync(outDir, { recursive: true });

await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
const fonts = [
  readFileSync("packages/render/fonts/Montserrat-Regular.ttf"),
  readFileSync("packages/render/fonts/Montserrat-Bold.ttf"),
  readFileSync("packages/render/fonts/Montserrat-ExtraBold.ttf"),
];

/** N-spike star polygon points (the lion's mane). */
function starPoints(cx: number, cy: number, spikes: number, rOut: number, rIn: number): string {
  const pts: string[] = [];
  for (let i = 0; i < spikes * 2; i++) {
    const r = i % 2 === 0 ? rOut : rIn;
    const a = (Math.PI * i) / spikes - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

/**
 * Original geometric lion head: spiked mane ring, punched face, minimal
 * gold features. A pictogram, deliberately nothing like the club crest.
 */
function lionMark(cx: number, cy: number, r: number, opts?: { mane?: string; face?: string; feat?: string }): string {
  const mane = opts?.mane ?? GOLD;
  const face = opts?.face ?? CHELSEA;
  const feat = opts?.feat ?? GOLD;
  const fr = r * 0.66;
  const eye = (sx: number) => `
    <g transform="rotate(${-14 * sx} ${cx + sx * fr * 0.36} ${cy - fr * 0.18})">
      <ellipse cx="${cx + sx * fr * 0.36}" cy="${cy - fr * 0.18}" rx="${fr * 0.16}" ry="${fr * 0.09}" fill="${feat}"/>
    </g>`;
  return `
  <g>
    <polygon points="${starPoints(cx, cy, 12, r, r * 0.72)}" fill="${mane}"/>
    <circle cx="${cx}" cy="${cy}" r="${fr}" fill="${face}"/>
    ${eye(-1)}${eye(1)}
    <path d="M ${cx - fr * 0.19} ${cy + fr * 0.18} L ${cx + fr * 0.19} ${cy + fr * 0.18} L ${cx} ${cy + fr * 0.44} Z" fill="${feat}"/>
    <path d="M ${cx} ${cy + fr * 0.44} L ${cx} ${cy + fr * 0.62} M ${cx} ${cy + fr * 0.62} L ${cx - fr * 0.34} ${cy + fr * 0.66} M ${cx} ${cy + fr * 0.62} L ${cx + fr * 0.34} ${cy + fr * 0.66}"
      fill="none" stroke="${feat}" stroke-width="${fr * 0.09}" stroke-linecap="round"/>
  </g>`;
}

/**
 * The mark: a tilted pitch, majority half shaded = field tilt, with the
 * lion in the (enlarged) center circle on the tilt line.
 */
function pitchMark(
  cx: number,
  cy: number,
  scale: number,
  opts?: { dim?: boolean; fill?: string; lionFace?: string }
): string {
  const W = 600 * scale, H = 400 * scale, R = 28 * scale;
  const x = cx - W / 2, y = cy - H / 2;
  const stroke = 26 * scale;
  const tiltShare = 0.62; // the metric, drawn
  const alpha = opts?.dim ? 0.8 : 1;
  const fill = opts?.fill ?? ACCENT;
  const lionR = 96 * scale;
  const lx = x + W * tiltShare;
  return `
  <g transform="rotate(-8 ${cx} ${cy})" opacity="${alpha}">
    <clipPath id="pitch-${cx}-${cy}"><rect x="${x}" y="${y}" width="${W}" height="${H}" rx="${R}"/></clipPath>
    <rect x="${x}" y="${y}" width="${W * tiltShare}" height="${H}" clip-path="url(#pitch-${cx}-${cy})" fill="${fill}"/>
    <rect x="${x}" y="${y}" width="${W}" height="${H}" rx="${R}" fill="none" stroke="${INK}" stroke-width="${stroke}"/>
    <line x1="${lx}" y1="${y}" x2="${lx}" y2="${y + lionR * 0.78 + (cy - y - lionR * 0.78 - lionR)}" stroke="${INK}" stroke-width="${stroke * 0.75}"/>
    <line x1="${lx}" y1="${cy + lionR}" x2="${lx}" y2="${y + H}" stroke="${INK}" stroke-width="${stroke * 0.75}"/>
    <circle cx="${lx}" cy="${cy}" r="${lionR}" fill="none" stroke="${INK}" stroke-width="${stroke * 0.65}"/>
    ${lionMark(lx, cy, lionR * 0.66, { mane: INK, face: opts?.lionFace ?? fill, feat: INK })}
  </g>`;
}

/** Small stat glyphs: rising bars, a sparkline, a live dot. */
function statGlyphs(x: number, y: number, s: number, col: string): string {
  const bar = (bx: number, h: number) =>
    `<rect x="${x + bx * s}" y="${y - h * s}" width="${9 * s}" height="${h * s}" rx="${2 * s}" fill="${col}"/>`;
  return `
  <g opacity="0.9">
    ${bar(0, 16)}${bar(14, 26)}${bar(28, 21)}${bar(42, 34)}
    <polyline points="${[[64, -6], [76, -18], [88, -10], [100, -30], [112, -22], [124, -36]]
      .map(([px, py]) => `${x + px * s},${y + py * s}`).join(" ")}"
      fill="none" stroke="${col}" stroke-width="${3 * s}" stroke-linecap="round" stroke-linejoin="round"/>
    <circle cx="${x + 124 * s}" cy="${y - 36 * s}" r="${5 * s}" fill="${GOLD}"/>
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

// ---- 1. App icon / X avatar (square 1024, Chelsea-blue field, gold tilt) ----
const icon = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="ig" cx="0.5" cy="0.36" r="0.95">
    <stop offset="0" stop-color="${CHELSEA}"/>
    <stop offset="1" stop-color="${CHELSEA_DEEP}"/>
  </radialGradient>
</defs>
<rect width="1024" height="1024" rx="180" fill="url(#ig)"/>
${pitchMark(512, 440, 1.12, { fill: GOLD })}
<text x="512" y="836" font-family="Montserrat" font-size="112" font-weight="800" fill="${INK}" text-anchor="middle" letter-spacing="-2">${BRAND}.</text>
${statGlyphs(376, 936, 2.2, "#7FA8DC")}
</svg>`;
render("icon-1024.png", icon, undefined, CHELSEA_DEEP);
render("x-avatar-400.png", icon, 400, CHELSEA_DEEP);

// ---- 2. Favicon (64): lion alone on Chelsea blue — legible at tab size ----
const favicon = `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">
<rect width="256" height="256" rx="48" fill="${CHELSEA}"/>
${lionMark(128, 128, 92, { mane: GOLD, face: CHELSEA, feat: GOLD })}
</svg>`;
render("favicon-64.png", favicon, 64, CHELSEA);
render("favicon-256.png", favicon, undefined, CHELSEA);

// ---- 3. Wordmark lockup (1600x420, mark left) ----
const lockup = `<svg width="1600" height="420" viewBox="0 0 1600 420" xmlns="http://www.w3.org/2000/svg">
<rect width="1600" height="420" fill="${BG}"/>
${pitchMark(230, 210, 0.52, { fill: CHELSEA, lionFace: CHELSEA })}
<text x="450" y="248" font-family="Montserrat" font-size="150" font-weight="800" fill="${INK}" letter-spacing="-4">${BRAND}.</text>
<text x="456" y="316" font-family="Montserrat" font-size="30" font-weight="700" fill="${MUTE}" letter-spacing="8">${TAGLINE}</text>
</svg>`;
render("logo-lockup.png", lockup);

// ---- 4. X banner (1500x500) ----
const banner = `<svg width="1500" height="500" viewBox="0 0 1500 500" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="g" cx="0.85" cy="0.5" r="1">
    <stop offset="0" stop-color="${CHELSEA_DEEP}"/>
    <stop offset="0.62" stop-color="${BG}"/>
    <stop offset="1" stop-color="#060709"/>
  </radialGradient>
</defs>
<rect width="1500" height="500" fill="url(#g)"/>
${pitchMark(1210, 250, 0.85, { dim: true, fill: CHELSEA, lionFace: CHELSEA })}
<text x="96" y="222" font-family="Montserrat" font-size="120" font-weight="800" fill="${INK}" letter-spacing="-3">${BRAND}.</text>
<text x="102" y="284" font-family="Montserrat" font-size="26" font-weight="700" fill="${MUTE}" letter-spacing="7">${TAGLINE}</text>
<rect x="100" y="312" width="64" height="5" rx="2.5" fill="${GOLD}"/>
<text x="102" y="366" font-family="Montserrat" font-size="23" fill="#9FB6D6">${MICRO}</text>
${statGlyphs(102, 442, 1.35, "#5C82C4")}
</svg>`;
render("x-banner-1500x500.png", banner);

console.log(`\nassets in ${outDir}/`);
