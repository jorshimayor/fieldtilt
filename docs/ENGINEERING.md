# Engineering Notes — bluebot

An honest account of how this system is built, what it costs, what the
numbers are, and what it doesn't do. Written for an engineer or hiring
manager who wants the five-minute truth rather than the pitch. (This is
also the source material for the public engineering write-up — every figure
below is real and reproducible from this repo.)

## The system in one paragraph

A production content system for football: five cron pipelines pull live data
(fixtures, live scores, standings, transfers, advanced xG), compose tweet
copy through an LLM that is structurally prevented from inventing numbers,
render data-accurate infographics (SVG templates → PNG via resvg-wasm), and
queue everything in an approval dashboard from which a human posts to X —
or, with one flag, the system posts unattended. One Cloudflare Worker,
edge-deployed, no servers.

## Real numbers (as deployed, August 2026)

| Metric | Value | How measured |
| --- | --- | --- |
| First-party TypeScript | ~5,300 lines across 50 files (plus ~600 lines of dashboard JS) | `wc -l` over api/packages/cloudflare/tests |
| Runtime dependencies | 8 | package.json |
| Bundle (worker.mjs) | 2.88 MB raw → 0.93 MB gzip | esbuild output; three embedded TTF fonts account for ~1.4 MB raw |
| WASM (resvg) | 2.48 MB raw → ~0.95 MB gzip | shipped beside the bundle, compiled by Cloudflare at deploy |
| Total upload | 1.85 MB gzip | wrangler deploy output |
| Worker startup | 27 ms | wrangler deploy validation |
| Unit test assertions | 75, in 5 suites | `pnpm test` |
| CI gates | typecheck, tests, worker build, bundle size, cold start, token budget, DB query count | .github/workflows/ci.yml |
| Infrastructure cost | $0/month | Workers free plan + Neon free + Upstash free + football-data.org free |
| Marginal cost per post | ≈ half a US cent (LLM tokens only; ~650 tokens/composition) | OpenRouter usage, approximate |
| Football API spend | ≤ ~60 requests on a match day, near-zero otherwise | request-budget counters (see below) |

## The decisions that matter

**Cloudflare Workers over Vercel Edge (migration is in the git history).**
One deploy artifact, cron triggers included, and CPU-time pricing that makes
the economics legible. The 10 ms CPU cap on the free plan is real and shaped
the architecture (see rendering, below).

**Provider abstraction as a cost strategy, not an aesthetic.** All football
data flows through one normalized interface
([packages/tools/types.ts](../packages/tools/types.ts)) with two
implementations: football-data.org (free tier) and API-Football (paid).
Each provider declares capabilities (`xg`, `transfers`, `liveMinute`…) and
every pipeline degrades explicitly when a capability is absent. Upgrading
from the $0 stack to the full-stats stack is pasting one API key — no code
change. Provider-scoped cache keys prevent id-space collisions.

**Rendering under a 10 ms CPU cap.** Infographics are pure-function SVG
templates (testable as strings) rasterized by resvg-wasm. But wasm
rasterization blows the free plan's CPU budget — so the approval flow
rasterizes **in the reviewing browser instead**: the Worker serves SVG with
fonts inlined as base64 `@font-face`, the dashboard draws it to a canvas,
and the resulting PNG is uploaded on approve. Server-side rendering exists
behind the same interface for the paid plan and unattended posting. Free
plan, real images, no compromise on output.

**LLM guardrails as architecture, not prompt vibes.** The composer only
receives numbers fetched from providers; prompts hard-require "never invent
stats" and emit a SKIP sentinel when data is insufficient; normalizers
enforce length and suffix invariants; and the agentic chat's `create_draft`
tool rejects empty grounding data with corrective errors the model can act
on. Adversarial finding from testing: the production model silently sent
`{}` for nested object tool parameters — fixed by flattening tool schemas
to JSON-string parameters with strict server-side validation.

**Idempotency at three layers.** Redis `SET NX` claims before any LLM spend
(a 5-minute poller must not stack duplicate drafts), durable Postgres
claims for content that must never repeat (transfers, spotlights), and a
full-time done-marker so the poller stops spending API calls once the recap
is queued.

**Rate limiting driven by the provider's own headers.** The
football-data.org client reads `X-Requests-Available-Minute` /
`X-RequestCounter-Reset` on every response, shares that state across
isolates via cache, sleeps through short resets, and fails fast to cached
data on long ones. The API-Football client carries a Redis daily budget
counter (default 90/day) as a hard stop. The match-day poller is gated to a
kickoff window warmed by the daily cron — outside it, zero API calls.

**Scraping honestly.** The Understat integration (advanced xG) is an
unofficial source and says so in its header comment: 12-hour caches, never
touched by the poller, every consumer degrades to "no xG layer" rather than
breaking, and copy that uses the numbers credits the source. A portfolio
piece that violates a provider's terms is an interview liability; this one
documents its risk posture instead.

## What this system does NOT prove (the honest gap list)

1. **No model of my own.** It consumes Understat's xG; it produces no
   original football judgment. It is a publishing system, not an analysis
   system. *(Being fixed: a Python analytics service — see
   [analytics/](../analytics/README.md) — will supply its own xG and weekly
   forecasts; this Worker becomes the delivery layer.)*
2. **TypeScript-only** while football data science runs on Python. Same
   fix: models in Python, delivery in TS — polyglot by design, not
   confusion.
3. ~~**Single-club coupling.**~~ Fixed ahead of schedule: every club fact
   (provider ids, league mappings, hashtag, voice hooks) lives in
   `packages/shared/club.ts`; switching club — or spinning up the BlueCo
   sibling — is `CLUB=strasbourg` on the Worker. Prompts, cards, crons,
   agent and dashboard all derive from it.
4. **No tracking data, no video linkage.** Event-level and aggregate data
   only. Club-grade tooling links every number back to video; this doesn't.
5. **Small-N testing.** 75 assertions cover parsers, mappers, templates and
   prompts well, but there is no integration harness faking the providers,
   and the agent loop is verified empirically rather than by contract
   tests.
6. **Operational blind spots.** No alerting on cron failures (errors log to
   `wrangler tail` and an optional webhook), and the free-plan Redis-less
   fallback weakens idempotency to per-isolate memory.

## What I would do differently starting today

- Start with the provider abstraction on day one instead of retrofitting it.
- Put model outputs (not just content) in Postgres from the start — the
  analytics service now imposes that.
- Contract tests against recorded provider fixtures before the first cron,
  not after the fifth.
