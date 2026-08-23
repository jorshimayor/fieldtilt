/**
 * CLUB CONFIGURATION — the module that makes this a football platform
 * instead of a Chelsea bot.
 *
 * Every club-specific fact lives here: provider ids, league mappings,
 * hashtags, voice hooks. Nothing else in the codebase may hardcode a club.
 * Switching club is one env var on the deployed Worker:
 *
 *   CLUB=chelsea      (default)
 *   CLUB=strasbourg   (BlueCo sibling — Ligue 1, same free data sources)
 *   CLUB='{"name":"Arsenal", ...}'   (full JSON for any club)
 *
 * Cache keys, prompts, cards, crons and the agent all derive from this.
 */

export type ClubConfig = {
  /** Short display name used in copy: "Chelsea" */
  name: string;
  /** Full name for formal contexts: "Chelsea FC" */
  fullName: string;
  /** Cache-key slug (stable, lowercase, no spaces) */
  slug: string;
  /** Hashtag + emoji appended to every post: "#CFC" + "💙" */
  hashtag: string;
  emoji: string;
  /** Provider-native identifiers — ids are PER PROVIDER, never mixed */
  ids: {
    apiFootball: number;
    footballData: number;
    /** Understat URL slug, e.g. "Chelsea" */
    understat: string;
  };
  league: {
    name: string;
    apiFootball: number;
    /** football-data.org competition code, e.g. "PL" */
    footballData: string;
    /** Understat league slug, e.g. "EPL" */
    understat: string;
  };
  /** Voice hooks for the composer */
  homeHook: string; // "Home fixture at the Bridge."
  awayHook: string; // "Away day."
  /** Fan timezone for kickoff formatting */
  timezone: string;
  /** IANA label shown after times, e.g. "WAT" */
  tzLabel: string;
};

const PRESETS: Record<string, ClubConfig> = {
  chelsea: {
    name: "Chelsea",
    fullName: "Chelsea FC",
    slug: "chelsea",
    hashtag: "#CFC",
    emoji: "💙",
    ids: { apiFootball: 49, footballData: 61, understat: "Chelsea" },
    league: { name: "Premier League", apiFootball: 39, footballData: "PL", understat: "EPL" },
    homeHook: "Home fixture at the Bridge.",
    awayHook: "Away day.",
    timezone: "Africa/Lagos",
    tzLabel: "WAT",
  },
  // BlueCo sibling club. NOTE: verify the three provider ids against each
  // API before first production use — id spaces differ per provider.
  strasbourg: {
    name: "Strasbourg",
    fullName: "RC Strasbourg Alsace",
    slug: "strasbourg",
    hashtag: "#RCSA",
    emoji: "💙",
    ids: { apiFootball: 95, footballData: 576, understat: "Strasbourg" },
    league: { name: "Ligue 1", apiFootball: 61, footballData: "FL1", understat: "Ligue_1" },
    homeHook: "Home night at the Meinau.",
    awayHook: "Away day.",
    timezone: "Africa/Lagos",
    tzLabel: "WAT",
  },
};

let cached: ClubConfig | null = null;
let cachedRaw: string | undefined;

/** Resolve the active club from env (preset name or full JSON). */
export function club(): ClubConfig {
  const raw = (globalThis as any).process?.env?.CLUB as string | undefined;
  if (cached && raw === cachedRaw) return cached;
  cachedRaw = raw;
  if (!raw || !raw.trim()) {
    cached = PRESETS.chelsea;
    return cached;
  }
  const key = raw.trim();
  if (PRESETS[key.toLowerCase()]) {
    cached = PRESETS[key.toLowerCase()];
    return cached;
  }
  if (key.startsWith("{")) {
    try {
      const parsed = JSON.parse(key) as Partial<ClubConfig>;
      cached = validateClub({ ...PRESETS.chelsea, ...parsed });
      return cached;
    } catch (e) {
      console.error("club_config_invalid_json_falling_back_to_chelsea", String(e));
    }
  } else {
    console.error("club_config_unknown_preset_falling_back_to_chelsea", key);
  }
  cached = PRESETS.chelsea;
  return cached;
}

export function validateClub(c: ClubConfig): ClubConfig {
  const problems: string[] = [];
  if (!c.name) problems.push("name required");
  if (!c.slug || /[^a-z0-9-]/.test(c.slug)) problems.push("slug must be lowercase alphanumeric");
  if (!c.ids?.apiFootball || !c.ids?.footballData || !c.ids?.understat)
    problems.push("all three provider ids required");
  if (!c.league?.apiFootball || !c.league?.footballData || !c.league?.understat)
    problems.push("all three league mappings required");
  if (problems.length) throw new Error(`invalid club config: ${problems.join("; ")}`);
  return c;
}

export function listPresets(): string[] {
  return Object.keys(PRESETS);
}
