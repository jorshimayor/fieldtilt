/**
 * SVG infographic templates — the "editorial" design system.
 *
 * Pure functions: typed data in → SVG string out (rasterization lives in
 * png.ts). Every visual decision comes from theme.ts; see
 * docs/DESIGN_SYSTEM.md for the rules these templates encode.
 *
 * Layout language (matching the reference posts):
 *   - near-black canvas, optional full-bleed photo under a dark scrim
 *   - names/headlines: huge, extrabold, tight tracking, often stacked
 *   - stats: oversized numerals with small letter-spaced uppercase labels
 *   - hairline dividers; the brand wordmark anchors a corner
 */

import { BRAND, color, font, type, formats, layout, PHOTO_SCRIM_OPACITY } from "./theme";

export const PORTRAIT = formats.portrait;
export const LANDSCAPE = formats.landscape;
const M = layout.margin;

// ------------------------------------------------------------------ utilities

/**
 * Inline the brand fonts into an SVG as base64 @font-face rules so a BROWSER
 * can rasterize it faithfully (canvas-drawn SVGs can't reach external fonts).
 * This is what makes the zero-cost approval flow work on the Workers free
 * plan: the dashboard rasterizes client-side instead of running wasm here.
 */
export function embedFontsInSvg(svg: string, fontBuffers: Uint8Array[]): string {
  const weights = [400, 700, 800];
  const faces = fontBuffers
    .slice(0, 3)
    .map((buf, i) => {
      let bin = "";
      const chunk = 0x8000;
      for (let o = 0; o < buf.length; o += chunk) {
        bin += String.fromCharCode(...buf.subarray(o, o + chunk));
      }
      const b64 = btoa(bin);
      return `@font-face{font-family:'${font.family}';font-weight:${weights[i]};src:url(data:font/ttf;base64,${b64}) format('truetype');}`;
    })
    .join("");
  return svg.replace(/(<svg[^>]*>)/, `$1<style>${faces}</style>`);
}

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(s: string, max: number): string {
  const v = (s || "").trim();
  return v.length <= max ? v : v.slice(0, max - 1).trimEnd() + "…";
}

