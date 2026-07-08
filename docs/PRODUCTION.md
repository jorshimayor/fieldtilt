# Going Live — Production Runbook

The bot posts real Chelsea data to X on these schedules (all UTC):

| Cron | When | What it posts |
| --- | --- | --- |
| `0 7 * * *` | daily 08:00 WAT | Match preview + preview card (only when a fixture is ≤48h away); also warms the match-day gate |
| `*/5 * * * *` | every 5 min | Live score updates + score card, and the full-time recap + stats card. Only spends API calls inside the match window (kickoff −15min → +4h) |
| `0 8 * * *` | daily 09:00 WAT | Confirmed transfers (in/out, last 14 days, never repeated) + transfer card |
| `0 9 * * 1` | Monday 10:00 WAT | Weekly form review + form/standings card |
| `0 12 * * 3` | Wednesday 13:00 WAT | Player spotlight + stat card (top performer, rotates monthly) |

Every post = LLM tweet copy (grounded in the fetched numbers, never invented)
+ a programmatic PNG infographic rendered from the same data.

## 1. Accounts & plans you need

| Service | Plan | Why |
| --- | --- | --- |
| API-Football | **Pro (~$19/mo)** | The free tier has NO current-season or live data (only 2021–2023). Live match posts require a paid plan. |
| Cloudflare Workers | **Paid ($5/mo)** | Free plan allows 10ms CPU — not enough to rasterize infographics. After upgrading, uncomment the `[limits]` block in `wrangler.toml`. |
| X API | Free tier works (≤500 posts/mo app cap; media upload included). Basic ($200/mo) only if you scale. | Posting + media upload |
| OpenRouter | pay-as-you-go | Tweet copywriting |
| Neon Postgres | free tier fine | Tokens, post log, durable dedup |
| Upstash Redis | free tier fine | Cache, idempotency, API budget guard |

## 2. Configure secrets

```sh
# once per secret (repeat for each)
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put FOOTBALL_DATA_KEY   # free tier (football-data.org)…
# npx wrangler secret put API_FOOTBALL_KEY  # …or/and paid full-stats tier — auto-preferred when set
npx wrangler secret put NEON_DATABASE_URL
npx wrangler secret put UPSTASH_REDIS_URL
npx wrangler secret put UPSTASH_REDIS_TOKEN
npx wrangler secret put X_CLIENT_ID
npx wrangler secret put X_CLIENT_SECRET
npx wrangler secret put X_REDIRECT_URI      # https://<worker-url>/api/x/callback
npx wrangler secret put CRON_SECRET         # openssl rand -hex 24
```

In the X developer portal, the OAuth 2.0 app must have **Read and write**
permissions and the callback URL above. The bot requests scopes:
`tweet.read tweet.write users.read media.write offline.access`.

## 3. Database schema

```sh
pnpm db:push   # creates messages, oauth_tokens, posted_items, caches…
```

## 4. Deploy & connect X

```sh
pnpm deploy
open https://<worker-url>/api/x/auth   # sign in with the bot account, authorize
open https://<worker-url>/api/health   # all checks should be ✅
```

If you authorized before `media.write` existed, visit `/api/x/auth` again —
image upload fails with 403 otherwise.

## 5. Approval queue vs auto-post

`config/flags.json` ships with `"publish_draft_only": true` — **approval
mode**: every cron composes its tweet + infographic into the drafts queue
instead of posting. On the dashboard (`https://<worker-url>/`, admin key =
CRON_SECRET) you can edit the text, preview the image, and hit **Post to X**
— the image is rasterized in your browser, so this whole flow works on the
free Workers plan.

For unattended **auto-post** (crons post directly, no review):

1. Set `"publish_draft_only": false` in `config/flags.json`
2. Upgrade to Workers Paid + uncomment `[limits]` in wrangler.toml (images
   now render server-side)
3. `pnpm deploy`

## 6. Operating notes

- **Protected endpoints** (`/api/cron/*`, `/api/generate-tweet`, `/api/render`,
  `/api/x/publish`, `/api/test/tools`, `/api/index`) need
  `Authorization: Bearer <CRON_SECRET>` or `?key=<CRON_SECRET>`. Without
  CRON_SECRET set they refuse to run in production entirely.
- **Manual trigger**: `curl -H "Authorization: Bearer $CRON_SECRET" https://<worker-url>/api/cron/fixtures`
- **API budget**: the bot stops calling API-Football after
  `API_FOOTBALL_DAILY_BUDGET` (default 90) requests/day (needs Redis).
  A normal match day uses ~60: ~50 live polls + daily crons.
- **Idempotency**: scorelines/fixtures dedup via Redis (`once`), transfers and
  spotlights via the `posted_items` table — safe to re-run any cron.
- **Infographic previews**: `GET /api/render?kind=post_match&key=<CRON_SECRET>`
  (kinds: `match_preview, score, post_match, player_stat, transfer, form`;
  add `&format=svg` to debug templates without wasm).
- **Errors** return JSON with an `x-error-id` and are logged via
  `console.error` — view with `npx wrangler tail`.
