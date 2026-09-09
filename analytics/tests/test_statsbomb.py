"""Offline tests for the StatsBomb loader — fixtures are real events from
open-data match 3857276 (Canada vs Morocco, WC 2022); no network in tests."""

import json
import math
from pathlib import Path

import pytest

from bluebot_analytics.statsbomb import (
    SHOT_SCHEMA,
    cache_path,
    flatten_shot,
    shot_angle,
    shot_distance,
)

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture()
def shot_events():
    return json.loads((FIXTURES / "shot_events.json").read_text())


# ---------------------------------------------------------------- geometry


def test_distance_penalty_spot():
    # penalty spot: (108, 40) -> 12 units straight out
    assert shot_distance(108, 40) == pytest.approx(12.0)


def test_distance_is_euclidean():
    assert shot_distance(114, 32) == pytest.approx(math.hypot(6, 8))


def test_angle_penalty_spot():
    # both posts 12 out, 4 lateral: angle = 2 * atan(4/12)
    assert shot_angle(108, 40) == pytest.approx(2 * math.atan(4 / 12))


def test_angle_shrinks_with_distance_and_width():
    assert shot_angle(100, 40) < shot_angle(110, 40)
    assert shot_angle(110, 20) < shot_angle(110, 40)


def test_angle_degenerate_on_goal_line():
    assert shot_angle(120, 40) == pytest.approx(math.pi)


# ---------------------------------------------------------------- flatten


def test_flatten_matches_schema_exactly(shot_events):
    row = flatten_shot(shot_events[0], match_id=3857276)
    assert set(row) == set(SHOT_SCHEMA)


def test_flatten_goal_event(shot_events):
    goal = flatten_shot(shot_events[0], match_id=3857276)
    assert goal["player"] == "Hakim Ziyech"
    assert goal["is_goal"] is True
    assert goal["outcome"] == "Goal"
    assert goal["statsbomb_xg"] == pytest.approx(0.024, abs=0.001)
    assert goal["x"] == pytest.approx(83.9)
    assert goal["distance"] == pytest.approx(shot_distance(83.9, 45.0))
    assert goal["match_id"] == 3857276


def test_flatten_non_goal_with_freeze_frame(shot_events):
    blocked = flatten_shot(shot_events[1])
    assert blocked["is_goal"] is False
    assert blocked["outcome"] == "Blocked"
    # a blocked shot has bodies in the cone by definition of being blocked
    assert blocked["defenders_in_cone"] is not None
    assert blocked["defenders_in_cone"] >= 1
    assert blocked["match_id"] is None


def test_gk_position_extracted(shot_events):
    # Ziyech's goal was a lob over an ADVANCED keeper (gk_x = 96) — assert the
    # invariant (keeper between shooter and goal), not a guess about position.
    row = flatten_shot(shot_events[0])
    assert row["gk_x"] is not None
    assert row["x"] < row["gk_x"] <= 120


# ---------------------------------------------------------------- cache


def test_cache_path_flattens_directories(tmp_path, monkeypatch):
    monkeypatch.setenv("BLUEBOT_CACHE_DIR", str(tmp_path))
    p = cache_path("events/3857276.json")
    assert p.parent == tmp_path / "statsbomb"
    assert p.name == "events__3857276.json"
