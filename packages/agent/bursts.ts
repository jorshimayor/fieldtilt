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
  NormalizedFixture,
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
  const bgPlayer = pickClubScorer(ctx.goals, c.name)?.player || (ctx.performers || [])[0]?.player;
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
        crestHomeClub: live.home,
        crestAwayClub: live.away,
        ...(bgPlayer ? { photoWiki: bgPlayer } : {}),
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
          autoPost: true, // half-time content is worthless after the restart
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


// ------------------------------------------------------------------ full time

export type SeasonPointRow = { season: string; points: number; position: number; played: number };

export type FulltimeContext = {
  fixture: NormalizedFixture; // finished
  goals: NormalizedGoalEvent[];
  scorers: string[];
  standings?: { team: NormalizedStanding | null; table: NormalizedStanding[] } | null;
  /** Finished fixtures NEWEST FIRST, including this match. */
  lastFixtures?: NormalizedFixture[] | null;
  performers?: NormalizedTopPlayer[] | null;
  h2h?: HeadToHead | null;
  pointsProgression?: { current: SeasonPointRow; past: SeasonPointRow[]; note: string } | null;
  nextFixture?: NormalizedFixture | null;
  seasonLbl: string;
};

const ourGoals = (f: NormalizedFixture) => (f.isHome ? f.goalsHome : f.goalsAway) ?? 0;
const oppGoals = (f: NormalizedFixture) => (f.isHome ? f.goalsAway : f.goalsHome) ?? 0;

/** Consecutive-run counters over finished fixtures (newest first). The
 *  honest "history made" layer: only claims the data window can prove. */
export function computeStreaks(fixtures: NormalizedFixture[]): {
  winRun: number;
  unbeatenRun: number;
  scoringRun: number;
  cleanSheetRun: number;
  window: number;
} {
  const done = fixtures.filter((f) => f.outcome);
  const run = (pred: (f: NormalizedFixture) => boolean) => {
    let n = 0;
    for (const f of done) {
      if (pred(f)) n++;
      else break;
    }
    return n;
  };
  return {
    winRun: run((f) => f.outcome === "W"),
    unbeatenRun: run((f) => f.outcome !== "L"),
    scoringRun: run((f) => ourGoals(f) > 0),
    cleanSheetRun: run((f) => oppGoals(f) === 0),
    window: done.length,
  };
}

