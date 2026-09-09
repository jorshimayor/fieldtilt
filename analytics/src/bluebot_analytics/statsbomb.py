"""StatsBomb open-data loader — the base every model builds on.

Season-calendar week 4 deliverable: load competitions, matches and events
from https://github.com/statsbomb/open-data with a DOCUMENTED shot schema
and tests from day one. The flattened shot table is the training input for
xg-v1 (weeks 8-14).

Design decisions (all learned the hard way in the fieldtilt Worker):
- stdlib-only core (urllib): the loader must run in a bare GitHub Action
  with zero installs. `polars` is optional, used only by `shots_frame`.
- two hosts: raw.githubusercontent.com 503s intermittently on the ~10MB
  event files; cdn.jsdelivr.net serves the same commit content. Try raw,
  fall back to jsdelivr (same multi-source pattern as the Worker's
  web_lookup).
- disk cache: open-data files are immutable per commit; every fetch is
  cached under BLUEBOT_CACHE_DIR (default ~/.cache/bluebot-analytics) so a
  backfill hits the network once, and tests never hit it at all.

Attribution: StatsBomb open data is free for research with attribution —
credit "data: StatsBomb" on anything published from it.
"""

from __future__ import annotations

import json
import math
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

HOSTS = (
    "https://raw.githubusercontent.com/statsbomb/open-data/master/data",
    "https://cdn.jsdelivr.net/gh/statsbomb/open-data@master/data",
)
USER_AGENT = "bluebot-analytics/0.1 (github.com/jorshimayor)"

# StatsBomb pitch: 120 x 80, attacking left -> right, goal centre at (120, 40),
# posts at y = 36 and y = 44 (7.32m goal mouth = 8 StatsBomb y-units).
PITCH_LENGTH = 120.0
PITCH_WIDTH = 80.0
GOAL_X = 120.0
GOAL_Y = 40.0
POST_LOW_Y = 36.0
POST_HIGH_Y = 44.0

#: The documented contract for one flattened shot row (see `flatten_shot`).
#: Types are Python types; None where the source event lacks the field.
SHOT_SCHEMA: dict[str, str] = {
    "event_id": "str — StatsBomb event uuid",
    "match_id": "int | None — caller-supplied (events files do not embed it)",
    "team": "str — shooting team name",
    "player": "str — shooter name",
    "period": "int — 1-5 (extra time 3-4, shootout 5)",
    "minute": "int",
    "second": "int",
    "x": "float — shot origin, 0-120 attacking left to right",
    "y": "float — shot origin, 0-80 top to bottom",
    "distance": "float — metres-equivalent units to goal centre (120, 40)",
    "angle": "float — radians subtended by the goal mouth from (x, y)",
    "outcome": "str — Goal | Saved | Blocked | Off T | Wayward | Post | ...",
    "is_goal": "bool",
    "statsbomb_xg": "float | None — StatsBomb's own model, for benchmarking",
    "body_part": "str | None — Right Foot | Left Foot | Head | ...",
    "technique": "str | None — Normal | Volley | Half Volley | Lob | ...",
    "shot_type": "str | None — Open Play | Free Kick | Penalty | Corner | ...",
    "under_pressure": "bool",
    "first_time": "bool",
    "one_on_one": "bool",
    "defenders_in_cone": "int | None — opponents in the shooter-to-posts "
    "triangle, from the freeze frame (None when no freeze frame)",
    "gk_x": "float | None — keeper position from the freeze frame",
    "gk_y": "float | None",
}


# ------------------------------------------------------------------ fetching


def cache_dir() -> Path:
    root = os.environ.get("BLUEBOT_CACHE_DIR") or str(Path.home() / ".cache" / "bluebot-analytics")
    p = Path(root) / "statsbomb"
    p.mkdir(parents=True, exist_ok=True)
    return p


def cache_path(rel: str) -> Path:
    return cache_dir() / rel.replace("/", "__")


def _fetch(rel: str, retries: int = 2) -> Any:
    """Fetch one open-data JSON file (cache -> raw -> jsdelivr)."""
    cached = cache_path(rel)
    if cached.exists():
        return json.loads(cached.read_text())
    last: Exception | None = None
    for attempt in range(retries + 1):
        for host in HOSTS:
            try:
                req = urllib.request.Request(f"{host}/{rel}", headers={"User-Agent": USER_AGENT})
                with urllib.request.urlopen(req, timeout=120) as res:
                    data = json.loads(res.read().decode("utf-8"))
                cached.write_text(json.dumps(data))
                return data
            except (urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as e:  # noqa: PERF203
                last = e
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"statsbomb fetch failed for {rel}: {last}")


def competitions() -> list[dict[str, Any]]:
    """All open-data (competition, season) pairs."""
    return _fetch("competitions.json")


def matches(competition_id: int, season_id: int) -> list[dict[str, Any]]:
    return _fetch(f"matches/{competition_id}/{season_id}.json")


