/**
 * Provider-agnostic football data contract.
 *
 * The crons and cards only ever see these shapes. Each data source
 * (providers/api-football.ts, providers/football-data.ts) maps its own API
 * into them, which is what makes the cost tiers a config switch:
 *
 *   $0/mo   FOOTBALL_DATA_KEY      → football-data.org (no live stats/xG)
 *   $19/mo  API_FOOTBALL_KEY       → API-Football Pro (everything)
 *
 * IDs (fixture/team/player) are provider-scoped — never mix ids across
 * providers. Cache keys are prefixed per provider for the same reason.
 */

export type ProviderName = "api-football" | "football-data";

export type NormalizedFixture = {
  id: number;
  date: string; // ISO
  competition: string;
  venue: string;
  home: string;
  away: string;
  isChelseaHome: boolean;
  opponent: string;
  opponentId: number | null;
  status: string; // provider-native short status, informational only
  goalsHome: number | null;
  goalsAway: number | null;
  /** Chelsea's result, only set for finished fixtures. */
  outcome: "W" | "D" | "L" | null;
};

export type MatchPhase = "pre" | "live" | "ht" | "finished" | "other";

export type NormalizedLiveMatch = {
  fixtureId: number;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
  minute: number | null; // null when the provider doesn't expose it
  phase: MatchPhase;
  competition: string;
  citation: string;
};

export type NormalizedMatchStats = {
  fixtureId: number;
  team: "home" | "away" | "unknown";
  possession: number | null;
  shotsTotal: number | null;
  shotsOnTarget: number | null;
  corners: number | null;
  fouls: number | null;
  xg: number | null;
  passAccuracy: number | null;
  citation: string;
};

export type NormalizedGoalEvent = {
  minute: number | null;
  player: string;
  assist: string | null;
  team: string;
  detail: string; // "Normal Goal" | "Penalty" | "Own Goal"
};

export type NormalizedTransfer = {
  player: string;
  playerId: number;
  date: string;
  direction: "in" | "out";
  counterparty: string;
  type: string; // "€ 40M" | "Loan" | "Free" | "N/A"
};

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

export type NormalizedTeamStats = {
  season: number;
  form: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  cleanSheets: number | null;
  avgGoalsFor: string;
  citation: string;
};

export type NormalizedTopPlayer = {
  player: string;
  playerId: number;
  photoUrl: string | null;
  position: string;
  appearances: number;
  goals: number;
  assists: number;
  minutes: number | null;
  rating: string | null;
};

export type HeadToHead = {
  wins: number;
  draws: number;
  losses: number;
  played: number;
  summary: string; // "W4 D3 L3 in the last 10"
  citation: string;
};

/** What a provider can actually deliver — crons degrade gracefully off this. */
export type ProviderCapabilities = {
  liveMinute: boolean;
  liveStats: boolean; // possession/shots during play
  xg: boolean;
  transfers: boolean;
  playerPhotos: boolean;
};

export interface FootballProvider {
  name: ProviderName;
  capabilities: ProviderCapabilities;

  getFixtures(opts: { next?: number; last?: number; season?: number }): Promise<{
    fixtures: NormalizedFixture[];
    citation: string;
  }>;
  /** The fixture by provider-native id (used to catch full-time after the live feed empties). */
  getFixtureById(id: number): Promise<NormalizedFixture | null>;
  /** Chelsea's match currently in play, if any. */
  getLiveMatch(): Promise<NormalizedLiveMatch | null>;
  getMatchStats(fixtureId: number): Promise<NormalizedMatchStats>;
  getGoalEvents(
    fixtureId: number,
    opts?: { ttlMs?: number }
  ): Promise<{ goals: NormalizedGoalEvent[]; citation: string }>;
  getTransfers(opts?: { sinceDays?: number }): Promise<{
    transfers: NormalizedTransfer[];
    citation: string;
    supported: boolean;
  }>;
  getStandings(season: number): Promise<{
    chelsea: NormalizedStanding | null;
    table: NormalizedStanding[];
    citation: string;
  }>;
  getSeasonStats(season: number): Promise<NormalizedTeamStats>;
  getTopPerformers(season: number): Promise<{
    players: NormalizedTopPlayer[];
    citation: string;
  }>;
  getHeadToHead(ref: { opponentId?: number | null; fixtureId?: number }): Promise<HeadToHead>;
}
