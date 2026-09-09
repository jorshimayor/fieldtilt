import { readFileSync } from "node:fs";
import { parseRss, buildPostsFeed } from "../../packages/tools/rss";

let failures = 0;
function check(name: string, cond: boolean) {
  if (cond) console.log(`  ✓ ${name}`);
  else { failures++; console.error(`  ✗ ${name}`); }
}
const xml = readFileSync("tests/unit/fixtures-bbc-rss.xml", "utf8");
const items = parseRss(xml, 5);
check("parses items from a real BBC snapshot", items.length >= 1);
check("items carry title+link", items.every((i) => i.title.length > 3 && i.link.startsWith("http")));
check("no html tags leak into titles", items.every((i) => !/[<>]/.test(i.title)));

const feed = buildPostsFeed([{ content: "Hook line\n\nFact & detail", tweetId: "123", postedAt: new Date("2026-09-07") }]);
check("outbound feed is rss with escaped entities", feed.includes("<rss") && feed.includes("Fact &amp; detail") && feed.includes("status/123"));
if (failures) process.exit(1);
console.log("All rss tests passed");
