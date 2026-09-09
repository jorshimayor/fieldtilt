"""Reep joins for the model layer — subjects keyed by identity, not names.

Teams resolve OFFLINE through the committed distill (data/reep-teams.json):
exact fold-match on the register's label plus an alias table for the
short names football-data actually emits ("Man United", "Brighton Hove",
"Nottingham"). Verified: 19/20 current PL clubs resolve; Coventry City has
no Understat history, so it stays unmapped and subjects fall back
gracefully — a miss is visible, never silently wrong.

Players resolve ONLINE (duckdb, optional) by provider id, never by name:
name search in a 407k-player table returns Solihull-Borough-class traps,
but transfermarkt/spieler, wyscout/player and opta/person ids are exact.

model_outputs subject convention (v2, from 9 Sep 2026):
  fixtures:  "reep:{home_rid}|{away_rid} {Home} vs {Away}"
             (unmapped side -> "fd" placeholder keeps the miss auditable)
  players:   "reep:{player_rid} {Player Name}"
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

DATA_PATH = Path(__file__).resolve().parents[2] / "data" / "reep-teams.json"

#: football-data short names -> register labels (extend as the league churns).
TEAM_ALIASES = {
    "man united": "manchester united",
    "man city": "manchester city",
    "tottenham": "tottenham hotspur",
    "spurs": "tottenham hotspur",
    "brighton hove": "brighton & hove albion",
    "brighton": "brighton & hove albion",
    "nottingham": "nottingham forest",
    "nottm forest": "nottingham forest",
    "bournemouth": "afc bournemouth",
    "newcastle": "newcastle united",
    "leeds": "leeds united",
    "west ham": "west ham united",
    "wolves": "wolverhampton wanderers",
    "sheffield utd": "sheffield united",
    "ipswich": "ipswich town",
    "hull": "hull city",
    "luton": "luton town",
}


def _fold(s: str) -> str:
    return "".join(c for c in (s or "").lower() if c.isalnum())


class TeamResolver:
    """name -> distilled register row (offline, deterministic)."""

    def __init__(self, path: Path = DATA_PATH):
        rows = json.loads(Path(path).read_text())
        self.by_fold: dict[str, dict[str, Any]] = {}
        for t in rows:
            self.by_fold.setdefault(_fold(t["label"]), t)

    def resolve(self, name: str) -> dict[str, Any] | None:
        f = _fold(name)
        hit = self.by_fold.get(f)
        if hit:
            return hit
        alias = TEAM_ALIASES.get((name or "").strip().lower())
        return self.by_fold.get(_fold(alias)) if alias else None

    def reep_id(self, name: str) -> str | None:
        hit = self.resolve(name)
        return hit["reep_id"] if hit else None


def fixture_subject(home: str, away: str, resolver: TeamResolver) -> str:
    """The model_outputs subject for a fixture, reep-keyed with visible misses."""
    h = resolver.reep_id(home) or "fd"
    a = resolver.reep_id(away) or "fd"
    return f"reep:{h}|{a} {home} vs {away}"


def player_subject(reep_id: str, name: str) -> str:
    return f"reep:{reep_id} {name}"


# ------------------------------------------------------------------ players (duckdb)


def player_reep(provider: str, namespace: str, external_id: str) -> str | None:
    """Exact player join by provider id (e.g. transfermarkt/spieler 568177)."""
    from .reep import _connect

    row = _connect().execute(
        "select reep_id from bridges where provider=? and namespace=? and external_id=? limit 1",
        [provider.lower(), namespace.lower(), str(external_id)],
    ).fetchone()
    return row[0] if row else None


def player_bridges(reep_id: str) -> dict[str, str]:
    """Every provider id the register holds for one player."""
    from .reep import _connect

    return {
        f"{p}/{ns}": ext
        for p, ns, ext in _connect()
        .execute("select provider, namespace, external_id from bridges where reep_id=?", [reep_id])
        .fetchall()
    }
