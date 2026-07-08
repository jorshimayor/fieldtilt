export const config = { runtime: "edge" };

/**
 * Infographic preview endpoint.
 *
 *   GET  /api/render?kind=post_match&demo=1   → PNG with demo data
 *   POST /api/render  {"kind": "...", "data": {...}}  → PNG with your data
 *
 * Used by the dashboard preview and for eyeballing card designs before they
 * go out on X. Requires the ops secret outside local dev (CPU isn't free).
 */

import { buildCardSvg, svgToPng, CardKind } from "../packages/render/index";
import { withErrorLogging } from "../packages/observability/index";
import { requireOpsAuth } from "../packages/shared/auth";

const DEMO: Record<CardKind, unknown> = {
  match_preview: {
    home: "Chelsea",
    away: "Arsenal",
    competition: "Premier League",
    dateLabel: "Sat 12 Jul, 16:00 WAT",
    venue: "Stamford Bridge",
  },
  score: {
    home: "Chelsea",
    away: "Arsenal",
    homeGoals: 2,
    awayGoals: 1,
    competition: "Premier League",
    statusLabel: "LIVE 78'",
    scorers: ["Palmer 23'", "Neto 58'", "Saka 71'"],
  },
  post_match: {
    home: "Chelsea",
    away: "Arsenal",
    homeGoals: 2,
    awayGoals: 1,
    competition: "Premier League",
    statusLabel: "FULL TIME",
    scorers: ["Palmer 23'", "Neto 58'"],
    stats: { possession: 54, xg: 2.31, shotsTotal: 15, shotsOnTarget: 7, corners: 6, passAccuracy: 87 },
  },
  player_stat: {
    player: "Cole Palmer",
    season: "2025/26",
    competition: "Premier League",
    stats: [
      { label: "Appearances", value: "34" },
      { label: "Goals", value: "18" },
      { label: "Assists", value: "12" },
      { label: "Minutes", value: "2980" },
      { label: "Avg rating", value: "7.61" },
      { label: "Pass accuracy", value: "84%" },
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
};

const KINDS = Object.keys(DEMO) as CardKind[];

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  const denied = requireOpsAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  let kind: CardKind;
  let data: unknown;

  if (req.method === "POST") {
    const body = (await req.json().catch(() => null)) as { kind?: CardKind; data?: unknown } | null;
    if (!body?.kind || !KINDS.includes(body.kind)) {
      return jsonErr(`invalid kind; allowed: ${KINDS.join(", ")}`);
    }
    kind = body.kind;
    data = body.data ?? DEMO[kind];
  } else {
    kind = (url.searchParams.get("kind") || "post_match") as CardKind;
    if (!KINDS.includes(kind)) return jsonErr(`invalid kind; allowed: ${KINDS.join(", ")}`);
    data = DEMO[kind];
  }

  if (url.searchParams.get("format") === "svg") {
    return new Response(buildCardSvg(kind, data), {
      status: 200,
      headers: { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" },
    });
  }
  const png = await svgToPng(buildCardSvg(kind, data));
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
