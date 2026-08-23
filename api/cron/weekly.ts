export const config = { runtime: "edge" };

/**
 * Weekly deep-dive — Monday 09:00 UTC (10:00 WAT).
 *
 * Pulls last-5 results (with real scores), the Premier League standing, and
 * season stats, then posts a form-review tweet with a RECENT FORM infographic.
 */

import {
  getTeamFixtures,
  getLeagueStandings,
  getTeamSeasonStats,
  seasonLabel,
  currentSeason,
  club,
} from "../../packages/tools/football";
import { composeAndPost } from "../../packages/shared/poster";
import { withErrorLogging } from "../../packages/observability/index";

export default withErrorLogging(async function handler(): Promise<Response> {
  const season = currentSeason();
  const [{ fixtures }, standings, teamStats] = await Promise.all([
    getTeamFixtures({ last: 5 }),
    getLeagueStandings(season),
    getTeamSeasonStats(season),
  ]);
  const finished = fixtures.filter((f) => f.outcome);
  if (!finished.length) return json({ skipped: "no recent finished fixtures" });

  const results = finished.map((f) => ({
    opponent: f.opponent,
    score: `${f.goalsHome ?? "?"}-${f.goalsAway ?? "?"}`,
    outcome: f.outcome as "W" | "D" | "L",
  }));

  const c = standings.team;
  const record = `${results.map((r) => r.outcome).join("")}`;
  const numbers = [
    `Last 5: ${record}`,
    c ? `P${c.played} • ${c.points}pts • #${c.rank} in the ${club().league.name}` : "",
    teamStats.goalsFor ? `${teamStats.goalsFor} scored / ${teamStats.goalsAgainst} conceded this season` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  const result = await composeAndPost({
    kind: "weekly_deep_dive",
    source: "cron:weekly",
    data: {
      theme: "Form across the last 5 matches",
      numbers,
      window: "last 5 matches",
    },
    card: {
      kind: "form",
      data: {
        seasonLabel: seasonLabel(season),
        results,
        position: c?.rank ?? null,
        points: c?.points ?? null,
        played: c?.played ?? null,
        goalsFor: c?.goalsFor ?? null,
        goalsAgainst: c?.goalsAgainst ?? null,
        competition: club().league.name,
      },
    },
    idKey: `tweet:weekly:${new Date().toISOString().slice(0, 10)}`,
    idTtlSec: 7 * 24 * 60 * 60,
  });

  return json(result);
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
