# BlueBanter TS — Chelsea FC X Bot

Autonomous Chelsea FC account for X: live scores, match previews, post-match
stats, confirmed transfers, player spotlights, and weekly form reviews — every
post grounded in real API-Football data and paired with a programmatically
rendered infographic (SVG → PNG via resvg-wasm, in-worker).

Runs on Cloudflare Workers with Neon + Drizzle, Upstash Redis, and OpenRouter
for tweet copy.

## Quickstart

- Install: `pnpm install`
- Local env: copy `.env.example` → `.env` (DB migrations), and create `.dev.vars` (Wrangler runtime env)
- Apply DB schema: `pnpm db:push`
- Run locally: `pnpm dev` (serves `http://localhost:3000`)
- Tests: `pnpm test` • Types: `pnpm typecheck`
- Preview an infographic: `http://localhost:3000/api/render?kind=post_match`
- Readiness check: `http://localhost:3000/api/health`
- Deploy (production): `pnpm deploy` — then follow **[docs/PRODUCTION.md](docs/PRODUCTION.md)**

## What posts, when

All content crons compose: live data → LLM tweet (numbers are never invented)
→ infographic card → X post with media. `config/flags.json` ships in
draft-only mode; see the production runbook to go live.

| Schedule (UTC) | Post |
| --- | --- |
| Daily 07:00 | Match preview + card (when a fixture is ≤48h away) |
| Every 5 min | Live score + full-time recap cards (only during the match window) |
| Daily 08:00 | Confirmed transfers in/out + transfer card |
| Mon 09:00 | Weekly form + league standing card |
| Wed 12:00 | Player spotlight stat card |
