export const config = { runtime: "edge" };

/**
 * Match-day poller — every 5 minutes.
 *
 * Quota-aware: exits WITHOUT any live API call unless we're inside the match
 * window (kickoff − 15min → kickoff + 4h) of the next known Chelsea fixture,
 * which the daily fixtures cron warms into cache.
 *
 * Inside the window:
 *   - live fixture   → score-change tweet + LIVE score card (once per scoreline)
 *   - finished (FT+) → post-match tweet + full-time stats card (once per fixture)
 */

import {
  CHELSEA_TEAM_ID,
  getChelseaFixtures,
  getMatchStats,
  getFixtureGoalEvents,
  formatScorers,
} from "../../packages/tools/football";
import { getLiveEvents } from "../../packages/tools/index";
import { getCache, setCache } from "../../packages/tools/cache";
import { composeAndPost } from "../../packages/shared/poster";
import { withErrorLogging } from "../../packages/observability/index";
import { NEXT_FIXTURE_KEY } from "./fixtures";

type LiveEvent = {
  fixture?: { id?: number; status?: { short?: string; elapsed?: number | null } };
  teams?: { home?: { id?: number; name?: string }; away?: { id?: number; name?: string } };
  goals?: { home?: number | null; away?: number | null };
  league?: { name?: string };
};

const LIVE_STATUSES = new Set(["1H", "2H", "ET", "HT", "BT", "P"]);
const FINAL_STATUSES = new Set(["FT", "AET", "PEN"]);
const WINDOW_BEFORE_MS = 15 * 60 * 1000;
const WINDOW_AFTER_MS = 4 * 60 * 60 * 1000;

export default withErrorLogging(async function handler(): Promise<Response> {
  // ---- window gate (no API spend outside match windows) ----
  let next = await getCache<{ id: number; date: string }>(NEXT_FIXTURE_KEY);
  if (!next) {
    const { fixtures } = await getChelseaFixtures({ next: 1 });
    if (fixtures[0]) {
      next = { id: fixtures[0].id, date: fixtures[0].date };
      await setCache(NEXT_FIXTURE_KEY, next, 6 * 60 * 60 * 1000);
    }
  }
  if (!next) return json({ skipped: "no known upcoming fixture" });

  const kickoff = new Date(next.date).getTime();
  const now = Date.now();
  if (now < kickoff - WINDOW_BEFORE_MS || now > kickoff + WINDOW_AFTER_MS) {
    return json({ skipped: "outside match window", kickoff: next.date });
  }

  // ---- inside the window: check the live feed ----
  const live = await getLiveEvents({});
  const events: LiveEvent[] = (live.events || []) as LiveEvent[];
  const game = events.find(
    (e) => e?.teams?.home?.id === CHELSEA_TEAM_ID || e?.teams?.away?.id === CHELSEA_TEAM_ID
  );
  if (!game) return json({ skipped: "in window but no live chelsea fixture yet" });

  const status = game?.fixture?.status?.short || "";
  const fixtureId = game?.fixture?.id || 0;
  const home = game?.teams?.home?.name || "Home";
  const away = game?.teams?.away?.name || "Away";
  const homeGoals = game?.goals?.home ?? 0;
  const awayGoals = game?.goals?.away ?? 0;
  const minute = game?.fixture?.status?.elapsed ?? null;
  const competition = game?.league?.name || "";

  const base = { fixtureId, home, away, homeGoals, awayGoals, competition };

  if (LIVE_STATUSES.has(status)) {
    const { goals } = await getFixtureGoalEvents(fixtureId, { ttlMs: 60 * 1000 });
    const scorers = formatScorers(goals);
    const statusLabel = status === "HT" ? "HALF TIME" : `LIVE ${minute ?? ""}'`;
    const result = await composeAndPost({
      kind: "live_update",
      data: {
        minute: minute ?? status,
        event: "Score update",
        actor: scorers[scorers.length - 1] || "n/a",
        score: `${homeGoals}-${awayGoals}`,
        possession: "n/a",
        xg: "n/a",
      },
      card: { kind: "score", data: { ...base, statusLabel, scorers } },
      idKey: `tweet:live:${fixtureId}:${homeGoals}-${awayGoals}`,
      idTtlSec: 20 * 60,
    });
    return json({ type: "live", status, ...result });
  }

  if (FINAL_STATUSES.has(status)) {
    const [stats, { goals }] = await Promise.all([
      getMatchStats(fixtureId),
      getFixtureGoalEvents(fixtureId, { ttlMs: 60 * 60 * 1000 }),
    ]);
    const scorers = formatScorers(goals);
    const result = await composeAndPost({
      kind: "post_match",
      data: {
        score: `${homeGoals}-${awayGoals}`,
        possession: stats.possession ?? "n/a",
        xg: stats.xg ?? "n/a",
        shotsOnTarget: stats.shotsOnTarget ?? "n/a",
        shotsTotal: stats.shotsTotal ?? "n/a",
        motm: "n/a",
        motmRating: "n/a",
      },
      card: {
        kind: "post_match",
        data: {
          ...base,
          statusLabel: "FULL TIME",
          scorers,
          stats: {
            possession: stats.possession,
            xg: stats.xg,
            shotsTotal: stats.shotsTotal,
            shotsOnTarget: stats.shotsOnTarget,
            corners: stats.corners,
            passAccuracy: stats.passAccuracy,
          },
        },
      },
      idKey: `tweet:postmatch:${fixtureId}`,
      idTtlSec: 24 * 60 * 60,
    });
    return json({ type: "post_match", status, ...result });
  }

  return json({ skipped: `status=${status}`, fixtureId });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
