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
import { withErrorLogging } from "../packages/observability/index";
import { requireOpsAuth } from "../packages/shared/auth";

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
  const reply = aborted
    ? `Aborted: no tool returned usable data (failed: ${state.grounding.failed.join(", ") || "none"}). Nothing was drafted.`
    : state.draftId
      ? `Draft ${state.draftId.slice(0, 8)} queued${state.design?.card_kind ? ` with a ${state.design.card_kind} card (${state.design.palette} kit)` : " (copy only)"}. ${state.design?.rationale || ""}`
      : "Pipeline finished without a draft — see trace.";
  return Response.json({
    trace: state.trace,
    draftId: state.draftId,
    tweet: state.tweet,
    reply,
  });
});
