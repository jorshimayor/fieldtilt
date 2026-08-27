/**
 * Grounded web-lookup parser tests — pure JSON-shape assertions.
 */
import { parseGroundedResponse } from "../../packages/tools/websearch";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}

const parsed = parseGroundedResponse({
  candidates: [{
    content: { parts: [{ text: "Chelsea play Luton on " }, { text: "Wednesday." }] },
    groundingMetadata: { groundingChunks: [
      { web: { uri: "https://g.co/a", title: "BBC Sport" } },
      { web: { uri: "https://g.co/a", title: "dup ignored" } },
      { web: { uri: "https://g.co/b", title: "Sky Sports" } },
    ]},
  }],
});
check("answer parts joined", parsed.answer === "Chelsea play Luton on Wednesday.");
check("sources deduped", parsed.sources.length === 2);
check("source titles kept", parsed.sourceTitles[0] === "BBC Sport");

const empty = parseGroundedResponse({});
check("empty response safe", empty.answer === "" && empty.sources.length === 0);

if (failures) { console.error(`${failures} websearch test(s) failed`); process.exit(1); }
console.log("All websearch tests passed");

// ---- DDG HTML parser ----
import { parseDdgHtml } from "../../packages/tools/websearch";
const ddg = parseDdgHtml(`
<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.chelseafc.com%2Fmatch&amp;rut=x">Chelsea v <b>Luton</b></a>
<a class="result__snippet" href="#">Carabao Cup second round at <b>Stamford Bridge</b>.</a>
`);
check("ddg link decoded", ddg[0]?.url === "https://www.chelseafc.com/match");
check("ddg title cleaned", ddg[0]?.title === "Chelsea v Luton");
check("ddg snippet cleaned", ddg[0]?.snippet.includes("Stamford Bridge"));
if (failures) process.exit(1);
console.log("All ddg tests passed");
