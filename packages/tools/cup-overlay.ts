/**
 * Cup overlay — API-Football as a SUPPLEMENT, not a replacement.
 *
 * football-data's free tier covers the league but is blind to domestic cups
 * (tonight's EFL Cup problem). When an API_FOOTBALL_KEY is present, this
 * overlay fills exactly that gap: cup fixtures, cup live matches, and cup
 * match stats come from API-Football while the league keeps riding the
 * unlimited football-data feed — so the 100 req/day free budget is spent
 * ONLY on what football-data can't see. With no key, everything here goes
 * quietly inert.
 *
 * Fixture ids are provider-scoped, so anything cached from the overlay is
 * tagged src:"af" and must be read back through the overlay's provider.
 */

import { apiFootballProvider } from "./providers/api-football";
import { provider, activeProviderName, club } from "./football";
import type { FootballProvider, NormalizedFixture } from "./types";

const env = () => (globalThis as any).process?.env || {};

/** Overlay applies only when the primary is football-data AND a key exists. */
export function cupOverlayActive(): boolean {
  return activeProviderName() === "football-data" && Boolean(env().API_FOOTBALL_KEY);
}

export type FixtureSrc = "primary" | "af";

/** The provider that owns a fixture id tagged with `src`. */
export function providerFor(src: FixtureSrc): FootballProvider {
  return src === "af" ? apiFootballProvider : provider();
}

const fold = (s: string) => (s || "").toLowerCase();

/** Cup = any competition that is not the club's league. */
export function isCupCompetition(competition: string): boolean {
  return fold(competition) !== fold(club().league.name);
}

/** Upcoming cup fixtures from the overlay (empty without a key). */
export async function getUpcomingCupFixtures(count = 5): Promise<NormalizedFixture[]> {
  if (!cupOverlayActive()) return [];
  try {
    const { fixtures } = await apiFootballProvider.getFixtures({ next: count });
    return fixtures.filter((f) => isCupCompetition(f.competition));
  } catch {
    return [];
  }
}

export type NextAnyFixture = { fixture: NormalizedFixture; src: FixtureSrc };

/**
 * The club's next fixture across ALL competitions: earliest of the primary
 * provider's next fixture and the overlay's next cup fixture.
 */
export async function getNextFixtureAny(): Promise<NextAnyFixture | null> {
  const [primary, cups] = await Promise.all([
    provider()
      .getFixtures({ next: 1 })
      .then((r) => r.fixtures[0] || null)
      .catch(() => null),
    getUpcomingCupFixtures(3).then((f) => f[0] || null),
  ]);
  if (!primary && !cups) return null;
  if (primary && (!cups || primary.date <= cups.date)) return { fixture: primary, src: "primary" };
  return { fixture: cups!, src: "af" };
}

/**
 * Live match across all competitions: the primary feed first, then (cup
 * days) the overlay. Returns the source so stats/events read from the
 * right provider.
 */
export async function getLiveMatchAny(): Promise<{ live: Awaited<ReturnType<FootballProvider["getLiveMatch"]>>; src: FixtureSrc } | null> {
  const primaryLive = await provider().getLiveMatch().catch(() => null);
  if (primaryLive) return { live: primaryLive, src: "primary" };
  if (!cupOverlayActive()) return null;
  const afLive = await apiFootballProvider.getLiveMatch().catch(() => null);
  return afLive ? { live: afLive, src: "af" } : null;
}
