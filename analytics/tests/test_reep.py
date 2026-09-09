"""Reep crosswalk tests — pinned to the REAL reep-register-v1 schema
(provider/namespace/external_id/reep_id), verified against the release on
9 Sep 2026. Fixture values are Chelsea's actual published bridges, so a
mapping regression is caught against ground truth."""

import pytest

from bluebot_analytics.reep import Crosswalk, ReepSchemaError, parse_bridges, parse_entities

BRIDGES = """provider,namespace,external_id,reep_id
understat,team,80,rt3763d29e7947d8
transfermarkt,verein,631,rt3763d29e7947d8
statsbomb,offline_team,33,rt3763d29e7947d8
opta,team_numeric,8,rt3763d29e7947d8
uefa,team,52914,rt3763d29e7947d8
understat,player,8995,rp_palmer_x
transfermarkt,spieler,568177,rp_palmer_x
""".splitlines()

ENTITIES = """reep_id,entity_type,status,label,gender,country
rt3763d29e7947d8,team,active,Chelsea,,England
rp_palmer_x,player,active,Cole Palmer,male,England
""".splitlines()


def test_parse_bridges_keys_by_provider_and_namespace():
    b = parse_bridges(BRIDGES)
    assert b[("understat", "team")]["80"] == "rt3763d29e7947d8"
    assert b[("transfermarkt", "spieler")]["568177"] == "rp_palmer_x"


def test_crosswalk_translates_chelsea_across_providers():
    xw = Crosswalk(parse_bridges(BRIDGES))
    assert xw.translate("understat", "team", "80", "transfermarkt", "verein") == "631"
    assert xw.translate("statsbomb", "offline_team", "33", "opta", "team_numeric") == "8"
    assert xw.translate("understat", "team", "999", "uefa", "team") is None


def test_namespace_separation_prevents_cross_kind_hits():
    xw = Crosswalk(parse_bridges(BRIDGES))
    # a player id must never resolve through a team namespace
    assert xw.reep_id("understat", "team", "8995") is None
    assert xw.reep_id("understat", "player", "8995") == "rp_palmer_x"


def test_bridges_for_lists_provider_slash_namespace():
    xw = Crosswalk(parse_bridges(BRIDGES))
    b = xw.bridges_for("rt3763d29e7947d8")
    assert b["understat/team"] == "80"
    assert b["uefa/team"] == "52914"
    assert len(b) == 5


def test_entities_use_entity_type():
    e = parse_entities(ENTITIES, entity_type="team")
    assert list(e) == ["rt3763d29e7947d8"]
    assert e["rt3763d29e7947d8"]["label"] == "Chelsea"


def test_schema_drift_fails_loudly():
    with pytest.raises(ReepSchemaError):
        parse_bridges(["reep_id,provider,provider_id", "x,fd,61"])  # the OLD guessed schema