export function fulltimePlan(ctx: FulltimeContext): ComposeSpec[] {
  const c = club();
  const f = ctx.fixture;
  const kit = f.isHome ? "home" : "away";
  const score = `${f.goalsHome ?? 0}-${f.goalsAway ?? 0}`;
  const isLeague = fold(f.competition) === fold(c.league.name);
  const outcomeWord = f.outcome === "W" ? "win" : f.outcome === "D" ? "draw" : "defeat";
  const specs: ComposeSpec[] = [];

  // scorers' receipts (up to 2, dedup by player) ---------------------------
  const ourScorers = ctx.goals.filter((g) => {
    const t = fold(g.team);
    return t.includes(fold(c.name)) || fold(c.name).includes(t);
  });
  const seen = new Set<string>();
  for (const g of ourScorers) {
    if (seen.has(fold(g.player)) || seen.size >= 2) continue;
    seen.add(fold(g.player));
    const perf = (ctx.performers || []).find(
      (p) => fold(p.player).includes(fold(g.player)) || fold(g.player).includes(fold(p.player))
    );
    specs.push({
      slot: `scorer_${seen.size}`,
      kind: "player_stat",
      data: {
        player: g.player,
        season: ctx.seasonLbl,
        goals: perf ? `${perf.goals} this season` : "scored today",
        assists: perf?.assists ?? "n/a",
        apps: perf?.appearances ?? "n/a",
        extra: `scored in the ${g.minute ?? "?"}' in today's ${score} ${outcomeWord} vs ${f.opponent}`,
      },
      card: {
        kind: "player_stat",
        data: {
          player: g.player,
          season: ctx.seasonLbl,
          competition: f.competition,
          context: `vs ${f.opponent}, full time`,
          stats: [
            { label: "Scored today", value: `${g.minute ?? "?"}'` },
            ...(perf
              ? [
                  { label: "Goals this season", value: String(perf.goals) },
                  { label: "Assists", value: String(perf.assists) },
                  { label: "Appearances", value: String(perf.appearances) },
                ]
              : []),
          ],
          remark: f.outcome === "W" ? "Decisive when it mattered." : "On the scoresheet again.",
          photoWiki: g.player,
          palette: kit,
        },
      },
    });
  }

  // streak / history layer -------------------------------------------------
  const st = ctx.lastFixtures?.length ? computeStreaks(ctx.lastFixtures) : null;
  if (st) {
    const claim =
      st.winRun >= 3
        ? { n: st.winRun, label: "consecutive wins" }
        : st.unbeatenRun >= 4
          ? { n: st.unbeatenRun, label: "games unbeaten" }
          : st.cleanSheetRun >= 2
            ? { n: st.cleanSheetRun, label: "clean sheets in a row" }
            : st.scoringRun >= 5
              ? { n: st.scoringRun, label: "straight games scoring" }
              : null;
    if (claim) {
      specs.push({
        slot: "streak_history",
        kind: "weekly_deep_dive",
        data: {
          theme: `${c.name} make it ${claim.n} ${claim.label} with the ${score} ${outcomeWord} vs ${f.opponent}`,
          numbers: `${claim.n} ${claim.label} (window: last ${st.window} matches, source: football-data)`,
          window: `last ${st.window} matches`,
        },
        card: {
          kind: "milestone",
          data: {
            player: c.name,
            value: String(claim.n),
            milestoneLabel: claim.label,
            context: `${f.competition} · after the ${score} ${outcomeWord} vs ${f.opponent}`,
            stats: [
              { label: "Wins in a row", value: String(st.winRun) },
              { label: "Unbeaten run", value: String(st.unbeatenRun) },
              { label: "Clean sheet run", value: String(st.cleanSheetRun) },
              { label: "Games scoring", value: String(st.scoringRun) },
            ],
            competition: f.competition,
            palette: "terminal",
          },
        },
      });
    }
    // biggest win of the season so far (within the provided window)
    if (f.outcome === "W" && ctx.lastFixtures!.length >= 3) {
      const margin = ourGoals(f) - oppGoals(f);
      const prevMax = Math.max(
        ...ctx.lastFixtures!.filter((x) => x.id !== f.id && x.outcome === "W").map((x) => ourGoals(x) - oppGoals(x)),
        0
      );
      if (margin >= 2 && margin > prevMax) {
        specs.push({
          slot: "biggest_win",
          kind: "weekly_deep_dive",
          data: {
            theme: `${score} vs ${f.opponent}: ${c.name}'s biggest winning margin in this ${ctx.lastFixtures!.length}-game window`,
            numbers: `margin +${margin}, previous best in the window +${prevMax}`,
            window: `last ${ctx.lastFixtures!.length} matches`,
          },
          card: {
            kind: "editorial",
            data: {
              eyebrow: "Statement",
              lines: [
                { text: `${f.home} ${score} ${f.away}.` },
                { text: `Biggest winning margin in the last ${ctx.lastFixtures!.length}.`, em: true },
              ],
              dateLabel: f.competition,
              palette: kit,
            },
          },
        });
      }
    }
  }

  // the table after (league only) -----------------------------------------
  const teamRow = isLeague ? ctx.standings?.team : null;
  if (teamRow) {
    const results = (ctx.lastFixtures || [])
      .filter((x) => x.outcome)
      .slice(0, 5)
      .map((x) => ({ opponent: x.opponent, score: `${x.goalsHome ?? "?"}-${x.goalsAway ?? "?"}`, outcome: x.outcome as "W" | "D" | "L" }));
    specs.push({
      slot: "table_after",
      kind: "weekly_deep_dive",
      data: {
        theme: `Where the ${outcomeWord} vs ${f.opponent} leaves ${c.name}`,
        numbers: `${teamRow.rank}th, ${teamRow.points} pts from ${teamRow.played}, GF ${teamRow.goalsFor} GA ${teamRow.goalsAgainst}, form ${teamRow.form || "n/a"}`,
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
          competition: f.competition,
          palette: "terminal",
        },
      },
    });
  }

  // season-start comparison (league only) ---------------------------------
  const pp = isLeague ? ctx.pointsProgression : null;
  if (pp?.past?.length) {
    const entries = [
      { value: String(pp.current.points), label: pp.current.season, sub: `${pp.current.position}th`, highlight: true },
      ...pp.past.map((s) => ({ value: String(s.points), label: s.season, sub: `${s.position}th` })),
    ];
    specs.push({
      slot: "season_start_compare",
      kind: "weekly_deep_dive",
      data: {
        theme: `${c.name}'s start vs recent seasons, after ${pp.current.played} game(s)`,
        numbers: entries.map((e) => `${e.label}: ${e.value} pts (${e.sub})`).join(", "),
        window: `first ${pp.current.played} league game(s)`,
      },
      card: {
        kind: "leaderboard",
        data: {
          title: `Points after ${pp.current.played} game(s)`,
          context: `${c.name} · season starts compared`,
          entries,
          footnote: "same-stage standings · source: football-data",
          palette: "terminal",
        },
      },
    });
  }

  // head-to-head ledger ----------------------------------------------------
  if (ctx.h2h && ctx.h2h.played > 0) {
    specs.push({
      slot: "h2h_ledger",
      kind: "weekly_deep_dive",
      data: {
        theme: `The ledger vs ${f.opponent} after today's ${score}`,
        numbers: `before today: ${ctx.h2h.wins}W ${ctx.h2h.draws}D ${ctx.h2h.losses}L in ${ctx.h2h.played}; today: ${outcomeWord} ${score}`,
        window: `last ${ctx.h2h.played} meetings`,
      },
      card: {
        kind: "editorial",
        data: {
          eyebrow: `vs ${f.opponent}`,
          lines: [
            { text: `${ctx.h2h.wins} wins. ${ctx.h2h.draws} draws. ${ctx.h2h.losses} defeats.` },
            { text: `And now: ${outcomeWord}, ${score}.`, em: true },
          ],
          dateLabel: f.competition,
          palette: "neutral",
        },
      },
    });
  }

  // on to the next ---------------------------------------------------------
  if (ctx.nextFixture) {
    const n = ctx.nextFixture;
    specs.push({
      slot: "next_up",
      kind: "match_preview",
      data: {
        opponent: n.opponent,
        competition: n.competition,
        date: n.date,
        venue: n.venue || (n.isHome ? "home" : "away"),
        hook: `straight off the ${score} ${outcomeWord} vs ${f.opponent}`,
      },
      card: {
        kind: "match_preview",
        data: {
          home: n.home,
          away: n.away,
          competition: n.competition,
          dateLabel: n.date,
          venue: n.venue,
          palette: n.isHome ? "home" : "away",
        },
      },
    });
  }

  return specs;
}

export async function runFulltimeBurst(ctx: FulltimeContext): Promise<BurstResult[]> {
  const { composeAndPost } = await import("../shared/poster");
  const specs = fulltimePlan(ctx);
  return Promise.all(
    specs.map(async (s): Promise<BurstResult> => {
      try {
        const r = await composeAndPost({
          kind: s.kind,
          data: s.data,
          card: s.card,
          source: "cron:fulltime",
          idKey: `tweet:ft:${ctx.fixture.id}:${s.slot}`,
          idTtlSec: 24 * 60 * 60,
        });
        return { slot: s.slot, draftId: r.draftId, posted: r.posted, skipped: r.skipped };
      } catch (e) {
        return { slot: s.slot, error: String((e as Error).message || e).slice(0, 140) };
      }
    })
  );
}
