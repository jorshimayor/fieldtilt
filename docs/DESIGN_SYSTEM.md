# &#x20;Design System

One visual language for everything the brand touches: X infographics, the
dashboard, and any future surface. The look is **editorial sports** — quiet,
photographic, typography-led. Think print magazine, not broadcast graphics.

**Files:**

| File                                                      | Role                                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`packages/render/theme.ts`](../packages/render/theme.ts) | **Canonical tokens** — colors, type scale, formats, spacing. Change here first. |
| [`packages/render/cards.ts`](../packages/render/cards.ts) | Card templates (the design applied to data)                                     |
| [`public/theme.css`](../public/theme.css)                 | Web mirror of the tokens (CSS variables) for the app                            |

## Principles

1. **The canvas is near-black.** `#0B0C0F` with a soft radial vignette. Photos
   (when available) go full-bleed under a \~62% dark scrim so type always wins.
2. **Typography does the design.** Montserrat only. Headlines: extrabold,
   UPPERCASE, tight tracking (−1 to −2), stacked in 1–2 lines. Labels: small,
   bold, wide tracking (+2.6), uppercase, muted gray. Never mix these roles.
3. **Numbers are the heroes.** Stat values render 3–8× larger than their
   labels. Labels stack in short lines under/beside the value ("PASSES /
   COMPLETED"), never in one long line.
4. **Monochrome first.** White ink, two grays, hairline dividers (`#2A2E37`).
   Color only where it carries meaning: red live-dot, W/D/L squares, one quiet
   accent (`#3D6BFF`) for interactive elements in the app. Never decorative.
5. **Whitespace is a feature.** Outer margin 72px. When there's no photo, a
   giant translucent monogram (5% white) fills the negative space.

## Formats

- **Portrait 960×1200 (4:5)** — player stats, transfers, form reviews,
  editorial/on-this-day. X's feed favors 4:5 for reach.
- **Landscape 1200×675 (16:9)** — scoreboards: match preview, live score.

## Card anatomy (all templates follow this)

```
[eyebrow ▶ KICKER]                       [wordmark / context]
[HEADLINE — huge, stacked, tight]
[hairline]
[content zone — stat rail / rows / body copy]
[hairline]
[footer: context label]                  [wordmark / date]
```

## Voice pairing

Card + tweet are one unit: the image carries the numbers, the tweet carries
the take. Don't repeat every stat from the card in the copy.

## Extending

New card = new pure function in `cards.ts` using only `theme.ts` tokens and
the shared helpers (`frame`, `eyebrow`, `bigStat`, `hairline`, `brandMark`,
`stackedName`, `watermark`). Register it in `index.ts` (`CardKind`), add demo
data in `api/render.ts`, and a string test in `tests/unit/render.test.ts`.
Preview at `/api/render?kind=<new>&format=svg`.

## Photos

Automated cards use API-Football headshots when available (spotlight cron) —
full-bleed under the scrim. For hero-quality posts like the reference images,
drop a licensed photo into the card data as `photoDataUri`; the templates
handle the rest. Never post unlicensed agency photography.
