/**
 * API-Football helpers scoped to Chelsea FC.
 *
 * Docs: https://www.api-football.com/documentation-v3
 * Base: https://v3.football.api-sports.io
 * Auth: header x-apisports-key
 *
 * Team IDs used:
 *   49  = Chelsea FC
 * League IDs (common):
 *   39 = Premier League, 2 = UEFA Champions League, 3 = UEFA Europa League
 *
 * All functions cache via Redis (hot) and fall back to Neon (warm for stats).
 */

import { setCache, getCache } from "./cache";
import { env } from "@shared/env";
import { redis } from "@shared/redis";

const BASE = "https://v3.football.api-sports.io";
export const CHELSEA_TEAM_ID = 49;
export const PREMIER_LEAGUE_ID = 39;

/**
 * API-Football season is the *starting* year (2025 = the 2025/26 season).
 * Seasons roll over in July/August; we switch in July.
 */
export function currentSeason(now = new Date()): number {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? y : y - 1;
}

export function seasonLabel(season = currentSeason()): string {
  return `${season}/${String((season + 1) % 100).padStart(2, "0")}`;
}

type ApiFootballResponse<T> = {
  response: T[];
  errors?: Record<string, string> | string[];
  results?: number;
};

/**
 * Soft daily request budget so a bug or hot cron can't burn the whole
 * API-Football quota (free tier = 100 req/day). Only enforced when Redis is
 * configured; otherwise it's a no-op.
 */
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
  // API-Football returns 200 with an `errors` object for quota/plan issues.
  if (json.errors && !Array.isArray(json.errors) && Object.keys(json.errors).length) {
    console.error("api_football_api_error", { path, errors: json.errors });
  }
  return json;
}

// ---------- Fixtures ----------

export type NormalizedFixture = {
  id: number;
  date: string; // ISO
  competition: string;
  venue: string;
  home: string;
  away: string;
  isChelseaHome: boolean;
  opponent: string;
  status: string; // e.g. "NS", "1H", "HT", "FT"
  goalsHome: number | null;
  goalsAway: number | null;
  /** Chelsea's result, only set for finished fixtures. */
  outcome: "W" | "D" | "L" | null;
};

export async function getChelseaFixtures(opts: {
  next?: number; // how many upcoming
  last?: number; // how many past
  season?: number;
}): Promise<{ fixtures: NormalizedFixture[]; citation: string }> {
  const params = new URLSearchParams();
  params.set("team", String(CHELSEA_TEAM_ID));
  if (opts.next) params.set("next", String(opts.next));
  if (opts.last) params.set("last", String(opts.last));
  if (opts.season) params.set("season", String(opts.season));
  const path = `/fixtures?${params.toString()}`;
  const key = `fixtures:chelsea:${params.toString()}`;
  const cached = await getCache<{
    fixtures: NormalizedFixture[];
    citation: string;
  }>(key);
  if (cached) return cached;

  const json = await af<any>(path);
  const fixtures: NormalizedFixture[] = (json.response || []).map((r: any) => {
    const home = r?.teams?.home?.name || "Home";
    const away = r?.teams?.away?.name || "Away";
    const isChelseaHome = r?.teams?.home?.id === CHELSEA_TEAM_ID;
    const status = r?.fixture?.status?.short || "NS";
    const goalsHome = r?.goals?.home ?? null;
    const goalsAway = r?.goals?.away ?? null;
    let outcome: "W" | "D" | "L" | null = null;
    if (["FT", "AET", "PEN"].includes(status) && goalsHome != null && goalsAway != null) {
      const ours = isChelseaHome ? goalsHome : goalsAway;
      const theirs = isChelseaHome ? goalsAway : goalsHome;
      outcome = ours > theirs ? "W" : ours < theirs ? "L" : "D";
    }
    return {
      id: r?.fixture?.id,
      date: r?.fixture?.date,
      competition: r?.league?.name || "",
      venue: r?.fixture?.venue?.name || "",
      home,
      away,
      isChelseaHome,
      opponent: isChelseaHome ? away : home,
      status,
      goalsHome,
      goalsAway,
      outcome,
    };
  });

  const data = { fixtures, citation: `${BASE}${path}` };
  // Short TTL for upcoming fixtures; they rarely change but can be reschedules.
  await setCache(key, data, 15 * 60 * 1000);
  return data;
}

// ---------- Match Stats ----------

