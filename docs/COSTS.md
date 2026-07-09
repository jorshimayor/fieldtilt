# Running Cheap — Cost Guide & Free Data Options

## The $0/month stack (what this repo now supports)

| Layer | Choice | Cost | Catch |
| --- | --- | --- | --- |
| Hosting | Cloudflare Workers **free** | $0 | 10ms CPU — fine for everything EXCEPT server-side PNG rendering. Solved: the dashboard approval flow rasterizes images **in your browser**, so manual posting works fully on the free plan. |
| LLM | OpenRouter free-tier models — set `OPENROUTER_MODEL=x-ai/grok-4.1-fast:free` (or another `:free` model) | $0 | Rate limits, occasional queueing. Paid Grok fast is ~pennies/month at this volume anyway. |
| Database | Neon free tier | $0 | Plenty (drafts, tokens, dedup) |
| Cache | Upstash Redis free tier | $0 | 10k commands/day — plenty |
| Posting | X API free tier | $0 | ~500 posts/month app cap; long-form posts (>280 chars) additionally require X Premium on the *account* |
| Football data | see below | $0–19 | The real decision |

Total: **$0/mo** with browser-rendered images + manual approval posting.
Add **$5/mo** (Workers Paid) only if you want unattended auto-posting with
images (server-side rendering needs the CPU). Add **~$19/mo** (API-Football
Pro) only if you want rich live in-match stats.

## Which platforms give live football data for free?

Honest answer: **no reputable API gives you full live minute-by-minute stats
(possession, xG, shot maps) for free.** What exists:

| Source | Free tier | Live? | Stats depth | Risk |
| --- | --- | --- | --- | --- |
| **football-data.org** | 10 req/min, PL + 12 comps, **current season** | Yes — live scores/status (slight delay) | Fixtures, results, standings, scorers. No possession/xG. | Low — reputable, stable. **Best free choice.** |
| **API-Football free** | 100 req/day | ❌ no live, seasons 2021–23 only | (historical only) | Useless for a live bot |
| **TheSportsDB** | Free key | Livescores are Patreon-only (~$10/mo) | Basic | Low |
| **Understat** (integrated — `packages/tools/understat.ts`) | Free | Post-match xG updates | Player xG/npxG/xA/xGChain, team xG tables — current season | Medium — unofficial JSON endpoints, can change; everything degrades gracefully when it does |
| **OpenLigaDB** | Free | Yes | German comps only | N/A for the PL |
| Sofascore / FotMob / Flashscore (unofficial) | Free scraping | Yes, rich (xG!) | Deep | **High** — against ToS, endpoints break without notice, IP blocks. Not production-safe. |
| **ESPN hidden JSON API** | Free, undocumented | Yes | Scores, events, some stats | Medium — unofficial, can change silently |

### Recommended configurations

1. **$0 — "free live scores"**: football-data.org for fixtures/live
   scores/standings/scorers. You lose possession/xG in live and post-match
   cards (templates already hide missing stats gracefully). ~Match previews,
   live score cards, FT results, form/standings, transfers via free news
   sources.
2. **$19/mo — "full fat"**: API-Football Pro. Everything works: possession,
   xG, shots, H2H, player season stats, transfers, headshots.
3. Start on (1), upgrade to (2) when the account earns it.

> **The adapter is built.** Both providers implement the same interface
> (`packages/tools/types.ts`); the facade (`packages/tools/football.ts`)
> picks one from env. Set `FOOTBALL_DATA_KEY` for free data today; add
> `API_FOOTBALL_KEY` later and the bot upgrades itself — no code changes.

## The upgrade roadmap (free → starter → recommended)

| When | Change | What you touch |
| --- | --- | --- |
| **Now — Free ($0)** | football-data.org + approval queue | `wrangler secret put FOOTBALL_DATA_KEY`; keep `publish_draft_only: true` |
| **~Month 5 — Starter ($5)** | Unattended auto-posting | Upgrade Workers to Paid, uncomment `[limits]` in wrangler.toml, set `publish_draft_only: false`, deploy |
| **~Month 10 — Recommended (~$24)** | Full live stats, xG, transfers, player cards | `wrangler secret put API_FOOTBALL_KEY` — the provider switches automatically (transfers cron and stat-rich cards light up on their own) |

Each step is additive; nothing from an earlier tier gets rewritten. `/api/health`
reports the active provider and its capabilities so you can confirm each switch.

## Cost controls already built in

- **API budget guard**: hard daily stop after `API_FOOTBALL_DAILY_BUDGET`
  (default 90) upstream calls.
- **Match-window gate**: the 5-min poller makes zero API calls outside
  kickoff−15min → +4h.
- **Aggressive caching**: Redis + Neon warm caches on every fetcher (15min–7d
  TTLs by volatility).
- **Draft-first pipeline**: no accidental LLM/posting spend — composing is
  the only cost until you hit Post.
- **`OPENROUTER_MODEL` env**: pin any cheaper/free model without a deploy.
