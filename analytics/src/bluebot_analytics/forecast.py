"""season-forecast-v1 — the weekly model call, published BEFORE matches,
scored AFTER. The season calendar's one non-negotiable constant.

Model (deliberately simple, defensible, and honest about it):
  attack/defence rates per team from the last N finished league matches,
  shrunk toward the league mean (few games -> trust the league, many games
  -> trust the team), a flat home-advantage multiplier, independent
  Poisson goals -> outcome probabilities over a 0-8 goal grid.

Outputs (Neon `model_outputs`, the Python<->Worker contract):
  model "season-forecast-v1"        one row per predicted fixture
  model "season-forecast-v1-score"  one summary row per scored round:
      Brier score vs a "always predict league-average" baseline, plus
      per-club expected points (xP) vs actual points for the round.

Run:  python -m bluebot_analytics.forecast predict|score
Env:  FOOTBALL_DATA_KEY, NEON_DATABASE_URL
"""

from __future__ import annotations

import json
import math
import os
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

FD_BASE = "https://api.football-data.org/v4"
MODEL = "season-forecast-v1"
SCORE_MODEL = "season-forecast-v1-score"
FORM_WINDOW = 10          # matches per team feeding the rates
SHRINK_K = 5.0            # rate shrinkage: weight = n / (n + K)
HOME_ADV = 1.18           # league-typical home goals multiplier
MAX_GOALS = 8             # Poisson grid bound


# ------------------------------------------------------------------ pure math


def poisson_pmf(lam: float, k: int) -> float:
    return math.exp(-lam) * lam**k / math.factorial(k)


def outcome_probs(lam_home: float, lam_away: float) -> dict[str, float]:
    """P(home win/draw/away win) from independent Poisson goal counts."""
    ph = pd = pa = 0.0
    for h in range(MAX_GOALS + 1):
        for a in range(MAX_GOALS + 1):
            p = poisson_pmf(lam_home, h) * poisson_pmf(lam_away, a)
            if h > a:
                ph += p
            elif h == a:
                pd += p
            else:
                pa += p
    total = ph + pd + pa  # grid truncation leaves ~1e-4 unassigned
    return {"home": ph / total, "draw": pd / total, "away": pa / total}


def shrunk_rate(team_avg: float, league_avg: float, n_games: int, k: float = SHRINK_K) -> float:
    """Blend a team's own rate with the league mean by sample size."""
    w = n_games / (n_games + k)
    return w * team_avg + (1 - w) * league_avg


def brier(probs: dict[str, float], actual: str) -> float:
    """Multiclass Brier score (0 = perfect, 2 = maximally wrong)."""
    return sum((probs[o] - (1.0 if o == actual else 0.0)) ** 2 for o in ("home", "draw", "away"))


def expected_points(probs: dict[str, float], side: str) -> float:
    """xP for one club from its fixture's outcome probabilities."""
    win = probs["home"] if side == "home" else probs["away"]
    return 3 * win + probs["draw"]


def team_rates(
    finished: list[dict[str, Any]], window: int = FORM_WINDOW
) -> tuple[dict[str, dict[str, float]], float]:
    """Per-team attack/defence goal rates over each team's last `window`
    finished matches, plus the league's average goals per team per match."""
    per_team: dict[str, list[tuple[int, int]]] = {}
    total_goals = 0
    for m in finished:
        h, a = m["home"], m["away"]
        gh, ga = m["goalsHome"], m["goalsAway"]
        total_goals += gh + ga
        per_team.setdefault(h, []).append((gh, ga))
        per_team.setdefault(a, []).append((ga, gh))
    league_avg = total_goals / (2 * len(finished)) if finished else 1.35
    rates: dict[str, dict[str, float]] = {}
    for team, games in per_team.items():
        recent = games[-window:]
        n = len(recent)
        att = sum(g for g, _ in recent) / n
        def_ = sum(c for _, c in recent) / n
        rates[team] = {
            "attack": shrunk_rate(att, league_avg, n),
            "defence": shrunk_rate(def_, league_avg, n),
            "games": n,
        }
    return rates, league_avg


def predict_fixture(
    home: str, away: str, rates: dict[str, dict[str, float]], league_avg: float
) -> dict[str, Any]:
    r_h = rates.get(home) or {"attack": league_avg, "defence": league_avg}
    r_a = rates.get(away) or {"attack": league_avg, "defence": league_avg}
    lam_home = HOME_ADV * r_h["attack"] * (r_a["defence"] / league_avg)
    lam_away = (1 / HOME_ADV) * r_a["attack"] * (r_h["defence"] / league_avg)
    probs = outcome_probs(lam_home, lam_away)
    return {
        "lambda_home": round(lam_home, 3),
        "lambda_away": round(lam_away, 3),
        "probs": {k: round(v, 4) for k, v in probs.items()},
        "xp_home": round(expected_points(probs, "home"), 3),
        "xp_away": round(expected_points(probs, "away"), 3),
    }


# ------------------------------------------------------------------ data IO


def _fd(path: str) -> Any:
    req = urllib.request.Request(
        f"{FD_BASE}{path}",
        headers={"X-Auth-Token": os.environ["FOOTBALL_DATA_KEY"], "User-Agent": "bluebot-analytics/0.1"},
    )
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read().decode())


def _norm(m: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": m["id"],
        "utc": m["utcDate"],
        "matchday": m.get("matchday"),
        "home": m["homeTeam"]["shortName"] or m["homeTeam"]["name"],
        "away": m["awayTeam"]["shortName"] or m["awayTeam"]["name"],
        "goalsHome": (m.get("score", {}).get("fullTime", {}) or {}).get("home"),
        "goalsAway": (m.get("score", {}).get("fullTime", {}) or {}).get("away"),
        "status": m["status"],
    }


