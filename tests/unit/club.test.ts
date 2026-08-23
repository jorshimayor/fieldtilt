/**
 * Club configuration tests — the module that makes this club-agnostic.
 * Run: tsx tests/unit/club.test.ts
 */
import { club, validateClub, listPresets } from "../../packages/shared/club";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`); }
}

const penv = ((globalThis as any).process.env = (globalThis as any).process.env || {});

console.log("club() resolution");
delete penv.CLUB;
check("defaults to chelsea", club().slug === "chelsea" && club().ids.apiFootball === 49);
check("chelsea maps all three providers", club().ids.footballData === 61 && club().ids.understat === "Chelsea");
check("league mapped for all providers", club().league.footballData === "PL" && club().league.understat === "EPL");

penv.CLUB = "strasbourg";
check("preset switch by env", club().slug === "strasbourg" && club().league.name === "Ligue 1");
check("strasbourg is fully mapped", club().ids.understat === "Strasbourg" && club().league.footballData === "FL1");

penv.CLUB = JSON.stringify({ name: "Arsenal", fullName: "Arsenal FC", slug: "arsenal", hashtag: "#AFC", emoji: "🔴",
  ids: { apiFootball: 42, footballData: 57, understat: "Arsenal" },
  league: { name: "Premier League", apiFootball: 39, footballData: "PL", understat: "EPL" } });
check("arbitrary club via JSON env", club().slug === "arsenal" && club().hashtag === "#AFC");
check("json club inherits defaults for optional fields", Boolean(club().homeHook));

penv.CLUB = "not-a-real-preset";
check("unknown preset falls back to chelsea", club().slug === "chelsea");
penv.CLUB = "{broken json";
check("broken json falls back to chelsea", club().slug === "chelsea");
delete penv.CLUB;

console.log("validateClub()");
let threw = false;
try { validateClub({ ...club(), slug: "BAD SLUG" } as any); } catch { threw = true; }
check("rejects invalid slug", threw);
check("presets listed", listPresets().includes("chelsea") && listPresets().includes("strasbourg"));

if (failures) { console.error(`\n${failures} club test(s) failed`); process.exit(1); }
console.log("\nAll club tests passed");
