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
  editorialCard,
  esc,
  embedFontsInSvg,
  PORTRAIT,
  LANDSCAPE,
} from "../../packages/render/cards";
import { BRAND } from "../../packages/render/theme";

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

console.log("matchPreviewCard (landscape)");
{
  const svg = matchPreviewCard({
    home: "Chelsea",
    away: "Arsenal <FC> & Co",
    competition: "Premier League",
    dateLabel: "Sat 12 Jul, 16:00 WAT",
    venue: "Stamford Bridge",
    footnote: "H2H · W4 D3 L3 in the last 10",
  });
  check("landscape canvas", svg.includes(`viewBox="0 0 ${LANDSCAPE.w} ${LANDSCAPE.h}"`));
  check("contains both teams", svg.includes("CHELSEA") && svg.includes("ARSENAL"));
  check("escapes injected markup", !svg.includes("<FC>") && svg.includes("&lt;FC&gt;"));
  check("brand wordmark present", svg.includes(BRAND));
  check("H2H footnote present", svg.includes("H2H"));
  const withPhoto = matchPreviewCard({
    home: "Chelsea",
    away: "Arsenal",
    competition: "PL",
    dateLabel: "Sat",
    photoDataUri: "data:image/jpeg;base64,AAAA",
  });
  check("photo goes full-bleed with cinematic scrims", withPhoto.includes("<image") && withPhoto.includes("scrimY") && withPhoto.includes("scrimX"));
}

console.log("scoreCard (landscape)");
{
  const svg = scoreCard({
    home: "Chelsea",
    away: "Arsenal",
    homeGoals: 2,
    awayGoals: 1,
    competition: "Premier League",
    statusLabel: "LIVE 78'",
    scorers: ["Palmer 23'"],
    statLine: "54% possession · 1.8 xG",
  });
  check("shows the scoreline", svg.includes(">2-1</text>"));
  check("LIVE status shown", svg.includes("LIVE 78"));
  check("lists scorers", svg.includes("Palmer 23"));
  check("in-match stat line", svg.includes("54% POSSESSION"));
}

console.log("postMatchCard (portrait)");
{
  const svg = postMatchCard({
    home: "Chelsea",
    away: "Arsenal",
    homeGoals: 2,
    awayGoals: 1,
    competition: "Premier League",
    seasonLabel: "Premier League 25/26",
    statusLabel: "FULL TIME",
    stats: { possession: 54, xg: 2.31, shotsTotal: 15, shotsOnTarget: 7 },
  });
  check("portrait canvas", svg.includes(`viewBox="0 0 ${PORTRAIT.w} ${PORTRAIT.h}"`));
  check("hero stats", svg.includes("54%") && svg.includes("2.31"));
  check("stat rows", svg.includes("Shots") && svg.includes("On target"));
  check("season footer", svg.includes("PREMIER LEAGUE 25/26"));
}

console.log("playerStatCard (portrait)");
{
  const svg = playerStatCard({
    player: "Moises Caicedo",
    season: "2025/26",
    context: "vs Arsenal",
    stats: [
      { label: "Pass accuracy", value: "89%" },
      { label: "Passes into final third", value: "14" },
    ],
  });
  check("stacked name", svg.includes("MOISES") && svg.includes("CAICEDO"));
  check("stat rail values", svg.includes("89%") && svg.includes("14"));
  check("labels wrap + uppercase", svg.includes("PASSES INTO") && svg.includes("FINAL THIRD"));
  check("watermark when no photo", svg.includes('opacity="0.05"'));
  const enriched = playerStatCard({
    player: "Cole Palmer",
    season: "2025/26",
    stats: [{ label: "Goals", value: "18" }],
    formPills: ["W", "D", "L", "W", "W"],
    remark: "Underlying numbers say the goals are coming back soon.",
  });
  check("form pills render", enriched.includes("FORM · MOST RECENT FIRST"));
  // remark wraps across lines, so assert a fragment that stays intact
  check("remark renders italic", enriched.includes('font-style="italic"') && enriched.includes("Underlying numbers"));
  const withPhoto = playerStatCard({
    player: "X Y",
    season: "2025/26",
    stats: [],
    photoDataUri: "data:image/png;base64,AAAA",
  });
  check("photo goes full-bleed under scrim", withPhoto.includes("<image") && withPhoto.includes("slice"));
}

