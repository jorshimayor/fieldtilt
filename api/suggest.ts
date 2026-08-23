export const config = { runtime: "edge" };

/**
 * Post suggestions (protected). GET /api/suggest →
 *   { suggestions: [{ label, prompt, kind }] }
 *
 * OptaJoe-style editorial radar: scans cached data (fixtures, standings,
 * Understat xG) for the statistical angles worth posting today — over/under-
 * performers, hidden-engine players, defensive rank claims, matchday hooks.
 * Every suggestion carries a ready-to-send chat prompt; the agent then
 * fetches the numbers itself, so nothing here can go stale into a draft.
 */

import {
  getChelseaFixtures,
  getLeagueStandings,
  currentSeason,
} from "../packages/tools/football";
import { getChelseaAdvancedStats, getLeagueXgTable } from "../packages/tools/understat";
import { withErrorLogging } from "../packages/observability/index";

type Suggestion = { label: string; prompt: string; kind: string };

export default withErrorLogging(async function handler(): Promise<Response> {
  const season = currentSeason();
  const suggestions: Suggestion[] = [];

  const [nextRes, lastRes, standings, adv, xgTable] = await Promise.all([
    getChelseaFixtures({ next: 1 }).catch(() => ({ fixtures: [] as any[] })),
    getChelseaFixtures({ last: 1 }).catch(() => ({ fixtures: [] as any[] })),
    getLeagueStandings(season).catch(() => null),
    getChelseaAdvancedStats(season).catch(() => ({ players: [] as any[] })),
    getLeagueXgTable(season).catch(() => ({ table: [] as any[] })),
  ]);

  // ── matchday hooks ────────────────────────────────────────────────────
  const next = nextRes.fixtures[0];
  if (next) {
    const hrs = (new Date(next.date).getTime() - Date.now()) / 36e5;
    if (hrs > 0 && hrs <= 72) {
      suggestions.push({
        kind: "match_preview",
        label: `${next.opponent} in ${Math.max(1, Math.round(hrs))}h — preview + H2H`,
        prompt: `Create a match preview post for the ${next.opponent} game with a card and the head-to-head record.`,
      });
    }
  }
  const last = lastRes.fixtures[0];
  if (last && last.outcome) {
    suggestions.push({
      kind: "post_match",
      label: `Reflect on ${last.opponent} (${last.goalsHome}-${last.goalsAway})`,
      prompt: `Write a reflective post about our last match against ${last.opponent} (final score ${last.goalsHome}-${last.goalsAway}) with the key numbers and a score card.`,
    });
  }

  // ── player angles from the xG layer ───────────────────────────────────
  const players = (adv.players || []).filter((p: any) => p.minutes >= 300);
  if (players.length) {
    const byDelta = [...players].sort(
      (a: any, b: any) => Math.abs(b.goals - b.xG) - Math.abs(a.goals - a.xG)
    );
    const d = byDelta[0];
    if (d && Math.abs(d.goals - d.xG) >= 1.5) {
      const over = d.goals > d.xG;
      suggestions.push({
        kind: "player_stat",
        label: `${d.player}: ${d.goals}g vs ${d.xG} xG (${over ? "over" : "under"}performing)`,
        prompt: `Draft a player spotlight on ${d.player} focused on ${over ? "overperformance" : "underperformance"}: ${d.goals} goals from ${d.xG} xG. Include a stat card with form pills and a one-line scout remark, credit Understat.`,
      });
    }
    const byChain = [...players].sort((a: any, b: any) => b.xGChain - a.xGChain);
    const engine = byChain[0];
    const topScorer = [...players].sort((a: any, b: any) => b.goals - a.goals)[0];
    if (engine && topScorer && engine.player !== topScorer.player) {
      suggestions.push({
        kind: "player_stat",
        label: `Hidden engine: ${engine.player} leads xGChain (${engine.xGChain})`,
        prompt: `Draft a "hidden engine" spotlight on ${engine.player}, who leads the squad in xGChain (${engine.xGChain}) despite not being the top scorer. Stat card with a scout remark, credit Understat.`,
      });
    }
    const byXa = [...players].sort((a: any, b: any) => b.xA - a.xA)[0];
    if (byXa && byXa.xA >= 2) {
      suggestions.push({
        kind: "player_stat",
        label: `Creator watch: ${byXa.player} (${byXa.xA} xA, ${byXa.assists} assists)`,
        prompt: `Draft a creator-watch post on ${byXa.player}: ${byXa.assists} assists from ${byXa.xA} xA plus key passes. Stat card, credit Understat.`,
      });
    }
  }

  // ── team-level claims ─────────────────────────────────────────────────
  const che = (xgTable.table || []).find((t: any) => /chelsea/i.test(t.team));
  if (che && che.matches >= 3 && xgTable.table.length >= 10) {
    const betterXga = xgTable.table.filter((t: any) => t.xGA < che.xGA).length;
    suggestions.push({
      kind: "weekly_deep_dive",
      label: `Defensive claim: ${betterXga} team(s) with better xGA`,
      prompt: `Write a post arguing about our defensive underlying numbers: only ${betterXga} Premier League team(s) have conceded fewer expected goals (xGA ${che.xGA}). Use the league xG table, credit Understat.`,
    });
  }
  if (standings?.chelsea && standings.chelsea.played > 0) {
    const c = standings.chelsea;
    suggestions.push({
      kind: "form",
      label: `Form check: #${c.rank}, ${c.points} pts after ${c.played}`,
      prompt: `Make a weekly form review post with a form card from the last 5 results, our league position (#${c.rank}) and points (${c.points}).`,
    });
  }

  return new Response(JSON.stringify({ suggestions: suggestions.slice(0, 6) }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});
