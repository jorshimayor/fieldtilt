/**
 * Historic league standings — "points on the table vs the last N seasons".
 *
 * football-data.org v4 supports standings?season=YYYY&matchday=N on the
 * free tier, so we can compare the club's CURRENT points/rank with where it
 * stood after the same number of games in past seasons. football-data
 * specific (the API-Football provider path can grow its own later).
 */

import { club } from "../shared/club";
import { getCache, setCache } from "./cache";

type SeasonPoint = { season: string; points: number; position: number; played: number };

const env = () => (globalThis as any).process?.env || {};

async function fdStandingsAt(season: number, matchday?: number): Promise<SeasonPoint | null> {
  const code = club().league.footballData;
  const teamId = club().ids.footballData;
  const md = matchday ? `&matchday=${matchday}` : "";
  const key = `hist:standings:${code}:${season}:${matchday ?? "now"}`;
  const cached = await getCache<SeasonPoint>(key);
  if (cached) return cached;
  const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/standings?season=${season}${md}`, {
    headers: { "X-Auth-Token": env().FOOTBALL_DATA_KEY || "" },
  });
  if (!res.ok) return null;
  const j = (await res.json()) as any;
  const table: any[] = j?.standings?.find((s: any) => s.type === "TOTAL")?.table || j?.standings?.[0]?.table || [];
  const row = table.find((t) => t?.team?.id === teamId);
  if (!row) return null;
  const point: SeasonPoint = {
    season: `${season}/${String((season + 1) % 100).padStart(2, "0")}`,
    points: row.points ?? 0,
    position: row.position ?? 0,
    played: row.playedGames ?? 0,
  };
  // Past-season snapshots never change; current season changes weekly.
  await setCache(key, point, matchday ? 30 * 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
  return point;
}

/**
 * Current points/rank plus the same-matchday snapshot for the last N
 * seasons. Feeds "best/worst start since ..." posts and a leaderboard or
 * comparison card of season starts.
 */
export async function getPointsVsPastSeasons(
  count = 3
): Promise<{ current: SeasonPoint; past: SeasonPoint[]; note: string } | { error: string }> {
  const n = Math.max(1, Math.min(count, 4));
  const thisSeason = (() => {
    const now = new Date();
    return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
  })();
  const current = await fdStandingsAt(thisSeason);
  if (!current) return { error: "current standings unavailable" };
  if (!current.played) return { error: "season has not started (0 games played)" };
  const past = (
    await Promise.all(
      Array.from({ length: n }, (_, i) => fdStandingsAt(thisSeason - 1 - i, current.played).catch(() => null))
    )
  ).filter(Boolean) as SeasonPoint[];
  return {
    current,
    past,
    note: `points and position after ${current.played} league game(s), this season vs the same stage of past seasons (source: football-data)`,
  };
}