console.log("transferCard (portrait)");
{
  const svgIn = transferCard({
    player: "Estêvão Willian",
    direction: "in",
    counterparty: "Palmeiras",
    transferType: "€ 45M",
  });
  check("incoming tag", svgIn.includes("INCOMING"));
  check("from → to", svgIn.includes("Palmeiras") && svgIn.includes("Chelsea"));
  check("fee stat", svgIn.includes("€ 45M"));
  const svgOut = transferCard({ player: "X", direction: "out", counterparty: "Milan" });
  check("outgoing tag", svgOut.includes("OUTGOING"));
}

console.log("formCard (portrait)");
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
  check("FORM headline", svg.includes("FORM."));
  check("league tiles", svg.includes("#3") && svg.includes("LEAGUE POSITION"));
  check("result rows", svg.includes("Arsenal") && svg.includes("2-1"));
}

console.log("editorialCard (portrait)");
{
  const svg = editorialCard({
    eyebrow: "On this day",
    lines: [
      { text: "Two years ago today, Chelsea" },
      { text: "Estêvão Willian.", em: true },
    ],
    dateLabel: "2024, June 22.",
  });
  check("eyebrow kicker", svg.includes("ON THIS DAY"));
  check("emphasis is bold italic", svg.includes('font-style="italic"'));
  check("date label", svg.includes("2024, June 22."));
}

console.log("embedFontsInSvg()");
{
  const svg = `<svg width="10" height="10" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"></svg>`;
  const out = embedFontsInSvg(svg, [new Uint8Array([1, 2, 3])]);
  check("injects @font-face style", out.includes("@font-face") && out.includes("base64"));
  check("keeps svg root first", out.startsWith("<svg"));
}

if (failures) {
  console.error(`\n${failures} render test(s) failed`);
  process.exit(1);
}
console.log("\nAll render tests passed");

// ---- head-to-head card ----
import { headToHeadCard, betterOf } from "../../packages/render/cards";
import { clubAssets } from "../../packages/render/clubs";

check("betterOf: higher wins by default", betterOf({ a: 9, b: 7 }) === "a");
check("betterOf: lower wins when flagged", betterOf({ a: 47, b: 45, higherIsBetter: false }) === "b");
check("betterOf: tie is null", betterOf({ a: 35, b: 35 }) === null);
check("betterOf: NaN is null", betterOf({ a: Number.NaN, b: 1 }) === null);

const h2h = headToHeadCard({
  title: "New keeper. Same standard.",
  playerA: "Emiliano Martinez",
  playerB: "Robert Sanchez",
  roleA: "New signing",
  roleB: "Chelsea No. 1",
  metrics: [
    { label: "Clean sheets", a: 7, b: 9 },
    { label: "Goals conceded", a: 47, b: 45, higherIsBetter: false },
  ],
  careerA: [{ label: "Appearances", value: "228" }],
  careerB: [{ label: "Appearances", value: "171" }],
  tagline: "The battle for the No. 1 spot is on.",
});
check("h2h renders both names", h2h.includes("MARTINEZ") && h2h.includes("SANCHEZ"));
check("h2h renders metric labels", h2h.includes("CLEAN SHEETS") && h2h.includes("GOALS CONCEDED"));
check("h2h falls back to initials without photos", h2h.includes("EM") && h2h.includes("RS"));
check("h2h renders tagline", h2h.includes("THE BATTLE FOR THE NO. 1 SPOT IS ON."));
check("h2h no em/en dashes", !/[—–]/.test(h2h));

check("clubAssets resolves aliases", clubAssets("Man City")?.handle === "@ManCity");
check("clubAssets resolves fuzzy", clubAssets("Aston Villa FC")?.crestUrl.includes("/58.png") === true);
check("clubAssets unknown is null", clubAssets("Real Madrid") === null);

// ---- terminal palette ----
import { leaderboardCard } from "../../packages/render/cards";
const term = leaderboardCard({
  title: "Most xG per 90",
  entries: [{ value: "0.82", label: "Cole Palmer", highlight: true }],
  palette: "terminal" as any,
});
check("terminal uses mono type", term.includes("JetBrains Mono"));
check("terminal has scanlines + brackets", term.includes('url(#scan)') && term.includes('stroke="#3D6BFF"'));
check("terminal eyebrow is a snake_case prompt", /leaderboard|most_xg/.test(term));
const neutral = leaderboardCard({ title: "Most xG per 90", entries: [{ value: "0.82", label: "Cole Palmer" }] });
check("neutral still Montserrat, no scanlines", neutral.includes("Montserrat") && !neutral.includes("url(#scan)"));

if (failures) process.exit(1);
