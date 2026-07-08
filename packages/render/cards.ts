/**
 * SVG infographic card templates.
 *
 * Every card is a pure function: typed data in → SVG string out. No network,
 * no fonts loaded here (rasterization + fonts live in png.ts), so these are
 * trivially unit-testable.
 *
 * Canvas: 1200x675 (16:9 — X's preferred inline crop).
 * Brand: Chelsea navy/blue, Montserrat, no club crests (trademark-safe).
 */

export const CARD_W = 1200;
export const CARD_H = 675;

const COLORS = {
  bgTop: "#050e2b",
  bgBottom: "#0a2e6e",
  chelsea: "#034694",
  accent: "#1e6bd6",
  line: "#1d4ed8",
  white: "#ffffff",
  muted: "#9dbcf5",
  gold: "#f5c542",
  win: "#22c55e",
  draw: "#94a3b8",
  loss: "#ef4444",
  barBg: "#12275c",
};

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
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words
    .slice(0, 3)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

/** Scale a font size down for long strings so names never overflow. */
function fitFont(text: string, base: number, maxChars: number): number {
  const len = (text || "").length;
  if (len <= maxChars) return base;
  return Math.max(Math.floor((base * maxChars) / len), Math.floor(base * 0.5));
}

function svgOpen(): string {
  return `<svg width="${CARD_W}" height="${CARD_H}" viewBox="0 0 ${CARD_W} ${CARD_H}" xmlns="http://www.w3.org/2000/svg">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${COLORS.bgTop}"/>
    <stop offset="1" stop-color="${COLORS.bgBottom}"/>
  </linearGradient>
  <linearGradient id="stripe" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="${COLORS.accent}" stop-opacity="0"/>
    <stop offset="0.5" stop-color="${COLORS.accent}" stop-opacity="0.35"/>
    <stop offset="1" stop-color="${COLORS.accent}" stop-opacity="0"/>
  </linearGradient>
</defs>
<rect width="${CARD_W}" height="${CARD_H}" fill="url(#bg)"/>
<g opacity="0.25">
  <path d="M -100 720 L 500 -60" stroke="${COLORS.accent}" stroke-width="120" opacity="0.18"/>
  <path d="M 60 720 L 660 -60" stroke="${COLORS.accent}" stroke-width="40" opacity="0.14"/>
  <path d="M 900 760 L 1400 80" stroke="${COLORS.chelsea}" stroke-width="160" opacity="0.35"/>
</g>`;
}

function chrome(label: string, sublabel?: string): string {
  return `
<g font-family="Montserrat">
  <text x="64" y="76" font-size="26" font-weight="800" letter-spacing="6" fill="${COLORS.white}">BLUEBANTER</text>
  <rect x="64" y="92" width="72" height="5" rx="2.5" fill="${COLORS.gold}"/>
  <text x="1136" y="76" font-size="24" font-weight="700" letter-spacing="3" fill="${COLORS.gold}" text-anchor="end">${esc(label.toUpperCase())}</text>
  ${sublabel ? `<text x="1136" y="106" font-size="17" fill="${COLORS.muted}" text-anchor="end">${esc(truncate(sublabel, 52))}</text>` : ""}
  <rect x="0" y="${CARD_H - 54}" width="${CARD_W}" height="54" fill="#03102e"/>
  <text x="64" y="${CARD_H - 20}" font-size="16" letter-spacing="1" fill="${COLORS.muted}">CHELSEA FC UPDATES</text>
  <text x="1136" y="${CARD_H - 20}" font-size="16" fill="${COLORS.muted}" text-anchor="end">data: API-FOOTBALL</text>
</g>`;
}

function teamBadge(cx: number, cy: number, name: string, r: number, isChelsea: boolean): string {
  const label = initials(name);
  const fs = label.length >= 3 ? r * 0.62 : r * 0.78;
  return `
<g font-family="Montserrat">
  <circle cx="${cx}" cy="${cy}" r="${r}" fill="${isChelsea ? COLORS.chelsea : "#12275c"}" stroke="${isChelsea ? COLORS.gold : COLORS.line}" stroke-width="4"/>
  <text x="${cx}" y="${cy + fs * 0.35}" font-size="${fs}" font-weight="800" fill="${COLORS.white}" text-anchor="middle">${esc(label)}</text>
</g>`;
}

function isChelseaName(name: string): boolean {
  return /chelsea/i.test(name || "");
}

// ---------------------------------------------------------------- match preview

export type MatchPreviewData = {
  home: string;
  away: string;
  competition: string;
  dateLabel: string; // already-formatted local kickoff, e.g. "Sat 12 Jul, 16:00 WAT"
  venue?: string;
};

