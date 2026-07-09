/**
 * DESIGN TOKENS — single source of truth for the whole brand.
 *
 * The aesthetic (see docs/DESIGN_SYSTEM.md): editorial sports graphics —
 * near-black canvas, white grotesk type with tight tracking, oversized stat
 * numerals, small letter-spaced uppercase labels, hairline dividers, and at
 * most one quiet accent. Photography (when licensed/available) goes full-bleed
 * behind a dark scrim; otherwise a typographic watermark carries the layout.
 *
 * public/theme.css mirrors these values for the web app. Change them here
 * first, then keep the CSS variables in sync.
 */

/** Wordmark stamped on every card and the app header. */
export const BRAND = "bluebot.";

export const color = {
  bg: "#0B0C0F", // near-black canvas
  bgAlt: "#12141A", // raised surfaces (tiles, rows)
  ink: "#FFFFFF", // primary type
  inkDim: "#C7CBD4", // secondary type
  inkMute: "#878D99", // labels, captions
  line: "#2A2E37", // hairlines / dividers
  scrim: "#07080A", // photo overlay base (used with opacity)
  accent: "#3D6BFF", // ONE quiet accent — links, live dot, focus. Use sparingly.
  win: "#8FE3A1",
  draw: "#9AA0AC",
  loss: "#E5484D",
} as const;

export const font = {
  family: "Montserrat",
  weight: { regular: 400, bold: 700, black: 800 },
} as const;

/**
 * Type scale (px, at card resolution). Display sizes use tight tracking;
 * labels use wide tracking — never the reverse.
 */
export const type = {
  display: { size: 118, weight: 800, tracking: -2 }, // hero numerals / scorelines
  h1: { size: 76, weight: 800, tracking: -1.5 }, // player / team names
  h2: { size: 44, weight: 800, tracking: -0.5 },
  stat: { size: 64, weight: 800, tracking: -1 }, // stat-rail values
  body: { size: 30, weight: 400, tracking: 0 }, // editorial sentences
  label: { size: 17, weight: 700, tracking: 2.6 }, // UPPERCASE stat labels
  micro: { size: 15, weight: 700, tracking: 2.2 }, // eyebrows, footers
} as const;

/** Card formats. Portrait 4:5 for player/editorial posts, landscape for scoreboards. */
export const formats = {
  portrait: { w: 960, h: 1200 },
  landscape: { w: 1200, h: 675 },
} as const;

export const layout = {
  margin: 72, // outer margin on cards
  gutter: 24,
  radius: 14,
  hairline: 2,
} as const;

/** Scrim opacity applied over full-bleed photos so type always reads. */
export const PHOTO_SCRIM_OPACITY = 0.62;
