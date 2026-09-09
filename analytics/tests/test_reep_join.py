"""Team resolution against the COMMITTED distill — offline ground truth."""

from bluebot_analytics.reep_join import TeamResolver, fixture_subject

R = TeamResolver()

FD_SHORTNAMES_TO_REEP = {
    "Chelsea": "rt3763d29e7947d8",
    "Man United": "rt85aa78bccbd812",
    "Man City": "rt37c836a696a159",
    "Brighton Hove": "rt78f360d6fde57e",
    "Nottingham": "rt9420ae803b8a55",
    "Hull City": "rtf38678780871c4",
    "Ipswich Town": "rt1874a32186f729",
    "Leeds United": "rt2c10fab805c3ea",
    "Sunderland": "rtb471f322d5ad96",
    "Tottenham": "rtcffb6a6bdb89fe",
}


def test_football_data_shortnames_resolve():
    for name, rid in FD_SHORTNAMES_TO_REEP.items():
        assert R.reep_id(name) == rid, name


def test_unmappable_club_stays_visible():
    # Coventry has no Understat-era history in register v1 — must be an
    # auditable miss, never a wrong match (the Solihull Borough trap).
    assert R.reep_id("Coventry City") is None
    s = fixture_subject("Coventry City", "Chelsea", R)
    assert s == "reep:fd|rt3763d29e7947d8 Coventry City vs Chelsea"


def test_fixture_subject_shape():
    s = fixture_subject("Man City", "Arsenal", R)
    assert s.startswith("reep:rt37c836a696a159|rt")
    assert s.endswith("Man City vs Arsenal")
