/**
 * Half-time burst planner tests — pure specs, no LLM/network/wasm.
 * Run: tsx tests/unit/halftime.test.ts
 */
import { halftimePlan, pickClubScorer, HalftimeContext } from "../../packages/agent/bursts";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

const live = {
  fixtureId: 555,
  home: "Chelsea FC",
  away: "Arsenal FC",
  homeGoals: 1,
  awayGoals: 0,
  minute: 45,
  phase: "ht" as const,
  competition: "Premier League",
  citation: "football-data",
};
const goals = [
  { minute: 23, player: "Cole Palmer", assist: null, team: "Chelsea FC", detail: "Normal Goal" },
];
const performers = [
  { player: "Cole Palmer", playerId: 1, photoUrl: null, position: "M", appearances: 3, goals: 4, assists: 2, minutes: 270, rating: null },
  { player: "Joao Pedro", playerId: 2, photoUrl: null, position: "F", appearances: 3, goals: 2, assists: 1, minutes: 240, rating: null },
  { player: "Pedro Neto", playerId: 3, photoUrl: null, position: "F", appearances: 3, goals: 1, assists: 2, minutes: 210, rating: null },
];
const full: HalftimeContext = {
  live,
  goals,
  scorers: ["Palmer 23'"],
  standings: {
    team: { rank: 2, team: "Chelsea", points: 7, played: 3, win: 2, draw: 1, lose: 0, goalsFor: 7, goalsAgainst: 2, form: "WWD" },
    table: [],
  },
  lastFixtures: [
    { opponent: "Fulham", goalsHome: 2, goalsAway: 0, outcome: "W" },
    { opponent: "West Ham", goalsHome: 5, goalsAway: 1, outcome: "W" },
  ],
  performers,
  h2h: { wins: 4, draws: 3, losses: 3, played: 10, summary: "W4 D3 L3 in the last 10", citation: "" },
  seasonLbl: "2025/26",
};

console.log("halftimePlan()");
const plan = halftimePlan(full);
const slots = plan.map((s) => s.slot);
check("at least 5 posts (6 when fully grounded)", plan.length >= 6);
check("one lost source still leaves 5", halftimePlan({ ...full, h2h: null }).length >= 5);
check("slots: score, scorer, h2h, table, board", ["ht_score", "scorer_spotlight", "h2h_history", "table_stakes", "scorer_board"].every((s) => slots.includes(s)));
check("score card is HALF TIME on home kit", (plan[0].card?.data as any).statusLabel === "HALF TIME" && (plan[0].card?.data as any).palette === "home");
const spotlight = plan.find((s) => s.slot === "scorer_spotlight")!;
check("scorer spotlight names Palmer with wiki photo", (spotlight.card?.data as any).player === "Cole Palmer" && (spotlight.card?.data as any).photoWiki === "Cole Palmer");
check("scorer season stats merged", JSON.stringify(spotlight.card?.data).includes('"4"'));
const board = plan.find((s) => s.slot === "scorer_board")!;
check("leaderboard top scorer highlighted", (board.card?.data as any).entries[0].highlight === true && (board.card?.data as any).entries[0].label === "Cole Palmer");
check("every spec has a card", plan.every((s) => s.card));
check("no em/en dashes in any spec", !/[—–]/.test(JSON.stringify(plan)));

console.log("goalless variant");
const goalless = halftimePlan({ ...full, goals: [], scorers: [], live: { ...live, home: "Arsenal FC", away: "Chelsea FC", homeGoals: 0, awayGoals: 0 } });
const gslots = goalless.map((s) => s.slot);
check("goalless swaps spotlight for xg_watch", gslots.includes("xg_watch") && !gslots.includes("scorer_spotlight"));
check("away fixture gets away kit", (goalless[0].card?.data as any).palette === "away");
check("still at least 5 posts", goalless.length >= 5);

console.log("degraded data");
const bare = halftimePlan({ live, goals: [], scorers: [], seasonLbl: "2025/26" });
check("no data still ships >= 3 with backfill", bare.length >= 3 && bare.map((s) => s.slot).includes("second_half_watch"));

console.log("pickClubScorer()");
check("finds our last scorer", pickClubScorer(goals, "Chelsea")?.player === "Cole Palmer");
check("ignores opponent goals", pickClubScorer([{ minute: 12, player: "Saka", assist: null, team: "Arsenal FC", detail: "Normal Goal" }], "Chelsea") === null);

