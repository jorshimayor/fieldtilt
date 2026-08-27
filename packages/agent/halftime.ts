/**
 * Half-time burst — at the break of every tracked match, compose AT LEAST
 * five grounded posts about the first half, each with its own card:
 *
 *   1. ht_score          the half-time scoreline (kit palette, score card)
 *   2. scorer_spotlight  our scorer's season receipts (photo card)
 *        — or xg_watch when we haven't scored (editorial, terminal)
 *   3. h2h_history       the head-to-head record vs this opponent
 *   4. table_stakes      where the table stands mid-match (form, terminal)
 *   5. scorer_board      season goals leaderboard (terminal)
 *   (+ second_half_watch backfills if a data source was unavailable)
 *
 * `halftimePlan` is PURE (data in → compose specs out) so it unit-tests
 * without LLM or network; `runHalftimeBurst` executes the specs through the
 * normal composeAndPost pipeline (approval queue + assistant nudge, or
 * auto-post when flags.publish_draft_only is false). Poster is imported
 * lazily to keep the wasm render chain out of unit tests.
 */

import { club } from "../shared/club";
import type { TweetKind } from "../shared/tweet-prompts";
import type { CardKind } from "../render/index";
import type {
  NormalizedLiveMatch,
  NormalizedGoalEvent,
  NormalizedStanding,
  NormalizedTopPlayer,
  HeadToHead,
} from "../tools/types";

export type ComposeSpec = {
  slot: string;
  kind: TweetKind;
  data: Record<string, unknown>;
  card?: { kind: CardKind; data: Record<string, unknown> };
};

export type HalftimeContext = {
  live: NormalizedLiveMatch;
  goals: NormalizedGoalEvent[];
  /** formatScorers() output, e.g. ["Palmer 23'"] */
  scorers: string[];
  standings?: { team: NormalizedStanding | null; table: NormalizedStanding[] } | null;
  lastFixtures?:
    | { opponent: string; goalsHome: number | null; goalsAway: number | null; outcome: string | null }[]
    | null;
  performers?: NormalizedTopPlayer[] | null;
  h2h?: HeadToHead | null;
  /** e.g. "2025/26" */
  seasonLbl: string;
};

