/**
 * Cross-league adjustment constants (league-adj-v1).
 *
 * When comparing players across leagues, raw per-90s flatter weaker
 * leagues. These multipliers give a TRANSPARENT, versioned correction:
 * multiply a per-90 produced in league X by its coefficient to express it
 * on a Premier League scale, and ALWAYS disclose the adjustment in the
 * card footnote (e.g. "adjusted: Eredivisie x0.72, league-adj-v1").
 *
 * Basis: blended from public league-strength references (UEFA association
 * club coefficients, ClubElo league mean ratings) and transfer-performance
 * translation studies; PL = 1.00 anchor. These are editorial constants,
 * not fitted parameters — revisit each season (candidate for the Python
 * analytics service as a fitted model writing model_outputs).
 */

export const LEAGUE_ADJ_VERSION = "league-adj-v1";

export const LEAGUE_COEFFICIENTS: Record<string, number> = {
  "premier league": 1.0,
  "la liga": 0.96,
  "serie a": 0.94,
  bundesliga: 0.93,
  "ligue 1": 0.88,
  "primeira liga": 0.78,
  eredivisie: 0.75,
  championship: 0.72,
  brasileirao: 0.72,
  "belgian pro league": 0.7,
  "liga profesional argentina": 0.68,
  "scottish premiership": 0.65,
  "super lig": 0.65,
  mls: 0.62,
  "saudi pro league": 0.6,
  "liga mx": 0.62,
  "league one": 0.55,
  "league two": 0.45,
};

const fold = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export function leagueCoefficient(league: string): { league: string; coefficient: number } | null {
  const q = fold(league);
  const key = Object.keys(LEAGUE_COEFFICIENTS).find((k) => q.includes(k) || k.includes(q));
  return key ? { league: key, coefficient: LEAGUE_COEFFICIENTS[key] } : null;
}

/** PL-scale a per-90 from another league. Returns null for unknown leagues
 *  (comparisons should then stay unadjusted AND say so). */
export function adjustPer90(value: number, fromLeague: string): { adjusted: number; coefficient: number; footnote: string } | null {
  const hit = leagueCoefficient(fromLeague);
  if (!hit || !Number.isFinite(value)) return null;
  const adjusted = Math.round(value * hit.coefficient * 100) / 100;
  return {
    adjusted,
    coefficient: hit.coefficient,
    footnote: `adjusted: ${hit.league} x${hit.coefficient} (${LEAGUE_ADJ_VERSION})`,
  };
}
