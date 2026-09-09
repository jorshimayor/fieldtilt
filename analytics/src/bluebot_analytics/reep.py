"""Reep identity register loader — the crosswalk spine.

Reep (reep.football) assigns stable IDs to football entities and bridges
them to provider IDs across 56 sources. The full release is CC0 and ships
as a free CSV bundle (entities, bridges, aliases, relationships) — the API
is partner-key-gated, so this loader works from the download.

Why we want it: fieldtilt currently joins Understat <-> football-data <->
Wikipedia by fold-matching names. Reep replaces guesswork with a real
crosswalk, and keying model_outputs subjects by Reep ID makes the week-15
"all 20 clubs" broadening free.

The bundle URL lives behind a JS download page, so it is supplied via
REEP_BUNDLE_URL (or the `bundle` argument). Column contract (validated at
load, so a drift fails loudly instead of mis-joining):

  bridges.csv:  reep_id, provider, provider_id  (extra columns ignored)
  entities.csv: reep_id, type, label            (extra columns ignored)

Citation courtesy: "Reep, the football identity register (reep.football)".
"""

from __future__ import annotations

import csv
import io
import json
import os
import urllib.request
import zipfile
from pathlib import Path
from typing import Iterable

from .statsbomb import cache_dir  # same cache root, statsbomb/../reep

REQUIRED_BRIDGE_COLS = {"reep_id", "provider", "provider_id"}
REQUIRED_ENTITY_COLS = {"reep_id", "type", "label"}


class ReepSchemaError(RuntimeError):
    """The downloaded bundle does not match the documented column contract."""


def _reep_cache() -> Path:
    p = cache_dir().parent / "reep"
    p.mkdir(parents=True, exist_ok=True)
    return p


def fetch_bundle(url: str | None = None) -> Path:
    """Download the CC0 bundle zip once; return the cached path."""
    url = url or os.environ.get("REEP_BUNDLE_URL")
    if not url:
        raise RuntimeError(
            "REEP_BUNDLE_URL not set. Grab the free CSV bundle link from "
            "https://reep.football/downloads and export it."
        )
    dest = _reep_cache() / "bundle.zip"
    if dest.exists():
        return dest
    req = urllib.request.Request(url, headers={"User-Agent": "bluebot-analytics/0.1"})
    with urllib.request.urlopen(req, timeout=600) as res:
        dest.write_bytes(res.read())
    return dest


def _validate(header: Iterable[str], required: set[str], name: str) -> None:
    missing = required - {h.strip().lower() for h in header}
    if missing:
        raise ReepSchemaError(f"{name} is missing columns {sorted(missing)} — "
                              "the release schema moved; update reep.py's contract")


def parse_bridges(lines: Iterable[str]) -> dict[str, dict[str, str]]:
    """CSV lines -> {provider: {provider_id: reep_id}} (pure, fixture-tested)."""
    reader = csv.DictReader(lines)
    _validate(reader.fieldnames or [], REQUIRED_BRIDGE_COLS, "bridges.csv")
    out: dict[str, dict[str, str]] = {}
    for row in reader:
        prov = row["provider"].strip().lower()
        out.setdefault(prov, {})[row["provider_id"].strip()] = row["reep_id"].strip()
    return out


def parse_entities(lines: Iterable[str], entity_type: str | None = None) -> dict[str, dict[str, str]]:
    """CSV lines -> {reep_id: {type, label}}, optionally filtered by type."""
    reader = csv.DictReader(lines)
    _validate(reader.fieldnames or [], REQUIRED_ENTITY_COLS, "entities.csv")
    out: dict[str, dict[str, str]] = {}
    for row in reader:
        if entity_type and row["type"].strip().lower() != entity_type:
            continue
        out[row["reep_id"].strip()] = {"type": row["type"].strip(), "label": row["label"].strip()}
    return out


class Crosswalk:
    """provider_id -> reep_id -> any other provider's id."""

    def __init__(self, bridges: dict[str, dict[str, str]]):
        self.by_provider = bridges
        self.reverse: dict[str, dict[str, str]] = {}
        for prov, ids in bridges.items():
            for pid, rid in ids.items():
                self.reverse.setdefault(rid, {})[prov] = pid

    def reep_id(self, provider: str, provider_id: str) -> str | None:
        return self.by_provider.get(provider.lower(), {}).get(str(provider_id))

    def translate(self, from_provider: str, provider_id: str, to_provider: str) -> str | None:
        rid = self.reep_id(from_provider, provider_id)
        return self.reverse.get(rid, {}).get(to_provider.lower()) if rid else None

    def bridges_for(self, reep_id: str) -> dict[str, str]:
        return dict(self.reverse.get(reep_id, {}))


def load_crosswalk(bundle: Path | None = None, providers: set[str] | None = None) -> Crosswalk:
    """Open the bundle zip and build a (optionally provider-filtered) crosswalk."""
    path = bundle or fetch_bundle()
    with zipfile.ZipFile(path) as z:
        name = next(n for n in z.namelist() if n.endswith("bridges.csv"))
        with z.open(name) as f:
            lines = io.TextIOWrapper(f, encoding="utf-8")
            bridges = parse_bridges(lines)
    if providers:
        bridges = {p: v for p, v in bridges.items() if p in {q.lower() for q in providers}}
    return Crosswalk(bridges)


def distill(
    out_path: Path, bundle: Path | None = None, providers: set[str] | None = None
) -> int:
    """Write a small provider->id->reep_id JSON for the TypeScript Worker.

    The full bundle is hundreds of MB; the Worker only needs the handful of
    providers fieldtilt actually joins across.
    """
    providers = providers or {"football-data", "understat", "wikidata", "statsbomb"}
    xw = load_crosswalk(bundle, providers)
    out_path.write_text(json.dumps(xw.by_provider, indent=0, sort_keys=True))
    return sum(len(v) for v in xw.by_provider.values())


if __name__ == "__main__":
    import sys

    n = distill(Path(sys.argv[1] if len(sys.argv) > 1 else "reep-bridge.json"))
    print(f"distilled {n} bridges")
