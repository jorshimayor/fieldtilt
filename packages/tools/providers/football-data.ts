/**
 * football-data.org provider — the "$0/month" tier.
 *
 * Docs: https://docs.football-data.org (API v4)
 * Auth: header X-Auth-Token
 * Chelsea team id: 61 · Premier League code: PL
 * Free tier: current season, live scores/status, standings, scorers, H2H.
 * Rate limit: 10 requests/minute (guarded below at 8/min).
 *
 * NOT available on this source (crons degrade gracefully):
 *   - live minute-by-minute stats (possession, shots) and xG  → cards omit them
 *   - transfers                                               → transfers cron skips
 *   - player photos / minutes / ratings                       → typographic cards
 *
 * Pure mappers (mapFd*) are exported for unit tests.
 */

import { setCache, getCache } from "../cache";
import { env } from "@shared/env";
import { redis } from "@shared/redis";
import {
  FootballProvider,
  NormalizedFixture,
  NormalizedLiveMatch,
  NormalizedMatchStats,
  NormalizedGoalEvent,
  NormalizedStanding,
  NormalizedTeamStats,
  NormalizedTopPlayer,
  HeadToHead,
  MatchPhase,
} from "../types";

const BASE = "https://api.football-data.org/v4";
export const FD_CHELSEA_TEAM_ID = 61;
export const FD_PL_CODE = "PL";

