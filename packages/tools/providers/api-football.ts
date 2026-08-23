/**
 * API-Football (api-sports.io) provider — the "recommended" tier (~$19/mo Pro).
 *
 * Docs: https://www.api-football.com/documentation-v3
 * Auth: header x-apisports-key
 * Team/league ids come from @shared/club — this file is club-agnostic.
 *
 * Full capabilities: live minute, in-match stats, xG, transfers, headshots.
 * NOTE: the free API-Football tier has NO live/current-season data — this
 * provider assumes a paid key. For $0, use providers/football-data.ts.
 */

import { setCache, getCache } from "../cache";
import { env } from "@shared/env";
import { redis } from "@shared/redis";
import { club } from "@shared/club";
import {
  FootballProvider,
  NormalizedFixture,
  NormalizedLiveMatch,
  NormalizedMatchStats,
  NormalizedGoalEvent,
  NormalizedTransfer,
  NormalizedStanding,
  NormalizedTeamStats,
  NormalizedTopPlayer,
  HeadToHead,
  MatchPhase,
} from "../types";

const BASE = "https://v3.football.api-sports.io";
// Club + league ids come from the club config — nothing club-specific here.
const teamId = () => club().ids.apiFootball;
const leagueId = () => club().league.apiFootball;
const slug = () => club().slug;

type ApiFootballResponse<T> = {
  response: T[];
  errors?: Record<string, string> | string[];
  results?: number;
};

