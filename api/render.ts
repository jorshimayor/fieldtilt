export const config = { runtime: "edge" };

/**
 * Infographic render endpoint.
 *
 *   GET  /api/render?kind=post_match                    → PNG, demo data
 *   GET  /api/render?kind=post_match&format=svg         → SVG (cheap, no wasm)
 *   GET  /api/render?...&format=svg&fonts=1             → SVG with fonts
 *        embedded as @font-face — browsers rasterize it pixel-faithfully.
 *        This powers the dashboard's client-side (free-plan) PNG path.
 *   POST /api/render {"kind": "...", "data": {...}, "format"?, "fonts"?}
 *
 * PNG output runs resvg-wasm (Workers Paid CPU); SVG output is string work
 * and runs fine on the free plan.
 */

import { buildCardSvg, svgToPng, embedFontsInSvg, resolveCardImages, CardKind } from "../packages/render/index";
import { fontFaces } from "../packages/render/fonts";
import { withErrorLogging } from "../packages/observability/index";
import { requireOpsAuth } from "../packages/shared/auth";

const DEMO: Record<CardKind, unknown> = {
  match_preview: {
    home: "Chelsea",
    away: "Arsenal",
    competition: "Premier League",
    dateLabel: "Sat 12 Jul, 16:00 WAT",
    venue: "Stamford Bridge",
    footnote: "H2H · W4 D3 L3 in the last 10",
  },
  score: {
    home: "Chelsea",
    away: "Arsenal",
    homeGoals: 2,
    awayGoals: 1,
    competition: "Premier League",
    statusLabel: "LIVE 78'",
    scorers: ["Palmer 23'", "Neto 58'", "Saka 71'"],
    statLine: "54% possession · 1.8 xG · 6 on target",
  },
  post_match: {
    home: "Chelsea",
    away: "Arsenal",
    homeGoals: 2,
    awayGoals: 1,
    competition: "Premier League",
    seasonLabel: "Premier League 25/26",
    statusLabel: "FULL TIME",
    scorers: ["Palmer 23'", "Neto 58'"],
    stats: { possession: 54, xg: 2.31, shotsTotal: 15, shotsOnTarget: 7, corners: 6, passAccuracy: 87, fouls: 9 },
  },
  player_stat: {
    player: "Moises Caicedo",
    season: "2025/26",
    competition: "Premier League",
    context: "vs Arsenal",
    formPills: ["W", "W", "D", "L", "W"],
    remark: "The midfield metronome — quietly dictating everything.",
    stats: [
      { label: "Pass accuracy", value: "89%" },
      { label: "Passes completed", value: "56" },
      { label: "Passes into final third", value: "14" },
      { label: "Ball recoveries", value: "6" },
      { label: "Successful crosses", value: "100%" },
      { label: "Tackles", value: "4" },
    ],
  },
  transfer: {
    player: "Estêvão Willian",
    direction: "in",
    counterparty: "Palmeiras",
    transferType: "€ 45M",
    dateLabel: "1 Jul 2026",
  },
  form: {
    seasonLabel: "2025/26",
    results: [
      { opponent: "Arsenal", score: "2-1", outcome: "W" },
      { opponent: "Brighton", score: "1-1", outcome: "D" },
      { opponent: "Man City", score: "0-1", outcome: "L" },
      { opponent: "Fulham", score: "3-0", outcome: "W" },
      { opponent: "Newcastle", score: "2-0", outcome: "W" },
    ],
    position: 3,
    points: 61,
    played: 31,
    goalsFor: 58,
    goalsAgainst: 31,
    competition: "Premier League",
  },
  editorial: {
    eyebrow: "On this day",
    lines: [
      { text: "Two years ago today, Chelsea" },
      { text: "announced the signing of" },
      { text: "Estêvão Willian.", em: true },
    ],
    dateLabel: "2024, June 22.",
  },
  milestone: {
    player: "Cole Palmer",
    value: "100",
    milestoneLabel: "Appearances for Chelsea",
    context: "All competitions",
    stats: [
      { label: "Goals", value: "47" },
      { label: "Assists", value: "29" },
      { label: "Mins per goal involvement", value: "104" },
      { label: "Penalties scored", value: "13/13" },
      { label: "Player of the Match awards", value: "18" },
    ],
    dateLabel: "23 Aug 2026",
    competition: "Premier League",
  },
  comparison: {
    title: "The creator debate",
    playerA: "Cole Palmer",
    playerB: "Bukayo Saka",
    context: "Premier League 25/26 · per 90",
    metrics: [
      { label: "Goals", a: 0.62, b: 0.48 },
      { label: "Assists", a: 0.35, b: 0.41 },
      { label: "Expected goals (xG)", a: 0.55, b: 0.44 },
      { label: "Key passes", a: 2.8, b: 2.4 },
      { label: "Shots", a: 3.4, b: 2.9 },
      { label: "Dribbles won", a: 1.6, b: 2.2 },
    ],
    footnote: "xG: Understat",
  },
  leaderboard: {
    title: "Most goal involvements",
    context: "Chelsea 26/27 · all competitions",
    entries: [
      { value: "2", label: "Cole Palmer", sub: "1G 1A", highlight: true },
      { value: "2", label: "João Pedro", sub: "1G 1A", highlight: true },
      { value: "1", label: "Morgan Rogers", sub: "1G" },
      { value: "1", label: "Pedro Neto", sub: "1A" },
      { value: "1", label: "Estêvão", sub: "1A" },
    ],
    footnote: "matchday 1 · source: football-data",
  },
  head_to_head: {
    title: "New keeper. Same standard.",
    context: "Martinez vs Sanchez, 2025/26 league stats",
    playerA: "Emiliano Martinez",
    playerB: "Robert Sanchez",
    roleA: "New signing",
    roleB: "Chelsea No. 1",
    photoAWiki: "Emiliano Martinez goalkeeper",
    photoBWiki: "Robert Sanchez goalkeeper",
    crestAClub: "Aston Villa",
    crestBClub: "Chelsea",
    metrics: [
      { label: "Appearances", a: 35, b: 35 },
      { label: "Clean sheets", a: 7, b: 9 },
      { label: "Goals conceded", a: 47, b: 47, higherIsBetter: false },
      { label: "Saves made", a: 95, b: 98 },
      { label: "Penalties saved", a: 1, b: 0, aDisplay: "1 (100%)", bDisplay: "0 (0%)" },
      { label: "Passes completed", a: 74, b: 67, aDisplay: "1,211 (74%)", bDisplay: "1,305 (67%)" },
      { label: "Yellow cards", a: 2, b: 3, higherIsBetter: false },
      { label: "Red cards", a: 0, b: 1, higherIsBetter: false },
    ],
    careerTitle: "PL career",
    careerA: [
      { label: "Appearances", value: "228" },
      { label: "Clean sheets", value: "66" },
      { label: "Saves made", value: "668" },
    ],
    careerB: [
      { label: "Appearances", value: "171" },
      { label: "Clean sheets", value: "49" },
      { label: "Saves made", value: "465" },
    ],
    tagline: "The battle for the No. 1 spot is on.",
    footnote: "photos: Wikimedia Commons · crests: football-data",
  },
  shot_map: {
    player: "Cole Palmer",
    context: "Premier League 26/27 · all shots",
    shots: [
      { x: 0.93, y: 0.48, xG: 0.55, result: "Goal" },
      { x: 0.88, y: 0.44, xG: 0.31, result: "Goal" },
      { x: 0.9, y: 0.55, xG: 0.12, result: "SavedShot" },
      { x: 0.85, y: 0.38, xG: 0.09, result: "MissedShots" },
      { x: 0.79, y: 0.5, xG: 0.06, result: "BlockedShot" },
      { x: 0.86, y: 0.62, xG: 0.18, result: "Goal" },
      { x: 0.76, y: 0.42, xG: 0.04, result: "MissedShots" },
      { x: 0.82, y: 0.52, xG: 0.11, result: "SavedShot" },
      { x: 0.71, y: 0.57, xG: 0.03, result: "MissedShots" },
      { x: 0.89, y: 0.41, xG: 0.24, result: "ShotOnPost" },
      { x: 0.94, y: 0.5, xG: 0.42, result: "SavedShot" },
      { x: 0.68, y: 0.36, xG: 0.02, result: "MissedShots" },
    ],
    remark: "A wide event map. A very narrow destination.",
    footnote: "xG: Understat",
  },
};

