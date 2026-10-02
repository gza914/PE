# Progress

## Current milestone
4. Information (vertical slice): **done**. Next up: Milestone 5 (web UI depth: Matter detail, Dossiers, Ledger) or Milestone 6 (the world: rival families, heat, investigations).

## Milestone 4
- **Sources** (`state.sources` hold the truth; `knowledge.sources` hold what you believe). The scenario starts with four:
  - Talk at the social club: overrated (true 50%, you start at 60%).
  - Nunzio the barber: underrated (true 80%, you start at 45%).
  - Sal Lauro: 75% true. He is family, so if he is the rat his reports invert.
  - Mr. Fessler, the lawyer: 85% true.

  Events can add more:
  - Sgt. Dolan (police). If Dolan's bad outcome fires, he is secretly working for his lieutenant and compromised.
  - Ellen Hartigan of the Herald (press).
  - Tommy Vella (street). He is reliable or unreliable on a hidden coin flip, and you can't tell which from the text.
- **Intel on matters** (`intel:` in event YAML): a claim, its denial, the condition that makes it true, and the kinds of source that would know.
  - When a matter arises, one source of a fitting kind reports, according to its reliability. A compromised source always reports the opposite.
  - Nobody reports on himself.
- **Verification** (`Verify` command, "Ask another source" in the web UI): costs 3 Influence and asks a source who hasn't spoken yet. Influence now accrues by +1 a month.
- **Learning who to trust:** when a matter is settled, the truth behind each claim comes out with a 60% chance (per-claim override). Each source's record updates, and your trust becomes (right + 4 × first impression) / (right + wrong + 4). The Don's decisions report what came out and who had it right.
- **Event machinery added:**
  - `secrets`: coin flips at arising that travel with follow-ups.
  - `arise_effects`
  - `{any: [...]}` conditions
  - `lists`: names sorted so slot order never leaks.
  - `carries`: bindings inherited by follow-ups.
  - Effects: `allegiance`, `add_source` / `compromise_source` / `remove_source`, `assign_roles` (a shuffle), `add_vice`, `retire`, `health`.
- **The Rat arc** (5 events):
  1. Mr. Fessler's warning names three men. They are secretly shuffled into rat, red herring (who has his own secret) and innocent.
  2. The street's evidence comes in, with a claim about each man.
  3. You either feed each man a different story (the canary) or put the question to one of them. Accusing the wrong man costs his loyalty, and the rat keeps talking.
  4. The reckoning: exile, turn him, or "the old way" (off-page).
  5. If the rat stays in place, subpoenas arrive and the evidence round comes back.
- **Content:** 31 events: 16 earlier, 5 in the arc, and 10 new ones built on secrets and intel (a robbed card game, a reporter, a hijacked truck, a runner with big ears, a capo's restaurant, the Don's doctor, a patrolman's shakedown, the Don's nephew, a raid tip, a repaid loan). `light_envelope` now carries intel about the capo's real spending.
- **Web:** matter cards show "What you've heard" as slips from each source, with a trust bar, "Your sources disagree", and Ask another source. The new Sources tab shows each source's trust, record and first impression. The Don's decisions show what came out.
- **Saves:** schema version 4, with a migration from version 3.
- **Tests:** 128. The parity bot now verifies intel. Its 10-year games cover a rat who is also a source, a compromised Dolan, and an unreliable Tommy.

## Balance check (40 seeds × 24 months, Don's Trust at the end, starting at 50)
| Strategy | Trust | Rat found |
|---|---|---|
| Knows every secret (upper bound) | 75 | 40/40 |
| Best option on paper, ignores intel | 64 | 40/40 |
| Reads intel, trusts first impressions | 59 | 40/40 |
| Silent | 47 | 40/40 (slowly, after subpoenas) |
| Random | 20 | 38/40 |

Knowing the truth is worth about 11 points of trust over ignoring intel. A player who takes first impressions at face value does worse than one who ignores intel, because the best source starts out underrated. Learning who to trust is the skill.

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

## Known issues (Milestone 4)
- Exposure rises (subpoenas, bribes) but has no consequence until heat and the law arrive in Milestone 6.
- Matters don't show what it would cost to learn more beyond the flat Influence price; sources of different kinds all cost the same.
- No Dossiers screen yet: what you believe about each man is the Family tab's loyalty reading plus the Sources tab.

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
- Play the vertical slice (24 months) in the web version: is reading the slips fun, and does the Rat arc land?
- Milestone 5 (deepen the web UI: Dossiers, Ledger with skim estimates) or Milestone 6 (rival families, heat, investigations, sit-downs).
