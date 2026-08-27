/**
 * Positional-metrics + cross-league adjustment tests (pure, no DB).
 * Run: tsx tests/unit/positional.test.ts
 */
import { validateImport, PACKS } from "../../packages/tools/positional";
import { adjustPer90, leagueCoefficient } from "../../packages/shared/league-adjust";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`); }
}

console.log("validateImport()");
const good = validateImport({
  player: "  Moises Caicedo ",
  url: "https://fbref.com/en/players/16264a81/Moises-Caicedo",
  scout: [
    { stat: "Aerials Won", per90: "1.55", percentile: "77" },
    { stat: "", per90: "1", percentile: "1" },
    { stat: "Tackles", per90: "3.1", percentile: "94" },
  ],
  career: [
    { season: "2021-2022", squad: "Brighton", comp: "Premier League", minutes: "980", goals: "1", assists: "1" },
    { season: "header", squad: "", comp: "", minutes: "", goals: "", assists: "" },
  ],
});
check("trims player", good.player === "Moises Caicedo");
check("drops empty scout rows", good.scout.length === 2);
check("drops non-season career rows", good.career.length === 1 && good.career[0].squad === "Brighton");
check("stamps asOf", /^\d{4}-\d{2}-\d{2}$/.test(good.asOf));

let threw = "";
try { validateImport({ player: "X", url: "https://evil.com/x", scout: [{ stat: "A", per90: "1", percentile: "1" }] }); } catch (e) { threw = String(e); }
check("rejects non-fbref url", threw.includes("fbref.com"));
threw = "";
try { validateImport({ player: "X", url: "https://fbref.com/en/players/x", scout: [], career: [] }); } catch (e) { threw = String(e); }
check("rejects empty payload", threw.includes("no scout or career rows"));

check("packs cover the roadmap metrics", PACKS.defender.includes("Aerials Won") && PACKS.defender.includes("Errors") && PACKS.midfielder.includes("Dispossessed") && PACKS.midfielder.includes("Progressive Carries"));

console.log("league-adjust");
check("PL anchor is 1.0", leagueCoefficient("Premier League")?.coefficient === 1.0);
check("fuzzy league match", leagueCoefficient("Dutch Eredivisie")?.coefficient === 0.75);
const adj = adjustPer90(0.8, "Eredivisie");
check("adjusts and discloses", adj !== null && adj!.adjusted === 0.6 && adj!.footnote.includes("league-adj-v1"));
check("unknown league returns null", adjustPer90(0.8, "Ruritanian League") === null);

if (failures) process.exit(1);
console.log("All positional tests passed");
