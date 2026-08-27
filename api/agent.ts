export const config = { runtime: "edge" };

/**
 * Graph compose endpoint (protected).
 *
 *   POST /api/agent { request: string }
 *   → { trace: NodeTrace[], draftId?, tweet?, reply }
 *
 * Runs the engineered compose graph (plan → gather → verify → design →
 * write+draft) and returns the full node trace for the console to render.
 */
import { runComposeGraph } from "../packages/agent/graph";
import { routeAndChat } from "../packages/shared/openrouter";
import { club } from "../packages/shared/club";
import { withErrorLogging } from "../packages/observability/index";
import { requireOpsAuth } from "../packages/shared/auth";

/**
 * Analyst fallback: when the pipeline ends without a draft (the request was
 * a QUESTION, or the writer refused), answer the operator directly from
 * whatever the gather stage found instead of shrugging at a trace.
 */
async function analystAnswer(request: string, data: Record<string, unknown>, failed: string[]): Promise<string> {
  try {
    const out = await routeAndChat({
      messages: [
        {
          role: "system",
          content: `You are the ${club().fullName} data analyst for the club's own operator (not a fan-facing tweet). Answer the question directly and concretely using ONLY the gathered data below. Lead with numbers. If the data cannot answer it, say exactly what is missing and which source would have it (e.g. Sofascore for cup match player stats, the FBref bookmarklet for positional metrics). Never invent stats. Plain text, no markdown, max 120 words. Never use em or en dashes.`,
        },
        {
          role: "user",
          content: `Question: ${request}

Gathered data (JSON): ${JSON.stringify(data).slice(0, 6000)}

Tools that failed: ${failed.join(", ") || "none"}`,
        },
      ],
    });
    return (out.content || "").trim() || "No answer could be produced from the gathered data.";
  } catch (e) {
    return `Answer stage failed: ${String((e as Error).message || e).slice(0, 120)}`;
  }
}

export default withErrorLogging(async function handler(
  req: Request,
): Promise<Response> {
  const denied = requireOpsAuth(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as {
    request?: string;
  } | null;
  const request = String(body?.request || "").trim();
  if (!request)
    return Response.json({ error: "request required" }, { status: 400 });

  const state = await runComposeGraph(request);
  const aborted = !state.grounding.ok;
  let reply: string;
  if (state.draftId) {
    reply = `Draft ${state.draftId.slice(0, 8)} queued${state.design?.card_kind ? ` with a ${state.design.card_kind} card (${state.design.palette} kit)` : " (copy only)"}. ${state.design?.rationale || ""}`;
  } else if (aborted) {
    reply = `No tool returned usable data (failed: ${state.grounding.failed.join(", ") || "none"}). Nothing was drafted. If this was about a cup match or a specific player's match stats, the structured tools cannot see those: check Sofascore (Stat sources page) or ask me in plain chat where I can use web_lookup.`;
  } else {
    // No draft but we DO have data: answer the operator instead.
    reply = await analystAnswer(request, state.data, state.grounding.failed);
  }
  return Response.json({
    trace: state.trace,
    draftId: state.draftId,
    tweet: state.tweet,
    reply,
  });
});