export function matchPreviewCard(d: MatchPreviewData): string {
  const homeFs = fitFont(d.home, 44, 14);
  const awayFs = fitFont(d.away, 44, 14);
  return `${svgOpen()}${chrome("Match Preview", d.competition)}
<g font-family="Montserrat" text-anchor="middle">
  <text x="600" y="200" font-size="30" font-weight="700" letter-spacing="8" fill="${COLORS.gold}">MATCH DAY</text>
  ${teamBadge(300, 340, d.home, 92, isChelseaName(d.home))}
  ${teamBadge(900, 340, d.away, 92, isChelseaName(d.away))}
  <text x="300" y="492" font-size="${homeFs}" font-weight="800" fill="${COLORS.white}">${esc(truncate(d.home, 20))}</text>
  <text x="900" y="492" font-size="${awayFs}" font-weight="800" fill="${COLORS.white}">${esc(truncate(d.away, 20))}</text>
  <text x="600" y="360" font-size="56" font-weight="800" fill="${COLORS.muted}">VS</text>
  <text x="600" y="548" font-size="26" font-weight="700" fill="${COLORS.white}">${esc(truncate(d.dateLabel, 44))}</text>
  ${d.venue ? `<text x="600" y="586" font-size="20" fill="${COLORS.muted}">${esc(truncate(d.venue, 48))}</text>` : ""}
</g>
</svg>`;
}

// ---------------------------------------------------------------- live / final score

export type ScoreCardData = {
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  competition: string;
  /** "LIVE 63'" | "HALF TIME" | "FULL TIME" */
  statusLabel: string;
  scorers?: string[]; // e.g. ["Palmer 23'", "Jackson 58'"]
};

export function scoreCard(d: ScoreCardData): string {
  const isLive = /live/i.test(d.statusLabel);
  const scorers = (d.scorers || []).slice(0, 4);
  const scorerRows = scorers
    .map(
      (s, i) =>
        `<text x="600" y="${520 + i * 30}" font-size="20" fill="${COLORS.muted}" text-anchor="middle">${esc(truncate(s, 60))}</text>`
    )
    .join("");
  return `${svgOpen()}${chrome(isLive ? "Live Score" : "Result", d.competition)}
<g font-family="Montserrat" text-anchor="middle">
  <rect x="480" y="160" width="240" height="52" rx="26" fill="${isLive ? COLORS.loss : COLORS.chelsea}"/>
  <text x="600" y="195" font-size="24" font-weight="800" letter-spacing="2" fill="${COLORS.white}">${esc(d.statusLabel.toUpperCase())}</text>
  ${teamBadge(260, 340, d.home, 84, isChelseaName(d.home))}
  ${teamBadge(940, 340, d.away, 84, isChelseaName(d.away))}
  <text x="260" y="480" font-size="${fitFont(d.home, 34, 16)}" font-weight="700" fill="${COLORS.white}">${esc(truncate(d.home, 20))}</text>
  <text x="940" y="480" font-size="${fitFont(d.away, 34, 16)}" font-weight="700" fill="${COLORS.white}">${esc(truncate(d.away, 20))}</text>
  <text x="600" y="392" font-size="132" font-weight="800" fill="${COLORS.white}">${esc(d.homeGoals)} - ${esc(d.awayGoals)}</text>
  ${scorerRows}
</g>
</svg>`;
}

// ---------------------------------------------------------------- post-match stats

export type PostMatchData = ScoreCardData & {
  stats: {
    possession?: number | null;
    xg?: number | null;
    shotsTotal?: number | null;
    shotsOnTarget?: number | null;
    corners?: number | null;
    passAccuracy?: number | null;
  };
};

function statRow(y: number, label: string, value: string): string {
  return `
  <text x="700" y="${y}" font-size="22" fill="${COLORS.muted}">${esc(label)}</text>
  <text x="1136" y="${y}" font-size="24" font-weight="800" fill="${COLORS.white}" text-anchor="end">${esc(value)}</text>
  <rect x="700" y="${y + 14}" width="436" height="2" fill="${COLORS.barBg}"/>`;
}