function initials(name: string): string {
  const words = (name || "?").split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

/** Shrink a font size for long strings so headlines never overflow. */
function fitFont(text: string, base: number, maxChars: number): number {
  const len = (text || "").length;
  if (len <= maxChars) return base;
  return Math.max(Math.floor((base * maxChars) / len), Math.floor(base * 0.45));
}

/** Wrap sentence text into ≤maxChars lines, capped at maxLines (ellipsis). */
function wrapText(textIn: string, maxChars: number, maxLines: number): string[] {
  const words = (textIn || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
      if (lines.length === maxLines) break;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  else if (lines.length === maxLines && cur) lines[maxLines - 1] += "…";
  return lines;
}

/** Split an UPPERCASE label into ≤maxChars lines (stat labels stack, ref-style). */
function wrapLabel(label: string, maxChars = 15): string[] {
  const words = label.toUpperCase().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = (cur + " " + w).trim();
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

function text(
  x: number,
  y: number,
  content: string,
  opts: {
    size: number;
    weight?: number;
    fill?: string;
    tracking?: number;
    anchor?: "start" | "middle" | "end";
    italic?: boolean;
    opacity?: number;
  }
): string {
  return `<text x="${x}" y="${y}" font-family="${font.family}" font-size="${opts.size}" font-weight="${opts.weight ?? 400}" fill="${opts.fill ?? color.ink}"${
    opts.tracking ? ` letter-spacing="${opts.tracking}"` : ""
  }${opts.anchor ? ` text-anchor="${opts.anchor}"` : ""}${opts.italic ? ` font-style="italic"` : ""}${
    opts.opacity != null ? ` opacity="${opts.opacity}"` : ""
  }>${esc(content)}</text>`;
}

// ------------------------------------------------------------------ chrome

function frame(w: number, h: number, photoDataUri?: string): string {
  // Photo treatment — the "poster" look: full-bleed image, a light overall
  // darken so color survives, then a cinematic Y-gradient scrim (heavy at
  // top and bottom where headlines/stats live, breathing room mid-frame).
  // Type must ALWAYS win: stats are the point of attention, photo the mood.
  const photo = photoDataUri
    ? `<image href="${photoDataUri}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>
<rect width="${w}" height="${h}" fill="${color.scrim}" opacity="0.38"/>
<rect width="${w}" height="${h}" fill="url(#scrimY)"/>
<rect width="${w}" height="${h}" fill="url(#scrimX)"/>`
    : `<rect width="${w}" height="${h}" fill="url(#vig)"/>`;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="vig" cx="0.5" cy="0.42" r="0.95">
    <stop offset="0" stop-color="#15171D"/>
    <stop offset="0.55" stop-color="${color.bg}"/>
    <stop offset="1" stop-color="#060709"/>
  </radialGradient>
  <linearGradient id="scrimY" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${color.scrim}" stop-opacity="0.72"/>
    <stop offset="0.28" stop-color="${color.scrim}" stop-opacity="0.18"/>
    <stop offset="0.52" stop-color="${color.scrim}" stop-opacity="0.22"/>
    <stop offset="0.78" stop-color="${color.scrim}" stop-opacity="0.68"/>
    <stop offset="1" stop-color="${color.scrim}" stop-opacity="0.94"/>
  </linearGradient>
  <linearGradient id="scrimX" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${color.scrim}" stop-opacity="0.5"/>
    <stop offset="0.3" stop-color="${color.scrim}" stop-opacity="0.06"/>
    <stop offset="0.68" stop-color="${color.scrim}" stop-opacity="0.06"/>
    <stop offset="1" stop-color="${color.scrim}" stop-opacity="0.55"/>
  </linearGradient>
</defs>
<rect width="${w}" height="${h}" fill="${color.bg}"/>
${photo}`;
}

/** Brand wordmark. Corner-anchored, always the same size. */
function brandMark(x: number, y: number, anchor: "start" | "end" = "start"): string {
  return text(x, y, BRAND, {
    size: 24,
    weight: font.weight.black,
    tracking: 1.5,
    anchor,
  });
}

/** "▶ EYEBROW" — small uppercase kicker with a play glyph. */
function eyebrow(x: number, y: number, label: string, anchor: "start" | "middle" | "end" = "start"): string {
  const tri =
    anchor === "start"
      ? `<path d="M ${x} ${y - 12} l 14 7 l -14 7 z" fill="${color.ink}"/>`
      : "";
  const tx = anchor === "start" ? x + 30 : x;
  return `${tri}${text(tx, y + 2, label.toUpperCase(), {
    size: type.micro.size,
    weight: type.micro.weight,
    tracking: type.micro.tracking,
    fill: color.inkDim,
    anchor,
  })}`;
}

/** Oversized stat value + stacked uppercase label (the right-rail unit). */
function bigStat(
  x: number,
  y: number,
  value: string,
  label: string,
  opts?: { anchor?: "start" | "middle" | "end"; size?: number }
): string {
  const anchor = opts?.anchor ?? "end";
  const size = opts?.size ?? type.stat.size;
  const lines = wrapLabel(label);
  const labelSvg = lines
    .map((l, i) =>
      text(x, y + 34 + i * 24, l, {
        size: type.label.size,
        weight: type.label.weight,
        tracking: type.label.tracking,
        fill: color.inkMute,
        anchor,
      })
    )
    .join("");
  return `${text(x, y, value, {
    size,
    weight: type.stat.weight,
    tracking: type.stat.tracking,
    anchor,
  })}${labelSvg}`;
}

function hairline(x1: number, y1: number, x2: number, y2: number): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color.line}" stroke-width="${layout.hairline}"/>`;
}

/** Giant translucent initials — carries the layout when there's no photo. */
function watermark(w: number, h: number, label: string): string {
  return text(w / 2, h * 0.62, label.toUpperCase(), {
    size: Math.floor(w * 0.42),
    weight: font.weight.black,
    tracking: -8,
    anchor: "middle",
    opacity: 0.05,
  });
}

/** Stack a long name into 1–2 huge lines. */
function stackedName(x: number, y: number, name: string, size: number, anchor: "start" | "middle" = "start"): string {
  const words = (name || "").split(/\s+/).filter(Boolean);
  let lines: string[];
  if (words.length <= 1) lines = [name];
  else {
    const mid = Math.ceil(words.length / 2);
    lines = [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
  }
  const fitted = Math.min(...lines.map((l) => fitFont(l, size, 13)));
  return lines
    .map((l, i) =>
      text(x, y + i * (fitted * 1.04), l, {
        size: fitted,
        weight: font.weight.black,
        tracking: type.h1.tracking,
        anchor,
      })
    )
    .join("");
}

// ------------------------------------------------------------------ player stat (portrait)

export type PlayerStatData = {
  player: string;
  season: string; // "2025/26"
  competition?: string;
  /** e.g. "vs Germany", "Premier League 25/26" — small context under the name */
  context?: string;
  stats: { label: string; value: string }[]; // up to 6, rendered as a right rail
  /** Recent form as W/D/L pills (team results while featuring, newest first). */
  formPills?: ("W" | "D" | "L")[];
  /** One scout-style line, e.g. "Underlying numbers say the goals are coming." */
  remark?: string;
  /** Optional full-bleed background photo (data: URI). Rendered under a scrim. */
  photoDataUri?: string;
};

export function playerStatCard(d: PlayerStatData): string {
  const { w, h } = PORTRAIT;
  const stats = (d.stats || []).slice(0, 6);
  const railX = w - M;
  const railTop = 150;
  const step = Math.min(178, Math.floor((h - railTop - 160) / Math.max(stats.length, 1)));
  const rail = stats
    .map((s, i) => bigStat(railX, railTop + i * step, s.value, s.label))
    .join("");

  // Recent form: W/D/L pills under the name block (newest first).
  const pills = (d.formPills || []).slice(0, 5);
  const pillsSvg = pills.length
    ? pills.map((o, i) => outcomeSquare(M + i * 58, 486, 42, o)).join("") +
      text(M, 566, "FORM · MOST RECENT FIRST", {
        size: 13,
        weight: 700,
        tracking: 2,
        fill: color.inkMute,
      })
    : "";

  // Scout remark: italic, quote-like, bottom-left above the wordmark.
  const remarkLines = d.remark ? wrapText(d.remark, 34, 3) : [];
  const remarkSvg = remarkLines
    .map((l, i) =>
      text(M, h - 118 - (remarkLines.length - 1 - i) * 44, l, {
        size: 29,
        italic: true,
        fill: color.inkDim,
      })
    )
    .join("");

  return `${frame(w, h, d.photoDataUri)}
${d.photoDataUri ? "" : watermark(w, h, initials(d.player))}
${stackedName(M, 190, d.player.toUpperCase(), type.h1.size)}
${d.context ? text(M, 400, d.context.toUpperCase(), { size: type.label.size, weight: 700, tracking: type.label.tracking, fill: color.inkMute }) : ""}
${text(M, 440, `SEASON ${d.season}`, { size: type.label.size, weight: 700, tracking: type.label.tracking, fill: color.inkMute })}
${pillsSvg}
${rail}
${remarkSvg}
${brandMark(M, h - 64)}
${d.competition ? text(w - M, h - 64, d.competition.toUpperCase(), { size: type.micro.size, weight: 700, tracking: type.micro.tracking, fill: color.inkMute, anchor: "end" }) : ""}
</svg>`;
}

// ------------------------------------------------------------------ post-match (portrait)

export type PostMatchData = {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  competition: string;
  seasonLabel?: string; // "Premier League 25/26" footer
  statusLabel: string; // "FULL TIME"
  scorers?: string[];
  photoDataUri?: string;
  stats: {
    possession?: number | null;
    xg?: number | null;
    shotsTotal?: number | null;
    shotsOnTarget?: number | null;
    corners?: number | null;
    passAccuracy?: number | null;
    fouls?: number | null;
  };
};

export function postMatchCard(d: PostMatchData): string {
  const { w, h } = PORTRAIT;
  const s = d.stats || {};
  const cx = w / 2;

  // Hero row: xG — SCORE — possession
  const hero = `
${bigStat(M + 110, 260, s.xg != null ? String(s.xg) : "—", "xG", { anchor: "middle", size: 84 })}
${bigStat(cx, 268, `${d.homeGoals}-${d.awayGoals}`, "Score", { anchor: "middle", size: 132 })}
${bigStat(w - M - 110, 260, s.possession != null ? `${s.possession}%` : "—", "Possession", { anchor: "middle", size: 84 })}`;

  const rows: [string, string][] = [];
  if (s.shotsTotal != null) rows.push(["Shots", String(s.shotsTotal)]);
  if (s.shotsOnTarget != null) rows.push(["On target", String(s.shotsOnTarget)]);
  if (s.corners != null) rows.push(["Corners", String(s.corners)]);
  if (s.passAccuracy != null) rows.push(["Pass accuracy", `${s.passAccuracy}%`]);
  if (s.fouls != null) rows.push(["Fouls", String(s.fouls)]);
  const listTop = 470;
  const list = rows
    .map(
      ([label, value], i) => `
${text(M, listTop + i * 66, label, { size: 28, fill: color.inkDim })}
${text(w - M, listTop + i * 66, value, { size: 30, weight: 800, anchor: "end" })}`
    )
    .join("");
  const scorers = (d.scorers || []).slice(0, 5);
  const scorersSvg = scorers.length
    ? text(M, listTop + rows.length * 66 + 26, scorers.join("  ·  "), {
        size: 22,
        fill: color.inkMute,
      })
    : "";

  return `${frame(w, h, d.photoDataUri)}
${eyebrow(M, 106, d.statusLabel)}
${text(w - M, 110, truncate(d.competition, 34).toUpperCase(), { size: type.micro.size, weight: 700, tracking: type.micro.tracking, fill: color.inkMute, anchor: "end" })}
${hero}
${hairline(M, 400, w - M, 400)}
${list}
${hairline(M, listTop + rows.length * 66 + 44, w - M, listTop + rows.length * 66 + 44)}
${scorersSvg}
${stackedName(M, h - 168, `${d.home} ${d.homeGoals}-${d.awayGoals} ${d.away}`.toUpperCase(), 46)}
${text(M, h - 64, (d.seasonLabel || d.competition).toUpperCase(), { size: type.micro.size, weight: 700, tracking: type.micro.tracking, fill: color.inkMute })}
${brandMark(w - M, h - 64, "end")}
</svg>`;
}

// ------------------------------------------------------------------ match preview (landscape)

export type MatchPreviewData = {
  home: string;
  away: string;
  competition: string;
  dateLabel: string;
  venue?: string;
  /** e.g. "H2H last 10: 4W 3D 3L" */
  footnote?: string;
  /** Full-bleed background photo (stadium, fans…) under the cinematic scrim. */
  photoDataUri?: string;
};

export function matchPreviewCard(d: MatchPreviewData): string {
  const { w, h } = LANDSCAPE;
  const cx = w / 2;
  const homeFs = fitFont(d.home, 88, 13);
  const awayFs = fitFont(d.away, 88, 13);
  return `${frame(w, h, d.photoDataUri)}
${eyebrow(cx, 116, "Match day", "middle")}
${text(cx, 268, d.home.toUpperCase(), { size: homeFs, weight: 800, tracking: -1.5, anchor: "middle" })}
${text(cx, 330, "vs", { size: 34, italic: true, fill: color.inkMute, anchor: "middle" })}
${text(cx, 432, d.away.toUpperCase(), { size: awayFs, weight: 800, tracking: -1.5, anchor: "middle" })}
${hairline(cx - 210, 486, cx + 210, 486)}
${text(cx, 540, d.dateLabel, { size: 27, weight: 700, anchor: "middle" })}
${d.venue ? text(cx, 582, d.venue.toUpperCase(), { size: type.micro.size, weight: 700, tracking: type.micro.tracking, fill: color.inkMute, anchor: "middle" }) : ""}
${d.footnote ? text(cx, h - 56, d.footnote.toUpperCase(), { size: type.micro.size, weight: 700, tracking: 1.6, fill: color.inkMute, anchor: "middle" }) : ""}
${brandMark(M, h - 56)}
${text(w - M, h - 56, truncate(d.competition, 34).toUpperCase(), { size: type.micro.size, weight: 700, tracking: type.micro.tracking, fill: color.inkMute, anchor: "end" })}
</svg>`;
}

// ------------------------------------------------------------------ live / final score (landscape)

export type ScoreCardData = {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  competition: string;
  statusLabel: string; // "LIVE 63'" | "HALF TIME" | "FULL TIME"
  scorers?: string[];
  /** e.g. "54% possession · 1.8 xG" */
  statLine?: string;
  photoDataUri?: string;
};

export function scoreCard(d: ScoreCardData): string {
  const { w, h } = LANDSCAPE;
  const cx = w / 2;
  const isLive = /live/i.test(d.statusLabel);
  const dot = isLive ? `<circle cx="${cx - 74}" cy="98" r="9" fill="${color.loss}"/>` : "";
  const scorers = (d.scorers || []).slice(0, 4);
  return `${frame(w, h, d.photoDataUri)}
${dot}${text(cx + (isLive ? 14 : 0), 106, d.statusLabel.toUpperCase(), { size: type.micro.size + 3, weight: 700, tracking: type.micro.tracking, fill: color.inkDim, anchor: "middle" })}
${text(cx, 330, `${d.homeGoals}-${d.awayGoals}`, { size: 210, weight: 800, tracking: -6, anchor: "middle" })}
${text(cx - 330, 300, truncate(d.home, 14).toUpperCase(), { size: fitFont(d.home, 34, 12), weight: 700, tracking: 1, fill: color.inkDim, anchor: "middle" })}
${text(cx + 330, 300, truncate(d.away, 14).toUpperCase(), { size: fitFont(d.away, 34, 12), weight: 700, tracking: 1, fill: color.inkDim, anchor: "middle" })}
${scorers.length ? hairline(cx - 190, 404, cx + 190, 404) : ""}
${scorers.map((sc, i) => text(cx, 452 + i * 36, sc, { size: 22, fill: color.inkMute, anchor: "middle" })).join("")}
${d.statLine ? text(cx, h - 112, d.statLine.toUpperCase(), { size: type.micro.size, weight: 700, tracking: 1.6, fill: color.inkMute, anchor: "middle" }) : ""}
${brandMark(M, h - 56)}
${text(w - M, h - 56, truncate(d.competition, 34).toUpperCase(), { size: type.micro.size, weight: 700, tracking: type.micro.tracking, fill: color.inkMute, anchor: "end" })}
</svg>`;
}

// ------------------------------------------------------------------ transfer (portrait)

export type TransferCardData = {
  player: string;
  direction: "in" | "out";
  counterparty: string;
  transferType?: string; // "€ 45M" | "Loan" | "Free"
  dateLabel?: string;
  photoDataUri?: string;
};

export function transferCard(d: TransferCardData): string {
  const { w, h } = PORTRAIT;
  const isIn = d.direction === "in";
  const from = isIn ? d.counterparty : "Chelsea";
  const to = isIn ? "Chelsea" : d.counterparty;
  const tag = isIn ? "INCOMING" : "OUTGOING";
  return `${frame(w, h, d.photoDataUri)}
${d.photoDataUri ? "" : watermark(w, h, initials(d.player))}
${eyebrow(M, 106, "Transfer news")}
${brandMark(w - M, 110, "end")}
${stackedName(M, 320, d.player.toUpperCase(), 84)}
<rect x="${M}" y="${560}" width="${tag.length * 15 + 48}" height="52" rx="26" fill="none" stroke="${color.ink}" stroke-width="2.5"/>
${text(M + 24 + (tag.length * 15) / 2, 594, tag, { size: 19, weight: 800, tracking: 2.4, anchor: "middle" })}
${text(M, 730, truncate(from, 24), { size: 40, weight: 700, fill: color.inkDim })}
<path d="M ${M} 786 h 120 m -18 -14 l 18 14 l -18 14" stroke="${color.ink}" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
${text(M, 872, truncate(to, 24), { size: 46, weight: 800 })}
${d.transferType ? bigStat(w - M, 780, d.transferType, "Fee", { anchor: "end", size: 56 }) : ""}
${d.dateLabel ? text(M, h - 64, d.dateLabel, { size: type.micro.size, weight: 700, tracking: type.micro.tracking, fill: color.inkMute }) : ""}
</svg>`;
}

// ------------------------------------------------------------------ weekly form (portrait)

export type FormCardData = {
  seasonLabel: string;
  results: { opponent: string; score: string; outcome: "W" | "D" | "L" }[];
  position?: number | null;
  points?: number | null;
  played?: number | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  competition?: string;
  photoDataUri?: string;
};

function outcomeSquare(x: number, y: number, size: number, outcome: "W" | "D" | "L"): string {
  const c = outcome === "W" ? color.win : outcome === "L" ? color.loss : color.draw;
  const filled = outcome === "W";
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="8" fill="${filled ? c : "none"}" stroke="${c}" stroke-width="2.5"/>
${text(x + size / 2, y + size * 0.68, outcome, { size: size * 0.5, weight: 800, fill: filled ? color.bg : c, anchor: "middle" })}`;
}

export function formCard(d: FormCardData): string {
  const { w, h } = PORTRAIT;
  const results = (d.results || []).slice(0, 5);
  const pills = results.map((r, i) => outcomeSquare(M + i * 78, 196, 56, r.outcome)).join("");
  const rowTop = 356;
  const bg = frame(w, h, d.photoDataUri);
  const rows = results
    .map(
      (r, i) => `
${text(M, rowTop + i * 62, truncate(r.opponent, 22), { size: 28, fill: color.inkDim })}
${text(w - M - 96, rowTop + i * 62, r.score, { size: 28, weight: 800, anchor: "end" })}
${outcomeSquare(w - M - 44, rowTop + i * 62 - 30, 40, r.outcome)}`
    )
    .join("");
  const tiles: [string, string][] = [];
  if (d.position != null) tiles.push([`#${d.position}`, "League position"]);
  if (d.points != null) tiles.push([String(d.points), "Points"]);
  if (d.goalsFor != null) tiles.push([String(d.goalsFor), "Goals scored"]);
  if (d.goalsAgainst != null) tiles.push([String(d.goalsAgainst), "Goals conceded"]);
  const tileTop = rowTop + results.length * 62 + 96;
  const tileSvg = tiles
    .slice(0, 4)
    .map(([v, l], i) => bigStat(M + (i % 2) * ((w - 2 * M) / 2) , tileTop + Math.floor(i / 2) * 168, v, l, { anchor: "start", size: 60 }))
    .join("");
  return `${bg}
${eyebrow(M, 106, "Weekly review")}
${brandMark(w - M, 110, "end")}
${text(M, 172, "FORM.", { size: 58, weight: 800, tracking: -1 })}
${pills}
${hairline(M, 300, w - M, 300)}
${rows}
${hairline(M, tileTop - 76, w - M, tileTop - 76)}
${tileSvg}
${text(M, h - 64, (d.competition || `Season ${d.seasonLabel}`).toUpperCase(), { size: type.micro.size, weight: 700, tracking: type.micro.tracking, fill: color.inkMute })}
</svg>`;
}

// ------------------------------------------------------------------ editorial (portrait)

export type EditorialData = {
  /** Kicker, e.g. "On this day", "Club statement" */
  eyebrow: string;
  /** Sentence fragments; `em: true` renders bold-italic (names, key phrases). */
  lines: { text: string; em?: boolean }[];
  dateLabel?: string;
  photoDataUri?: string;
};

export function editorialCard(d: EditorialData): string {
  const { w, h } = PORTRAIT;
  const lines = (d.lines || []).slice(0, 7);
  const lineHeight = 58;
  const startY = h * 0.42;
  const body = lines
    .map((l, i) =>
      text(M, startY + i * lineHeight, l.text, {
        size: 36,
        weight: l.em ? 800 : 400,
        italic: l.em,
        fill: l.em ? color.ink : color.inkDim,
      })
    )
    .join("");
  return `${frame(w, h, d.photoDataUri)}
${brandMark(w - M, 110, "end")}
${eyebrow(M, h * 0.28, d.eyebrow)}
${body}
${d.dateLabel ? text(M, h - 64, d.dateLabel, { size: 20, fill: color.inkMute }) : ""}
</svg>`;
}
