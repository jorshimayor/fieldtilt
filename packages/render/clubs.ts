/**
 * Club directory — official X handles + football-data.org crest ids.
 *
 * Handles are used for tagging clubs in tweet copy (never guessed by the
 * LLM: if a club is missing here, it simply goes untagged). Crest ids feed
 * https://crests.football-data.org/{id}.png, the same CDN the football-data
 * API returns in its own team payloads.
 */

export type ClubAssets = { handle: string; crestId: number };

export const CLUB_DIRECTORY: Record<string, ClubAssets> = {
  arsenal: { handle: "@Arsenal", crestId: 57 },
  "aston villa": { handle: "@AVFCOfficial", crestId: 58 },
  bournemouth: { handle: "@afcbournemouth", crestId: 1044 },
  brentford: { handle: "@BrentfordFC", crestId: 402 },
  brighton: { handle: "@OfficialBHAFC", crestId: 397 },
  burnley: { handle: "@BurnleyOfficial", crestId: 328 },
  chelsea: { handle: "@ChelseaFC", crestId: 61 },
  "crystal palace": { handle: "@CPFC", crestId: 354 },
  everton: { handle: "@Everton", crestId: 62 },
  fulham: { handle: "@FulhamFC", crestId: 63 },
  leeds: { handle: "@LUFC", crestId: 341 },
  leicester: { handle: "@LCFC", crestId: 338 },
  liverpool: { handle: "@LFC", crestId: 64 },
  luton: { handle: "@LutonTown", crestId: 389 },
  "manchester city": { handle: "@ManCity", crestId: 65 },
  "manchester united": { handle: "@ManUtd", crestId: 66 },
  newcastle: { handle: "@NUFC", crestId: 67 },
  "nottingham forest": { handle: "@NFFC", crestId: 351 },
  southampton: { handle: "@SouthamptonFC", crestId: 340 },
  sunderland: { handle: "@SunderlandAFC", crestId: 71 },
  tottenham: { handle: "@SpursOfficial", crestId: 73 },
  "west ham": { handle: "@WestHam", crestId: 563 },
  wolves: { handle: "@Wolves", crestId: 76 },
};

/** Fold-match a free-text club name ("Man City", "Spurs") to directory assets. */
export function clubAssets(name: string): (ClubAssets & { crestUrl: string }) | null {
  const q = (name || "").toLowerCase().trim();
  if (!q) return null;
  const aliases: Record<string, string> = {
    "man city": "manchester city",
    "man united": "manchester united",
    "man utd": "manchester united",
    spurs: "tottenham",
    "nottm forest": "nottingham forest",
    forest: "nottingham forest",
    "west ham united": "west ham",
    "wolverhampton wanderers": "wolves",
    "brighton & hove albion": "brighton",
    "afc bournemouth": "bournemouth",
    "luton town": "luton",
    "leeds united": "leeds",
    "leicester city": "leicester",
    "newcastle united": "newcastle",
    "aston villa fc": "aston villa",
  };
  const key =
    aliases[q] ||
    (CLUB_DIRECTORY[q] ? q : Object.keys(CLUB_DIRECTORY).find((k) => q.includes(k) || k.includes(q)));
  const hit = key ? CLUB_DIRECTORY[key] : undefined;
  return hit ? { ...hit, crestUrl: `https://crests.football-data.org/${hit.crestId}.png` } : null;
}