def events(match_id: int) -> list[dict[str, Any]]:
    return _fetch(f"events/{match_id}.json")


# ------------------------------------------------------------------ geometry


def shot_distance(x: float, y: float) -> float:
    """Distance from (x, y) to the goal centre, in pitch units."""
    return math.hypot(GOAL_X - x, GOAL_Y - y)


def shot_angle(x: float, y: float) -> float:
    """Angle (radians) the goal mouth subtends from (x, y).

    The classic second xG feature: wide/deep positions see a sliver of goal,
    the penalty spot sees a wall of it. Computed via the law of cosines over
    the shooter-to-post triangle; degenerate on the goal line between the
    posts, where we return pi (the whole goal is 'visible').
    """
    a = math.hypot(GOAL_X - x, POST_LOW_Y - y)
    b = math.hypot(GOAL_X - x, POST_HIGH_Y - y)
    c = POST_HIGH_Y - POST_LOW_Y
    if a == 0 or b == 0:
        return math.pi
    cos = (a * a + b * b - c * c) / (2 * a * b)
    return math.acos(max(-1.0, min(1.0, cos)))


def _defenders_in_cone(shooter: tuple[float, float], freeze_frame: list[dict[str, Any]]) -> int:
    """Opponents inside the triangle shooter -> both posts (crude but honest)."""
    sx, sy = shooter
    p1 = (GOAL_X, POST_LOW_Y)
    p2 = (GOAL_X, POST_HIGH_Y)

    def sign(o: tuple[float, float], a: tuple[float, float], b: tuple[float, float]) -> float:
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def inside(pt: tuple[float, float]) -> bool:
        d1 = sign(pt, (sx, sy), p1)
        d2 = sign(pt, p1, p2)
        d3 = sign(pt, p2, (sx, sy))
        neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
        pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
        return not (neg and pos)

    n = 0
    for ff in freeze_frame:
        if ff.get("teammate"):
            continue
        loc = ff.get("location") or []
        if len(loc) >= 2 and inside((float(loc[0]), float(loc[1]))):
            n += 1
    return n


# ------------------------------------------------------------------ flatten


def flatten_shot(event: dict[str, Any], match_id: int | None = None) -> dict[str, Any]:
    """One Shot event -> one flat row matching SHOT_SCHEMA exactly."""
    shot = event.get("shot") or {}
    loc = event.get("location") or [None, None]
    x = float(loc[0]) if loc[0] is not None else float("nan")
    y = float(loc[1]) if loc[1] is not None else float("nan")
    freeze = shot.get("freeze_frame")
    gk = None
    if freeze:
        for ff in freeze:
            if not ff.get("teammate") and (ff.get("position") or {}).get("name") == "Goalkeeper":
                gk = ff.get("location")
                break
    outcome = (shot.get("outcome") or {}).get("name") or "Unknown"
    row = {
        "event_id": event.get("id"),
        "match_id": match_id,
        "team": (event.get("team") or {}).get("name"),
        "player": (event.get("player") or {}).get("name"),
        "period": event.get("period"),
        "minute": event.get("minute"),
        "second": event.get("second"),
        "x": x,
        "y": y,
        "distance": shot_distance(x, y),
        "angle": shot_angle(x, y),
        "outcome": outcome,
        "is_goal": outcome == "Goal",
        "statsbomb_xg": shot.get("statsbomb_xg"),
        "body_part": (shot.get("body_part") or {}).get("name"),
        "technique": (shot.get("technique") or {}).get("name"),
        "shot_type": (shot.get("type") or {}).get("name"),
        "under_pressure": bool(event.get("under_pressure")),
        "first_time": bool(shot.get("first_time")),
        "one_on_one": bool(shot.get("one_on_one")),
        "defenders_in_cone": _defenders_in_cone((x, y), freeze) if freeze else None,
        "gk_x": float(gk[0]) if gk else None,
        "gk_y": float(gk[1]) if gk else None,
    }
    assert set(row) == set(SHOT_SCHEMA), "flatten_shot drifted from SHOT_SCHEMA"
    return row


def match_shots(match_id: int) -> list[dict[str, Any]]:
    """All flattened shot rows for one match (network/cache)."""
    return [
        flatten_shot(e, match_id)
        for e in events(match_id)
        if (e.get("type") or {}).get("name") == "Shot"
    ]


def season_shots(competition_id: int, season_id: int) -> list[dict[str, Any]]:
    """Every shot in a (competition, season) — the xg-v1 training table."""
    rows: list[dict[str, Any]] = []
    for m in matches(competition_id, season_id):
        rows.extend(match_shots(m["match_id"]))
    return rows


def shots_frame(rows: list[dict[str, Any]]):
    """Rows -> polars DataFrame (optional dependency, models-side only)."""
    try:
        import polars as pl
    except ImportError as e:  # pragma: no cover
        raise ImportError("polars is required for shots_frame: uv add polars") from e
    return pl.DataFrame(rows)
