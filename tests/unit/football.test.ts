/**
 * Pure-logic tests for the football helpers (no network).
 * Run: tsx tests/unit/football.test.ts
 */
import {
  currentSeason,
  seasonLabel,
  formatScorers,
} from "../../packages/tools/football";

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

if (failures) {
  console.error(`\n${failures} football test(s) failed`);
  process.exit(1);
}
console.log("\nAll football tests passed");
