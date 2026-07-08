/**
 * Pure-logic tests for the football facade + providers (no network).
 * Run: tsx tests/unit/football.test.ts
 */
import {
  currentSeason,
  seasonLabel,
  formatScorers,
  activeProviderName,
} from "../../packages/tools/football";
import {
  mapFdMatch,
  mapFdPhase,
  mapFdStandingRow,
  mapFdGoals,
  mapFdScorer,
  teamStatsFromStanding,
  FD_CHELSEA_TEAM_ID,
} from "../../packages/tools/providers/football-data";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("currentSeason()");
check("May 2026 → 2025/26 season", currentSeason(new Date("2026-05-15T00:00:00Z")) === 2025);
check("July 2026 → 2026/27 season", currentSeason(new Date("2026-07-08T00:00:00Z")) === 2026);
check("Dec 2026 → 2026/27 season", currentSeason(new Date("2026-12-25T00:00:00Z")) === 2026);

console.log("seasonLabel()");
check("2025 → 2025/26", seasonLabel(2025) === "2025/26");
check("2029 → 2029/30", seasonLabel(2029) === "2029/30");

console.log("formatScorers()");
const goals = [
  { minute: 23, player: "Cole Palmer", assist: null, team: "Chelsea", detail: "Normal Goal" },
  { minute: 58, player: "Nicolas Jackson", assist: "Palmer", team: "Chelsea", detail: "Penalty" },
  { minute: 71, player: "Bukayo Saka", assist: null, team: "Arsenal", detail: "Normal Goal" },
];
const all = formatScorers(goals);
check("formats last name + minute", all[0] === "Palmer 23'");
check("marks penalties", all[1] === "Jackson 58' (P)");
check("team filter works", formatScorers(goals, "Chelsea").length === 2);

console.log("activeProviderName() — env-driven switching");
const penv = ((globalThis as any).process.env = (globalThis as any).process.env || {});
delete penv.FOOTBALL_PROVIDER;
delete penv.API_FOOTBALL_KEY;
delete penv.FOOTBALL_DATA_KEY;
check("defaults to api-football with no keys", activeProviderName() === "api-football");
penv.FOOTBALL_DATA_KEY = "x";
check("fd key alone → football-data", activeProviderName() === "football-data");
penv.API_FOOTBALL_KEY = "y";
check("both keys → api-football wins", activeProviderName() === "api-football");
penv.FOOTBALL_PROVIDER = "football-data";
check("explicit FOOTBALL_PROVIDER overrides", activeProviderName() === "football-data");
delete penv.FOOTBALL_PROVIDER;
delete penv.API_FOOTBALL_KEY;
delete penv.FOOTBALL_DATA_KEY;

console.log("football-data mappers");
const fdMatch = {
  id: 498034,
  utcDate: "2026-08-15T14:00:00Z",
  status: "FINISHED",
  venue: "Stamford Bridge",
  competition: { name: "Premier League" },
  homeTeam: { id: FD_CHELSEA_TEAM_ID, name: "Chelsea FC" },
  awayTeam: { id: 57, name: "Arsenal FC" },
  score: { fullTime: { home: 2, away: 1 } },
};
{
  const f = mapFdMatch(fdMatch);
  check("maps ids/teams", f.id === 498034 && f.home === "Chelsea FC" && f.opponent === "Arsenal FC");
  check("detects chelsea home + opponent id", f.isChelseaHome && f.opponentId === 57);
  check("scores + W outcome", f.goalsHome === 2 && f.goalsAway === 1 && f.outcome === "W");
  const loss = mapFdMatch({ ...fdMatch, score: { fullTime: { home: 0, away: 3 } } });
  check("L outcome", loss.outcome === "L");
  const upcoming = mapFdMatch({ ...fdMatch, status: "TIMED", score: { fullTime: { home: null, away: null } } });
  check("no outcome for scheduled", upcoming.outcome === null && upcoming.goalsHome === null);
}

check("phase IN_PLAY → live", mapFdPhase("IN_PLAY") === "live");
check("phase PAUSED → ht", mapFdPhase("PAUSED") === "ht");
check("phase FINISHED → finished", mapFdPhase("FINISHED") === "finished");
check("phase TIMED → pre", mapFdPhase("TIMED") === "pre");
check("phase POSTPONED → other", mapFdPhase("POSTPONED") === "other");

{
  const row = mapFdStandingRow({
    position: 3,
    team: { id: FD_CHELSEA_TEAM_ID, name: "Chelsea FC" },
    playedGames: 31,
    won: 18,
    draw: 7,
    lost: 6,
    points: 61,
    goalsFor: 58,
    goalsAgainst: 31,
    form: "W,W,D,L,W",
  });
  check("standing row maps", row.rank === 3 && row.points === 61 && row.form === "WWDLW");
  const ts = teamStatsFromStanding(2026, row, "cite");
  check("season stats derived from standing", ts.wins === 18 && ts.avgGoalsFor === "1.87" && ts.cleanSheets === null);
}

{
  const mapped = mapFdGoals([
    { minute: 23, scorer: { name: "Cole Palmer" }, assist: null, team: { name: "Chelsea FC" }, type: "REGULAR" },
    { minute: 58, scorer: { name: "Nicolas Jackson" }, assist: { name: "Palmer" }, team: { name: "Chelsea FC" }, type: "PENALTY" },
  ]);
  check("fd goals map to normalized events", mapped[0].player === "Cole Palmer" && mapped[1].detail === "Penalty");
  check("fd goals feed formatScorers", formatScorers(mapped)[1] === "Jackson 58' (P)");
}

{
  const p = mapFdScorer({
    player: { id: 129, name: "Cole Palmer", position: "Midfield" },
    team: { id: FD_CHELSEA_TEAM_ID },
    playedMatches: 34,
    goals: 18,
    assists: 12,
  });
  check("fd scorer maps", p.player === "Cole Palmer" && p.goals === 18 && p.assists === 12);
  check("fd scorer has no photo/rating (free tier)", p.photoUrl === null && p.rating === null);
}

if (failures) {
  console.error(`\n${failures} football test(s) failed`);
  process.exit(1);
}
console.log("\nAll football tests passed");
