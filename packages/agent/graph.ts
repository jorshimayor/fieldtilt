/**
 * Compose graph — an engineered agent, not a free-running loop.
 *
 *   plan ──▶ gather ──▶ verify ──▶ design ──▶ write+draft
 *              ▲           │
 *              └── rework ─┘   (one retry of failed tools, then proceed
 *                               or abort with an honest grounding report)
 *
 * Each node is a typed function over shared state; the whole run returns a
 * trace the console renders step by step. The LLM is used for judgment
 * (planning, design); everything mechanical (tool fan-out, validation,
 * queueing) is deterministic code. Copywriting stays inside create_draft's
 * house-voice composer, so graph drafts obey the same guardrails as chat.
 */
import { routeAndChat } from "../shared/openrouter";
import { club } from "../shared/club";
import type { TweetKind } from "../shared/tweet-prompts";
import type { CardKind } from "../render/index";
import { TWEET_KINDS, CARD_KINDS } from "./kinds";

export type NodeTrace = {
  node: string;
  status: "ok" | "error" | "rework" | "skip";
  ms: number;
  note: string;
};

export type PlannedTool = { name: string; args: Record<string, unknown> };

export type GraphState = {
  request: string;
  plan?: {
    intent: string;
    tweet_kind: TweetKind;
    tools: PlannedTool[];
    card_candidates: CardKind[];
  };
  data: Record<string, unknown>;
  grounding: { ok: boolean; failed: string[]; webSources: string[] };
  design?: {
    card_kind?: CardKind;
    palette: "neutral" | "home" | "away" | "terminal";
    card_data?: Record<string, unknown>;
    copy_data?: Record<string, unknown>;
    rationale: string;
  };
  draftId?: string;
  tweet?: string;
  trace: NodeTrace[];
  reworked: boolean;
};

export type GraphDeps = {
  /** LLM call that must return parsed JSON (one corrective retry inside). */
  llmJson: (system: string, user: string) => Promise<any>;
  exec: (name: string, args: Record<string, unknown>) => Promise<any>;
};

const GATHER_TOOLS = [
  "get_upcoming_fixtures",
  "get_recent_results",
  "get_standings",
  "get_top_performers",
  "get_advanced_player_stats",
  "get_league_xg_table",
  "get_head_to_head",
  "get_player_shots",
  "get_positional_stats",
  "get_player_career",
  "get_former_club_players",
  "get_points_vs_past_seasons",
  "get_league_coefficients",
  "web_lookup",
];

async function defaultLlmJson(system: string, user: string): Promise<any> {
  for (const corrective of [null, "Your previous reply was not valid JSON. Reply with ONLY a valid JSON object."]) {
    const out = await routeAndChat({
      messages: [
        { role: "system", content: system },
        { role: "user", content: corrective ? `${user}\n\n${corrective}` : user },
      ],
    });
    const text = (out.content || "").trim().replace(/^```(?:json)?/, "").replace(/```$/, "").trim();
    try {
      return JSON.parse(text);
    } catch {
      /* one corrective retry */
    }
  }
  throw new Error("llm_json_invalid: model would not produce JSON");
}

export const defaultDeps: GraphDeps = {
  llmJson: defaultLlmJson,
  // Lazy: keeps the wasm-renderer import chain out of unit tests.
  exec: async (name, args) => (await import("./tools")).execTool(name, args),
};

function timed(state: GraphState, node: string) {
  const t0 = Date.now();
  return (status: NodeTrace["status"], note: string) =>
    state.trace.push({ node, status, ms: Date.now() - t0, note: note.slice(0, 160) });
}

// ---------------------------------------------------------------- nodes

async function nodePlan(state: GraphState, deps: GraphDeps): Promise<void> {
  const done = timed(state, "plan");
  const c = club();
  const plan = await deps.llmJson(
    `You plan data-gathering for a ${c.fullName} social post. Reply ONLY with JSON:
{"intent": "<one line>", "tweet_kind": one of ${JSON.stringify(TWEET_KINDS)},
 "tools": [{"name": "<tool>", "args": {…}} …] (1-5 items, choose from ${JSON.stringify(GATHER_TOOLS)};
   web_lookup args: {"question": "…"} — REQUIRED whenever the request involves a cup match, a specific match's player performance, or anything the league tools cannot see; also for cup fixtures, kickoff times, lower-league opponents),
 "card_candidates": up to 2 of ${JSON.stringify(CARD_KINDS)}}`,
    `Request: ${state.request}\nToday: ${new Date().toISOString().slice(0, 10)}`
  );
  const tools = (Array.isArray(plan?.tools) ? plan.tools : [])
    .filter((t: any) => GATHER_TOOLS.includes(t?.name))
    .slice(0, 5)
    .map((t: any) => ({ name: t.name, args: t.args && typeof t.args === "object" ? t.args : {} }));
  if (!tools.length) throw new Error("plan produced no valid tools");
  state.plan = {
    intent: String(plan?.intent || state.request).slice(0, 200),
    tweet_kind: TWEET_KINDS.includes(plan?.tweet_kind) ? plan.tweet_kind : "player_stat",
    tools,
    card_candidates: (Array.isArray(plan?.card_candidates) ? plan.card_candidates : []).filter((k: any) =>
      CARD_KINDS.includes(k)
    ),
  };
  done("ok", `${state.plan.intent} · tools: ${tools.map((t: PlannedTool) => t.name).join(", ")}`);
}

