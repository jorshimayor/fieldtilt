export const config = { runtime: "edge" };

/**
 * The weekly model call — the season's credibility constant.
 *
 * Friday: publish season-forecast-v1's predictions BEFORE the round
 * (drafted into the approval queue with a match_stats probability card).
 * Tuesday: publish the score of the previous round AFTER it, wins and
 * misses alike — the whole point is public accountability.
 *
 * The Python model (analytics/) writes `model_outputs`; this cron only
 * publishes what landed there. ?mode=call|score overrides the day check.
 */

import { db } from "../../packages/db/client";
import { modelOutputs } from "../../packages/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { composeAndPost } from "../../packages/shared/poster";
import { club } from "../../packages/shared/club";
import { withErrorLogging } from "../../packages/observability/index";
import { currentSeason, seasonLabel } from "../../packages/tools/football";

const MODEL = "season-forecast-v1";
const SCORE_MODEL = "season-forecast-v1-score";

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || (new Date().getUTCDay() === 2 ? "score" : "call");
  return mode === "score" ? publishScore() : publishCall();
});

async function publishCall(): Promise<Response> {
  const season = currentSeason();
  const rows = await db
    .select()
    .from(modelOutputs)
    .where(and(eq(modelOutputs.model, MODEL), eq(modelOutputs.season, season)))
    .orderBy(desc(modelOutputs.id))
    .limit(12);
  // Latest prediction batch = rows sharing the newest predicted_at stamp.
  const newest = (rows[0]?.payload as any)?.predicted_at;
  const batch = rows
    .filter((r) => (r.payload as any)?.predicted_at === newest && !(r.payload as any)?.scored)
    .map((r) => r.payload as any)
    .sort((a, b) => String(a.kickoff_utc).localeCompare(String(b.kickoff_utc)));
  if (!batch.length) return json({ skipped: "no unpublished prediction batch in model_outputs" });

  const c = club();
  const gw = rows[0]?.gameweek;
  const ours = batch.find((p) => [p.home, p.away].some((t: string) => t.toLowerCase().includes(c.name.toLowerCase())));
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const line = (p: any) => {
    const call = p.probs.home >= Math.max(p.probs.draw, p.probs.away) ? p.home : p.probs.away >= p.probs.draw ? p.away : "the draw";
    return `${p.home} vs ${p.away}: ${pct(p.probs.home)} / ${pct(p.probs.draw)} / ${pct(p.probs.away)}, call: ${call}`;
  };
  const result = await composeAndPost({
    kind: "weekly_deep_dive",
    source: "cron:model-call",
    data: {
      theme: `season-forecast-v1 calls matchday ${gw}, published before kickoff as always`,
      numbers: `${batch.length} fixtures. ${ours ? `Our fixture: ${line(ours)}. ` : ""}Full slate: ${batch.slice(0, 6).map(line).join("; ")}. Model: shrunk Poisson goal rates, last ${((batch[0] || {}).features || {}).window || 10} matches per team. Scored publicly after the round.`,
      window: `matchday ${gw}`,
    },
    card: {
      kind: "match_stats",
      data: {
        home: "HOME %",
        away: "AWAY %",
        competition: `${c.league.name} MD${gw}`,
        statusLabel: "MODEL CALL",
        rows: batch.slice(0, 10).map((p) => ({
          label: `${p.home} v ${p.away}`,
          home: pct(p.probs.home),
          away: pct(p.probs.away),
        })),
        footnote: `season-forecast-v1 · published before kickoff · draws omitted from bars`,
        palette: "terminal",
      },
    },
    forceQueue: true,
    idKey: `tweet:modelcall:${season}:${gw}:${newest}`,
    idTtlSec: 6 * 24 * 3600,
  });
  return json({ mode: "call", gameweek: gw, fixtures: batch.length, ...result });
}

async function publishScore(): Promise<Response> {
  const season = currentSeason();
  const rows = await db
    .select()
    .from(modelOutputs)
    .where(and(eq(modelOutputs.model, SCORE_MODEL), eq(modelOutputs.season, season)))
    .orderBy(desc(modelOutputs.id))
    .limit(1);
  const s = rows[0]?.payload as any;
  if (!s) return json({ skipped: "no score row yet" });
  const hits = s.results.filter((r: any) => r.called === r.actual).length;
  const result = await composeAndPost({
    kind: "weekly_deep_dive",
    source: "cron:model-call",
    data: {
      theme: `Scoring last round's model call in public, ${s.beat_baseline ? "and the model beat the baseline" : "and the baseline won this week"}`,
      numbers: `${hits}/${s.matches} outcomes called correctly; Brier ${s.brier} vs ${s.brier_baseline} for the league-average baseline (lower is better). Worst call: ${[...s.results].sort((a: any, b: any) => b.brier - a.brier)[0]?.fixture}. Model: season-forecast-v1.`,
      window: "last completed round",
    },
    card: {
      kind: "match_stats",
      data: {
        home: "CALLED",
        away: "ACTUAL",
        competition: seasonLabel(season),
        statusLabel: "MODEL SCORED",
        rows: s.results.slice(0, 10).map((r: any) => ({
          label: `${r.fixture} (${r.final})`,
          home: r.called,
          away: r.actual,
        })),
        footnote: `brier ${s.brier} vs baseline ${s.brier_baseline} · ${s.beat_baseline ? "beat" : "lost to"} baseline`,
        palette: "terminal",
      },
    },
    forceQueue: true,
    idKey: `tweet:modelscore:${season}:${s.scored_at}`,
    idTtlSec: 6 * 24 * 3600,
  });
  return json({ mode: "score", matches: s.matches, brier: s.brier, ...result });
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
