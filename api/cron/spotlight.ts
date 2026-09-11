export const config = { runtime: "edge" };

/**
 * Player spotlight — Wednesday 12:00 UTC (13:00 WAT).
 *
 * Ranks the squad by goal involvements this season and posts a stat card for
 * the top performer. Rotates: a player already featured in the last 4 weeks
 * is skipped in favor of the next one (durable dedup via posted_items).
 */

import {
  getTeamTopPerformers,
  seasonLabel,
  currentSeason,
  club,
} from "../../packages/tools/football";
import { getTeamAdvancedStats } from "../../packages/tools/understat";
import { composeAndPost, claimPostedKey, recordPostedTweet } from "../../packages/shared/poster";
import { withErrorLogging } from "../../packages/observability/index";

function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export default withErrorLogging(async function handler(): Promise<Response> {
  const season = currentSeason();
  // Coverage-first: the whole squad is content. Spotlight the LEAST-covered
  // player who is actually getting minutes; top performers get plenty of
  // airtime from every other pipeline.
  const { players: topPerformers } = await getTeamTopPerformers(season);
  let players = topPerformers;
  try {
    const { getFullSquad, countMentions } = await import("../../packages/tools/squad");
    const { db } = await import("../../packages/db/client");
    const { drafts } = await import("../../packages/db/schema");
    const { desc: descOp, eq: eqOp } = await import("drizzle-orm");
    const { players: squad } = await getFullSquad();
    const recent = await db.select({ content: drafts.content }).from(drafts)
      .where(eqOp(drafts.status, "posted")).orderBy(descOp(drafts.createdAt)).limit(200);
    const counts = countMentions(squad, recent.map((r) => r.content));
    const ranked = squad
      .filter((sp) => (sp.fpl?.minutes || 0) > 0)
      .sort((a, b) =>
        (counts.find((c) => c.name === a.name)?.mentions || 0) - (counts.find((c) => c.name === b.name)?.mentions || 0)
        || (b.fpl?.minutes || 0) - (a.fpl?.minutes || 0));
    if (ranked.length) {
      // map least-covered squad names onto the performers list shape when
      // possible; fall back to a synthetic entry from FPL numbers.
      players = ranked.slice(0, 8).map((sp) => {
        const perf = topPerformers.find((tp) => tp.player.toLowerCase().includes(sp.name.split(" ").slice(-1)[0].toLowerCase()));
        return perf || ({ player: sp.name, playerId: 0, photoUrl: null, position: sp.position, appearances: Math.round((sp.fpl!.minutes) / 90), goals: sp.fpl!.goals, assists: sp.fpl!.assists, minutes: sp.fpl!.minutes, rating: null } as any);
      });
    }
  } catch {
    /* coverage layer optional - top performers remain the fallback */
  }
  const candidates = players.filter((p) => p.appearances > 0).slice(0, 6);
  if (!candidates.length) return json({ skipped: "no player data for this season yet" });

  // One spotlight per week overall…
  const weekKey = `spotlight:week:${isoWeek()}`;
  if (!(await claimPostedKey(weekKey, "spotlight"))) {
    return json({ skipped: "spotlight already posted this week" });
  }

  const month = new Date().toISOString().slice(0, 7);
  for (const p of candidates) {
    // …and each player at most once per month.
    const playerKey = `spotlight:${p.player}:${month}`;
    if (!(await claimPostedKey(playerKey, "spotlight"))) continue;

    const stats: { label: string; value: string }[] = [
      { label: "Appearances", value: String(p.appearances) },
      { label: "Goals", value: String(p.goals) },
      { label: "Assists", value: String(p.assists) },
    ];
    if (p.minutes != null) stats.push({ label: "Minutes", value: String(p.minutes) });
    if (p.rating) stats.push({ label: "Avg rating", value: p.rating });

    // Advanced layer (Understat xG model) — best-effort, card omits it if down.
    let xgLine = "";
    try {
      const { players: adv } = await getTeamAdvancedStats(season);
      const lastName = p.player.split(" ").slice(-1)[0].toLowerCase();
      const a = adv.find((x) => x.player.toLowerCase().includes(lastName));
      if (a) {
        stats.splice(3); // keep the card to 6 tiles: apps/goals/assists + xG trio
        stats.push({ label: "Expected goals (xG)", value: a.xG.toFixed(1) });
        stats.push({ label: "Expected assists (xA)", value: a.xA.toFixed(1) });
        stats.push({ label: "xG per 90", value: a.per90.xG.toFixed(2) });
        xgLine = `xG ${a.xG.toFixed(1)} (${a.goals} goals), xA ${a.xA.toFixed(1)} — xG: Understat`;
      }
    } catch {
      // typographic card still works without the xG layer
    }

    // Editorial-style background photo (API-Football headshot under a scrim).
    let photoDataUri: string | undefined;
    if (p.photoUrl) {
      try {
        const res = await fetch(p.photoUrl);
        if (res.ok) {
          const buf = new Uint8Array(await res.arrayBuffer());
          let bin = "";
          for (let i = 0; i < buf.length; i += 0x8000) {
            bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
          }
          photoDataUri = `data:image/png;base64,${btoa(bin)}`;
        }
      } catch {
        // typographic layout carries the card without a photo
      }
    }

    const result = await composeAndPost({
      kind: "player_stat",
      source: "cron:spotlight",
      data: {
        player: p.player,
        season: seasonLabel(season),
        goals: p.goals,
        assists: p.assists,
        apps: p.appearances,
        extra: xgLine || (p.rating ? `avg rating ${p.rating}` : `position ${p.position}`),
      },
      card: {
        kind: "player_stat",
        data: {
          player: p.player,
          season: seasonLabel(season),
          competition: club().league.name,
          context: p.position ? `Position · ${p.position}` : undefined,
          stats,
          photoDataUri,
        },
      },
    });
    if (result.tweetId) await recordPostedTweet(playerKey, result.tweetId);
    return json({ player: p.player, ...result });
  }

  return json({ skipped: "all top performers featured recently" });
});

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}
