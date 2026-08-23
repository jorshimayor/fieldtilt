# Football Data Mastery

**A working curriculum for becoming a football data expert, built for an
engineer.** You already ship full-stack systems (this repo is the proof). This
document is the bridge from "engineer who loves football" to "football
research engineer a club would hire" — the data landscape, the metrics canon,
the toolchain, a phased curriculum with definitions of done, the reading
canon, and the career routing.

How to use it: Parts I–III are reference — read once, return often. Part IV is
the actual plan — work it in order, every phase ends in a shipped artifact.
Parts V–VI are the inputs (reading) and outputs (visibility) around the work.

---

## Part I — The Data Landscape

Everything in football analytics derives from four raw data types. Knowing
which type feeds which insight — and who sells/gives it — is table stakes in
any club interview.

### 1. Event data (the workhorse)

Hand-coded (increasingly CV-assisted) log of on-ball events: passes, shots,
duels, tackles, carries — each with timestamp, player, (x, y) location, and
outcome. ~1,600–3,500 events per match.

- **What it powers:** xG, xA, xT/EPV/VAEP, pass networks, progressive
  actions, PPDA, basically every public-facing stat.
- **Blind spot:** off-ball. Event data cannot see the striker's run that
  dragged two defenders away. That's what tracking is for.
- **Commercial:** Opta (Stats Perform), StatsBomb (Hudl), Wyscout — Opta and
  StatsBomb are the club standards. StatsBomb's differentiators: pressure
  events, shot freeze-frames (defender/keeper positions at shot moment),
  360° frames.
- **Free:** StatsBomb Open Data (see below), Understat (already integrated
  in this repo), FBref tables (which are Opta-derived since 2022).

### 2. Tracking data (the frontier)

(x, y) coordinates of all 22 players + ball at 10–25 Hz — ~2–3 million data
points per match. Optical (TRACAB, Second Spectrum/Genius, Sportec) or
broadcast-derived (SkillCorner, which reconstructs tracking from TV footage).

- **What it powers:** pitch control, space generation/occupation, line
  breaking, pressing structure, off-ball run valuation, physical outputs.
- **Why it matters for you:** far fewer people can work with it. Event-data
  literacy is common; tracking-data literacy is a differentiator, and it's
  pure engineering+math — your home turf.
- **Free samples:** Metrica Sports open tracking data, SkillCorner open
  data (9 matches with broadcast tracking), and the kloppy library's
  bundled samples.

### 3. Physical/GPS data

Wearables (Catapult, STATSports) or optical-derived: distance, high-speed
running (HSR, typically >5.5 m/s), sprints (>7 m/s), accelerations,
metabolic load. Owned by sports science departments; analysts touch it for
availability/fatigue context. Know the vocabulary; don't specialize here.

### 4. Video

Still the lingua franca of coaching. Every quantitative insight ultimately
gets sold to coaches *through video* (analysts clip in Hudl
Sportscode/Angles). The best club tooling links numbers → clips in one
click. Remember this when designing anything analyst-facing: **a metric
without a route back to video is a dead end in a club.**

### The provider map (who clubs actually pay)

| Provider | Type | Notes |
| --- | --- | --- |
| Stats Perform (Opta) | Event + AI models | The incumbent; OptaJoe's engine; enterprise only |
| StatsBomb (Hudl) | Event (+360 frames) | Analytics-community favorite; free open data |
| Wyscout (Hudl) | Event + video platform | Scouting standard, broad coverage, shallower events |
| SkillCorner | Broadcast tracking | Tracking for leagues you can't install cameras in |
| Second Spectrum (Genius) | Optical tracking | Premier League's official tracking supplier |
| TRACAB (ChyronHego) | Optical tracking | Long-time PL/Bundesliga supplier |
| Sportec Solutions | Event + tracking | Bundesliga official |
| Transfermarkt | Valuations/bio | Market values are crowd opinion, not measurements — cite carefully |

### The free data goldmine (your entire curriculum runs on this)

