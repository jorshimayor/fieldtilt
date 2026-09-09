"""Reep identity register loader — the crosswalk spine.

Reep (reep.football) assigns stable IDs to football entities and bridges
them to provider IDs. The release is CC0; this loader works from the free
downloads: the CSV bundle or the single-file DuckDB build
(reep-register-v1.duckdb).

REAL release schema (verified against reep-register-v1 on 9 Sep 2026 —
the earlier guessed contract failed loudly, as designed):

  bridges:  provider, namespace, external_id, reep_id
            (namespace scopes the id kind: understat/team, opta/person,
             transfermarkt/verein, statsbomb/offline_team, ...)
  entities: reep_id, entity_type, status, label, gender, country, ...
  teams / players / matches ...: typed convenience views of entities.

Worked example (Chelsea men = rt3763d29e7947d8): understat/team 80,
transfermarkt/verein 631, statsbomb/offline_team 33, opta/team_numeric 8,
uefa/team 52914, wyscout/team 1610.

Why fieldtilt wants it: we currently join Understat <-> Transfermarkt <->
StatsBomb by fold-matching names. This replaces guesswork with a real
crosswalk, and keying model_outputs subjects by reep_id makes the week-15
"all 20 clubs" broadening free.

Citation courtesy: "Reep, the football identity register (reep.football)".
"""

from __future__ import annotations

import csv
import json
import os
from pathlib import Path
from typing import Any, Iterable

from .statsbomb import cache_dir  # same cache root: .../bluebot-analytics

REQUIRED_BRIDGE_COLS = {"reep_id", "provider", "namespace", "external_id"}
REQUIRED_ENTITY_COLS = {"reep_id", "entity_type", "label"}

ProviderKey = tuple[str, str]  # (provider, namespace)


class ReepSchemaError(RuntimeError):
    """The release does not match the documented column contract."""


def _reep_cache() -> Path:
    p = cache_dir().parent / "reep"
    p.mkdir(parents=True, exist_ok=True)
    return p


def default_duckdb_path() -> Path:
    return Path(os.environ.get("REEP_DUCKDB") or (_reep_cache() / "reep-register-v1.duckdb"))


def _validate(header: Iterable[str], required: set[str], name: str) -> None:
    missing = required - {h.strip().lower() for h in header}
    if missing:
        raise ReepSchemaError(
            f"{name} is missing columns {sorted(missing)} — the release schema moved; update reep.py's contract"
        )


def parse_bridges(lines: Iterable[str]) -> dict[ProviderKey, dict[str, str]]:
    """CSV lines -> {(provider, namespace): {external_id: reep_id}} (pure)."""
    reader = csv.DictReader(lines)
    _validate(reader.fieldnames or [], REQUIRED_BRIDGE_COLS, "bridges")
    out: dict[ProviderKey, dict[str, str]] = {}
    for row in reader:
        key = (row["provider"].strip().lower(), row["namespace"].strip().lower())
        out.setdefault(key, {})[row["external_id"].strip()] = row["reep_id"].strip()
    return out


def parse_entities(lines: Iterable[str], entity_type: str | None = None) -> dict[str, dict[str, str]]:
    """CSV lines -> {reep_id: {entity_type, label}}, optionally filtered."""
    reader = csv.DictReader(lines)
    _validate(reader.fieldnames or [], REQUIRED_ENTITY_COLS, "entities")
    out: dict[str, dict[str, str]] = {}
    for row in reader:
        if entity_type and row["entity_type"].strip().lower() != entity_type:
            continue
        out[row["reep_id"].strip()] = {
            "entity_type": row["entity_type"].strip(),
            "label": row["label"].strip(),
        }
    return out


