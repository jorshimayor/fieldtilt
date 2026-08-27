/**
 * Understat advanced stats — free xG-layer for arguments and player profiling.
 *
 * Understat (understat.com) publishes xG models for the top-5 leagues but has
 * no official API. Its site loads data from internal JSON endpoints
 * (`/getTeamData/{team}/{season}`, `/getLeagueData/{league}/{season}`) when
 * called with XHR headers — we use those, with the legacy embedded-HTML
 * format (`var playersData = JSON.parse('\x7B…')`) as a fallback. Two
 * requests per half-day at most, cached hard.
 *
 * HONEST CAVEATS (see docs/COSTS.md):
 *  - Unofficial source: endpoints can change without notice. Every entry
 *    point degrades to empty results, so tweets/cards simply omit xG then.
 *  - Keep volume low: cached 12h; never called from the 5-minute poller.
 *  - Numbers are Understat's xG model — cite "xG: Understat" in copy when used.
 *
 * Pure helpers (parseUnderstatVar, mapUnderstat*) are exported for unit tests.
 */

import { setCache, getCache } from "./cache";
import { club } from "@shared/club";

const BASE = "https://understat.com";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const TTL_MS = 12 * 60 * 60 * 1000;

// ------------------------------------------------------------------ types

export type AdvancedPlayerStats = {
  /** Understat player id — feeds getPlayerShots. */
  id?: string;
  player: string;
  position: string;
  matches: number;
  minutes: number;
  goals: number;
  xG: number;
  npg: number; // non-penalty goals
  npxG: number;
  assists: number;
  xA: number;
  shots: number;
  keyPasses: number;
  xGChain: number;
  xGBuildup: number;
  /** per-90 rates for the headline numbers */
  per90: { xG: number; xA: number; shots: number; keyPasses: number };
};

export type TeamXgRow = {
  team: string;
  matches: number;
  xG: number;
  xGA: number;
  npxG: number;
  npxGA: number;
  xPts: number;
};

// ------------------------------------------------------------------ parser

/**
 * Extract and decode `var <name> = JSON.parse('…')` from an Understat page.
 * The payload escapes non-ASCII as \xNN sequences.
 */
