export const config = { runtime: "edge" };

/**
 * Match-day poller — every 5 minutes. Provider-agnostic (works on both the
 * free football-data.org tier and API-Football Pro).
 *
 * Quota-aware: exits WITHOUT any API call unless we're inside the match
 * window (kickoff − 15min → kickoff + 4h) of the next known Chelsea fixture,
 * which the daily fixtures cron warms into cache.
 *
 * Inside the window:
 *   - live / half-time  → score-change tweet + LIVE score card (once per scoreline)
 *   - after the live feed empties → check the fixture itself; if finished,
 *     post the full-time recap (once per fixture). Stats/xG appear when the
 *     provider supports them and are omitted otherwise.
 */

import {
  getChelseaFixtures,
  getFixtureById,
  getLiveChelseaMatch,
  getMatchStats,
  getFixtureGoalEvents,
  formatScorers,
  seasonLabel,
  provider,
} from "../../packages/tools/football";
import { getCache, setCache } from "../../packages/tools/cache";
import { composeAndPost } from "../../packages/shared/poster";
import { withErrorLogging } from "../../packages/observability/index";
import { nextFixtureKey } from "./fixtures";

const WINDOW_BEFORE_MS = 15 * 60 * 1000;
const WINDOW_AFTER_MS = 4 * 60 * 60 * 1000;
/** Don't bother checking for full-time before this much of the match has passed. */
const FT_EARLIEST_MS = 100 * 60 * 1000;

export default withErrorLogging(async function handler(): Promise<Response> {
  // ---- window gate (no API spend outside match windows) ----
  let next = await getCache<{ id: number; date: string }>(nextFixtureKey());
  if (!next) {
    const { fixtures } = await getChelseaFixtures({ next: 1 });
    if (fixtures[0]) {
      next = { id: fixtures[0].id, date: fixtures[0].date };
      await setCache(nextFixtureKey(), next, 6 * 60 * 60 * 1000);
    }
  }
  if (!next) return json({ skipped: "no known upcoming fixture" });

  const kickoff = new Date(next.date).getTime();
  const now = Date.now();
  if (now < kickoff - WINDOW_BEFORE_MS || now > kickoff + WINDOW_AFTER_MS) {
    return json({ skipped: "outside match window", kickoff: next.date });
  }

  // ---- inside the window: live feed first ----
  const live = await getLiveChelseaMatch();

  if (live && (live.phase === "live" || live.phase === "ht")) {
    const caps = provider().capabilities;
    const [{ goals }, stats] = await Promise.all([
      getFixtureGoalEvents(live.fixtureId, { ttlMs: 60 * 1000 }),
      caps.liveStats ? getMatchStats(live.fixtureId).catch(() => null) : Promise.resolve(null),
    ]);
    const scorers = formatScorers(goals);
    const statusLabel =
      live.phase === "ht" ? "HALF TIME" : live.minute != null ? `LIVE ${live.minute}'` : "LIVE";
    const statLine = [
      stats?.possession != null ? `${stats.possession}% possession` : "",
      stats?.xg != null ? `${stats.xg} xG` : "",
      stats?.shotsOnTarget != null ? `${stats.shotsOnTarget} on target` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    const result = await composeAndPost({
      kind: "live_update",
      source: "cron:match-day",
      data: {
        minute: live.minute ?? statusLabel,
        event: "Score update",
        actor: scorers[scorers.length - 1] || "n/a",
        score: `${live.homeGoals}-${live.awayGoals}`,
        possession: stats?.possession ?? "n/a",
        xg: stats?.xg ?? "n/a",
      },
      card: {
        kind: "score",
        data: {
          home: live.home,
          away: live.away,
          homeGoals: live.homeGoals,
          awayGoals: live.awayGoals,
          competition: live.competition,
          statusLabel,
          scorers,
          statLine,
        },
      },
      idKey: `tweet:live:${live.fixtureId}:${live.homeGoals}-${live.awayGoals}`,
      idTtlSec: 20 * 60,
    });
    return json({ type: "live", phase: live.phase, ...result });
  }

  // ---- no live feed entry: maybe the match just finished ----
  if (now < kickoff + FT_EARLIEST_MS) {
    return json({ skipped: "in window, match not started or in early play" });
  }
  // Once the recap is out, stop spending API calls for the rest of the window.
  if (await getCache(`ftdone:${next.id}`)) {
    return json({ skipped: "full-time recap already handled", fixtureId: next.id });
  }

  const fixture = await getFixtureById(next.id);
  if (!fixture) return json({ skipped: "fixture lookup failed", fixtureId: next.id });
  if (fixture.outcome === null) {
    return json({ skipped: `not finished yet (status=${fixture.status})`, fixtureId: next.id });
  }

  const caps = provider().capabilities;
  const [stats, { goals }] = await Promise.all([
    getMatchStats(fixture.id).catch(() => null),
    getFixtureGoalEvents(fixture.id, { ttlMs: 60 * 60 * 1000 }),
  ]);
  const scorers = formatScorers(goals);
  const result = await composeAndPost({
    kind: "post_match",
    source: "cron:match-day",
    data: {
      score: `${fixture.goalsHome}-${fixture.goalsAway}`,
      possession: stats?.possession ?? "n/a",
      xg: stats?.xg ?? "n/a",
      shotsOnTarget: stats?.shotsOnTarget ?? "n/a",
      shotsTotal: stats?.shotsTotal ?? "n/a",
      motm: "n/a",
      motmRating: "n/a",
    },
    card: {
      kind: "post_match",
      data: {
        home: fixture.home,
        away: fixture.away,
        homeGoals: fixture.goalsHome ?? 0,
        awayGoals: fixture.goalsAway ?? 0,
        competition: fixture.competition,
        statusLabel: "FULL TIME",
        scorers,
        seasonLabel: `${fixture.competition} ${seasonLabel()}`,
        stats: caps.liveStats
          ? {
              possession: stats?.possession,
              xg: stats?.xg,
              shotsTotal: stats?.shotsTotal,
              shotsOnTarget: stats?.shotsOnTarget,
              corners: stats?.corners,
              passAccuracy: stats?.passAccuracy,
              fouls: stats?.fouls,
            }
          : {},
      },
    },
    idKey: `tweet:postmatch:${fixture.id}`,
    idTtlSec: 24 * 60 * 60,
  });
  await setCache(`ftdone:${fixture.id}`, true, 24 * 60 * 60 * 1000);
  return json({ type: "post_match", ...result });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
