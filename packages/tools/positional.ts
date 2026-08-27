/**
 * Positional metrics (FBref/Opta) — store-backed, browser-ingested.
 *
 * FBref sits behind a human-verification wall, so NOTHING here scrapes at
 * runtime. Instead the operator browses an FBref player page normally and
 * clicks the fieldtilt bookmarklet (Stat sources panel), which reads the
 * page's scouting-report + standard-stats tables and POSTs them to
 * /api/ingest. Rows land in the durable statCache table; the agent tools
 * below read from that store and fail HONESTLY when a player was never
 * imported — they never invent numbers.
 */

import { db } from "../db/client";
import { statCache } from "../db/schema";
import { eq } from "drizzle-orm";

export type ScoutRow = { stat: string; per90: string; percentile: string };
export type CareerRow = {
  season: string;
  squad: string;
  comp: string;
  minutes: string;
  goals: string;
  assists: string;
};
export type FbrefImport = {
  player: string;
  url: string;
  position?: string;
  asOf: string; // ISO date of import
  scout: ScoutRow[];
  career: CareerRow[];
};

export const fold = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

const scoutKey = (player: string) => `fbref:${fold(player)}`;
const INDEX_KEY = "fbref:index";
/** Imports go stale eventually; 60 days keeps a card honest. */
const TTL_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * Curated packs mapping the roadmap's positional metrics to FBref stat
 * names (matched fold-includes, so "Tackles" also catches "Tackles Won").
 * "Errors" is the closest sourced proxy for positional mistakes; carry /
 * dribble defending maps to Dribblers Tackled; tackle resistance to the
 * Dispossessed + Miscontrols family.
 */
export const PACKS: Record<string, string[]> = {
  defender: [
    "Aerials Won",
    "% of Aerials Won",
    "Clearances",
    "Tackles",
    "Tackles Won",
    "Dribblers Tackled",
    "% of Dribblers Tackled",
    "Blocks",
    "Interceptions",
    "Ball Recoveries",
    "Errors",
    "Pass Completion %",
    "Progressive Passes",
  ],
  midfielder: [
    "Progressive Carries",
    "Carries into Final Third",
    "Successful Take-Ons",
    "Dispossessed",
    "Miscontrols",
    "Tackles",
    "Tackles Won",
    "Dribblers Tackled",
    "% of Dribblers Tackled",
    "Interceptions",
    "Ball Recoveries",
    "Aerials Won",
    "Pass Completion %",
    "Progressive Passes",
    "Key Passes",
    "Fouls Drawn",
  ],
};

/** Validate + normalize a bookmarklet payload. Throws with a clear reason. */
export function validateImport(raw: any): FbrefImport {
  const player = String(raw?.player || "").trim().slice(0, 60);
  if (!player) throw new Error("missing player name");
  const url = String(raw?.url || "").slice(0, 200);
  if (!/^https:\/\/fbref\.com\//.test(url)) throw new Error("url must be an fbref.com page");
  const clean = (s: unknown, max = 60) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const scout: ScoutRow[] = (Array.isArray(raw?.scout) ? raw.scout : [])
    .slice(0, 250)
    .map((r: any) => ({ stat: clean(r?.stat), per90: clean(r?.per90, 20), percentile: clean(r?.percentile, 8) }))
    .filter((r: ScoutRow) => r.stat && r.per90 !== "");
  const career: CareerRow[] = (Array.isArray(raw?.career) ? raw.career : [])
    .slice(0, 40)
    .map((r: any) => ({
      season: clean(r?.season, 12),
      squad: clean(r?.squad, 40),
      comp: clean(r?.comp, 40),
      minutes: clean(r?.minutes, 10),
      goals: clean(r?.goals, 6),
      assists: clean(r?.assists, 6),
    }))
    .filter((r: CareerRow) => /\d{4}/.test(r.season) && r.squad);
  if (!scout.length && !career.length) throw new Error("no scout or career rows found on the page");
  return { player, url, position: clean(raw?.position, 40) || undefined, asOf: new Date().toISOString().slice(0, 10), scout, career };
}

async function readStore<T>(key: string): Promise<T | null> {
  const rows = await db.select().from(statCache).where(eq(statCache.key, key)).limit(1);
  const row = rows[0];
  if (!row?.data) return null;
  if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) return null;
  return row.data as T;
}

