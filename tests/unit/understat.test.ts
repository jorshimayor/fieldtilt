/**
 * Understat parser tests — pure string/JSON logic, no network.
 * Run: tsx tests/unit/understat.test.ts
 */
import {
  parseUnderstatVar,
  mapUnderstatPlayer,
  mapUnderstatTeams,
} from "../../packages/tools/understat";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("parseUnderstatVar()");
{
  // \x7B = "{", \x22 = '"', \x7D = "}" — how Understat escapes its payloads.
  const html = `<script>
    var playersData = JSON.parse('\\x7B\\x22id\\x22:\\x221\\x22,\\x22player_name\\x22:\\x22Cole Palmer\\x22\\x7D');
  </script>`;
  const parsed = parseUnderstatVar(html, "playersData") as any;
  check("decodes hex-escaped JSON.parse payload", parsed?.player_name === "Cole Palmer");
  check("missing var → null", parseUnderstatVar(html, "teamsData") === null);
  check("broken payload → null", parseUnderstatVar(`var x = JSON.parse('\\x7Bnope')`, "x") === null);
}

console.log("mapUnderstatPlayer()");
{
  const p = mapUnderstatPlayer({
    player_name: "Cole Palmer",
    position: "AM S",
    games: "30",
    time: "2700",
    goals: "14",
    xG: "10.4567",
    npg: "10",
    npxG: "7.2111",
    assists: "8",
    xA: "6.789",
    shots: "90",
    key_passes: "60",
    xGChain: "15.5",
    xGBuildup: "5.25",
  });
  check("parses numeric strings", p.goals === 14 && p.minutes === 2700 && p.shots === 90);
  check("rounds xG metrics to 2dp", p.xG === 10.46 && p.xA === 6.79 && p.npxG === 7.21);
  check("computes per-90 rates", p.per90.xG === 0.35 && p.per90.shots === 3);
  const zero = mapUnderstatPlayer({ player_name: "Bench Guy", time: "0", xG: "0" });
  check("zero minutes → zero per-90 (no divide-by-zero)", zero.per90.xG === 0);
}

console.log("mapUnderstatTeams()");
{
  const rows = mapUnderstatTeams({
    "80": {
      title: "Chelsea",
      history: [
        { xG: "2.1", xGA: "0.8", npxG: "1.9", npxGA: "0.8", xpts: "2.4" },
        { xG: "1.4", xGA: "1.2", npxG: "1.4", npxGA: "1.2", xpts: "1.5" },
      ],
    },
    "83": { title: "Arsenal", history: [{ xG: "3.0", xGA: "0.5", npxG: "3.0", npxGA: "0.5", xpts: "2.9" }] },
  });
  check("sums per-match history", rows.find((r) => r.team === "Chelsea")?.xG === 3.5);
  check("counts matches", rows.find((r) => r.team === "Chelsea")?.matches === 2);
  check("sorted by xG desc", rows[0].team === "Chelsea");
  check("xPts summed", rows.find((r) => r.team === "Chelsea")?.xPts === 3.9);
}

if (failures) {
  console.error(`\n${failures} understat test(s) failed`);
  process.exit(1);
}
console.log("\nAll understat tests passed");
