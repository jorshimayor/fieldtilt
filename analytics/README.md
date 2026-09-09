# analytics — the Python model service

**Models in Python. Delivery in TypeScript.** This workspace is where the
football judgment lives; the Cloudflare Worker is only the publisher of what
these models find.

## The contract

The two sides never call each other directly — they meet in Postgres:

```
Python (here, scheduled via GitHub Actions cron — $0)
  └─ trains/runs models on StatsBomb open data, Understat, football-data.org
  └─ writes rows to Neon table `model_outputs`
       (model, subject, season, gameweek, payload JSONB)

TypeScript Worker (../)
  └─ reads latest `model_outputs` rows
  └─ composes the weekly model call BEFORE matches, scores it AFTER
  └─ renders cards + queues drafts exactly like every other pipeline
```

This resolves the language split honestly: polyglot by design. It also means
the Python side needs no server — a scheduled GitHub Action with `uv` is the
whole runtime.

## Planned models (see the season calendar)

| Model id | What it outputs | Ships |
| --- | --- | --- |
| `xg-v1` | Own xG per shot, trained on StatsBomb open data; calibration metrics in payload | Nov 2026 |
| `season-forecast-v1` | Weekly title/top-4/relegation probabilities with intervals, plus last week's Brier score | weekly, all season |
| `data-quality-v1` | Source disagreement log (football-data vs Understat), monthly summary | monthly |

## Status

Scaffold only — the working code lands per the calendar (weeks 3–14). First
milestone: the free-data package this service will consume.

```sh
cd analytics
uv sync
uv run python -m bluebot_analytics  # prints status
```


## statsbomb.py (week 4 — the base)

Loader for [StatsBomb open data](https://github.com/statsbomb/open-data):
`competitions()`, `matches()`, `events()`, and a flattened shot table
(`match_shots` / `season_shots`) whose contract is `SHOT_SCHEMA` — every row
carries the two classic xG features (distance, goal-mouth angle), the freeze
frame distilled to `defenders_in_cone` + keeper position, and StatsBomb's own
`statsbomb_xg` for benchmarking xg-v1 against.

- stdlib-only core (runs in a bare GitHub Action); `polars` optional.
- dual-host fetch (raw.githubusercontent 503s on big event files; jsdelivr
  fallback) + immutable disk cache under `BLUEBOT_CACHE_DIR`.
- tests are offline: real fixture events vendored from match 3857276.
- attribution: credit "data: StatsBomb" on anything published from it.

```python
from bluebot_analytics import statsbomb as sb
rows = sb.season_shots(43, 106)   # every WC 2022 shot, cached after first run
```