async function nodeGather(state: GraphState, deps: GraphDeps, only?: PlannedTool[]): Promise<void> {
  const done = timed(state, only ? "gather(rework)" : "gather");
  const targets = only ?? state.plan!.tools;
  const results = await Promise.all(
    targets.map(async (t) => {
      try {
        return { name: t.name, result: await deps.exec(t.name, t.args) };
      } catch (e) {
        return { name: t.name, result: { error: String((e as Error).message || e) } };
      }
    })
  );
  for (const r of results) state.data[r.name] = r.result;
  const failed = results.filter((r) => (r.result as any)?.error).map((r) => r.name);
  done(failed.length === targets.length ? "error" : "ok", failed.length ? `failed: ${failed.join(", ")}` : `${results.length} tool(s) returned data`);
}

async function nodeVerify(state: GraphState, deps: GraphDeps): Promise<"proceed" | "rework" | "abort"> {
  const done = timed(state, "verify");
  const failed = Object.entries(state.data)
    .filter(([, v]) => (v as any)?.error)
    .map(([k]) => k);
  const web = state.data["web_lookup"] as any;
  const webSources: string[] = Array.isArray(web?.source_urls) ? web.source_urls : [];
  const okCount = Object.keys(state.data).length - failed.length;
  state.grounding = { ok: okCount > 0, failed, webSources };
  if (failed.length && !state.reworked) {
    done("rework", `retrying failed tools once: ${failed.join(", ")}`);
    return "rework";
  }
  if (!state.grounding.ok) {
    done("error", "no tool returned usable data — refusing to draft ungrounded");
    return "abort";
  }
  done("ok", `${okCount} grounded source(s)${webSources.length ? ` · web citations: ${webSources.length}` : ""}${failed.length ? ` · degraded without: ${failed.join(", ")}` : ""}`);
  return "proceed";
}

