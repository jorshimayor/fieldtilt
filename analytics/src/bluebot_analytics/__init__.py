"""bluebot analytics — models in Python, delivery in TypeScript.

Scaffold. Working models land per the season calendar:
  weeks 3-7   free-data package (separate repo, consumed here)
  weeks 8-14  xg-v1 on StatsBomb open data + calibration write-up
  weekly      season-forecast-v1 (predict before matches, score after)

Contract: write rows to Neon `model_outputs` (model, subject, season,
gameweek, payload). The Worker publishes what lands there.
"""

__version__ = "0.0.1"


def main() -> None:
    print("bluebot-analytics scaffold — see analytics/README.md for the contract")


if __name__ == "__main__":
    main()