const KINDS = Object.keys(DEMO) as CardKind[];

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  const denied = requireOpsAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  let kind: CardKind;
  let data: unknown;
  let format = url.searchParams.get("format") || "png";
  let embedFonts = url.searchParams.get("fonts") === "1";

  if (req.method === "POST") {
    const body = (await req.json().catch(() => null)) as
      | { kind?: CardKind; data?: unknown; format?: string; fonts?: boolean }
      | null;
    if (!body?.kind || !KINDS.includes(body.kind)) {
      return jsonErr(`invalid kind; allowed: ${KINDS.join(", ")}`);
    }
    kind = body.kind;
    data = body.data ?? DEMO[kind];
    if (body.format) format = body.format;
    if (body.fonts) embedFonts = true;
    // Dashboard photo uploads: merge a data-URI photo into whichever data
    // (demo or supplied) is being rendered.
    if (typeof (body as any).photoDataUri === "string" && (body as any).photoDataUri.startsWith("data:image/")) {
      data = { ...(data as Record<string, unknown>), photoDataUri: (body as any).photoDataUri };
    }
    // Kit switcher: a top-level palette overrides whatever the data carries.
    if (["neutral", "home", "away", "terminal"].includes((body as any).palette)) {
      data = { ...(data as Record<string, unknown>), palette: (body as any).palette };
    }
  } else {
    kind = (url.searchParams.get("kind") || "post_match") as CardKind;
    if (!KINDS.includes(kind)) return jsonErr(`invalid kind; allowed: ${KINDS.join(", ")}`);
    data = DEMO[kind];
    const qp = url.searchParams.get("palette");
    if (qp && ["neutral", "home", "away", "terminal"].includes(qp)) data = { ...(data as Record<string, unknown>), palette: qp };
  }

  // Inline any image URLs / wiki-photo / crest-club fields before building
  // the SVG — canvas and resvg both refuse external hrefs.
  data = await resolveCardImages(data as Record<string, unknown>);

  let svg = buildCardSvg(kind, data);
  if (format === "svg") {
    if (embedFonts) svg = embedFontsInSvg(svg, fontFaces);
    return new Response(svg, {
      status: 200,
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
    });
  }
  const png = await svgToPng(svg);
  return new Response(png.slice().buffer as ArrayBuffer, {
    status: 200,
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
});

function jsonErr(message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}