async function nodeDesign(state: GraphState, deps: GraphDeps): Promise<void> {
  const done = timed(state, "design");
  const dataStr = JSON.stringify(state.data).slice(0, 6000);
  const shapes = `match_preview {home, away, competition, dateLabel, venue?, footnote?}
score {home, away, homeGoals, awayGoals, competition, statusLabel, scorers?[], statLine?}
post_match {home, away, homeGoals, awayGoals, competition, statusLabel, seasonLabel?, scorers?[], stats:{possession?, xg?, shotsTotal?, shotsOnTarget?, corners?, passAccuracy?, fouls?}}
player_stat {player, season, competition?, context?, stats:[{label, value}] (max 6), formPills?:["W"|"D"|"L"] (max 5), remark?}
transfer {player, direction:"in"|"out", counterparty, transferType?, dateLabel?}
form {seasonLabel, results:[{opponent, score, outcome}] (max 5), position?, points?, goalsFor?, goalsAgainst?, competition?}
editorial {eyebrow, lines:[{text, em?}] (max 7)}
milestone {player, value, milestoneLabel, context?, stats:[{label, value}] (max 6), dateLabel?, competition?}
comparison {title?, playerA, playerB, context, metrics:[{label, a, b, aDisplay?, bDisplay?}] (max 6), footnote}
leaderboard {title, context?, entries:[{value, label, sub?, highlight?}] (max 7, ranked), footnote?}
shot_map {player, context?, shots:[{x, y, xG, result}] (pass through EXACTLY what get_player_shots returned), remark?, footnote}
scatter {title, context?, xLabel, yLabel, points:[{label, x, y, score?, highlight?}] (max 26), quadrants?:{tl,tr,bl,br}, xInvert?/yInvert?, footnote}
head_to_head {title? (max 2 short lines), context?, playerA, playerB, roleA?, roleB?, photoAWiki/photoBWiki (player names — renderer fetches Wikipedia headshots), crestAClub/crestBClub (club names — renderer fetches crests), metrics:[{label, a, b, aDisplay?, bDisplay?, higherIsBetter?}] (max 8; higherIsBetter:false for conceded/cards), careerTitle?, careerA/careerB:[{label, value}] (max 3), tagline?, footnote ("photos: Wikimedia Commons")}`;
  for (const attempt of [0, 1]) {
    const d = await deps.llmJson(
      `You are the DESIGN stage of a football graphics pipeline. Choose the infographic for this post and fill its data — every value MUST come from the gathered data below, never invented. Reply ONLY with JSON:
{"card_kind": one of ${JSON.stringify(state.plan!.card_candidates.length ? state.plan!.card_candidates : CARD_KINDS)} or null,
 "palette": "home" (home fixtures, celebrations) | "away" (away fixtures) | "neutral" (analysis) | "terminal" (mono terminal skin, best for data-heavy analysis: leaderboards, shot maps, xG tables),
 "card_data": object matching the shape, or null,
 "copy_data": flat object of the concrete facts the tweet writer needs (strings/numbers only — e.g. {"opponent":"Luton Town","competition":"Carabao Cup R2","date":"Thu 27 Aug, 19:30 WAT","venue":"Stamford Bridge","hook":"H2H: W2, 6-2 agg","source":"chelseafc.com"}). NEVER empty — this is what the copy is written from,
 "rationale": "<one line on the design choice>"}\nNever use em dashes or en dashes in any card text or copy_data value; use hyphens or commas.
Card shapes:\n${shapes}
${state.grounding.webSources.length ? "Facts from web_lookup MUST be credited: put the source domain in a footnote/context field." : ""}`,
      `Post intent: ${state.plan!.intent}\nGathered data: ${dataStr}${attempt ? "\n\nYour previous card_data was invalid or empty — fix it or set card_kind to null." : ""}`
    );
    const kind = d?.card_kind;
    const copyData = d?.copy_data && typeof d.copy_data === "object" ? d.copy_data : undefined;
    if (kind == null) {
      state.design = { palette: ["home", "away", "terminal"].includes(d?.palette) ? d.palette : "neutral", copy_data: copyData, rationale: String(d?.rationale || "no card") };
      done("ok", `no card · ${state.design.rationale}`);
      return;
    }
    if (CARD_KINDS.includes(kind) && d?.card_data && typeof d.card_data === "object" && Object.keys(d.card_data).length) {
      state.design = {
        card_kind: kind,
        palette: ["home", "away", "terminal"].includes(d?.palette) ? d.palette : "neutral",
        card_data: { ...d.card_data, palette: ["home", "away", "terminal"].includes(d?.palette) ? d.palette : "neutral" },
        copy_data: copyData,
        rationale: String(d?.rationale || "").slice(0, 160),
      };
      done("ok", `${kind} · ${state.design.palette} kit · ${state.design.rationale}`);
      return;
    }
  }
  state.design = { palette: "neutral", rationale: "design stage could not produce a valid card — drafting copy-only" };
  done("error", state.design.rationale);
}

async function nodeDraft(state: GraphState, deps: GraphDeps): Promise<void> {
  const done = timed(state, "write+draft");
  // The design stage distills copy_data — the flat facts the house writer's
  // per-kind templates expect. Raw tool payloads make the writer SKIP.
  const payload: Record<string, unknown> = state.design?.copy_data && Object.keys(state.design.copy_data).length
    ? { ...state.design.copy_data }
    : { intent: state.plan!.intent, ...state.data };
  if (state.grounding.webSources.length) payload.sources = state.grounding.webSources.slice(0, 4).join(" ");
  try {
    const result = await deps.exec("create_draft", {
      kind: state.plan!.tweet_kind,
      tone: "professional",
      data_json: JSON.stringify(payload).slice(0, 7000),
      card_kind: state.design?.card_kind,
      card_data_json: state.design?.card_data ? JSON.stringify(state.design.card_data) : undefined,
    });
    state.draftId = result?.draftId;
    state.tweet = result?.tweet;
    done("ok", `draft ${String(result?.draftId || "").slice(0, 8)} queued`);
  } catch (e) {
    done("error", String((e as Error).message || e));
  }
}

// ---------------------------------------------------------------- runner

export async function runComposeGraph(request: string, deps: GraphDeps = defaultDeps): Promise<GraphState> {
  const state: GraphState = {
    request,
    data: {},
    grounding: { ok: false, failed: [], webSources: [] },
    trace: [],
    reworked: false,
  };
  await nodePlan(state, deps);
  await nodeGather(state, deps);
  let verdict = await nodeVerify(state, deps);
  if (verdict === "rework") {
    state.reworked = true;
    const failedTools = state.plan!.tools.filter((t) => state.grounding.failed.includes(t.name));
    await nodeGather(state, deps, failedTools);
    verdict = await nodeVerify(state, deps);
  }
  if (verdict === "abort") return state;
  await nodeDesign(state, deps);
  await nodeDraft(state, deps);
  return state;
}
