/**
 * Compose-graph tests — fake LLM + fake tools via dependency injection.
 * Asserts node ordering, the rework edge, design validation fallback, and
 * the ungrounded abort.
 */
import { runComposeGraph, GraphDeps } from "../../packages/agent/graph";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}

const PLAN = {
  intent: "preview the cup tie",
  tweet_kind: "match_preview",
  tools: [{ name: "get_head_to_head", args: {} }, { name: "web_lookup", args: { question: "when" } }],
  card_candidates: ["match_preview"],
};
const DESIGN = {
  card_kind: "match_preview",
  palette: "home",
  card_data: { home: "Chelsea", away: "Luton", competition: "Carabao Cup", dateLabel: "Thu 27 Aug" },
  copy_data: { opponent: "Luton Town", competition: "Carabao Cup R2", date: "Thu 27 Aug" },
  rationale: "cup tie at home",
};

function deps(overrides: Partial<{ execMap: Record<string, any[]>; llmQueue: any[] }>): GraphDeps & { calls: string[] } {
  const execMap: Record<string, any[]> = overrides.execMap ?? {
    get_head_to_head: [{ opponent: "Luton", wins: 2 }],
    web_lookup: [{ answer: "Thu", source_urls: ["https://chelseafc.com/x"] }],
    create_draft: [{ draftId: "abcd1234-xxxx", tweet: "tweet!" }],
  };
  const llmQueue = overrides.llmQueue ?? [PLAN, DESIGN];
  const calls: string[] = [];
  return {
    calls,
    llmJson: async () => llmQueue.shift(),
    exec: async (name) => {
      calls.push(name);
      const q = execMap[name];
      if (!q || !q.length) throw new Error(`tool_down: ${name}`);
      return q.length > 1 ? q.shift() : q[0];
    },
  };
}

async function main() {
// happy path
{
  const d = deps({});
  const s = await runComposeGraph("preview the Luton cup tie", d);
  check("nodes in order", s.trace.map((t) => t.node).join(">") === "plan>gather>verify>design>write+draft");
  check("draft queued", s.draftId === "abcd1234-xxxx");
  check("web sources captured", s.grounding.webSources.length === 1);
  check("design palette applied", (s.design?.card_data as any)?.palette === "home");
}

// rework edge: web_lookup fails once, succeeds on retry
{
  const d = deps({
    execMap: {
      get_head_to_head: [{ opponent: "Luton" }],
      web_lookup: [{ error: "quota" }, { answer: "Thu", source_urls: ["https://x"] }],
      create_draft: [{ draftId: "dddd0000", tweet: "t" }],
    },
    llmQueue: [PLAN, DESIGN],
  });
  const s = await runComposeGraph("preview", d);
  check("rework traced", s.trace.some((t) => t.status === "rework"));
  check("rework re-gathers only failed tool", s.trace.some((t) => t.node === "gather(rework)"));
  check("rework then drafts", s.draftId === "dddd0000");
}

// design invalid twice → copy-only draft
{
  const d = deps({ llmQueue: [PLAN, { card_kind: "match_preview", card_data: {} }, { card_kind: "nope" }] });
  const s = await runComposeGraph("preview", d);
  check("invalid design degrades to copy-only", s.draftId === "abcd1234-xxxx" && !s.design?.card_kind);
}

// every tool dead → abort, no draft
{
  const d = deps({ execMap: { create_draft: [{ draftId: "should-not-run" }] }, llmQueue: [PLAN] });
  const s = await runComposeGraph("preview", d);
  check("ungrounded aborts without draft", !s.draftId);
  check("abort never calls create_draft", !d.calls.includes("create_draft"));
}

if (failures) { console.error(`${failures} graph test(s) failed`); process.exit(1); }
console.log("All agent-graph tests passed");
}
main();