def _season() -> int:
    now = datetime.now(timezone.utc)
    return now.year if now.month >= 7 else now.year - 1


def _db():
    import psycopg

    url = os.environ["NEON_DATABASE_URL"]
    return psycopg.connect(url)


def _insert(rows: list[tuple[str, str, int, int | None, str]]) -> None:
    with _db() as conn, conn.cursor() as cur:
        cur.executemany(
            "insert into model_outputs (model, subject, season, gameweek, payload) values (%s, %s, %s, %s, %s::jsonb)",
            rows,
        )
        conn.commit()


# ------------------------------------------------------------------ commands


def cmd_predict() -> None:
    season = _season()
    comp = _fd(f"/competitions/PL/matches?season={season}")
    matches = [_norm(m) for m in comp.get("matches", [])]
    finished = [m for m in matches if m["status"] == "FINISHED" and m["goalsHome"] is not None]
    # last season's tail pads the window early in the season (honest note in payload)
    padded = False
    if len(finished) < 40:
        try:
            prev = [_norm(m) for m in _fd(f"/competitions/PL/matches?season={season - 1}").get("matches", [])]
            finished = [m for m in prev if m["status"] == "FINISHED"][-120:] + finished
            padded = True
        except Exception:
            pass
    rates, league_avg = team_rates(finished)
    horizon = datetime.now(timezone.utc) + timedelta(days=8)
    upcoming = [
        m
        for m in matches
        if m["status"] in ("SCHEDULED", "TIMED") and datetime.fromisoformat(m["utc"].replace("Z", "+00:00")) <= horizon
    ]
    if not upcoming:
        print("no fixtures inside the 8-day horizon; nothing to predict")
        return
    now = datetime.now(timezone.utc).isoformat()
    rows = []
    for m in upcoming:
        pred = predict_fixture(m["home"], m["away"], rates, league_avg)
        payload = {
            "fixture_id": m["id"],
            "kickoff_utc": m["utc"],
            "home": m["home"],
            "away": m["away"],
            **pred,
            "features": {"window": FORM_WINDOW, "shrink_k": SHRINK_K, "home_adv": HOME_ADV, "league_avg": round(league_avg, 3), "padded_with_last_season": padded},
            "predicted_at": now,
        }
        rows.append((MODEL, f"fd:{m['id']} {m['home']} vs {m['away']}", season, m["matchday"], json.dumps(payload)))
        p = payload["probs"]
        print(f"MD{m['matchday']} {m['home']} vs {m['away']}: H {p['home']:.0%} D {p['draw']:.0%} A {p['away']:.0%}")
    _insert(rows)
    print(f"wrote {len(rows)} prediction rows (model={MODEL}, season={season})")


def cmd_score() -> None:
    season = _season()
    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            """select id, payload from model_outputs
               where model = %s and season = %s
               and not (payload ? 'scored')
               order by id asc""",
            (MODEL, season),
        )
        pending = cur.fetchall()
    if not pending:
        print("nothing unscored")
        return
    comp = _fd(f"/competitions/PL/matches?season={season}")
    finals = {m["id"]: _norm(m) for m in comp.get("matches", []) if m["status"] == "FINISHED"}
    scored, details = 0, []
    baseline = {"home": 0.45, "draw": 0.25, "away": 0.30}  # long-run league base rates
    with _db() as conn, conn.cursor() as cur:
        for row_id, payload in pending:
            f = finals.get(payload["fixture_id"])
            if not f:
                continue
            actual = "home" if f["goalsHome"] > f["goalsAway"] else "away" if f["goalsAway"] > f["goalsHome"] else "draw"
            b = brier(payload["probs"], actual)
            bb = brier(baseline, actual)
            payload.update({"scored": True, "actual": actual, "final": f"{f['goalsHome']}-{f['goalsAway']}", "brier": round(b, 4), "brier_baseline": round(bb, 4)})
            cur.execute("update model_outputs set payload = %s::jsonb where id = %s", (json.dumps(payload), row_id))
            details.append(payload)
            scored += 1
        conn.commit()
    if not scored:
        print("predictions exist but their fixtures are not finished yet")
        return
    avg = sum(d["brier"] for d in details) / scored
    avg_base = sum(d["brier_baseline"] for d in details) / scored
    summary = {
        "matches": scored,
        "brier": round(avg, 4),
        "brier_baseline": round(avg_base, 4),
        "beat_baseline": avg < avg_base,
        "results": [
            {"fixture": f"{d['home']} vs {d['away']}", "final": d["final"], "called": max(d["probs"], key=d["probs"].get), "actual": d["actual"], "brier": d["brier"], "xp_home": d["xp_home"], "xp_away": d["xp_away"]}
            for d in details
        ],
        "scored_at": datetime.now(timezone.utc).isoformat(),
    }
    _insert([(SCORE_MODEL, f"round scored {datetime.now(timezone.utc).date()}", season, details[0].get("gameweek"), json.dumps(summary))])
    print(f"scored {scored} fixtures: brier {avg:.4f} vs baseline {avg_base:.4f} ({'BEAT' if avg < avg_base else 'lost to'} baseline)")


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "predict"
    if cmd == "predict":
        cmd_predict()
    elif cmd == "score":
        cmd_score()
    else:
        print("usage: python -m bluebot_analytics.forecast predict|score")
        sys.exit(2)


if __name__ == "__main__":
    main()
