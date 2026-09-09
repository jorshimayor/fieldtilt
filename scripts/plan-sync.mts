/**
 * Sync the private planning files into Neon so the /plan page can serve
 * them behind ops auth WITHOUT the content ever entering the public repo
 * or worker bundle.
 *
 *   npx tsx scripts/plan-sync.mts
 *
 * Reads (git-ignored, local only):
 *   docs/private/SEASON_CALENDAR.md   -> statCache key "plan:season"
 *   docs/private/EDITORIAL_CALENDAR.md -> statCache key "plan:ledger"
 *
 * Re-run after editing either file; /plan reflects it on next load.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env", "utf8").split("\n")) {
  const i = line.indexOf("=");
  if (i > 0 && !line.startsWith("#")) process.env[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, "");
}

const { db } = await import("../packages/db/client.ts");
const { statCache } = await import("../packages/db/schema.ts");

// ---- season calendar: markdown table -> {header, rows} ----
const seasonMd = readFileSync("docs/private/SEASON_CALENDAR.md", "utf8");
const tableLines = seasonMd.split("\n").filter((l) => l.startsWith("| "));
const cells = (l: string) => l.split("|").slice(1, -1).map((c) => c.trim());
const header = cells(tableLines[0]);
const rows = tableLines.slice(2).map(cells).filter((r) => r.length === header.length && r[0]);
console.log(`season calendar: ${rows.length} weeks, ${header.length} columns`);

// ---- editorial calendar: W-block format -> [{week, date, deep, fast, ship}] ----
const edMd = readFileSync("docs/private/EDITORIAL_CALENDAR.md", "utf8");
const weeks: { week: number; date: string; deep: string; fast: string; ship: string }[] = [];
let cur: any = null;
for (const raw of edMd.split("\n")) {
  const w = raw.match(/^W(\d+)\s+\(([^)]+)\)\s+DEEP:\s*(.*)$/);
  if (w) {
    if (cur) weeks.push(cur);
    cur = { week: Number(w[1]), date: w[2], deep: w[3].trim(), fast: "", ship: "" };
    continue;
  }
  if (!cur) continue;
  const slot = raw.match(/^\s+(FAST|SHIP):\s*(.*)$/);
  if (slot) {
    cur[slot[1].toLowerCase() as "fast" | "ship"] = slot[2].trim();
  } else if (raw.match(/^\s{10,}\S/) && !raw.trim().startsWith("#")) {
    // continuation line joins whichever slot was filled last
    const target = cur.ship ? "ship" : cur.fast ? "fast" : "deep";
    cur[target] = `${cur[target]} ${raw.trim()}`;
  }
}
if (cur) weeks.push(cur);
console.log(`editorial ledger: ${weeks.length} weeks`);
if (!rows.length || weeks.length < 10) throw new Error("parse looks wrong - refusing to sync");

// ---- senior-SWE study guide (onchain-backend, gitignored) -> plan:study ----
let study: any = null;
try {
  const guide = readFileSync(`${process.env.HOME}/Code/onchain-backend/notes/private/senior-swe-study-guide.md`, "utf8");
  const parts = guide.split(/\n(?=## )/);
  const sections = parts
    .map((chunk) => {
      const m = chunk.match(/^##\s+(\d+)\.\s*(.*)$/m);
      return {
        num: m ? Number(m[1]) : -1,
        title: m ? m[2].replace(/\s*\(.*?\)\s*$/, "").replace(/[*_`]/g, "").trim() : "Preamble",
        body: chunk,
      };
    })
    .filter((x) => x.body.trim());
  study = { sections, source: "onchainsuite infra handbook study guide", syncedAt: new Date().toISOString() };
  console.log(`study guide: ${sections.length} sections, ${Math.round(guide.length / 1024)}KB`);
} catch (e) {
  console.log("study guide not found - skipping (plan:study unchanged)");
}

const far = new Date("2028-01-01");
for (const [key, data] of [
  ["plan:season", { header, rows, syncedAt: new Date().toISOString() }],
  ["plan:ledger", { start: "2026-09-14", weeks, syncedAt: new Date().toISOString() }],
  ...(study ? ([["plan:study", study]] as const) : []),
] as const) {
  await db
    .insert(statCache)
    .values({ key, data, expiresAt: far })
    .onConflictDoUpdate({ target: statCache.key, set: { data, expiresAt: far } });
  console.log(`synced ${key}`);
}
