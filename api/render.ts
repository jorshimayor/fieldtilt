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

import { buildCardSvg, svgToPng, embedFontsInSvg, CardKind } from "../packages/render/index";
import { fontBuffers } from "../packages/render/fonts";
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
  } else {
    kind = (url.searchParams.get("kind") || "post_match") as CardKind;
    if (!KINDS.includes(kind)) return jsonErr(`invalid kind; allowed: ${KINDS.join(", ")}`);
    data = DEMO[kind];
  }

  let svg = buildCardSvg(kind, data);
  if (format === "svg") {
    if (embedFonts) svg = embedFontsInSvg(svg, fontBuffers);
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
