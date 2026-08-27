export const config = { runtime: "edge" };

/**
 * Analytics endpoint (protected) — one payload powering the dashboard's
 * Dune/Flipside-style panels. Everything comes from the cached data layer,
 * so refreshing the dashboard costs at most a handful of upstream calls.
 *
 *   GET /api/analytics →
 *     club, standings (our row + table), leagueXg (Understat),
 *     squad (advanced player stats), recentForm (last 10 fixtures)
 */

import {
  getTeamFixtures,
  getLeagueStandings,
  currentSeason,
  seasonLabel,
  club,
} from "../packages/tools/football";
import { getTeamAdvancedStats, getLeagueXgTable, getPlayerShots } from "../packages/tools/understat";
import { withErrorLogging } from "../packages/observability/index";

export default withErrorLogging(async function handler(): Promise<Response> {
  const season = currentSeason();

  const [standings, leagueXg, squad, recent] = await Promise.all([
    getLeagueStandings(season).catch(() => null),
    getLeagueXgTable(season).catch(() => ({ table: [], source: "" })),
    getTeamAdvancedStats(season).catch(() => ({ players: [], source: "" })),
    getTeamFixtures({ last: 10 }).catch(() => ({ fixtures: [] })),
  ]);

  // Shot map for the squad's top-xG player (cached 12h in the data layer).
  const topByXg = (squad.players || [])[0];
  const shotMap = topByXg
    ? await getPlayerShots(topByXg.player, season).catch(() => null)
    : null;

  const c = club();
  return new Response(
    JSON.stringify({
      club: { name: c.name, fullName: c.fullName, league: c.league.name },
      season: seasonLabel(season),
      standings: standings
        ? { team: standings.team, table: standings.table.slice(0, 20) }
        : null,
      leagueXg: leagueXg.table,
      shotMap: shotMap
        ? {
            player: shotMap.player,
            summary: shotMap.summary,
            shots: shotMap.shots.slice(0, 120).map((sh) => ({ x: sh.x, y: sh.y, xG: Math.round(sh.xG * 1000) / 1000, result: sh.result })),
          }
        : null,
      squad: (squad.players || []).map((p) => ({
        player: p.player,
        position: p.position,
        minutes: p.minutes,
        goals: p.goals,
        xG: p.xG,
        assists: p.assists,
        xA: p.xA,
        shots: p.shots,
        keyPasses: p.keyPasses,
        xGChain: p.xGChain,
      })),
      recentForm: (recent.fixtures || [])
        .filter((f) => f.outcome)
        .map((f) => ({
          opponent: f.opponent,
          isHome: f.isHome,
          score: `${f.goalsHome ?? "?"}-${f.goalsAway ?? "?"}`,
          outcome: f.outcome,
          date: f.date,
        })),
      sources: { xg: "Understat", data: "football-data.org / API-Football" },
    }),
    { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } }
  );
});