/** Soft daily request budget (free tier = 100 req/day; default cap 90). */
async function underBudget(): Promise<boolean> {
  if (!redis) return true;
  const limit = Number((globalThis as any).process?.env?.API_FOOTBALL_DAILY_BUDGET || 90);
  const day = new Date().toISOString().slice(0, 10);
  const key = `af:budget:${day}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 26 * 60 * 60);
  return n <= limit;
}

async function af<T>(path: string): Promise<ApiFootballResponse<T>> {
  if (!(await underBudget())) {
    console.error("api_football_budget_exceeded", { path });
    return { response: [], errors: ["budget_exceeded"] };
  }
  const res = await fetch(`${BASE}${path}`, {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY || "" },
  });
  if (!res.ok) {
    console.error("api_football_http_error", { path, status: res.status });
    return { response: [], errors: [`http_${res.status}`] };
  }
  const json = (await res.json()) as ApiFootballResponse<T>;
  if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length) {
    console.error("api_football_api_error", { path, errors: json.errors });
  }
  return json;
}

function mapFixture(r: any): NormalizedFixture {
  const home = r?.teams?.home?.name || "Home";
  const away = r?.teams?.away?.name || "Away";
  const isHome = r?.teams?.home?.id === teamId();
  const status = r?.fixture?.status?.short || "NS";
  const goalsHome = r?.goals?.home ?? null;
  const goalsAway = r?.goals?.away ?? null;
  let outcome: "W" | "D" | "L" | null = null;
  if (["FT", "AET", "PEN"].includes(status) && goalsHome != null && goalsAway != null) {
    const ours = isHome ? goalsHome : goalsAway;
    const theirs = isHome ? goalsAway : goalsHome;
    outcome = ours > theirs ? "W" : ours < theirs ? "L" : "D";
  }
  return {
    id: r?.fixture?.id,
    date: r?.fixture?.date,
    competition: r?.league?.name || "",
    venue: r?.fixture?.venue?.name || "",
    home,
    away,
    isHome,
    opponent: isHome ? away : home,
    opponentId: (isHome ? r?.teams?.away?.id : r?.teams?.home?.id) ?? null,
    status,
    goalsHome,
    goalsAway,
    outcome,
  };
}

function phaseFromStatus(status: string): MatchPhase {
  if (["1H", "2H", "ET", "P", "BT"].includes(status)) return "live";
  if (status === "HT") return "ht";
  if (["FT", "AET", "PEN"].includes(status)) return "finished";
  if (["NS", "TBD"].includes(status)) return "pre";
  return "other";
}

function pickStat(stats: any[], type: string): string | number | null {
  if (!Array.isArray(stats)) return null;
  const row = stats.find((s) => (s?.type || "").toLowerCase() === type.toLowerCase());
  return row ? row.value : null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).replace("%", "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export const apiFootballProvider: FootballProvider = {
  name: "api-football",
  capabilities: {
    liveMinute: true,
    liveStats: true,
    xg: true,
    transfers: true,
    playerPhotos: true,
  },

  async getFixtures(opts) {
    const params = new URLSearchParams();
    params.set("team", String(teamId()));
    if (opts.next) params.set("next", String(opts.next));
    if (opts.last) params.set("last", String(opts.last));
    if (opts.season) params.set("season", String(opts.season));
    const path = `/fixtures?${params.toString()}`;
    const key = `fixtures:${slug()}:${params.toString()}`;
    const cached = await getCache<{ fixtures: NormalizedFixture[]; citation: string }>(key);
    if (cached) return cached;

    const json = await af<any>(path);
    const fixtures = (json.response || []).map(mapFixture);
    const data = { fixtures, citation: `${BASE}${path}` };
    await setCache(key, data, 15 * 60 * 1000);
    return data;
  },

  async getFixtureById(id) {
    const key = `fixture:${slug()}:${id}`;
    const cached = await getCache<NormalizedFixture>(key);
    if (cached) return cached;
    const json = await af<any>(`/fixtures?id=${id}`);
    const row = (json.response || [])[0];
    if (!row) return null;
    const fixture = mapFixture(row);
    await setCache(key, fixture, 60 * 1000);
    return fixture;
  },

  async getLiveMatch() {
    const key = `live:${slug()}`;
    const cached = await getCache<NormalizedLiveMatch | "none">(key);
    if (cached) return cached === "none" ? null : cached;
    const path = `/fixtures?live=all`;
    const json = await af<any>(path);
    const game = (json.response || []).find(
      (e: any) => e?.teams?.home?.id === teamId() || e?.teams?.away?.id === teamId()
    );
    if (!game) {
      await setCache(key, "none", 10 * 1000);
      return null;
    }
    const live: NormalizedLiveMatch = {
      fixtureId: game?.fixture?.id || 0,
      home: game?.teams?.home?.name || "Home",
      away: game?.teams?.away?.name || "Away",
      homeGoals: game?.goals?.home ?? 0,
      awayGoals: game?.goals?.away ?? 0,
      minute: game?.fixture?.status?.elapsed ?? null,
      phase: phaseFromStatus(game?.fixture?.status?.short || ""),
      competition: game?.league?.name || "",
      citation: `${BASE}${path}`,
    };
    await setCache(key, live, 10 * 1000);
    return live;
  },

  async getMatchStats(fixtureId) {
    const key = `matchstats:${slug()}:${fixtureId}`;
    const cached = await getCache<NormalizedMatchStats>(key);
    if (cached) return cached;

    const path = `/fixtures/statistics?fixture=${fixtureId}`;
    const json = await af<any>(path);
    const teamEntry = (json.response || []).find((e: any) => e?.team?.id === teamId());
    const stats = teamEntry?.statistics || [];
    const data: NormalizedMatchStats = {
      fixtureId,
      team: teamEntry ? "home" : "unknown",
      possession: toNumber(pickStat(stats, "Ball Possession")),
      shotsTotal: toNumber(pickStat(stats, "Total Shots")),
      shotsOnTarget: toNumber(pickStat(stats, "Shots on Goal")),
      corners: toNumber(pickStat(stats, "Corner Kicks")),
      fouls: toNumber(pickStat(stats, "Fouls")),
      xg: toNumber(pickStat(stats, "expected_goals")),
      passAccuracy: toNumber(pickStat(stats, "Passes %")),
      citation: `${BASE}${path}`,
    };
    await setCache(key, data, 10 * 60 * 1000);
    return data;
  },

  async getGoalEvents(fixtureId, opts) {
    const path = `/fixtures/events?fixture=${fixtureId}`;
    const key = `events:${slug()}:${fixtureId}`;
    const cached = await getCache<{ goals: NormalizedGoalEvent[]; citation: string }>(key);
    if (cached) return cached;

    const json = await af<any>(path);
    const goals: NormalizedGoalEvent[] = (json.response || [])
      .filter((e: any) => e?.type === "Goal" && e?.detail !== "Missed Penalty")
      .map((e: any) => ({
        minute: e?.time?.elapsed ?? null,
        player: e?.player?.name || "Unknown",
        assist: e?.assist?.name || null,
        team: e?.team?.name || "",
        detail: e?.detail || "Normal Goal",
      }));
    const data = { goals, citation: `${BASE}${path}` };
    await setCache(key, data, opts?.ttlMs ?? 60 * 1000);
    return data;
  },

  async getTransfers(opts) {
    const sinceDays = opts?.sinceDays ?? 14;
    const path = `/transfers?team=${teamId()}`;
    const key = `transfers:${slug()}`;
    let all = await getCache<NormalizedTransfer[]>(key);

    if (!all) {
      const json = await af<any>(path);
      all = [];
      for (const row of json.response || []) {
        const player = row?.player?.name || "";
        const playerId = row?.player?.id || 0;
        for (const t of row?.transfers || []) {
          const inbound = t?.teams?.in?.id === teamId();
          const outbound = t?.teams?.out?.id === teamId();
          if (!inbound && !outbound) continue;
          all.push({
            player,
            playerId,
            date: t?.date || "",
            direction: inbound ? "in" : "out",
            counterparty: inbound
              ? t?.teams?.out?.name || "Unknown"
              : t?.teams?.in?.name || "Unknown",
            type: t?.type || "N/A",
          });
        }
      }
      await setCache(key, all, 6 * 60 * 60 * 1000);
    }

    const cutoff = Date.now() - sinceDays * 24 * 60 * 60 * 1000;
    const transfers = all
      .filter((t) => t.date && new Date(t.date).getTime() >= cutoff)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    return { transfers, citation: `${BASE}${path}`, supported: true };
  },

  async getStandings(season) {
    const path = `/standings?league=${leagueId()}&season=${season}`;
    const key = `standings:${slug()}:${season}`;
    const cached = await getCache<{
      team: NormalizedStanding | null;
      table: NormalizedStanding[];
      citation: string;
    }>(key);
    if (cached) return cached;

    const json = await af<any>(path);
    const rows: any[] = json.response?.[0]?.league?.standings?.[0] || [];
    const table: NormalizedStanding[] = rows.map((r) => ({
      rank: r?.rank ?? 0,
      team: r?.team?.name || "",
      points: r?.points ?? 0,
      played: r?.all?.played ?? 0,
      win: r?.all?.win ?? 0,
      draw: r?.all?.draw ?? 0,
      lose: r?.all?.lose ?? 0,
      goalsFor: r?.all?.goals?.for ?? 0,
      goalsAgainst: r?.all?.goals?.against ?? 0,
      form: r?.form || "",
    }));
    const ours = table.find((t) => t.team.toLowerCase().includes(club().name.toLowerCase())) || null;
    const data = { team: ours, table, citation: `${BASE}${path}` };
    await setCache(key, data, 60 * 60 * 1000);
    return data;
  },

  async getSeasonStats(season) {
    const path = `/teams/statistics?league=${leagueId()}&season=${season}&team=${teamId()}`;
    const key = `teamstats:${slug()}:${season}`;
    const cached = await getCache<NormalizedTeamStats>(key);
    if (cached) return cached;

    const json = await af<any>(path);
    const r: any = (json as any).response || {};
    const data: NormalizedTeamStats = {
      season,
      form: r?.form || "",
      played: r?.fixtures?.played?.total ?? 0,
      wins: r?.fixtures?.wins?.total ?? 0,
      draws: r?.fixtures?.draws?.total ?? 0,
      losses: r?.fixtures?.loses?.total ?? 0,
      goalsFor: r?.goals?.for?.total?.total ?? 0,
      goalsAgainst: r?.goals?.against?.total?.total ?? 0,
      cleanSheets: r?.clean_sheet?.total ?? 0,
      avgGoalsFor: r?.goals?.for?.average?.total || "0",
      citation: `${BASE}${path}`,
    };
    await setCache(key, data, 12 * 60 * 60 * 1000);
    return data;
  },

  async getTopPerformers(season) {
    const key = `topperformers:${slug()}:${season}`;
    const cached = await getCache<{ players: NormalizedTopPlayer[]; citation: string }>(key);
    if (cached) return cached;

    const players: NormalizedTopPlayer[] = [];
    let citation = "";
    for (let page = 1; page <= 3; page++) {
      const path = `/players?team=${teamId()}&season=${season}&page=${page}`;
      citation = `${BASE}${path}`;
      const json = await af<any>(path);
      const rows: any[] = json.response || [];
      for (const row of rows) {
        const s =
          (row.statistics || []).find((st: any) => st?.league?.id === leagueId()) ||
          (row.statistics || [])[0] ||
          {};
        players.push({
          player: row?.player?.name || "",
          playerId: row?.player?.id || 0,
          photoUrl: row?.player?.photo || null,
          position: s?.games?.position || "",
          appearances: s?.games?.appearences ?? 0,
          goals: s?.goals?.total ?? 0,
          assists: s?.goals?.assists ?? 0,
          minutes: s?.games?.minutes ?? 0,
          rating: s?.games?.rating ? Number(s.games.rating).toFixed(2) : null,
        });
      }
      if (rows.length < 20) break;
    }
    players.sort((a, b) => b.goals * 2 + b.assists - (a.goals * 2 + a.assists));
    const data = { players, citation };
    await setCache(key, data, 12 * 60 * 60 * 1000);
    return data;
  },

  async getHeadToHead(ref) {
    const opponentId = ref.opponentId;
    if (!opponentId) {
      return { wins: 0, draws: 0, losses: 0, played: 0, summary: "", citation: "" };
    }
    const last = 10;
    const path = `/fixtures/headtohead?h2h=${teamId()}-${opponentId}&last=${last}`;
    const key = `h2h:${slug()}:${opponentId}:${last}`;
    const cached = await getCache<HeadToHead>(key);
    if (cached) return cached;

    const json = await af<any>(path);
    let wins = 0,
      draws = 0,
      losses = 0;
    for (const r of json.response || []) {
      const status = r?.fixture?.status?.short;
      if (!["FT", "AET", "PEN"].includes(status)) continue;
      const ourHome = r?.teams?.home?.id === teamId();
      const ours = ourHome ? r?.goals?.home : r?.goals?.away;
      const theirs = ourHome ? r?.goals?.away : r?.goals?.home;
      if (ours == null || theirs == null) continue;
      if (ours > theirs) wins++;
      else if (ours < theirs) losses++;
      else draws++;
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