class Crosswalk:
    """(provider, namespace, external_id) -> reep_id -> any other provider."""

    def __init__(self, bridges: dict[ProviderKey, dict[str, str]]):
        self.by_provider = bridges
        self.reverse: dict[str, dict[ProviderKey, str]] = {}
        for key, ids in bridges.items():
            for ext, rid in ids.items():
                self.reverse.setdefault(rid, {})[key] = ext

    @staticmethod
    def _key(provider: str, namespace: str) -> ProviderKey:
        return (provider.lower(), namespace.lower())

    def reep_id(self, provider: str, namespace: str, external_id: str) -> str | None:
        return self.by_provider.get(self._key(provider, namespace), {}).get(str(external_id))

    def translate(
        self, from_provider: str, from_namespace: str, external_id: str, to_provider: str, to_namespace: str
    ) -> str | None:
        rid = self.reep_id(from_provider, from_namespace, external_id)
        return self.reverse.get(rid, {}).get(self._key(to_provider, to_namespace)) if rid else None

    def bridges_for(self, reep_id: str) -> dict[str, str]:
        return {f"{p}/{ns}": ext for (p, ns), ext in self.reverse.get(reep_id, {}).items()}


# ------------------------------------------------------------------ duckdb


def _connect(db_path: Path | None = None):
    try:
        import duckdb
    except ImportError as e:  # pragma: no cover
        raise ImportError("duckdb is required for the .duckdb release: uv add duckdb") from e
    path = db_path or default_duckdb_path()
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Download reep-register-v1.duckdb from reep.football/downloads "
            f"and place it there, or set REEP_DUCKDB."
        )
    return duckdb.connect(str(path), read_only=True)


def load_crosswalk_duckdb(
    db_path: Path | None = None, providers: set[str] | None = None
) -> Crosswalk:
    """Build a Crosswalk from the DuckDB release (optionally provider-filtered)."""
    con = _connect(db_path)
    cols = {r[0].lower() for r in con.execute("describe bridges").fetchall()}
    _validate(cols, REQUIRED_BRIDGE_COLS, "bridges (duckdb)")
    where, params = "", []
    if providers:
        ph = ",".join("?" for _ in providers)
        where, params = f"where provider in ({ph})", [p.lower() for p in providers]
    out: dict[ProviderKey, dict[str, str]] = {}
    for prov, ns, ext, rid in con.execute(
        f"select provider, namespace, external_id, reep_id from bridges {where}", params
    ).fetchall():
        out.setdefault((prov.lower(), ns.lower()), {})[str(ext)] = rid
    return Crosswalk(out)


#: Providers fieldtilt actually joins across (worker + analytics).
FIELDTILT_PROVIDERS = {"understat", "transfermarkt", "statsbomb", "opta", "uefa", "fbref", "api_football", "clubelo"}


def distill_teams(out_path: Path, db_path: Path | None = None) -> int:
    """Every team with an Understat bridge -> one small JSON row carrying its
    label + all fieldtilt-relevant provider ids. Understat-bridged teams ≈
    the big-5-league universe, which is exactly the cross-league scope."""
    con = _connect(db_path)
    rows = con.execute(
        """
        with u as (select reep_id, external_id as understat_id from bridges
                   where provider='understat' and namespace='team')
        select u.reep_id, t.label, t.country, u.understat_id, b.provider, b.namespace, b.external_id
        from u
        join teams t on t.reep_id = u.reep_id
        left join bridges b on b.reep_id = u.reep_id and b.provider in ({})
        """.format(",".join(f"'{p}'" for p in sorted(FIELDTILT_PROVIDERS)))
    ).fetchall()
    teams: dict[str, dict[str, Any]] = {}
    for rid, label, country, uid, prov, ns, ext in rows:
        rec = teams.setdefault(rid, {"reep_id": rid, "label": label, "country": country, "understat": uid, "ids": {}})
        if prov:
            rec["ids"][f"{prov}/{ns}"] = ext
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(sorted(teams.values(), key=lambda t: (t["country"] or "", t["label"] or "")), indent=0))
    return len(teams)


if __name__ == "__main__":
    import sys

    out = Path(sys.argv[1] if len(sys.argv) > 1 else "data/reep-teams.json")
    n = distill_teams(out)
    print(f"distilled {n} understat-bridged teams -> {out}")
