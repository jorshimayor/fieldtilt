/**
 * Card template tests — pure SVG string assertions, no wasm required.
 * Run: tsx tests/unit/render.test.ts
 */
import {
  matchPreviewCard,
  scoreCard,
  postMatchCard,
  playerStatCard,
  transferCard,
  formCard,
  esc,
  CARD_W,
  CARD_H,
} from "../../packages/render/cards";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

console.log("esc()");
check("escapes XML entities", esc(`<&>"'`) === "&lt;&amp;&gt;&quot;&apos;");
check("stringifies non-strings", esc(3) === "3" && esc(null) === "");

console.log("matchPreviewCard");
{
  const svg = matchPreviewCard({
    home: "Chelsea",
    away: "Arsenal <FC> & Co",
    competition: "Premier League",
    dateLabel: "Sat 12 Jul, 16:00 WAT",
    venue: "Stamford Bridge",
  });
  check("is an svg with the right canvas", svg.startsWith("<svg") && svg.includes(`viewBox="0 0 ${CARD_W} ${CARD_H}"`));
  check("contains both teams", svg.includes("Chelsea") && svg.includes("Arsenal"));
  check("escapes injected markup", !svg.includes("<FC>") && svg.includes("&lt;FC&gt;"));
  check("shows kickoff", svg.includes("16:00"));
}

console.log("scoreCard");
{
  const svg = scoreCard({
    home: "Chelsea",
    away: "Arsenal",
    homeGoals: 2,
    awayGoals: 1,
    competition: "Premier League",
    statusLabel: "LIVE 78'",
    scorers: ["Palmer 23'"],
  });
  check("shows the scoreline", svg.includes("2 - 1"));
  check("shows LIVE badge", svg.includes("LIVE 78"));
  check("lists scorers", svg.includes("Palmer 23"));
}

console.log("postMatchCard");
{
  const svg = postMatchCard({
    home: "Chelsea",
    away: "Arsenal",
    homeGoals: 2,
    awayGoals: 1,
    competition: "Premier League",
    statusLabel: "FULL TIME",
    stats: { possession: 54, xg: 2.31, shotsTotal: 15, shotsOnTarget: 7 },
  });
  check("shows FT stats", svg.includes("54%") && svg.includes("2.31") && svg.includes("7 / 15"));
  const empty = postMatchCard({
    home: "A",
    away: "B",
    homeGoals: 0,
    awayGoals: 0,
    competition: "",
    statusLabel: "FULL TIME",
    stats: {},
  });
  check("handles missing stats gracefully", empty.includes("Stats unavailable"));
}

console.log("playerStatCard");
{
  const svg = playerStatCard({
    player: "Cole Palmer",
    season: "2025/26",
    stats: [
      { label: "Goals", value: "18" },
      { label: "Assists", value: "12" },
    ],
  });
  check("shows player + season", svg.includes("Cole Palmer") && svg.includes("2025/26"));
  check("renders stat tiles", svg.includes("18") && svg.includes("GOALS"));
}

console.log("transferCard");
{
  const svgIn = transferCard({
    player: "Estêvão",
    direction: "in",
    counterparty: "Palmeiras",
    transferType: "€ 45M",
  });
  check("incoming badge", svgIn.includes("INCOMING"));
  check("shows both clubs", svgIn.includes("Palmeiras") && svgIn.includes("Chelsea"));
  const svgOut = transferCard({ player: "X", direction: "out", counterparty: "Milan" });
  check("outgoing badge", svgOut.includes("OUTGOING"));
}

console.log("formCard");
{
  const svg = formCard({
    seasonLabel: "2025/26",
    results: [
      { opponent: "Arsenal", score: "2-1", outcome: "W" },
      { opponent: "Brighton", score: "1-1", outcome: "D" },
    ],
    position: 3,
    points: 61,
    goalsFor: 58,
    goalsAgainst: 31,
  });
  check("form pills present", svg.includes("RECENT FORM"));
  check("league tiles present", svg.includes("#3") && svg.includes("61") && svg.includes("LEAGUE POSITION"));
}

if (failures) {
  console.error(`\n${failures} render test(s) failed`);
  process.exit(1);
}
console.log("\nAll render tests passed");