export function postMatchCard(d: PostMatchData): string {
  const s = d.stats || {};
  const rows: [string, string][] = [];
  if (s.possession != null) rows.push(["Possession", `${s.possession}%`]);
  if (s.xg != null) rows.push(["Expected goals (xG)", String(s.xg)]);
  if (s.shotsOnTarget != null || s.shotsTotal != null)
    rows.push(["Shots (on target/total)", `${s.shotsOnTarget ?? "–"} / ${s.shotsTotal ?? "–"}`]);
  if (s.corners != null) rows.push(["Corners", String(s.corners)]);
  if (s.passAccuracy != null) rows.push(["Pass accuracy", `${s.passAccuracy}%`]);
  const statRows = rows.map(([l, v], i) => statRow(272 + i * 62, l, v)).join("");
  const scorers = (d.scorers || []).slice(0, 4);
  const scorerRows = scorers
    .map(
      (sc, i) =>
        `<text x="300" y="${492 + i * 30}" font-size="19" fill="${COLORS.muted}" text-anchor="middle">${esc(truncate(sc, 40))}</text>`
    )
    .join("");
  return `${svgOpen()}${chrome("Full Time", d.competition)}
<g font-family="Montserrat">
  <g text-anchor="middle">
    ${teamBadge(180, 300, d.home, 62, isChelseaName(d.home))}
    ${teamBadge(420, 300, d.away, 62, isChelseaName(d.away))}
    <text x="300" y="322" font-size="64" font-weight="800" fill="${COLORS.white}">${esc(d.homeGoals)}-${esc(d.awayGoals)}</text>
    <text x="180" y="412" font-size="${fitFont(d.home, 22, 14)}" font-weight="700" fill="${COLORS.white}">${esc(truncate(d.home, 16))}</text>
    <text x="420" y="412" font-size="${fitFont(d.away, 22, 14)}" font-weight="700" fill="${COLORS.white}">${esc(truncate(d.away, 16))}</text>
    <text x="300" y="452" font-size="20" font-weight="700" letter-spacing="3" fill="${COLORS.gold}">${esc(d.statusLabel.toUpperCase())}</text>
    ${scorerRows}
  </g>
  <text x="700" y="220" font-size="24" font-weight="800" letter-spacing="3" fill="${COLORS.gold}" font-family="Montserrat">CHELSEA BY THE NUMBERS</text>
  ${statRows || `<text x="700" y="300" font-size="22" fill="${COLORS.muted}">Stats unavailable for this fixture</text>`}
</g>
</svg>`;
}

// ---------------------------------------------------------------- player stat

export type PlayerStatData = {
  player: string;
  season: string; // "2025/26"
  competition?: string;
  stats: { label: string; value: string }[]; // up to 6
};

export function playerStatCard(d: PlayerStatData): string {
  const stats = (d.stats || []).slice(0, 6);
  const cols = stats.length > 3 ? 3 : Math.max(stats.length, 1);
  const cellW = 1072 / cols;
  const boxes = stats
    .map((s, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = 64 + col * cellW;
      const y = 300 + row * 160;
      return `
  <rect x="${x + 8}" y="${y}" width="${cellW - 16}" height="140" rx="16" fill="${COLORS.barBg}" stroke="${COLORS.line}" stroke-opacity="0.5"/>
  <text x="${x + cellW / 2}" y="${y + 64}" font-size="46" font-weight="800" fill="${COLORS.gold}" text-anchor="middle">${esc(s.value)}</text>
  <text x="${x + cellW / 2}" y="${y + 104}" font-size="18" letter-spacing="1" fill="${COLORS.muted}" text-anchor="middle">${esc(truncate(s.label.toUpperCase(), 24))}</text>`;
    })
    .join("");
  return `${svgOpen()}${chrome("Player Spotlight", d.competition || "Chelsea FC")}
<g font-family="Montserrat">
  <text x="64" y="204" font-size="${fitFont(d.player, 58, 22)}" font-weight="800" fill="${COLORS.white}">${esc(truncate(d.player, 30))}</text>
  <text x="64" y="248" font-size="24" font-weight="700" fill="${COLORS.gold}">SEASON ${esc(d.season)}</text>
  ${boxes}
</g>
</svg>`;
}

// ---------------------------------------------------------------- transfer

export type TransferCardData = {
  player: string;
  direction: "in" | "out";
  counterparty: string; // other club
  transferType?: string; // "€40m" | "Loan" | "Free" | "N/A"
  dateLabel?: string;
};

