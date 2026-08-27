import assert from "node:assert";
import { normalizeTweet, buildTweetMessages } from "../../packages/shared/tweet-prompts";

// 1. Appends missing suffix
{
  const out = normalizeTweet("Palmer is cooking tonight.");
  assert.ok(out.endsWith("#CFC 💙"), `missing suffix in: ${out}`);
}

// 2. SKIP passes through empty
{
  const out = normalizeTweet("SKIP");
  assert.strictEqual(out, "");
}

// 3. Enforces 280-char cap while preserving suffix
{
  const long = "Chelsea ".repeat(60);
  const out = normalizeTweet(long);
  assert.ok(out.length <= 280, `too long: ${out.length}`);
  assert.ok(out.endsWith("#CFC 💙"), `suffix stripped: ${out}`);
}

// 4. Strips wrapping quotes
{
  const out = normalizeTweet('"Elite winger." ');
  assert.ok(!out.startsWith('"'), out);
}

// 5. Builds messages with correct roles
{
  const msgs = buildTweetMessages("match_preview", "professional", {
    opponent: "Arsenal",
    competition: "PL",
    date: "Sat 3 PM",
    venue: "Stamford Bridge",
  });
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, "system");
  assert.ok(msgs[0].content.includes("MATCH PREVIEW"));
  assert.ok(msgs[1].content.includes("Arsenal"));
}

// 6. Savage tone still hard-limits banter topics in system prompt
{
  const msgs = buildTweetMessages("post_match", "savage", { score: "3-0" });
  assert.ok(msgs[0].content.includes("Never cruel"));
  assert.ok(msgs[0].content.includes("#CFC 💙"));
}

console.log("ok tweet-prompts");

// ---- catch-all facts reach the writer (operator-supplied metrics) ----
import { buildTweetMessages } from "../../packages/shared/tweet-prompts";
const msgs = buildTweetMessages("player_stat", "professional", {
  player: "Valentino Barco",
  season: "2026/27",
  rating: "8.5",
  touches: 119,
  passesIntoFinalThird: "30/34",
  source: "Sofascore",
});
assert.ok(msgs[1].content.includes("touches: 119") && msgs[1].content.includes("rating: 8.5") && msgs[1].content.includes("Sofascore"), "extra metrics appended to user msg");
console.log("  ✓ extra metrics appended to user msg");