export function parseUnderstatVar(html: string, name: string): unknown | null {
  const re = new RegExp(`var\\s+${name}\\s*=\\s*JSON\\.parse\\('([^']+)'\\)`);
  const m = html.match(re);
  if (!m) return null;
  const decoded = m[1].replace(/\\x([0-9A-Fa-f]{2})/g, (_s, h) =>
    String.fromCharCode(parseInt(h, 16))
  );
  try {
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function num(v: unknown): number {
  const n = parseFloat(String(v ?? "0"));
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function mapUnderstatPlayer(r: any): AdvancedPlayerStats {
  const minutes = num(r?.time);
  const id = String(r?.id ?? "");
  const per90 = (v: number) => (minutes > 0 ? round2((v * 90) / minutes) : 0);
  const xG = num(r?.xG);
  const xA = num(r?.xA);
  const shots = num(r?.shots);
  const keyPasses = num(r?.key_passes);
  return {
    id,
    player: r?.player_name || "",
    position: r?.position || "",
    matches: num(r?.games),
    minutes,
    goals: num(r?.goals),
    xG: round2(xG),
    npg: num(r?.npg),
    npxG: round2(num(r?.npxG)),
    assists: num(r?.assists),
    xA: round2(xA),
    shots,
    keyPasses,
    xGChain: round2(num(r?.xGChain)),
    xGBuildup: round2(num(r?.xGBuildup)),
    per90: { xG: per90(xG), xA: per90(xA), shots: per90(shots), keyPasses: per90(keyPasses) },
  };
}

export function mapUnderstatTeams(teamsData: any): TeamXgRow[] {
  const rows: TeamXgRow[] = [];
  for (const key of Object.keys(teamsData || {})) {
    const t = teamsData[key];
    const history: any[] = Array.isArray(t?.history) ? t.history : [];
    const sum = (field: string) => round2(history.reduce((acc, h) => acc + num(h?.[field]), 0));
    rows.push({
      team: t?.title || key,
      matches: history.length,
      xG: sum("xG"),
      xGA: sum("xGA"),
      npxG: sum("npxG"),
      npxGA: sum("npxGA"),
      xPts: sum("xpts"),
    });
  }
  return rows.sort((a, b) => b.xG - a.xG);
}

// ------------------------------------------------------------------ fetchers

async function fetchJson(path: string, referer: string): Promise<any | null> {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      "User-Agent": UA,
      "X-Requested-With": "XMLHttpRequest",
      Referer: referer,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    console.error("understat_http_error", { path, status: res.status });
    return null;
  }
  return res.json().catch(() => null);
}

async function fetchPage(path: string): Promise<string | null> {
  const res = await fetch(`${BASE}${path}`, { headers: { "User-Agent": UA } });
  if (!res.ok) return null;
  return res.text();
}

/**
 * Tracked-club squad advanced stats for a season (Understat uses the start
 * year, same convention as our currentSeason()).
 */
export async function getTeamAdvancedStats(
  season: number
): Promise<{ players: AdvancedPlayerStats[]; source: string }> {
  const key = `understat:${club().slug}:${season}`;
  const cached = await getCache<{ players: AdvancedPlayerStats[]; source: string }>(key);
  if (cached) return cached;

  const source = `${BASE}/team/${club().ids.understat}/${season}`;
  let players: AdvancedPlayerStats[] = [];
  try {
    const json = await fetchJson(`/getTeamData/${club().ids.understat}/${season}`, source);
    let raw: any[] | null = Array.isArray(json?.players) ? json.players : null;
    if (!raw) {
      // Legacy fallback: data embedded in the page HTML.
      const html = await fetchPage(`/team/${club().ids.understat}/${season}`);
      const parsed = html ? parseUnderstatVar(html, "playersData") : null;
      raw = Array.isArray(parsed) ? parsed : null;
    }
    players = (raw || []).map(mapUnderstatPlayer).filter((p) => p.minutes > 0);
    players.sort((a, b) => b.xG + b.xA - (a.xG + a.xA));
  } catch (e) {
    console.error("understat_parse_error", { error: String(e) });
  }
  const data = { players, source };
  // Cache even empty results (site down / early season) to stay low-volume.
  await setCache(key, data, players.length ? TTL_MS : 60 * 60 * 1000);
  return data;
}

/** League-wide team xG table (for "only X have a better xGA"-style arguments). */
export async function getLeagueXgTable(
  season: number
): Promise<{ table: TeamXgRow[]; source: string }> {
  const key = `understat:${club().league.understat.toLowerCase()}:${season}`;
  const cached = await getCache<{ table: TeamXgRow[]; source: string }>(key);
  if (cached) return cached;

  const source = `${BASE}/league/${club().league.understat}/${season}`;
  let table: TeamXgRow[] = [];
  try {
    const json = await fetchJson(`/getLeagueData/${club().league.understat}/${season}`, source);
    let raw: unknown = json?.teams && typeof json.teams === "object" ? json.teams : null;
    if (!raw) {
      const html = await fetchPage(`/league/${club().league.understat}/${season}`);
      raw = html ? parseUnderstatVar(html, "teamsData") : null;
    }
    table = raw ? mapUnderstatTeams(raw) : [];
  } catch (e) {
    console.error("understat_parse_error", { error: String(e) });
  }
  const data = { table, source };
  await setCache(key, data, table.length ? TTL_MS : 60 * 60 * 1000);
  return data;
}

// ------------------------------------------------------------------ shots

export type UnderstatShot = {
  /** 0..1 along the pitch toward the goal being attacked. */
  x: number;
  /** 0..1 across the pitch. */
  y: number;
  xG: number;
  result: string; // Goal | SavedShot | MissedShots | BlockedShot | ShotOnPost | OwnGoal
  minute: number;
  situation: string;
  shotType: string;
  date: string;
};

export function mapUnderstatShot(r: any): UnderstatShot {
  return {
    x: Number(r?.X ?? 0),
    y: Number(r?.Y ?? 0),
    xG: Number(r?.xG ?? 0),
    result: String(r?.result ?? ""),
    minute: Number(r?.minute ?? 0),
    situation: String(r?.situation ?? ""),
    shotType: String(r?.shotType ?? ""),
    date: String(r?.date ?? "").slice(0, 10),
  };
}

/**
 * A player's shot map for a season — /getPlayerData/{id} carries the full
 * career shot list (X/Y/xG/result); we filter to the requested season.
 * Accepts a player name (resolved against the squad) or an Understat id.
 */
export async function getPlayerShots(
  playerNameOrId: string,
  season: number
): Promise<{ player: string; shots: UnderstatShot[]; summary: { shots: number; goals: number; xG: number }; source: string } | null> {
  let id = /^\d+$/.test(playerNameOrId.trim()) ? playerNameOrId.trim() : "";
  let playerName = playerNameOrId;
  if (!id) {
    const { players } = await getTeamAdvancedStats(season);
    const fold = (v: string) => v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const needle = fold(playerNameOrId);
    const hit =
      players.find((pl) => fold(pl.player).includes(needle)) ||
      players.find((pl) => fold(pl.player).includes(needle.split(/\s+/).pop() || needle));
    if (!hit?.id) return null;
    id = hit.id;
    playerName = hit.player;
  }
  const key = `understat:shots:${id}:${season}`;
  const cached = await getCache<any>(key);
  if (cached) return cached;

  const source = `${BASE}/player/${id}`;
  const json = await fetchJson(`/getPlayerData/${id}`, source);
  const raw: any[] = Array.isArray(json?.shots) ? json.shots : [];
  if (!raw.length && !json) return null;
  const name = json?.player?.name || playerName;
  const shots = raw.filter((r) => String(r?.season) === String(season)).map(mapUnderstatShot);
  const summary = {
    shots: shots.length,
    goals: shots.filter((sh) => sh.result === "Goal").length,
    xG: Math.round(shots.reduce((a, sh) => a + sh.xG, 0) * 100) / 100,
  };
  const data = { player: name, shots, summary, source };
  await setCache(key, data, shots.length ? TTL_MS : 60 * 60 * 1000);
  return data;
}
