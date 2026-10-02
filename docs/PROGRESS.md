# Progress

## Current milestone
2. Economy and characters: **done**. Next up: Milestone 3 (The advisory loop).

## Milestone 2
- **Cast** (`content/scenarios/default.yaml`): the Ferrante family. Don Aurelio Ferrante, underboss Sal Lauro, you (Thomas Corvo), and four capos with distinct profiles:
  - Vito Amaro: loyal old hand.
  - Frank Tessaro: ambitious, greedy top earner running two rackets.
  - Leo Marchetti: quiet, hard to read.
  - Augie Sabella: hothead with no discretion, running two rackets.
- Six rackets, four monthly expenses (one of them crew stipends).
- **Economy** (`engine/systems/economy.py`): each racket's gross = typical income × random swing × the capo's competence. The capo keeps his crew's share, then skims part of what he owes based on greed × disloyalty plus trait modifiers. The skim goes to his hidden `stash`. The family pays expenses in order and skips any it can't afford. A missed stipend leaves a remembered slight on every member.
- **Characters** (`engine/systems/characters.py`): memories decay and are forgotten. Each month loyalty closes 10% of the gap to a target set by the Don's respect, family cohesion, traits, and remembered favors and slights (capped), plus a little noise. Cohesion follows the crew's mean loyalty.
- **Observation** (`engine/systems/observation.py`): when a man's loyalty crosses into a new band, you may notice. Low discretion makes it likelier. Noticing produces a `Report` with a line from `content/observations.yaml` and updates your impression of him. Unnoticed shifts leave your impression stale.
- **Tuning** lives in `content/balance.yaml`; flavor text lives in `content/observations.yaml`.
- **Text loop**: after each month it prints the books (envelopes, expenses, treasury) and what you noticed. `f` shows the family tree with your reading of each man; `r` reprints the last report.
- **Saves**: schema version 2, with a migration from version 1.
- **Tests**: 60, covering economy math, skim bounds, missed stipends, memory decay, loyalty convergence, observation, content validity, migration, CLI, and a seed-1234 golden run.

## Observations from a 10-year headless run (5 seeds)
- Loyalty is stable: men settle near their trait-driven targets (Amaro around 90, Tessaro around 50).
- Tessaro skims about 20% of what he owes (about $270k over 10 years); Sabella about $100k; Marchetti a little; Amaro nothing.
- The treasury nets about +$3k a month and never runs short, so the missed-stipend path never fires in normal play. Nothing to spend on yet; Milestone 3 decisions should create that pressure.

## Web version (added after Milestone 2)
- One mobile-first page, `web/dist/consigliere.html`, built by `tools/build_web.py` from three pieces:
  - `web/index.html`: layout and styles.
  - `web/app.js`: the UI. It has Office (the month's books and notes), Family (your read on each man, plus his rackets) and Books (treasury chart, monthly table, everything you noticed).
  - `web/engine.js`: a JavaScript copy of the monthly tick.
- The Python engine stays the source of truth. The build script dumps the balance, the observation text and the validated starting WorldState as JSON, so the web page never re-reads the YAML. `engine.js` reproduces Python's Mersenne Twister and the exact float math, and `tests/test_web_parity.py` checks with node that 120-month games are identical, including the missed-stipend path.
- Saves go to the browser's localStorage. A New game button asks for confirmation on the page itself.
- Pyodide (Python in the browser) was ruled out: the hosting page blocks the CDN fetches it needs, and it would be a 13MB download on phones.

## Known issues
- No decisions yet: you watch. Racket `heat` is defined but not accumulated (Milestone 6).
- The CLI reads names, roles and racket assignments from `WorldState` (treated as public knowledge); stats come only via `PlayerKnowledge`.
- The golden test in `tests/test_golden.py` must be updated whenever balance or content changes on purpose.
- Every engine change now has to be made twice (Python and `web/engine.js`); the parity test catches any drift.
- pytest is not installed in a fresh container: `pip install -e .[dev]`.

## Next step
- Milestone 3: matters, recommendations, Don's Trust, the Don's decision logic, 15 events. Start with a plan for the event YAML schema and the Don's decision model.