async function writeStore(key: string, data: unknown): Promise<void> {
  const expiresAt = new Date(Date.now() + TTL_MS);
  await db
    .insert(statCache)
    .values({ key, data: data as any, expiresAt })
    .onConflictDoUpdate({ target: statCache.key, set: { data: data as any, expiresAt } });
}

export async function storeFbrefImport(raw: any): Promise<{ player: string; scoutRows: number; careerRows: number }> {
  const imp = validateImport(raw);
  await writeStore(scoutKey(imp.player), imp);
  const index = (await readStore<Record<string, string>>(INDEX_KEY)) || {};
  index[imp.player] = imp.asOf;
  await writeStore(INDEX_KEY, index);
  return { player: imp.player, scoutRows: imp.scout.length, careerRows: imp.career.length };
}

export async function listImportedPlayers(): Promise<Record<string, string>> {
  return (await readStore<Record<string, string>>(INDEX_KEY)) || {};
}

const NOT_IMPORTED = (player: string) =>
  `no FBref import for "${player}". These metrics come from operator-side imports: open the player's FBref scouting report in a browser and click the fieldtilt bookmarklet (dashboard > Stat sources). Never invent these numbers.`;

/** Positional metrics for a player, optionally filtered to a pack. */
export async function getPositionalStats(
  player: string,
  pack?: string
): Promise<
  | { player: string; position?: string; asOf: string; source: string; url: string; stats: ScoutRow[] }
  | { error: string; imported: string[] }
> {
  const index = await listImportedPlayers();
  const match = Object.keys(index).find((k) => fold(k).includes(fold(player)) || fold(player).includes(fold(k)));
  const imp = match ? await readStore<FbrefImport>(scoutKey(match)) : null;
  if (!imp) return { error: NOT_IMPORTED(player), imported: Object.keys(index) };
  let stats = imp.scout;
  const wanted = pack && PACKS[fold(pack)] ? PACKS[fold(pack)] : null;
  if (wanted) {
    stats = imp.scout.filter((r) => wanted.some((w) => fold(r.stat).includes(fold(w)) || fold(w).includes(fold(r.stat))));
  }
  // Dedup repeated stat names (full scouting reports repeat rows per section).
  const seen = new Set<string>();
  stats = stats.filter((r) => (seen.has(fold(r.stat)) ? false : (seen.add(fold(r.stat)), true)));
  return {
    player: imp.player,
    position: imp.position,
    asOf: imp.asOf,
    source: "FBref (Opta), last 365 days per-90 + positional percentile",
    url: imp.url,
    stats,
  };
}

/** Career rows (season-by-season squads) — powers year-vs-year comparisons
 *  and "facing a former club" angles. */
export async function getPlayerCareer(
  player: string
): Promise<
  | { player: string; asOf: string; source: string; career: CareerRow[]; clubs: string[] }
  | { error: string; imported: string[] }
> {
  const index = await listImportedPlayers();
  const match = Object.keys(index).find((k) => fold(k).includes(fold(player)) || fold(player).includes(fold(k)));
  const imp = match ? await readStore<FbrefImport>(scoutKey(match)) : null;
  if (!imp || !imp.career.length) return { error: NOT_IMPORTED(player), imported: Object.keys(index) };
  const clubs = [...new Set(imp.career.map((r) => r.squad))];
  return { player: imp.player, asOf: imp.asOf, source: "FBref career table", career: imp.career, clubs };
}

/** Which imported players have `opponent` in their career squads. */
export async function playersWhoPlayedFor(opponent: string): Promise<{ opponent: string; players: { player: string; seasons: string[] }[]; imported: string[] }> {
  const index = await listImportedPlayers();
  const hits: { player: string; seasons: string[] }[] = [];
  for (const name of Object.keys(index)) {
    const imp = await readStore<FbrefImport>(scoutKey(name));
    if (!imp) continue;
    const seasons = imp.career.filter((r) => fold(r.squad).includes(fold(opponent)) || fold(opponent).includes(fold(r.squad))).map((r) => r.season);
    if (seasons.length) hits.push({ player: imp.player, seasons: [...new Set(seasons)] });
  }
  return { opponent, players: hits, imported: Object.keys(index) };
}