1. **StatsBomb Open Data** (`github.com/statsbomb/open-data`) — full event
   data: all Messi's La Liga seasons, World Cups 2018/2022, Euros, WSL
   seasons, 15/16 Big-5 league seasons, Arsenal 03/04 Invincibles. Includes
   360° freeze-frames for some competitions. This is the community's shared
   textbook.
2. **Metrica Sports sample games** — 3 matches of full tracking + events,
   anonymized. The standard pitch-control teaching dataset.
3. **SkillCorner open data** — 9 matches broadcast tracking (matched to
   public event data).
4. **Wyscout/Pappalardo dataset** — the 2019 *Nature Scientific Data*
   public release: a full season of events for the Big-5 leagues + WC18 +
   Euro16. Older spec, but huge.
5. **Understat** — current-season xG (already wired into this repo).
6. **football-data.org / FBref** — fixtures, results, aggregated advanced
   tables.

### Coordinate systems (the first thing that bites every engineer)

Every provider uses a different pitch coordinate space, and y-axis direction
differs. StatsBomb: 120×80, origin top-left. Opta: 100×100 percentages.
Wyscout: 100×100, its own quirks. Metrica: normalized 1×1. **Rule: normalize
everything on ingest** — the `kloppy` library exists precisely to load any
provider's event/tracking data into one standard model. Use it from day one
and half the community's data-wrangling pain disappears.

---

## Part II — The Metrics Canon

Learn these from first principles — in interviews you will be asked "how
would you build xG?" not "what is xG?". Ordered from foundational to
frontier.

### Tier 1 — Counting stats, corrected

- **Per-90 normalization** — never compare raw totals across different
  minutes played. Also beware small minutes: report per-90 alongside
  minutes, and shrink toward the mean for tiny samples.
- **Possession adjustment (padj)** — defensive counting stats (tackles,
  interceptions) depend on how much the opponent has the ball. Padj scales
  them to a notional 50% possession (sigmoid-based scaling, popularized by
  StatsBomb) so a defender in a dominant team isn't punished for having
  nothing to defend.
- **PPDA** (passes allowed per defensive action) — pressing intensity proxy:
  opponent passes in their own ~60% of the pitch ÷ your defensive actions
  there. Lower = more aggressive press.
- **Field tilt** — share of final-third possession/touches. Reads
  territorial dominance better than possession %.
- **Progressive passes / carries** — actions moving the ball materially
  toward goal (definitions vary — Opta/FBref: ≥10m closer to goal with
  qualifiers; StatsBomb uses its own). Always state whose definition you're
  using.

### Tier 2 — The expected family

- **xG (expected goals)** — probability a shot becomes a goal, estimated
  from historical shots with similar features: distance, angle, body part,
  assist type, pattern of play (open play/set piece/counter), one-on-one,
  under pressure (StatsBomb), freeze-frame features (defender density, GK
  position). Built as a supervised classifier (logistic regression →
  gradient boosting). Two things separate a good xG modeler from a stats
  reader: **calibration** (predicted 0.2 must mean 20% over volume — check
  with reliability curves, Brier score, log-loss) and **honesty about
  variance** (a season of shots is a small sample; single-match "xG wins"
  claims are noise-laundering).
- **npxG** — xG excluding penalties (penalties are ~0.76 constant and
  swamp open-play signal).
- **xA / xAG** — two different things people conflate: xA (StatsBomb/
  Understat-style) values the *pass* by the xG of the resulting shot; xAG
  (FBref) is xG-assisted — credit only when a shot actually followed. Know
  the difference; it's a classic interview trap.
- **PSxG (post-shot xG)** — xG re-estimated *after* the ball leaves the
  boot, using trajectory/placement. PSxG − xG on-target isolates shooting
  placement quality; goals-conceded − PSxG-faced isolates goalkeeper
  shot-stopping. This is how modern GK analysis works.
- **xGChain / xGBuildup** — credit every player in a possession ending in a
  shot with the possession's xG (xGBuildup excludes the shooter/assister —
  finds deep-lying contributors). Already in this repo via Understat.

### Tier 3 — Possession value (valuing every action, not just shots)

