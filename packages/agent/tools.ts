/**
 * Shared tool executor — the single place every agent (flat chat loop and
 * the compose graph) runs data tools and create_draft through. Extracted
 * from api/chat.ts so tool behavior can never drift between agents.
 */
import {
  getTeamFixtures,
  getLeagueStandings,
  getTeamTopPerformers,
  getHeadToHead,
  currentSeason,
} from "../tools/football";
import { getTeamAdvancedStats, getLeagueXgTable, getPlayerShots } from "../tools/understat";
import { groundedLookup } from "../tools/websearch";
import { composeAndPost } from "../shared/poster";
import { db } from "../db/client";
import { drafts } from "../db/schema";
import { desc, eq } from "drizzle-orm";
import { TweetKind, Tone } from "../shared/tweet-prompts";
import { CardKind } from "../render/index";

import { TWEET_KINDS, CARD_KINDS } from "./kinds";
export { TWEET_KINDS, CARD_KINDS };

function clamp(n: unknown, lo: number, hi: number, dflt: number): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : dflt;
}

/** Models sometimes send nested objects as JSON strings — accept both. */
function coerceObject(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try {
      const parsed = JSON.parse(v);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function execTool(name: string, args: any): Promise<any> {
  switch (name) {
    case "get_upcoming_fixtures": {
      const n = clamp(args?.count, 1, 10, 3);
      const { fixtures: league } = await getTeamFixtures({ next: n });
      const { getUpcomingCupFixtures } = await import("../tools/cup-overlay");
      const cups = await getUpcomingCupFixtures(n);
      const fixtures = [...league, ...cups].sort((a, b) => a.date.localeCompare(b.date)).slice(0, n);
      return fixtures.map((f) => ({
        fixtureId: f.id,
        dateUtc: f.date,
        home: f.home,
        away: f.away,
        opponent: f.opponent,
        competition: f.competition,
        venue: f.venue || null,
        isHome: f.isHome,
      }));
    }
    case "get_recent_results": {
      const { fixtures } = await getTeamFixtures({ last: clamp(args?.count, 1, 10, 5) });
      return fixtures.map((f) => ({
        dateUtc: f.date,
        opponent: f.opponent,
        score: `${f.goalsHome ?? "?"}-${f.goalsAway ?? "?"}`,
        home: f.home,
        away: f.away,
        outcome: f.outcome,
        competition: f.competition,
      }));
    }
    case "get_standings": {
      const { team, table } = await getLeagueStandings(currentSeason());
      return { team, topSix: table.slice(0, 6) };
    }
    case "get_top_performers": {
      const { players } = await getTeamTopPerformers(currentSeason());
      return players.slice(0, 8);
    }
    case "get_advanced_player_stats": {
      const { players, source } = await getTeamAdvancedStats(currentSeason());
      if (!players.length) {
        return { error: "no advanced stats available yet (early season or Understat unreachable)" };
      }
      const fold = (s: string) =>
        s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
      const filter = fold(String(args?.player || "").trim());
      let picked = filter ? players.filter((p) => fold(p.player).includes(filter)) : players.slice(0, 12);
      let note: string | undefined;
      if (filter && !picked.length) {
        // Try last-name-only, then fall back to the full list so the agent
        // can locate the right spelling instead of concluding "no data".
        const last = filter.split(/\s+/).pop() || filter;
        picked = players.filter((p) => fold(p.player).includes(last));
        if (!picked.length) {
          picked = players.slice(0, 12);
          note = `no player matched "${args?.player}" — full squad list returned, check the spelling against player names`;
        }
      }
      return { players: picked, note, source: "Understat", url: source };
    }
    case "get_league_xg_table": {
      const { table, source } = await getLeagueXgTable(currentSeason());
      if (!table.length) {
        return { error: "no league xG data available yet (early season or Understat unreachable)" };
      }
      return { table, source: "Understat", url: source };
    }
    case "get_player_shots": {
      const who = String(args?.player || "").trim();
      if (!who) return { error: "player required" };
      const res = await getPlayerShots(who, currentSeason());
      if (!res) return { error: `no Understat player matched "${who}"` };
      return {
        player: res.player,
        summary: res.summary,
        shots: res.shots.slice(0, 80).map((sh) => ({ x: sh.x, y: sh.y, xG: Math.round(sh.xG * 1000) / 1000, result: sh.result })),
        source: "Understat",
        url: res.source,
      };
    }
    case "get_positional_stats": {
      const { getPositionalStats } = await import("../tools/positional");
      const who = String(args?.player || "").trim();
      if (!who) return { error: "player required" };
      return getPositionalStats(who, args?.pack ? String(args.pack) : undefined);
    }
    case "get_player_career": {
      const { getPlayerCareer } = await import("../tools/positional");
      const who = String(args?.player || "").trim();
      if (!who) return { error: "player required" };
      return getPlayerCareer(who);
    }
    case "get_former_club_players": {
      const { playersWhoPlayedFor } = await import("../tools/positional");
      const opp = String(args?.opponent || "").trim();
      if (!opp) return { error: "opponent required" };
      return playersWhoPlayedFor(opp);
    }
    case "get_points_vs_past_seasons": {
      const { getPointsVsPastSeasons } = await import("../tools/history");
      return getPointsVsPastSeasons(Number(args?.count) || 3);
    }
    case "get_league_coefficients": {
      const { LEAGUE_COEFFICIENTS, LEAGUE_ADJ_VERSION } = await import("../shared/league-adjust");
      return {
        version: LEAGUE_ADJ_VERSION,
        anchor: "Premier League = 1.00",
        coefficients: LEAGUE_COEFFICIENTS,
        how_to_apply:
          "multiply a per-90 produced in league X by its coefficient to express it on a PL scale; ALWAYS disclose in the footnote, e.g. 'adjusted: eredivisie x0.75 (league-adj-v1)'. Unknown league: compare unadjusted and say so.",
      };
    }
    case "web_lookup": {
      const q = String(args?.question || "").trim();
      if (!q) return { error: "question required" };
      try {
        const r = await groundedLookup(q);
        return { answer: r.answer, sources: r.sourceTitles.slice(0, 4), source_urls: r.sources.slice(0, 4) };
      } catch (e) {
        return { error: String((e as Error).message || e) };
      }
    }
    case "get_head_to_head": {
      const { fixtures } = await getTeamFixtures({ next: 1 });
      const next = fixtures[0];
      if (!next) return { error: "no upcoming fixture" };
      const h2h = await getHeadToHead({ opponentId: next.opponentId, fixtureId: next.id });
      return { opponent: next.opponent, ...h2h, citation: undefined };
    }
    case "list_pending_drafts": {
      const rows = await db
        .select()
        .from(drafts)
        .where(eq(drafts.status, "pending"))
        .orderBy(desc(drafts.createdAt))
        .limit(10);
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        card: r.cardKind,
        preview: (r.content || "").slice(0, 90),
      }));
    }
    case "create_draft": {
      if (!TWEET_KINDS.includes(args?.kind)) throw new Error(`invalid kind: ${args?.kind}`);
      const data = coerceObject(args?.data_json ?? args?.data);
      if (!data || !Object.keys(data).length) {
        throw new Error(
          `'data_json' is empty or invalid (received: ${JSON.stringify(args?.data_json ?? args?.data).slice(0, 120)}) — pass a JSON object string with the real facts, e.g. "{\\"opponent\\":\\"Fulham\\",\\"date\\":\\"Mon 24 Aug, 20:00 WAT\\",\\"hook\\":\\"H2H W6 D1 L3\\"}"`
        );
      }
      const cardKind = (args?.card_kind || coerceObject(args?.card)?.kind) as CardKind | undefined;
      const cardData = coerceObject(args?.card_data_json ?? coerceObject(args?.card)?.data);
      if (cardKind && !CARD_KINDS.includes(cardKind)) {
        throw new Error(`invalid card kind: ${cardKind}`);
      }
      if (cardKind && (!cardData || !Object.keys(cardData).length)) {
        throw new Error("card_kind set but card_data_json is empty — pass the card data as a JSON object string");
      }
      const result = await composeAndPost({
        kind: args.kind as TweetKind,
        tone: (args.tone === "savage" ? "savage" : "professional") as Tone,
        data,
        card: cardKind && cardData ? { kind: cardKind, data: cardData } : undefined,
        longform: Boolean(args.longform),
        source: "chat",
        forceQueue: true,
      });
      if (!result.draftId) {
        throw new Error(
          `compose refused (${result.skipped || "no output"}) — the tweet writer needs concrete facts in 'data'; include the numbers you fetched`
        );
      }
      return { draftId: result.draftId, tweet: result.tweet, queued: true };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
