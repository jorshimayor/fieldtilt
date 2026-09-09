"""bluebot analytics — models in Python, delivery in TypeScript.

Scaffold. Working models land per the season calendar:
  weeks 3-7   free-data package (statsbomb.py landed week 4; extract to
              its own PyPI repo when the API settles)
  weeks 8-14  xg-v1 on StatsBomb open data + calibration write-up
  weekly      season-forecast-v1 (predict before matches, score after)

Contract: write rows to Neon `model_outputs` (model, subject, season,
gameweek, payload). The Worker publishes what lands there.
"""

from . import statsbomb  # noqa: F401  (week 4: the open-data base)

__version__ = "0.1.0"


def main() -> None:
    print("bluebot-analytics scaffold — see analytics/README.md for the contract")


if __name__ == "__main__":
    main()