The intellectual center of modern football analytics: what is a pass from A
to B *worth*?

- **xT (expected threat)** — Karun Singh, 2018. Grid the pitch (e.g., 16×12);
  each zone's value = probability possession there eventually becomes a
  goal, solved iteratively via a Markov model of move/shoot transition
  probabilities. Action value = xT(end) − xT(start). Elegant, transparent,
  implementable in an afternoon — **you will implement this from scratch in
  Phase 2.**
- **EPV (expected possession value)** — the continuous-time generalization,
  usually with tracking data (Fernández, Bornn, Cervone): value of the
  current possession state, decomposed into pass/carry/shoot options.
- **VAEP** — KU Leuven (Decroos et al., KDD 2019). Values *every* action
  (including defensive) as ΔP(score next k actions) − ΔP(concede next k
  actions), learned with gradient boosting over action sequences. Reference
  implementation: `socceraction` — you'll run it in Phase 2.
- **OBV (on-ball value)** — StatsBomb's production possession-value model;
  same family. Know the name; it's on their platform.

### Tier 4 — Tracking-derived (the frontier)

- **Pitch control** (Spearman) — probability your team controls the ball if
  it arrives at location (x, y), from player positions/velocities and
  arrival-time physics. The foundation of space analysis. **You will
  implement this in Phase 3** (Laurie Shaw's Friends-of-Tracking code is
  the reference).
