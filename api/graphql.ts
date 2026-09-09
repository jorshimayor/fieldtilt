export const config = { runtime: "edge" };

/**
 * Public read-only GraphQL API — the data layer behind /terminal.
 *
 * Unauthenticated by design: everything here is already public information
 * (league tables, fixtures, our own published posts, our own model calls).
 * Quota protection is caching, not auth — every resolver's data is cached
 * for 10 minutes, so a burst of public traffic costs at most one upstream
 * fetch per source per window.
 *
 *   POST /api/graphql {"query": "{ standings { team points } }"}
 *   GET  /api/graphql?query={...}
 */

import { buildSchema, graphql } from "graphql";
import { getCache, setCache } from "../packages/tools/cache";
import { withErrorLogging } from "../packages/observability/index";

const TTL = 10 * 60 * 1000;

const schema = buildSchema(/* GraphQL */ `
  type ClubInfo { name: String!, league: String!, season: String! }
  type StandingRow { rank: Int!, team: String!, played: Int!, points: Int!, goalsFor: Int!, goalsAgainst: Int!, form: String }
  type XgRow { team: String!, xG: Float!, xGA: Float! }
  type ResultRow { opponent: String!, score: String!, outcome: String!, isHome: Boolean!, dateUtc: String! }
  type FixtureRow { home: String!, away: String!, competition: String!, dateUtc: String!, venue: String }
  type ForecastFixture { home: String!, away: String!, kickoffUtc: String!, pHome: Float!, pDraw: Float!, pAway: Float!, xpHome: Float!, xpAway: Float! }
  type ModelCall { model: String!, gameweek: Int, predictedAt: String!, fixtures: [ForecastFixture!]! }
  type ScoredResult { fixture: String!, final: String!, called: String!, actual: String!, brier: Float! }
  type ModelScore { matches: Int!, brier: Float!, brierBaseline: Float!, beatBaseline: Boolean!, results: [ScoredResult!]! }
  type Post { content: String!, tweetId: String, postedAt: String }
  type Query {
    clubInfo: ClubInfo!
    standings: [StandingRow!]!
    xgTable: [XgRow!]!
    recentResults(count: Int): [ResultRow!]!
    nextFixtures(count: Int): [FixtureRow!]!
    modelCall: ModelCall
    modelScore: ModelScore
    posts(count: Int): [Post!]!
  }
`);

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = await getCache<T>(`gql:${key}`);
  if (hit) return hit;
  const data = await load();
  await setCache(`gql:${key}`, data, TTL);
  return data;
}