/** 10 req/min on the free tier — stop at 8 to leave headroom. No-op without Redis. */
async function underRateLimit(): Promise<boolean> {
  if (!redis) return true;
  const minute = Math.floor(Date.now() / 60_000);
  const key = `fd:rate:${minute}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 120);
  return n <= 8;
}

async function fd(path: string): Promise<any | null> {
  if (!(await underRateLimit())) {
    console.error("football_data_rate_limited", { path });
    return null;
  }
  const res = await fetch(`${BASE}${path}`, {
    headers: { "X-Auth-Token": env.FOOTBALL_DATA_KEY || "" },
  });
  if (!res.ok) {
    console.error("football_data_http_error", { path, status: res.status });
    return null;
  }
  return res.json();
}

// ------------------------------------------------------------ pure mappers

export function mapFdPhase(status: string): MatchPhase {
  if (status === "IN_PLAY") return "live";
  if (status === "PAUSED") return "ht";
  if (status === "FINISHED") return "finished";
  if (["SCHEDULED", "TIMED"].includes(status)) return "pre";
  return "other"; // SUSPENDED, POSTPONED, CANCELLED, AWARDED
}

export function mapFdMatch(m: any): NormalizedFixture {
  const home = m?.homeTeam?.name || m?.homeTeam?.shortName || "Home";
  const away = m?.awayTeam?.name || m?.awayTeam?.shortName || "Away";
  const isChelseaHome = m?.homeTeam?.id === FD_CHELSEA_TEAM_ID;
  const status = m?.status || "SCHEDULED";
  const goalsHome = m?.score?.fullTime?.home ?? null;
  const goalsAway = m?.score?.fullTime?.away ?? null;
  let outcome: "W" | "D" | "L" | null = null;
  if (status === "FINISHED" && goalsHome != null && goalsAway != null) {
    const ours = isChelseaHome ? goalsHome : goalsAway;
    const theirs = isChelseaHome ? goalsAway : goalsHome;
    outcome = ours > theirs ? "W" : ours < theirs ? "L" : "D";
  }
  return {
    id: m?.id,
    date: m?.utcDate,
    competition: m?.competition?.name || "",
    venue: m?.venue || "",
    home,
    away,
    isChelseaHome,
    opponent: isChelseaHome ? away : home,
    opponentId: (isChelseaHome ? m?.awayTeam?.id : m?.homeTeam?.id) ?? null,
    status,
    goalsHome,
    goalsAway,
    outcome,
  };
}

export function mapFdLive(m: any, citation: string): NormalizedLiveMatch {
  return {
    fixtureId: m?.id || 0,
    home: m?.homeTeam?.name || "Home",
    away: m?.awayTeam?.name || "Away",
    homeGoals: m?.score?.fullTime?.home ?? 0,
    awayGoals: m?.score?.fullTime?.away ?? 0,
    minute: typeof m?.minute === "number" ? m.minute : null,
    phase: mapFdPhase(m?.status || ""),
    competition: m?.competition?.name || "",
    citation,
  };
}

export function mapFdStandingRow(r: any): NormalizedStanding {
  return {
    rank: r?.position ?? 0,
    team: r?.team?.name || "",
    points: r?.points ?? 0,
    played: r?.playedGames ?? 0,
    win: r?.won ?? 0,
    draw: r?.draw ?? 0,
    lose: r?.lost ?? 0,
    goalsFor: r?.goalsFor ?? 0,
    goalsAgainst: r?.goalsAgainst ?? 0,
    form: (r?.form || "").replace(/,/g, ""),
  };
}

export function mapFdGoals(goals: any[]): NormalizedGoalEvent[] {
  return (goals || []).map((g: any) => ({
    minute: g?.minute ?? null,
    player: g?.scorer?.name || "Unknown",
    assist: g?.assist?.name || null,
    team: g?.team?.name || "",
    detail:
      g?.type === "PENALTY" ? "Penalty" : g?.type === "OWN" ? "Own Goal" : "Normal Goal",
  }));
}

export function mapFdScorer(s: any): NormalizedTopPlayer {
  return {
    player: s?.player?.name || "",
    playerId: s?.player?.id || 0,
    photoUrl: null,
    position: s?.player?.position || "",
    appearances: s?.playedMatches ?? 0,
    goals: s?.goals ?? 0,
    assists: s?.assists ?? 0,
    minutes: null,
    rating: null,
  };
}

/** Season stats derived from the standings row (fd has no team-stats endpoint). */
export function teamStatsFromStanding(
  season: number,
  row: NormalizedStanding | null,
  citation: string
): NormalizedTeamStats {
  return {
    season,
    form: row?.form || "",
    played: row?.played ?? 0,
    wins: row?.win ?? 0,
    draws: row?.draw ?? 0,
    losses: row?.lose ?? 0,
    goalsFor: row?.goalsFor ?? 0,
    goalsAgainst: row?.goalsAgainst ?? 0,
    cleanSheets: null,
    avgGoalsFor: row && row.played ? (row.goalsFor / row.played).toFixed(2) : "0",
    citation,
  };
}

// ------------------------------------------------------------ provider

export const footballDataProvider: FootballProvider = {
  name: "football-data",
  capabilities: {
    liveMinute: false, // present on some plans; treat as bonus when it appears
    liveStats: false,
    xg: false,
    transfers: false,
    playerPhotos: false,
  },

  async getFixtures(opts) {
    const status = opts.last ? "FINISHED" : "SCHEDULED";
    const limit = opts.next || opts.last || 5;
    const path = `/teams/${FD_CHELSEA_TEAM_ID}/matches?status=${status}&limit=${limit}`;
    const key = `fd:fixtures:${status}:${limit}`;
    const cached = await getCache<{ fixtures: NormalizedFixture[]; citation: string }>(key);
    if (cached) return cached;

    const json = await fd(path);
    let fixtures = ((json?.matches as any[]) || []).map(mapFdMatch);
    // fd returns FINISHED ascending; we want most recent first.
    if (opts.last) fixtures = fixtures.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, limit);
    const data = { fixtures, citation: `${BASE}${path}` };
    await setCache(key, data, 15 * 60 * 1000);
    return data;
  },

  async getFixtureById(id) {
    const key = `fd:fixture:${id}`;
    const cached = await getCache<NormalizedFixture>(key);
    if (cached) return cached;
    const json = await fd(`/matches/${id}`);
    if (!json) return null;
    const fixture = mapFdMatch(json);
    await setCache(key, fixture, 60 * 1000);
    return fixture;
  },

  async getLiveMatch() {
    const key = `fd:live:chelsea`;
    const cached = await getCache<NormalizedLiveMatch | "none">(key);
    if (cached) return cached === "none" ? null : cached;
    const path = `/teams/${FD_CHELSEA_TEAM_ID}/matches?status=IN_PLAY,PAUSED`;
    const json = await fd(path);
    const m = ((json?.matches as any[]) || [])[0];
    if (!m) {
      await setCache(key, "none", 30 * 1000);
      return null;
    }
    const live = mapFdLive(m, `${BASE}${path}`);
    await setCache(key, live, 30 * 1000);
    return live;
  },

  async getMatchStats(fixtureId) {
    // Not available on the free tier — nulls everywhere; cards hide them.
    return {
      fixtureId,
      team: "unknown",
      possession: null,
      shotsTotal: null,
      shotsOnTarget: null,
      corners: null,
      fouls: null,
      xg: null,
      passAccuracy: null,
      citation: `${BASE}/matches/${fixtureId}`,
    } satisfies NormalizedMatchStats;
  },

  async getGoalEvents(fixtureId, opts) {
    const path = `/matches/${fixtureId}`;
    const key = `fd:events:${fixtureId}`;
    const cached = await getCache<{ goals: NormalizedGoalEvent[]; citation: string }>(key);
    if (cached) return cached;
    const json = await fd(path);
    const goals = mapFdGoals(json?.goals || []);
    const data = { goals, citation: `${BASE}${path}` };
    await setCache(key, data, opts?.ttlMs ?? 60 * 1000);
    return data;
  },

  async getTransfers() {
    // football-data.org has no transfers endpoint.
    return { transfers: [], citation: BASE, supported: false };
  },

  async getStandings(season) {
    const path = `/competitions/${FD_PL_CODE}/standings?season=${season}`;
    const key = `fd:standings:${season}`;
    const cached = await getCache<{
      chelsea: NormalizedStanding | null;
      table: NormalizedStanding[];
      citation: string;
    }>(key);
    if (cached) return cached;

    const json = await fd(path);
    const total = ((json?.standings as any[]) || []).find((s: any) => s?.type === "TOTAL");
    const table: NormalizedStanding[] = (total?.table || []).map(mapFdStandingRow);
    const chelsea =
      (total?.table || [])
        .filter((r: any) => r?.team?.id === FD_CHELSEA_TEAM_ID)
        .map(mapFdStandingRow)[0] || null;
    const data = { chelsea, table, citation: `${BASE}${path}` };
    await setCache(key, data, 60 * 60 * 1000);
    return data;
  },

  async getSeasonStats(season) {
    const key = `fd:teamstats:${season}`;
    const cached = await getCache<NormalizedTeamStats>(key);
    if (cached) return cached;
    const { chelsea, citation } = await this.getStandings(season);
    const data = teamStatsFromStanding(season, chelsea, citation);
    await setCache(key, data, 60 * 60 * 1000);
    return data;
  },

  async getTopPerformers(season) {
    const path = `/competitions/${FD_PL_CODE}/scorers?limit=100&season=${season}`;
    const key = `fd:topperformers:${season}`;
    const cached = await getCache<{ players: NormalizedTopPlayer[]; citation: string }>(key);
    if (cached) return cached;

    const json = await fd(path);
    const players = ((json?.scorers as any[]) || [])
      .filter((s: any) => s?.team?.id === FD_CHELSEA_TEAM_ID)
      .map(mapFdScorer)
      .sort((a, b) => b.goals * 2 + b.assists - (a.goals * 2 + a.assists));
    const data = { players, citation: `${BASE}${path}` };
    await setCache(key, data, 12 * 60 * 60 * 1000);
    return data;
  },

  async getHeadToHead(ref) {
    if (!ref.fixtureId) {
      return { wins: 0, draws: 0, losses: 0, played: 0, summary: "", citation: "" };
    }
    const path = `/matches/${ref.fixtureId}/head2head?limit=10`;
    const key = `fd:h2h:${ref.fixtureId}`;
    const cached = await getCache<HeadToHead>(key);
    if (cached) return cached;

    const json = await fd(path);
    let wins = 0,
      draws = 0,
      losses = 0;
    for (const m of (json?.matches as any[]) || []) {
      if (m?.status !== "FINISHED") continue;
      const f = mapFdMatch(m);
      if (f.outcome === "W") wins++;
      else if (f.outcome === "L") losses++;
      else if (f.outcome === "D") draws++;
    }
    const played = wins + draws + losses;
    const data: HeadToHead = {
      wins,
      draws,
      losses,
      played,
      summary: played ? `W${wins} D${draws} L${losses} in the last ${played}` : "",
      citation: `${BASE}${path}`,
    };
    await setCache(key, data, 7 * 24 * 60 * 60 * 1000);
    return data;
  },
};