- **Space generation / occupation** (Fernández & Bornn, "Wide Open
  Spaces") — who creates dangerous space by moving, who occupies it.
  Values off-ball runs — the thing event data can't see.
- **Line-breaking passes, packing** — passes that eliminate defenders
  (Impect's packing is the commercial version); computable from tracking
  by counting defenders between ball and goal before/after.
- **Pressing structure** — distance-to-presser at reception, time-to-
  pressure, defensive-line height, compactness (convex hulls, team
  centroids). All straightforward geometry once you have tracking — very
  engineer-friendly territory.

### Tier 5 — Player evaluation practice

- **Percentile profiles vs positional peers** (the FBref/StatsBomb radar
  style) — always vs same position, same league tier, with a minutes
  floor. Beware: radars communicate *style* as much as *quality*.
- **Similarity search** — nearest-neighbors on standardized per-90 vectors;
  the bread and butter of data scouting ("find me a cheaper player X").
- **Aging curves** — peak ages differ by position (fullbacks/forwards
  earlier, CBs/GKs later); any transfer argument ignoring age is broken.
- **The scouting funnel** — data shortlists → video vetting → live
  scouting. Data narrows, humans decide. Position your tooling accordingly.

### Team-level style fingerprinting

Directness (progression per possession vs possession count), tempo,
buildup patterns (short vs long from GK — event data shows this cleanly),
pressing triggers, set-piece threat share (elite teams treat set pieces as
~25–33% of goals — a whole sub-discipline with dedicated coaches). A good
opposition report quantifies exactly these.

---

## Part III — The Toolchain (TS engineer → PyData, fast)

Python is non-negotiable in this field. The good news: you're not learning
programming, you're learning a dialect.

| You know | You'll use | Notes |
| --- | --- | --- |
| pnpm / package.json | **uv** / pyproject.toml | uv is the modern one — fast, lockfiles, sane |
| TypeScript types | type hints + **pydantic** | Gradual, but write them everywhere |
| Array.map/filter/reduce | list comprehensions, **pandas/Polars** | Polars will feel like home: expression chains, lazy evaluation |
| JSON.parse + fetch | **requests/httpx**, `pd.read_*` | |
| vitest/your test scripts | **pytest** | |
| esbuild/node scripts | **Jupyter notebooks** | Exploration medium; promote stable code out of notebooks into modules |
| SVG cards (this repo) | **matplotlib + mplsoccer** | mplsoccer draws pitches, radars, shot maps; restyle with your design tokens |
| drizzle/Neon | **DuckDB + Parquet** | The analytics combo: query millions of events on your laptop, zero servers |
| Cloudflare Workers dashboards | **Streamlit** (prototype) → your TS frontends (production) | Ship analyst tools fast in Streamlit; your ability to then build the *real* app in TS is the differentiator |

**The football stack, specifically:**

- `statsbombpy` — StatsBomb open/API data loader
- `kloppy` — normalizes every provider's event & tracking data into one model (use always)
- `mplsoccer` — pitches, shot maps, pass maps, radars
- `socceraction` — VAEP/xT reference implementations (SPADL action format)
- `penaltyblog` — Poisson/Dixon-Coles match prediction models, odds utilities
- `scikit-learn` → `XGBoost`/`LightGBM` — the modeling workhorses (clubs run on gradient boosting far more than deep learning)
- `PyTorch` — for Phase 5 and for the JD checkbox that says deep learning
- `highlight_text`, `adjustText` — annotation polish for viz

**Your unfair advantages, named:** (1) you ship full-stack — most analysts
can't; (2) you have a design system — most analytics viz is ugly; (3) you've
built agentic LLM tooling — clubs are just starting to want this (natural-
language query over club data, auto-drafted report text); (4) you already
run data pipelines with caching, budgets, and graceful degradation — that's
production thinking most quants lack.

---

## Part IV — The Curriculum

Phased, each with a **shipped artifact** and a **definition of done**. Every
artifact is simultaneously bluebot content, a portfolio piece, and interview
ammunition. Timeline assumes ~8–10 focused hours/week; compress or stretch
honestly.

### Phase 0 — Python bootstrap (weeks 1–2)

Set up `uv`, learn the pandas/Polars core (read → filter → groupby → join →
plot) by porting something you already understand: recreate this repo's
Understat xG-vs-goals table in a notebook.

- **Artifact:** a `research/` repo with one clean notebook: Chelsea squad
  xG over/under-performance, plotted in your design system's colors.
- **Done when:** you can load a CSV/JSON, reshape it, and produce a styled
  matplotlib chart without googling every line.

### Phase 1 — Event data fundamentals + your own xG model (weeks 3–8)

Load StatsBomb Open Data via `statsbombpy`/`kloppy`. Build shot maps and
pass networks with `mplsoccer`. Then the rite of passage: **train your own
xG model.**

1. Assemble every open-data shot (~tens of thousands): features = distance,
   angle, body part, play pattern, under-pressure, freeze-frame defender
   count where available.
2. Logistic regression baseline → XGBoost → compare with log-loss, Brier
   score, and a **calibration curve** (this plot is the centerpiece).
3. Validate against StatsBomb's own xG values; write up where and *why*
   yours diverges (their extra features, your data volume).

- **Artifacts:** xG model notebook + a public write-up ("I built an xG
  model from scratch — here's what I learned about calibration"), shot-map
  and pass-network graphics on the bot account.
- **Done when:** you can defend every modeling choice out loud — features,
  train/test split by *season not random* (leakage!), calibration method.

### Phase 2 — Possession value + player profiling (weeks 9–16)

1. **Implement xT from scratch** — grid the pitch, estimate transition
   matrices from open data, iterate to convergence, then rank Big-5-season
   players by xT added. Compare your implementation with `socceraction`'s.
2. **Run VAEP** via `socceraction` end-to-end; read the paper alongside.
3. **Build the profiling machine:** per-90 + padj + minutes floors →
   position-peer percentiles → radar/pizza charts in your design system.
   Add nearest-neighbor player similarity.

- **Artifacts:** "Valuing every pass" write-up with your xT heatmap; a
  player-profile card generator (this slots directly into bluebot's
  player_stat cards — real convergence of the two projects).
- **Done when:** you can explain to a non-quant *why* a sideways pass out
  of the back can be worth more than a flashy final-third flick, with your
  own numbers.

### Phase 3 — Tracking data + pitch control (weeks 17–24)

Work through **Friends of Tracking** (David Sumpter's YouTube course +
Laurie Shaw's tracking-data lectures). Using Metrica open tracking data:

1. Player/ball animation, velocities, physical summaries (distance, HSR).
2. **Implement Spearman pitch control** (Shaw's repo as reference — write
   your own, then diff).
3. One applied study: e.g., quantify how a team's defensive block
   compresses space between lines, or value off-ball runs on one match.

- **Artifacts:** pitch-control animation clips (exceptional bot content —
  almost nobody posts these), "what tracking data sees that event data
  can't" long-read.
- **Done when:** pitch control runs on any kloppy-loadable tracking input
  in under a minute per match, and you can explain the physics.

### Phase 4 — The flagship: automated opposition report (weeks 25–36)

The portfolio piece that maps 1:1 onto club job descriptions. Full-stack —
this is where your engineering identity fuses with the analytics:

- **Input:** any team in the open data (or Understat/FBref for current
  season context).
- **Pipeline:** style fingerprint (directness, buildup routes, pressing
  metrics, field tilt) → key-player profiles (Phase 2 machine) → set-piece
  patterns (corner delivery zones, first-contact locations) → auto-drafted
  narrative text (your LLM agent experience, grounded in the computed
  numbers exactly like bluebot's guardrails).
- **Output:** a rendered dossier — web page + PDF — in your design system.
- **Then write the meta-piece:** "I built the tool a club analyst would
  use" — architecture, design decisions, screenshots.

- **Done when:** a stranger can request any open-data team and get a
  coherent, *coach-readable* dossier in under two minutes.

### Phase 5 — Deep learning credibility (weeks 30–40, overlaps)

One honest PyTorch project, not a tour: re-implement your xG model as a
small net (embeddings for categoricals) and benchmark vs XGBoost —
spoiler: tabular GBMs usually win, and *saying so* is the credibility. If
appetite remains: a sequence model over possession chains (predict next
action type/location) touches the research frontier (seq2seq/transformer
approaches to ball progression).

- **Done when:** you can discuss when deep learning earns its complexity in
  football (tracking, sequences, CV) and when it doesn't (small tabular).

### Ongoing habits (all phases)

- **Ship something visible every 2 weeks** — graphic, thread, or notebook.
- **Replicate one published analysis per month** — replication is the
  fastest teacher and the community respects it.
- **Keep a decisions log** — every modeling choice with the why. This
  becomes interview prep for free.

---

## Part V — The Reading Canon

### Books (in this order)

1. **Soccermatics** — David Sumpter. The gateway: math of football, readable.
2. **The Numbers Game** — Anderson & Sally. Why football resisted analytics; foundational framing.
3. **Football Hackers** — Christoph Biermann. The scene: Brentford, Midtjylland, Matthew Benham; how clubs actually adopted data.
4. **The Expected Goals Philosophy** — James Tippett. Quick xG primer (light, but useful common vocabulary).
5. **Net Gains** — Ryan O'Hanlon. Modern, honest state-of-the-art tour.
6. **Zonal Marking** / **The Mixer** — Michael Cox. Tactical literacy — you must speak coach.
7. **How to Watch Football** — Ruud Gullit. Ditto, from the pitch's perspective.

### Papers (the citation backbone — read actively, implement 3 of them)

- Decroos et al., **"Actions Speak Louder than Goals: Valuing Player Actions in Soccer"** (KDD 2019) — VAEP.
- Fernández & Bornn, **"Wide Open Spaces"** (Sloan 2018) — space generation/occupation.
- Spearman, **"Beyond Expected Goals"** (Sloan 2018) + Spearman et al., **"Physics-Based Modeling of Pass Probabilities"** (2017) — pitch control lineage.
- Fernández, Bornn, Cervone, **"Decomposing the Immeasurable Sport"** (2019) — EPV.
- Power et al., **"Not All Passes Are Created Equal"** (KDD 2017) — pass risk/reward.
- Shaw & Glickman, **"Dynamic Analysis of Team Strategy"** (2019) — formations from tracking.
- Le, Carr, Yue, Lucey, **"Data-Driven Ghosting"** (Sloan 2017) — imitation learning for defense.
- Karun Singh's **xT blog post** (2018) — not a paper, but canon: `karun.in/blog/expected-threat.html`.
- Pappalardo et al., **"A public data set of spatio-temporal match events"** (Nature Sci. Data 2019) — the open Wyscout release.
- StatsBomb Conference proceedings (annual) — where current club-adjacent research appears.

### People & feeds worth your attention

Karun Singh, David Sumpter, Laurie Shaw (ex-City, tracking lectures), Ted
Knutson (StatsBomb founder), John Muller (The Athletic), Michael Caley, Tom
Worville, James Yorke; the StatsBomb/Hudl blog archive; American Soccer
Analysis (ASA — their g+ model articles are excellent teaching material).

### The Linked Library

Everything below is free. Each entry is tagged with the curriculum phase it
serves — watch/read *when the phase needs it*, not all upfront. (Handles and
URLs occasionally move; the title in quotes always finds it.)

#### Football analytics — video & courses

| Resource | Phase | Why |
| --- | --- | --- |
| [Friends of Tracking](https://www.youtube.com/@friendsoftracking) — Sumpter, Shaw et al. | 1–3 | THE community course. Start with the "How to become a football data scientist" intro videos; the Laurie Shaw tracking lectures are Phase 3's backbone |
| [Laurie Shaw's tracking-data code](https://github.com/Friends-of-Tracking-Data-FoTD/LaurieOnTracking) | 3 | The reference implementation you'll re-implement pitch control against |
| [McKay Johns](https://www.youtube.com/@mckayjohns) | 0–2 | The most practical "Python for football analytics" channel — shot maps, pass maps, scraping, radar charts, project walkthroughs at exactly your entry level |
| [Soccermatics course (Uppsala)](https://soccermatics.readthedocs.io/) | 1–2 | Sumpter's university course, fully public: theory + Python notebooks for xG, possession value, and more. Your Phase 1–2 curriculum shadows this |
| [StatsBomb / Hudl channel](https://www.youtube.com/@StatsBomb) | 2+ | Conference talks — how working club/vendor analysts actually frame problems |
| [Tifo Football](https://www.youtube.com/@TifoFootball) | any | Tactical literacy in animated 10-minute doses — this is how you learn to "speak coach" |
| [Karun Singh — Expected Threat](https://karun.in/blog/expected-threat.html) | 2 | The xT post itself; your Phase 2 implementation spec |
| [American Soccer Analysis](https://www.americansocceranalysis.com/) | 2 | Their g+ (goals added) explainer series is superb possession-value teaching material |

#### Python & PyData (your TS→Python bridge)

| Resource | Phase | Why |
| --- | --- | --- |
| [Corey Schafer — Python playlist](https://www.youtube.com/@coreyms) | 0 | The gold-standard Python fundamentals series; skim what TS already taught you, slow down at comprehensions, generators, decorators |
| [Corey Schafer — pandas series](https://www.youtube.com/playlist?list=PL-osiE80TeTsWmV9i9c58mdDCSskIFdDS) | 0–1 | The pandas course. Watch alongside porting your Understat notebook |
| [Kaggle Learn](https://www.kaggle.com/learn) | 0–1 | Interactive micro-courses (Python, pandas, Intro ML) — exercises in-browser, zero setup, fast feedback loop for an engineer |
| [Calmcode](https://calmcode.io/) | 0–2 | Short, sharp videos on Polars, pytest, and PyData tooling — engineer-brained, no fluff |
| [ArjanCodes](https://www.youtube.com/@ArjanCodes) | 0+ | Python *software design* — the channel that keeps your engineering standards intact while you switch languages |
| [uv docs](https://docs.astral.sh/uv/) | 0 | Your pnpm replacement — read the "Getting started" page and move on |
| [mplsoccer docs & gallery](https://mplsoccer.readthedocs.io/) | 1+ | The gallery page is a menu of every football viz you'll make — copy, then restyle in your design system |
| [kloppy docs](https://kloppy.pysport.org/) | 1+ | Provider-agnostic data loading — your first stop for every dataset |
| [statsbombpy](https://github.com/statsbomb/statsbombpy) | 1 | Open-data loader |
| [socceraction docs](https://socceraction.readthedocs.io/) | 2 | SPADL + VAEP + xT reference implementations |
| [penaltyblog](https://pena.lt/y/blog) + [docs](https://penaltyblog.readthedocs.io/) | 2+ | Match prediction models (Poisson, Dixon-Coles) with clean Python |
| [DuckDB docs](https://duckdb.org/docs/) | 1+ | Query millions of events in-process; pairs with Parquet as your local warehouse |
| [Streamlit docs](https://docs.streamlit.io/) | 4 | Prototype analyst tools in an afternoon; graduate the winners to your TS stack |

#### ML, stats & deep learning

| Resource | Phase | Why |
| --- | --- | --- |
| [StatQuest](https://www.youtube.com/@statquest) | 1–2 | Every concept your xG model needs — logistic regression, gradient boosting, ROC/calibration — explained until it's unforgettable |
| [3Blue1Brown — Neural networks](https://www.youtube.com/playlist?list=PLZHQObOWTQDNU6R1_67000Dx_ZCJB-3pi) | 5 | Visual intuition for what a network actually does, before any code |
| [Andrej Karpathy — Zero to Hero](https://karpathy.ai/zero-to-hero.html) | 5 | Build backprop→GPT from scratch in code; the single best DL course for engineers |
| [fast.ai — Practical Deep Learning](https://course.fast.ai/) | 5 | Top-down PyTorch practice; complements Karpathy's bottom-up |
| [scikit-learn user guide](https://scikit-learn.org/stable/user_guide.html) | 1–2 | Read the calibration + model-evaluation chapters before shipping your xG write-up |

#### Data sources (bookmark folder)

| Source | What |
| --- | --- |
| [StatsBomb Open Data](https://github.com/statsbomb/open-data) | The event-data textbook: Messi seasons, World Cups, Euros, WSL, Invincibles |
| [Metrica sample data](https://github.com/metrica-sports/sample-data) | 3 matches of full tracking — Phase 3's dataset |
| [SkillCorner open data](https://github.com/SkillCorner/opendata) | 9 matches of broadcast tracking |
| [Pappalardo/Wyscout dataset](https://figshare.com/collections/Soccer_match_event_dataset/4415000) | Full Big-5 season of events (Nature Sci. Data 2019) |
| [Understat](https://understat.com/) | Current-season xG (already wired into this repo) |
| [FBref](https://fbref.com/) | Opta-derived advanced tables; manual research companion |
| ["Actions Speak Louder than Goals" (VAEP, arXiv)](https://arxiv.org/abs/1802.07127) | The one paper PDF with a permanently stable link; find the rest by title via Google Scholar |

#### Suggested viewing order for the first month

1. Friends of Tracking — "How to become a football data scientist" intro
2. Kaggle Learn Python + pandas (do, don't just watch)
3. McKay Johns — first three project videos (shot map, pass map, scraping)
4. Corey Schafer pandas series as reference while porting the Understat notebook
5. StatQuest logistic regression + gradient boosting, the week you start the xG model

---

## Part VI — Community, Visibility, Career Routing

### Where the community lives

- **PySport** (pysport.org + Discord) — the open-source football analytics
  hub; `kloppy`/`socceraction` maintainers are here. **Contributing here is
  the highest-leverage networking available to you** — a merged PR in
  kloppy is worth more than 50 cold applications, and as a TS engineer you
  can also fill their tooling gaps (viz, web, infra).
- **StatsBomb (Hudl) annual conference** — community papers accepted;
  attend, eventually submit.
- **MIT Sloan Sports Analytics Conference** — the research prestige venue.
- **X/Twitter football analytics scene** — where your bot already lives.
  Your analytics output and your engineering write-ups build the profile;
  keep the banter voice separate from the research byline.

### The routing (realistic odds, in order)

1. **Vendors first:** StatsBomb/Hudl, SkillCorner, Stats Perform, Genius
   Sports, Zelus/Teamworks, Sportlight. More roles, better engineering
   cultures, and clubs poach from them constantly.
2. **Club side doors:** academy analytics, women's team, loans department,
   recruitment analysis — lower competition, same building, internal moves
   are common.
3. **First-team roles** (the Arsenal-JD tier): apply once the flagship
   project exists and your name rings a bell in the community.
4. **Set alerts now:** jobsinfootball.com, sportsjobs.online, clubs' own
   career pages (Chelsea posts as "1st Team Data Analyst" / "Performance
   Data Analyst"; stack: Power BI, MS SQL Server, R/Python — note Power BI
   appearing repeatedly: a weekend of Power BI familiarity is cheap
   insurance).

### The credential question, honestly

Ads say "advanced qualification in a quantitative discipline." Three ways
through: (a) part-time MSc (data science, or sports-specific like AI in
Sport programs) — the conventional unlock; (b) an exceptional public
portfolio + community standing — has worked for many current club analysts;
(c) vendor experience as the credential substitute. Plan on (b)+(c), keep
(a) as an option once income allows.

### CV mapping (your repo → their bullets, ready to paste)

- "Designed and deployed full-stack data-driven applications (TypeScript,
  Cloudflare Workers, Postgres/Neon, Redis) with provider-abstracted data
  pipelines, rate-limit governance, and graceful degradation."
- "Built agentic LLM tooling with function-calling over live football data,
  with strict grounded-data guardrails preventing fabricated statistics."
- "Created a football data-visualization design system (typography-led stat
  graphics, automated SVG→PNG rendering pipeline)."
- Then Phases 1–4 add: "trained and calibrated a custom xG model on 40k+
  shots"; "implemented expected-threat and pitch-control models from the
  literature"; "built an automated opposition-report generator."

---

## Appendix A — Glossary flashcards

| Term | One-liner |
| --- | --- |
| xG | P(goal) for a shot, from historical shots with similar features |
| npxG | xG minus penalties |
| xA | xG of the shot following your pass |
| xAG | xG assisted — FBref's variant, only when a shot occurred |
| PSxG | xG after ball trajectory is known; isolates finishing/GK skill |
| xGChain | possession xG credited to every involved player |
| xGBuildup | xGChain minus shooter and assister |
| xT | zone-value Markov model; action value = Δzone value |
| EPV | continuous possession value (tracking-based generalization) |
| VAEP | ΔP(score) − ΔP(concede) per action, learned model |
| OBV | StatsBomb's production possession-value model |
| PPDA | opp. passes per your defensive action, opp. 60% of pitch; lower = harder press |
| Field tilt | share of final-third touches |
| Padj | possession-adjusted defensive stats |
| Pitch control | P(controlling ball at (x,y)) from positions + velocities |
| Packing | defenders eliminated by a pass/carry |
| HSR | high-speed running distance (>5.5 m/s) |
| SPADL | socceraction's normalized action format |

## Appendix B — StatsBomb event JSON, orientation speed-run

- Matches → `matches/{competition_id}/{season_id}.json`; events →
  `events/{match_id}.json`; lineups separate; 360 frames separate.
- Every event: `id, index, period, timestamp, minute, second, type,
  possession, possession_team, play_pattern, team, player, position,
  location [x,y]` + type-specific object (`shot`, `pass`, `carry`, …).
- Shots carry `shot.statsbomb_xg`, `shot.freeze_frame` (player positions!),
  `shot.outcome`. Passes carry `pass.end_location`, `pass.height`,
  `pass.outcome` (absent = complete — gotcha #1).
- Pitch: 120×80, origin top-left, attacking left→right per team per period
  — normalize direction before any spatial aggregation (gotcha #2).
- Pressure events and `under_pressure` flags are StatsBomb-unique — free
  feature gold for your xG model.

## Appendix C — This repo as lab bench

Everything you build feeds back here: Phase 1 shot maps → new card kind;
Phase 2 profiling percentiles → player_stat cards get "top 8% of PL
midfielders" lines; Phase 4's report generator → a `long_read` pipeline
with dossier cards. The bot is your distribution; the research is your
depth; the design system makes both recognizable. That combination — ship,
analyze, publish, repeat — *is* the positioning.