const fold = (s: string) =>
  (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** The last of OUR goals in the event list (null when we haven't scored). */
export function pickClubScorer(goals: NormalizedGoalEvent[], clubName: string): NormalizedGoalEvent | null {
  const c = fold(clubName);
  const ours = goals.filter((g) => {
    const t = fold(g.team);
    return t.includes(c) || c.includes(t);
  });
  return ours.length ? ours[ours.length - 1] : null;
}

export function halftimePlan(ctx: HalftimeContext): ComposeSpec[] {
  const c = club();
  const { live } = ctx;
  const isHome = fold(live.home).includes(fold(c.name));
  const kit = isHome ? "home" : "away";
  const opponent = isHome ? live.away : live.home;
  const score = `${live.homeGoals}-${live.awayGoals}`;
  const specs: ComposeSpec[] = [];

  // 1 — the scoreline ------------------------------------------------------
  specs.push({
    slot: "ht_score",
    kind: "live_update",
    data: {
      minute: "HT",
      event: `Half time: ${live.home} ${score} ${live.away}, ${live.competition}`,
      actor: ctx.scorers[ctx.scorers.length - 1] || "n/a",
      score,
      possession: "n/a",
      xg: "n/a",
    },
    card: {
      kind: "score",
      data: {
        home: live.home,
        away: live.away,
        homeGoals: live.homeGoals,
        awayGoals: live.awayGoals,
        competition: live.competition,
        statusLabel: "HALF TIME",
        scorers: ctx.scorers,
        palette: kit,
      },
    },
  });

  // 2 — our scorer's receipts, or the xg watch when goalless ---------------
  const scorer = pickClubScorer(ctx.goals, c.name);
  const perf = scorer
    ? (ctx.performers || []).find(
        (p) => fold(p.player).includes(fold(scorer.player)) || fold(scorer.player).includes(fold(p.player))
      )
    : undefined;
  if (scorer) {
    specs.push({
      slot: "scorer_spotlight",
      kind: "player_stat",
      data: {
        player: scorer.player,
        season: ctx.seasonLbl,
        goals: perf ? `${perf.goals} this season (plus this one)` : "scored this half",
        assists: perf?.assists ?? "n/a",
        apps: perf?.appearances ?? "n/a",
        extra: `on the scoresheet in the ${scorer.minute ?? "?"}' vs ${opponent}`,
      },
      card: {
        kind: "player_stat",
        data: {
          player: scorer.player,
          season: ctx.seasonLbl,
          competition: live.competition,
          context: `vs ${opponent}, half time`,
          stats: [
            { label: "Scored today", value: `${scorer.minute ?? "?"}'` },
            ...(perf
              ? [
                  { label: "Goals this season", value: String(perf.goals) },
                  { label: "Assists", value: String(perf.assists) },
                  { label: "Appearances", value: String(perf.appearances) },
                ]
              : []),
          ],
          remark: "On the scoresheet before the break.",
          photoWiki: scorer.player,
          palette: kit,
        },
      },
    });
  } else {
    const top = (ctx.performers || [])[0];
    specs.push({
      slot: "xg_watch",
      kind: "weekly_deep_dive",
      data: {
        theme: `${c.name} without a first-half goal vs ${opponent} (${score} at the break)`,
        numbers: top
          ? `${top.player} leads the season charts with ${top.goals} goals and ${top.assists} assists in ${top.appearances} apps`
          : `score ${score} at half time`,
        window: "first half",
      },
      card: {
        kind: "editorial",
        data: {
          eyebrow: "Half time",
          lines: [
            { text: `${score} at the break.` },
            ...(top ? [{ text: `${top.player}: ${top.goals} goals this season.` }] : []),
            { text: "45 minutes to fix it.", em: true },
          ],
          dateLabel: live.competition,
          palette: "terminal",
        },
      },
    });
  }

  // 3 — head-to-head history ----------------------------------------------
  if (ctx.h2h && ctx.h2h.played > 0) {
    const { wins, draws, losses, played, summary } = ctx.h2h;
    specs.push({
      slot: "h2h_history",
      kind: "weekly_deep_dive",
      data: {
        theme: `The history vs ${opponent}, at the break of another chapter`,
        numbers: `played ${played}: ${wins} wins, ${draws} draws, ${losses} defeats (${summary})`,
        window: `last ${played} meetings`,
      },
      card: {
        kind: "editorial",
        data: {
          eyebrow: `vs ${opponent}`,
          lines: [
            { text: `Played ${played}.` },
            { text: `${wins} wins. ${draws} draws. ${losses} defeats.` },
            { text: `Today: ${score} at half time.`, em: true },
          ],
          dateLabel: live.competition,
          palette: "neutral",
        },
      },
    });
  }

  // 4 — the table mid-match ------------------------------------------------
  const teamRow = ctx.standings?.team;
  if (teamRow) {
    const results = (ctx.lastFixtures || [])
      .slice(0, 5)
      .filter((f) => f.outcome)
      .map((f) => ({
        opponent: f.opponent,
        score: `${f.goalsHome ?? "?"}-${f.goalsAway ?? "?"}`,
        outcome: f.outcome as "W" | "D" | "L",
      }));
    specs.push({
      slot: "table_stakes",
      kind: "weekly_deep_dive",
      data: {
        theme: `What this result does to ${c.name}'s league position`,
        numbers: `currently ${teamRow.rank}th, ${teamRow.points} pts from ${teamRow.played} played, GF ${teamRow.goalsFor} GA ${teamRow.goalsAgainst}, form ${teamRow.form || "n/a"}; ${score} vs ${opponent} at half time`,
        window: ctx.seasonLbl,
      },
      card: {
        kind: "form",
        data: {
          seasonLabel: ctx.seasonLbl,
          results,
          position: teamRow.rank,
          points: teamRow.points,
          goalsFor: teamRow.goalsFor,
          goalsAgainst: teamRow.goalsAgainst,
          palette: "terminal",
        },
      },
    });
  }

  // 5 — season goals leaderboard ------------------------------------------
  const scorersBoard = (ctx.performers || []).filter((p) => p.goals > 0).slice(0, 5);
  if (scorersBoard.length >= 2) {
    specs.push({
      slot: "scorer_board",
      kind: "weekly_deep_dive",
      data: {
        theme: `Who is carrying the goals for ${c.name} this season`,
        numbers: scorersBoard.map((p) => `${p.player} ${p.goals}G ${p.assists}A`).join(", "),
        window: ctx.seasonLbl,
      },
      card: {
        kind: "leaderboard",
        data: {
          title: "Most goals",
          context: `${c.name} ${ctx.seasonLbl} · all competitions`,
          entries: scorersBoard.map((p, i) => ({
            value: String(p.goals),
            label: p.player,
            sub: `${p.assists}A`,
            highlight: i === 0,
          })),
          footnote: "source: football-data",
          palette: "terminal",
        },
      },
    });
  }

  // 6 — always ship the second-half watch: with every source healthy the
  // burst is 6 posts, and one missing source still leaves at least 5.
  {
    specs.push({
      slot: "second_half_watch",
      kind: "weekly_deep_dive",
      data: {
        theme: `Second-half watch: ${live.home} ${score} ${live.away}`,
        numbers: `${score} at half time in the ${live.competition}${ctx.scorers.length ? `; scorers so far: ${ctx.scorers.join(", ")}` : ""}`,
        window: "next 45 minutes",
      },
      card: {
        kind: "editorial",
        data: {
          eyebrow: "Second half",
          lines: [
            { text: `${live.home} ${score} ${live.away}.` },
            { text: "Everything still to play for.", em: true },
          ],
          dateLabel: live.competition,
          palette: "terminal",
        },
      },
    });
  }

  return specs;
}

export type BurstResult = {
  slot: string;
  draftId?: string;
  posted?: boolean;
  skipped?: string;
  error?: string;
};

/** Execute the plan through the normal compose pipeline (parallel, tolerant). */
export async function runHalftimeBurst(ctx: HalftimeContext): Promise<BurstResult[]> {
  const { composeAndPost } = await import("../shared/poster");
  const specs = halftimePlan(ctx);
  return Promise.all(
    specs.map(async (s): Promise<BurstResult> => {
      try {
        const r = await composeAndPost({
          kind: s.kind,
          data: s.data,
          card: s.card,
          source: "cron:halftime",
          idKey: `tweet:ht:${ctx.live.fixtureId}:${s.slot}`,
          idTtlSec: 6 * 60 * 60,
        });
        return { slot: s.slot, draftId: r.draftId, posted: r.posted, skipped: r.skipped };
      } catch (e) {
        return { slot: s.slot, error: String((e as Error).message || e).slice(0, 140) };
      }
    })
  );
}
