/**
 * Football data facade — the only module crons/routes import from.
 * Club-agnostic: the tracked club comes from @shared/club (env CLUB).
 *
 * Delegates to whichever provider is configured, so the cost tiers are an
 * env-var switch, not a rewrite:
 *
 *   FOOTBALL_PROVIDER=football-data  (or just set FOOTBALL_DATA_KEY)  → $0
 *   FOOTBALL_PROVIDER=api-football   (or just set API_FOOTBALL_KEY)   → Pro
 *
 * When both keys exist, API-Football wins (it's the richer source) unless
 * FOOTBALL_PROVIDER says otherwise. See packages/tools/types.ts for the
 * contract and docs/COSTS.md for the tier trade-offs.
 */

import { env } from "@shared/env";
import { club } from "@shared/club";
import { FootballProvider, ProviderName, NormalizedGoalEvent } from "./types";
import { apiFootballProvider } from "./providers/api-football";
import { footballDataProvider } from "./providers/football-data";

export * from "./types";
export { club } from "@shared/club";

export function activeProviderName(): ProviderName {
  const explicit = env.FOOTBALL_PROVIDER;
  if (explicit === "api-football" || explicit === "football-data") return explicit;
  if (env.API_FOOTBALL_KEY) return "api-football";
  if (env.FOOTBALL_DATA_KEY) return "football-data";
  return "api-football";
}

export function provider(): FootballProvider {
  return activeProviderName() === "football-data" ? footballDataProvider : apiFootballProvider;
}

// ---------- season helpers (provider-independent) ----------

/** Season = starting year (2025 = the 2025/26 season); rolls over in July. */
export function currentSeason(now = new Date()): number {
  const y = now.getUTCFullYear();
  return now.getUTCMonth() >= 6 ? y : y - 1;
}

export function seasonLabel(season = currentSeason()): string {
  return `${season}/${String((season + 1) % 100).padStart(2, "0")}`;
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

// ---------- delegating API (same names the crons always used) ----------

export const getTeamFixtures: FootballProvider["getFixtures"] = (opts) =>
  provider().getFixtures(opts);

export const getFixtureById: FootballProvider["getFixtureById"] = (id) =>
  provider().getFixtureById(id);

export const getLiveTeamMatch: FootballProvider["getLiveMatch"] = () =>
  provider().getLiveMatch();

export const getMatchStats: FootballProvider["getMatchStats"] = (fixtureId) =>
  provider().getMatchStats(fixtureId);

export const getFixtureGoalEvents: FootballProvider["getGoalEvents"] = (fixtureId, opts) =>
  provider().getGoalEvents(fixtureId, opts);

export const getTeamTransfers: FootballProvider["getTransfers"] = (opts) =>
  provider().getTransfers(opts);

export const getLeagueStandings: FootballProvider["getStandings"] = (season) =>
  provider().getStandings(season);

export const getTeamSeasonStats: FootballProvider["getSeasonStats"] = (season) =>
  provider().getSeasonStats(season);

export const getTeamTopPerformers: FootballProvider["getTopPerformers"] = (season) =>
  provider().getTopPerformers(season);

export const getHeadToHead: FootballProvider["getHeadToHead"] = (ref) =>
  provider().getHeadToHead(ref);