export type NormalizedMatchStats = {
  fixtureId: number;
  team: "home" | "away" | "unknown";
  possession: number | null; // %
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  corners: number | null;
  fouls: number | null;
  xg: number | null;
  passAccuracy: number | null; // %
  citation: string;
};

function pickStat(stats: any[], type: string): string | number | null {
  if (!Array.isArray(stats)) return null;
  const row = stats.find(
    (s) => (s?.type || "").toLowerCase() === type.toLowerCase()
  );
  return row ? row.value : null;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  const s = String(v).replace("%", "").trim();
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

export async function getMatchStats(
  fixtureId: number
): Promise<NormalizedMatchStats> {
  const key = `matchstats:${fixtureId}`;
  const cached = await getCache<NormalizedMatchStats>(key);
  if (cached) return cached;

  const path = `/fixtures/statistics?fixture=${fixtureId}`;
  const json = await af<any>(path);
  // Response is an array per team; find the Chelsea side.
  const chelseaEntry = (json.response || []).find(
    (e: any) => e?.team?.id === CHELSEA_TEAM_ID
  );
  const stats = chelseaEntry?.statistics || [];
  const team: "home" | "away" | "unknown" = chelseaEntry
    ? "home" // We don't know from this endpoint alone; fix via fixture lookup if needed.
    : "unknown";

  const data: NormalizedMatchStats = {
    fixtureId,
    team,
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
}

// ---------- Player Season Summary ----------

export type NormalizedPlayerSummary = {
  player: string;
  team: string;
  season: number | null;
  appearances: number | null;
  goals: number | null;
  assists: number | null;
  minutes: number | null;
  passAccuracy: number | null;
  tackles: number | null;
  citation: string;
};

export async function getChelseaPlayerSummary(
  name: string,
  season?: number
): Promise<NormalizedPlayerSummary | null> {
  const key = `playersummary:${name.toLowerCase()}:${season || ""}`;
  const cached = await getCache<NormalizedPlayerSummary>(key);
  if (cached) return cached;

  const params = new URLSearchParams();
  params.set("team", String(CHELSEA_TEAM_ID));
  params.set("search", name);
  if (season) params.set("season", String(season));
  const path = `/players?${params.toString()}`;
  const json = await af<any>(path);
  const row = (json.response || [])[0];
  if (!row) return null;

  const s = (row.statistics || [])[0] || {};
  const data: NormalizedPlayerSummary = {
    player: row?.player?.name || name,
    team: s?.team?.name || "Chelsea",
    season: s?.league?.season ?? season ?? null,
    appearances: s?.games?.appearences ?? null,
    goals: s?.goals?.total ?? null,
    assists: s?.goals?.assists ?? null,
    minutes: s?.games?.minutes ?? null,
    passAccuracy: toNumber(s?.passes?.accuracy),
    tackles: s?.tackles?.total ?? null,
    citation: `${BASE}${path}`,
  };
  await setCache(key, data, 6 * 60 * 60 * 1000);
  return data;
}

// ---------- Transfers ----------

export type NormalizedTransfer = {
  player: string;
  playerId: number;
  date: string; // "2026-07-01"
  direction: "in" | "out";
  counterparty: string;
  /** e.g. "€ 40M", "Loan", "Free", "N/A" */
  type: string;
};

export async function getChelseaTransfers(opts?: {
  sinceDays?: number;
}): Promise<{ transfers: NormalizedTransfer[]; citation: string }> {
  const sinceDays = opts?.sinceDays ?? 14;
  const path = `/transfers?team=${CHELSEA_TEAM_ID}`;
  const key = `transfers:chelsea`;
  let all = await getCache<NormalizedTransfer[]>(key);

  if (!all) {
    const json = await af<any>(path);
    all = [];
    for (const row of json.response || []) {
      const player = row?.player?.name || "";
      const playerId = row?.player?.id || 0;
      for (const t of row?.transfers || []) {
        const inbound = t?.teams?.in?.id === CHELSEA_TEAM_ID;
        const outbound = t?.teams?.out?.id === CHELSEA_TEAM_ID;
        if (!inbound && !outbound) continue;
        all.push({
          player,
          playerId,
          date: t?.date || "",
          direction: inbound ? "in" : "out",
          counterparty: inbound ? t?.teams?.out?.name || "Unknown" : t?.teams?.in?.name || "Unknown",
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
  return { transfers, citation: `${BASE}${path}` };
}

// ---------- League standings ----------

export type NormalizedStanding = {
  rank: number;
  team: string;
  points: number;
  played: number;
  win: number;
  draw: number;
  lose: number;
  goalsFor: number;
  goalsAgainst: number;
  form: string; // "WWDLW"
};

export async function getLeagueStandings(
  season = currentSeason()
): Promise<{ chelsea: NormalizedStanding | null; table: NormalizedStanding[]; citation: string }> {
  const path = `/standings?league=${PREMIER_LEAGUE_ID}&season=${season}`;
  const key = `standings:${season}`;
  const cached = await getCache<{ chelsea: NormalizedStanding | null; table: NormalizedStanding[]; citation: string }>(key);
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
  const chelsea = table.find((t) => /chelsea/i.test(t.team)) || null;
  const data = { chelsea, table, citation: `${BASE}${path}` };
  await setCache(key, data, 60 * 60 * 1000);
  return data;
}

// ---------- Team season statistics ----------

export type NormalizedTeamStats = {
  season: number;
  form: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number;
  avgGoalsFor: string;
  citation: string;
};

export async function getChelseaSeasonStats(
  season = currentSeason()
): Promise<NormalizedTeamStats> {
  const path = `/teams/statistics?league=${PREMIER_LEAGUE_ID}&season=${season}&team=${CHELSEA_TEAM_ID}`;
  const key = `teamstats:${season}`;
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
}

// ---------- Fixture events (goal scorers etc.) ----------

export type NormalizedGoalEvent = {
  minute: number | null;
  player: string;
  assist: string | null;
  team: string;
  detail: string; // "Normal Goal" | "Penalty" | "Own Goal"
};

export async function getFixtureGoalEvents(
  fixtureId: number,
  opts?: { ttlMs?: number }
): Promise<{ goals: NormalizedGoalEvent[]; citation: string }> {
  const path = `/fixtures/events?fixture=${fixtureId}`;
  const key = `events:${fixtureId}`;
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
}

/** "Palmer 23'", "Jackson 58' (P)" — ready for the score card. */
export function formatScorers(goals: NormalizedGoalEvent[], teamFilter?: string): string[] {
  return goals
    .filter((g) => !teamFilter || g.team === teamFilter)
    .map((g) => {
      const pen = /penalty/i.test(g.detail) ? " (P)" : "";
      const og = /own goal/i.test(g.detail) ? " (OG)" : "";
      const lastName = g.player.split(" ").slice(-1)[0] || g.player;
      return `${lastName} ${g.minute ?? "?"}'${pen}${og}`;
    });
}

// ---------- Squad top performers ----------

export type NormalizedTopPlayer = {
  player: string;
  position: string;
  appearances: number;
  goals: number;
  assists: number;
  minutes: number;
  rating: string | null;
};

export async function getChelseaTopPerformers(
  season = currentSeason()
): Promise<{ players: NormalizedTopPlayer[]; citation: string }> {
  const key = `topperformers:${season}`;
  const cached = await getCache<{ players: NormalizedTopPlayer[]; citation: string }>(key);
  if (cached) return cached;

  const players: NormalizedTopPlayer[] = [];
  let citation = "";
  // Squad spans ~3 pages of the /players endpoint.
  for (let page = 1; page <= 3; page++) {
    const path = `/players?team=${CHELSEA_TEAM_ID}&season=${season}&page=${page}`;
    citation = `${BASE}${path}`;
    const json = await af<any>(path);
    const rows: any[] = json.response || [];
    for (const row of rows) {
      // Prefer the Premier League stat line; fall back to the first.
      const s =
        (row.statistics || []).find((st: any) => st?.league?.id === PREMIER_LEAGUE_ID) ||
        (row.statistics || [])[0] ||
        {};
      players.push({
        player: row?.player?.name || "",
        position: s?.games?.position || "",
        appearances: s?.games?.appearences ?? 0,
        goals: s?.goals?.total ?? 0,
        assists: s?.goals?.assists ?? 0,
        minutes: s?.games?.minutes ?? 0,
        rating: s?.games?.rating ? Number(s.games.rating).toFixed(2) : null,
      });
    }
    if (rows.length < 20) break; // last page
  }
  players.sort((a, b) => b.goals * 2 + b.assists - (a.goals * 2 + a.assists));
  const data = { players, citation };
  await setCache(key, data, 12 * 60 * 60 * 1000);
  return data;
}
