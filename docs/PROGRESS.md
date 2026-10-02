# Progress

## Current milestone
3. The advisory loop: **done**. Next up: Milestone 4 (Information).

## Milestone 3
- **Interface decision:** the web page is the main interface, laid out for desktop first (it still works in a narrow window). It replaces the Textual plan in DESIGN.md. The text CLI stays for quick headless play.
- **Matters** (`engine/matters.py`, schema in `engine/eventdefs.py`): every month, after the books close, 1 to 3 matters arise from `content/events/*.yaml`.
  - Each event casts characters and rackets from those that fit, for example "an ambitious capo" or "the capo who runs the numbers racket".
  - Events have trigger conditions, weights, cooldowns and once-only flags. Text is filled with names when the matter arises.
- **Advice:** for each matter you recommend an option, advise waiting (if the event allows it), or say nothing (`Recommend` command).
- **The Don decides** when you end the month:
  - He follows your advice with a chance of 15% + up to 70% from Don's Trust, ±10% from his mood, and his traits (paranoid -10%, vain -5%, sentimental +5%), clamped to 5–95%.
  - Otherwise he picks his own preference: each option's appeal for his traits, plus a little noise. If his preference happens to match yours, that counts as following.
- **Consequences:** a weighted outcome is picked, where weights can depend on hidden truth (a capo who skims is likelier to be caught by an audit). Then its effects apply:
  - stats, memories, Don's Trust / Influence / Exposure
  - money (shown in the books as "Decisions that cost or paid")
  - the Don's mood, cohesion
  - racket reassignment and income changes, new or changed monthly expenses
  - flags and delayed follow-ups
- **Don's Trust** after each matter:
  - He followed you: +3 if it went well, 0 if neutral, -8 if it went badly.
  - He ignored you: -2 if it went well anyway, 0 if neutral, -2 if it went badly.
  - You said nothing: no change.
  - Options can add Exposure when he follows your advice (your name is on it).
- **The Don's mood** rises after good outcomes (+3), falls after bad ones (-5), and drifts back toward even.
- **Content:** 16 events. 13 random matters, one follow-up matter (a promise coming due), and two news follow-ups (a capo who sulks after being refused, a card debt that turns violent).
- **Web:** Office has your desk (news, matters, advice buttons) next to last month's report (the Don's decisions, the books, what you noticed). Family has your read on each man. Books has the treasury chart, the monthly table and your advice record. Press `N` to end the month.
- **Saves:** schema version 3, with a migration from version 2.
- **Tests:** 101.
  - Parity between Python and JS now runs a bot advisor through five 10-year games. It cycles through every option, waiting and silence, and reaches every event, including all three follow-ups.

## Balance check (30 seeds × 36 months, `Don's Trust` at the end, starting at 50)
| Strategy | Avg trust | Range |
|---|---|---|
| Always the option that is best on paper | 73 | 35–100 |
| Always the first option | 58 | 14–100 |
| Silent | 50 | 50 |
| Random option | 23 | 0–48 |

Matters arrive about once a month on average after the opening months (2–3 in month one).

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
- One self-contained page (desktop-first since Milestone 3), `web/dist/consigliere.html`, built by `tools/build_web.py` from three pieces:
  - `web/index.html`: layout and styles.
  - `web/app.js`: the UI. It has Office (the month's books and notes), Family (your read on each man, plus his rackets) and Books (treasury chart, monthly table, everything you noticed).
  - `web/engine.js`: a JavaScript copy of the monthly tick.
- The Python engine stays the source of truth. The build script dumps the balance, the observation text and the validated starting WorldState as JSON, so the web page never re-reads the YAML. `engine.js` reproduces Python's Mersenne Twister and the exact float math, and `tests/test_web_parity.py` checks with node that 120-month games are identical, including the missed-stipend path.
- Saves go to the browser's localStorage. A New game button asks for confirmation on the page itself.
- Pyodide (Python in the browser) was ruled out: the hosting page blocks the CDN fetches it needs, and it would be a 13MB download on phones.

## Known issues (Milestone 3)
- Content is thin: with 13 random matters the same ones return about once a year. Milestone 4 targets 30 events.
- Don's Trust at 0 has no consequence yet (endings come in Milestone 8). Influence is gained but can't be spent.
- Matters don't yet show "what you believe, how sure you are, and what it would cost to learn more". That is Milestone 4.

## Known issues (earlier)
- No decisions yet: you watch. Racket `heat` is defined but not accumulated (Milestone 6).
- The CLI reads names, roles and racket assignments from `WorldState` (treated as public knowledge); stats come only via `PlayerKnowledge`.
- The golden test in `tests/test_golden.py` must be updated whenever balance or content changes on purpose.
- Every engine change now has to be made twice (Python and `web/engine.js`); the parity test catches any drift.
- pytest is not installed in a fresh container: `pip install -e .[dev]`.

## Next step
- Play a few in-game years in the web version and note which matters felt like real dilemmas and which were obvious.
- Milestone 4: reports, sources, confidence, verification, one informant, the Rat arc; reach 30 events.
