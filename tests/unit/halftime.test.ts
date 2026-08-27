/**
 * Half-time burst planner tests — pure specs, no LLM/network/wasm.
 * Run: tsx tests/unit/halftime.test.ts
 */
import { halftimePlan, pickClubScorer, HalftimeContext } from "../../packages/agent/halftime";

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