const rootValue = {
  clubInfo: async () => {
    const { club, seasonLabel } = await import("../packages/tools/football");
    return { name: club().name, league: club().league.name, season: seasonLabel() };
  },
  standings: () =>
    cached("standings", async () => {
      const { getLeagueStandings, currentSeason } = await import("../packages/tools/football");
      const { table } = await getLeagueStandings(currentSeason());
      return table.map((t) => ({ rank: t.rank, team: t.team, played: t.played, points: t.points, goalsFor: t.goalsFor, goalsAgainst: t.goalsAgainst, form: t.form || null }));
    }),
  xgTable: () =>
    cached("xg", async () => {
      const { getLeagueXgTable } = await import("../packages/tools/understat");
      const { currentSeason } = await import("../packages/tools/football");
      const { table } = await getLeagueXgTable(currentSeason());
      return (table as any[]).map((t) => ({ team: t.team, xG: t.xG, xGA: t.xGA }));
    }),
  recentResults: ({ count }: { count?: number }) =>
    cached("results", async () => {
      const { getTeamFixtures } = await import("../packages/tools/football");
      const { fixtures } = await getTeamFixtures({ last: 10 });
      return fixtures
        .filter((f) => f.outcome)
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((f) => ({ opponent: f.opponent, score: `${f.goalsHome}-${f.goalsAway}`, outcome: f.outcome, isHome: f.isHome, dateUtc: f.date }));
    }).then((r: any[]) => r.slice(0, Math.min(count || 5, 10))),
  nextFixtures: ({ count }: { count?: number }) =>
    cached("fixtures", async () => {
      const { getTeamFixtures } = await import("../packages/tools/football");
      const { getUpcomingCupFixtures } = await import("../packages/tools/cup-overlay");
      const [{ fixtures }, cups] = await Promise.all([getTeamFixtures({ next: 5 }), getUpcomingCupFixtures(5)]);
      return [...fixtures, ...cups]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((f) => ({ home: f.home, away: f.away, competition: f.competition, dateUtc: f.date, venue: f.venue || null }));
    }).then((r: any[]) => r.slice(0, Math.min(count || 3, 10))),
  modelCall: () =>
    cached("modelcall", async () => {
      const { db } = await import("../packages/db/client");
      const { modelOutputs } = await import("../packages/db/schema");
      const { desc, eq } = await import("drizzle-orm");
      const rows = await db.select().from(modelOutputs).where(eq(modelOutputs.model, "season-forecast-v1")).orderBy(desc(modelOutputs.id)).limit(12);
      if (!rows.length) return null;
      const newest = (rows[0].payload as any)?.predicted_at;
      const batch = rows.filter((r) => (r.payload as any)?.predicted_at === newest).map((r) => r.payload as any);
      return {
        model: "season-forecast-v1",
        gameweek: rows[0].gameweek,
        predictedAt: newest,
        fixtures: batch
          .sort((a, b) => String(a.kickoff_utc).localeCompare(String(b.kickoff_utc)))
          .map((p) => ({ home: p.home, away: p.away, kickoffUtc: p.kickoff_utc, pHome: p.probs.home, pDraw: p.probs.draw, pAway: p.probs.away, xpHome: p.xp_home, xpAway: p.xp_away })),
      };
    }),
  modelScore: () =>
    cached("modelscore", async () => {
      const { db } = await import("../packages/db/client");
      const { modelOutputs } = await import("../packages/db/schema");
      const { desc, eq } = await import("drizzle-orm");
      const rows = await db.select().from(modelOutputs).where(eq(modelOutputs.model, "season-forecast-v1-score")).orderBy(desc(modelOutputs.id)).limit(1);
      const s = rows[0]?.payload as any;
      if (!s) return null;
      return { matches: s.matches, brier: s.brier, brierBaseline: s.brier_baseline, beatBaseline: s.beat_baseline, results: s.results.map((r: any) => ({ fixture: r.fixture, final: r.final, called: r.called, actual: r.actual, brier: r.brier })) };
    }),
  posts: ({ count }: { count?: number }) =>
    cached("posts", async () => {
      const { db } = await import("../packages/db/client");
      const { drafts } = await import("../packages/db/schema");
      const { desc, eq } = await import("drizzle-orm");
      const rows = await db
        .select({ content: drafts.content, tweetId: drafts.tweetId, postedAt: drafts.postedAt })
        .from(drafts)
        .where(eq(drafts.status, "posted"))
        .orderBy(desc(drafts.postedAt))
        .limit(10);
      return rows.map((r) => ({ content: r.content, tweetId: r.tweetId, postedAt: r.postedAt ? new Date(r.postedAt).toISOString() : null }));
    }).then((r: any[]) => r.slice(0, Math.min(count || 6, 10))),
};

export default withErrorLogging(async function handler(req: Request): Promise<Response> {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  let query = "";
  let variables: Record<string, unknown> | undefined;
  if (req.method === "POST") {
    const body = (await req.json().catch(() => null)) as any;
    query = body?.query || "";
    variables = body?.variables;
  } else {
    query = new URL(req.url).searchParams.get("query") || "";
  }
  if (!query) {
    return new Response(JSON.stringify({ error: "pass a GraphQL query (POST {query} or GET ?query=)" }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
  }
  const result = await graphql({ schema, source: query, rootValue, variableValues: variables });
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=120", ...cors },
  });
});
