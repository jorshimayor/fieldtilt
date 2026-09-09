"""Offline tests for season-forecast-v1's pure math."""

import math

import pytest

from bluebot_analytics.forecast import (
    brier,
    expected_points,
    outcome_probs,
    poisson_pmf,
    predict_fixture,
    shrunk_rate,
    team_rates,
)


def test_poisson_pmf_sums_to_one():
    assert sum(poisson_pmf(1.4, k) for k in range(30)) == pytest.approx(1.0)


def test_outcome_probs_sum_and_symmetry():
    p = outcome_probs(1.5, 1.5)
    assert p["home"] + p["draw"] + p["away"] == pytest.approx(1.0)
    assert p["home"] == pytest.approx(p["away"], abs=1e-9)  # equal lambdas -> symmetric


def test_outcome_probs_favours_stronger_side():
    p = outcome_probs(2.2, 0.8)
    assert p["home"] > 0.6 > p["away"]


def test_shrinkage_limits():
    assert shrunk_rate(3.0, 1.4, 0) == pytest.approx(1.4)  # no games -> league
    assert shrunk_rate(3.0, 1.4, 1000) == pytest.approx(3.0, abs=0.01)  # many -> team


def test_brier_bounds():
    sure = {"home": 1.0, "draw": 0.0, "away": 0.0}
    assert brier(sure, "home") == pytest.approx(0.0)
    assert brier(sure, "away") == pytest.approx(2.0)


def test_expected_points():
    p = {"home": 0.5, "draw": 0.3, "away": 0.2}
    assert expected_points(p, "home") == pytest.approx(1.8)
    assert expected_points(p, "away") == pytest.approx(0.9)


def _match(h, a, gh, ga):
    return {"home": h, "away": a, "goalsHome": gh, "goalsAway": ga}


def test_team_rates_and_prediction_direction():
    finished = (
        [_match("Strong", "Filler%d" % i, 3, 0) for i in range(6)]
        + [_match("Weak", "Filler%d" % i, 0, 3) for i in range(6)]
    )
    rates, league_avg = team_rates(finished)
    assert rates["Strong"]["attack"] > league_avg > rates["Weak"]["attack"]
    pred = predict_fixture("Strong", "Weak", rates, league_avg)
    assert pred["probs"]["home"] > 0.55
    assert pred["xp_home"] > pred["xp_away"]
    assert math.isclose(sum(pred["probs"].values()), 1.0, abs_tol=0.001)


def test_unknown_team_falls_back_to_league_average():
    rates, league_avg = team_rates([_match("A", "B", 1, 1)])
    pred = predict_fixture("Newly Promoted", "Also New", rates, league_avg)
    # league-average sides at home advantage: home edge, all probs sane
    assert 0.3 < pred["probs"]["home"] < 0.6