if (failures) process.exit(1);
console.log("All halftime tests passed");

// ---- full-time burst ----
import { fulltimePlan, computeStreaks, FulltimeContext } from "../../packages/agent/bursts";

const fx = (over: any = {}) => ({
  id: 900, date: "2026-08-30T13:00:00Z", competition: "Premier League", venue: "Stamford Bridge",
  home: "Chelsea FC", away: "Fulham FC", isHome: true, opponent: "Fulham", opponentId: 63,
  status: "FINISHED", goalsHome: 3, goalsAway: 0, outcome: "W" as const, ...over,
});
const lastTen = [
  fx(),
  fx({ id: 899, goalsHome: 2, goalsAway: 0, opponent: "West Ham" }),
  fx({ id: 898, goalsHome: 1, goalsAway: 0, opponent: "Everton" }),
  fx({ id: 897, goalsHome: 1, goalsAway: 1, outcome: "D", opponent: "Leeds" }),
  fx({ id: 896, goalsHome: 0, goalsAway: 2, outcome: "L", opponent: "Arsenal", isHome: true }),
];

console.log("computeStreaks()");
const st = computeStreaks(lastTen);
check("win run 3", st.winRun === 3);
check("unbeaten run 4", st.unbeatenRun === 4);
check("clean sheet run 3", st.cleanSheetRun === 3);
check("scoring run 4", st.scoringRun === 4);

console.log("fulltimePlan()");
const ftCtx: FulltimeContext = {
  fixture: fx(),
  goals: [
    { minute: 12, player: "Cole Palmer", assist: null, team: "Chelsea FC", detail: "Normal Goal" },
    { minute: 55, player: "Joao Pedro", assist: null, team: "Chelsea FC", detail: "Normal Goal" },
    { minute: 80, player: "Cole Palmer", assist: null, team: "Chelsea FC", detail: "Penalty" },
  ],
  scorers: ["Palmer 12'", "Pedro 55'", "Palmer 80' (P)"],
  standings: full.standings,
  lastFixtures: lastTen,
  performers,
  h2h: full.h2h,
  pointsProgression: {
    current: { season: "2026/27", points: 6, position: 2, played: 2 },
    past: [{ season: "2025/26", points: 4, position: 8, played: 2 }],
    note: "n",
  },
  nextFixture: fx({ id: 901, opponent: "Brentford", home: "Brentford FC", away: "Chelsea FC", isHome: false, outcome: null, goalsHome: null, goalsAway: null, status: "SCHEDULED" }),
  seasonLbl: "2026/27",
};
const ft = fulltimePlan(ftCtx);
const fslots = ft.map((s) => s.slot);
check("ft ships 8 slots when fully grounded", ft.length >= 8);
check("two scorers max, deduped", fslots.includes("scorer_1") && fslots.includes("scorer_2") && !fslots.includes("scorer_3"));
check("streak slot claims 3 straight wins", JSON.stringify(ft.find((s) => s.slot === "streak_history")).includes('"3"'));
check("biggest win detected (+3 > +2)", fslots.includes("biggest_win"));
check("league slots present", fslots.includes("table_after") && fslots.includes("season_start_compare"));
check("h2h + next up present", fslots.includes("h2h_ledger") && fslots.includes("next_up"));
check("combined HT+FT >= 10", plan.length + ft.length >= 10);
check("ft no dashes", !/[—–]/.test(JSON.stringify(ft)));

const cup = fulltimePlan({ ...ftCtx, fixture: fx({ competition: "EFL Cup" }), pointsProgression: null });
const cupSlots = cup.map((s) => s.slot);
check("cup drops league-table slots", !cupSlots.includes("table_after") && !cupSlots.includes("season_start_compare"));
check("cup still ships 5+", cup.length >= 5);

const loss = fulltimePlan({ ...ftCtx, fixture: fx({ goalsHome: 0, goalsAway: 1, outcome: "L" }), goals: [], scorers: [], lastFixtures: [fx({ goalsHome: 0, goalsAway: 1, outcome: "L" }), ...lastTen.slice(1)] });
check("loss: no streak/biggest-win/scorer slots", !loss.some((s) => ["streak_history", "biggest_win", "scorer_1"].includes(s.slot)));

if (failures) process.exit(1);
console.log("All burst tests passed");