export function transferCard(d: TransferCardData): string {
  const isIn = d.direction === "in";
  const from = isIn ? d.counterparty : "Chelsea";
  const to = isIn ? "Chelsea" : d.counterparty;
  return `${svgOpen()}${chrome("Transfer News", d.dateLabel)}
<g font-family="Montserrat" text-anchor="middle">
  <rect x="450" y="150" width="300" height="52" rx="26" fill="${isIn ? COLORS.win : COLORS.loss}" opacity="0.9"/>
  <text x="600" y="185" font-size="24" font-weight="800" letter-spacing="3" fill="${COLORS.white}">${isIn ? "INCOMING" : "OUTGOING"}</text>
  <text x="600" y="290" font-size="${fitFont(d.player, 60, 24)}" font-weight="800" fill="${COLORS.white}">${esc(truncate(d.player, 28))}</text>
  ${teamBadge(300, 420, from, 74, isChelseaName(from))}
  ${teamBadge(900, 420, to, 74, isChelseaName(to))}
  <text x="300" y="546" font-size="${fitFont(from, 26, 18)}" font-weight="700" fill="${COLORS.white}">${esc(truncate(from, 22))}</text>
  <text x="900" y="546" font-size="${fitFont(to, 26, 18)}" font-weight="700" fill="${COLORS.white}">${esc(truncate(to, 22))}</text>
  <g stroke="${COLORS.gold}" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 430 420 H 760"/>
    <path d="M 725 390 L 770 420 L 725 450"/>
  </g>
  ${d.transferType ? `<text x="600" y="486" font-size="26" font-weight="800" fill="${COLORS.gold}">${esc(truncate(d.transferType, 20))}</text>` : ""}
</g>
</svg>`;
}

// ---------------------------------------------------------------- weekly form / club stats

export type FormCardData = {
  seasonLabel: string; // "2025/26"
  results: { opponent: string; score: string; outcome: "W" | "D" | "L" }[]; // most recent first, up to 5
  position?: number | null;
  points?: number | null;
  played?: number | null;
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  competition?: string;
};

export function formCard(d: FormCardData): string {
  const results = (d.results || []).slice(0, 5);
  const pills = results
    .map((r, i) => {
      const x = 64 + i * 68;
      const color = r.outcome === "W" ? COLORS.win : r.outcome === "L" ? COLORS.loss : COLORS.draw;
      return `
  <circle cx="${x + 26}" cy="216" r="26" fill="${color}"/>
  <text x="${x + 26}" y="226" font-size="26" font-weight="800" fill="#03102e" text-anchor="middle">${esc(r.outcome)}</text>`;
    })
    .join("");
  const rows = results
    .map((r, i) => {
      const y = 312 + i * 52;
      const color = r.outcome === "W" ? COLORS.win : r.outcome === "L" ? COLORS.loss : COLORS.draw;
      return `
  <text x="64" y="${y}" font-size="22" fill="${COLORS.white}">${esc(truncate(r.opponent, 26))}</text>
  <text x="520" y="${y}" font-size="22" font-weight="800" fill="${COLORS.white}" text-anchor="end">${esc(r.score)}</text>
  <rect x="548" y="${y - 20}" width="28" height="28" rx="6" fill="${color}"/>
  <text x="562" y="${y}" font-size="18" font-weight="800" fill="#03102e" text-anchor="middle">${esc(r.outcome)}</text>`;
    })
    .join("");
  const tiles: [string, string][] = [];
  if (d.position != null) tiles.push([`#${d.position}`, "LEAGUE POSITION"]);
  if (d.points != null) tiles.push([String(d.points), "POINTS"]);
  if (d.goalsFor != null) tiles.push([String(d.goalsFor), "GOALS SCORED"]);
  if (d.goalsAgainst != null) tiles.push([String(d.goalsAgainst), "GOALS CONCEDED"]);
  const tileSvg = tiles
    .slice(0, 4)
    .map(([v, l], i) => {
      const x = 660 + (i % 2) * 250;
      const y = 200 + Math.floor(i / 2) * 170;
      return `
  <rect x="${x}" y="${y}" width="230" height="146" rx="16" fill="${COLORS.barBg}" stroke="${COLORS.line}" stroke-opacity="0.5"/>
  <text x="${x + 115}" y="${y + 72}" font-size="46" font-weight="800" fill="${COLORS.gold}" text-anchor="middle">${esc(v)}</text>
  <text x="${x + 115}" y="${y + 112}" font-size="15" letter-spacing="1" fill="${COLORS.muted}" text-anchor="middle">${esc(l)}</text>`;
    })
    .join("");
  return `${svgOpen()}${chrome("Weekly Review", d.competition || `Season ${d.seasonLabel}`)}
<g font-family="Montserrat">
  <text x="64" y="166" font-size="30" font-weight="800" letter-spacing="2" fill="${COLORS.white}">RECENT FORM</text>
  ${pills}
  ${rows || `<text x="64" y="320" font-size="22" fill="${COLORS.muted}">No recent results</text>`}
  ${tileSvg}
</g>
</svg>`;
}
