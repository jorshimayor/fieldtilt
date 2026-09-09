"""Reep crosswalk tests — the CSV column contract is defined HERE, so a
release-schema drift fails loudly in CI instead of silently mis-joining."""

import pytest

from bluebot_analytics.reep import Crosswalk, ReepSchemaError, parse_bridges, parse_entities

BRIDGES = """reep_id,provider,provider_id,confidence
rp_team_chelsea,football-data,61,1.0
rp_team_chelsea,understat,Chelsea,1.0
rp_team_chelsea,wikidata,Q9616,1.0
rp_player_palmer,football-data,fd_777,1.0
rp_player_palmer,understat,8995,1.0
""".splitlines()

ENTITIES = """reep_id,type,label,country
rp_team_chelsea,team,Chelsea FC,England
rp_player_palmer,player,Cole Palmer,England
""".splitlines()


def test_parse_bridges_groups_by_provider():
    b = parse_bridges(BRIDGES)
    assert b["football-data"]["61"] == "rp_team_chelsea"
    assert b["understat"]["8995"] == "rp_player_palmer"


def test_crosswalk_translates_between_providers():
    xw = Crosswalk(parse_bridges(BRIDGES))
    assert xw.translate("football-data", "61", "understat") == "Chelsea"
    assert xw.translate("understat", "8995", "football-data") == "fd_777"
    assert xw.translate("football-data", "999", "understat") is None


def test_bridges_for_returns_all_providers():
    xw = Crosswalk(parse_bridges(BRIDGES))
    assert xw.bridges_for("rp_team_chelsea") == {
        "football-data": "61",
        "understat": "Chelsea",
        "wikidata": "Q9616",
    }


def test_entities_filter_by_type():
    e = parse_entities(ENTITIES, entity_type="team")
    assert list(e) == ["rp_team_chelsea"]
    assert e["rp_team_chelsea"]["label"] == "Chelsea FC"


def test_schema_drift_fails_loudly():
    bad = ["id,source,source_id", "1,fd,61"]
    with pytest.raises(ReepSchemaError):
        parse_bridges(bad)
