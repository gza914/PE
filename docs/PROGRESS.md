# Progress

## Current milestone
9 (content pass) and 11 (polish): **done**. Left: 10 (optional live sit-downs).

## Milestone 9: content pass
- **151 events** (from 56), in four batches, with the balance check rerun after each.
  - Arcs (8+): the rat; narcotics (an offer, a sideline, quiet money, heat, an overdose, a bust); the Don's son Vincent (home from the Army, first job, made, restless, a lawyer, a rival); a Senate committee (rumor, subpoena, televised hearings, a witness, the aftermath); a capo's ambition; a union election and strike; a kidnapping; succession; war and the Commission.
  - Trait events: 25 matters that turn on one man's temperament (a vain capo's gold Cadillac, a pious one's confession, a drinker, a loyal man who warns you).
  - Rackets and the city: fixed fights, a racetrack tip, garbage and vending contracts, airport cargo, parking lots, an IRS audit, a club fire, a newspaper strike, a teen gang.
  - Your own life: your health, your wife's questions, her brother's debts, an FBI agent at the barber's, a photograph in the Herald.
  - Money drains: a councilman's nephew, a judge's campaign, a hospital wing, the Policemen's Ball, the Waterfront Commission, a nightclub that loses money beautifully.
- **New effects:** `add_racket`, `remove_racket`, `promote`, `defect`, and a `headline` on events and outcomes that prints in the Herald.
- **Event machinery:** `urgent` events (succession) always arise when eligible; cast slots must refer to earlier slots (checked at load); fills skip names that no longer exist, and effects on a racket that has since closed do nothing.
- **Tone edit:** every new event follows the guide. Real street names are replaced with fictional ones. Places outside the city (Montreal, Miami, the track at Belmont) stay real; no real people.
- **Balance changes:**
  - Retirement is offered from 9 years (Don's Trust 70). It is a request the Don can grant, put off ("one more year", likelier the more he relies on you) or resent (Don's Trust -25, likelier with Exposure 30+ or a new Don).
  - "Intact" needs $100,000 in the treasury (was $25,000).
  - Event incomes trimmed; new monthly obligations make a careful family pay for its caution.
- **Latest result** (`docs/BALANCE.md`, 1,000 runs each): cautious wins 55%, paper 46%, silent 10%, ignore_law 5%, aggressive 0%, random 0%. No balance bugs; only the tutorial-only `first_morning` never fires in bot play.

## Milestone 11: polish
- **Difficulty** (`content/difficulty.yaml`): Easy, Normal, Hard. They adjust the starting treasury, Don's Trust and Influence, how readily the Don follows advice, and how fast investigations move. Chosen at New game; saved in `WorldState.difficulty`.
- **Tutorial month:** an optional gentle first matter (the baker who was robbed), and tips from "an old hand" through the first months: the desk, sources, ending the month, the report, the Family and Books tabs, the Papers. Each can be dismissed, or all turned off.
- **The Papers** (Evening Herald tab): every month's headlines, newest first. Stories about the family are red and tagged; the rest is the city. Filter by family or city, with a clippings column. A filler story never repeats within a year.
- **Typewriter:** the month's news, the latest line at the sit-down table and the ending type themselves in. Click or any key skips. Off in settings, and off under reduced motion. The unrevealed text keeps its space, so nothing jumps.
- **Settings tab:** theme (match system, light, dark), typewriter and tips. Kept in the browser.
- **New game** opens a setup sheet (difficulty, tutorial). It is the first screen of a fresh browser.
- **Fix:** typing N in a dossier note no longer ends the month.
- **Saves:** schema version 8; web save version 7.

## Milestone 7: simulation harness
- `python tools/simulate.py --runs 1000` plays full games with six bot strategies (`tools/bots.py`) on four cores. 1,000 runs per strategy take about 4 minutes. Flags: `--strategies`, `--months`, `--seed`, `--jobs`, `--json`, `--report`, and `--strict`, which exits 1 on a balance bug.
- **Strategies.** Bots see only what a player sees, plus the published options; their own coin flips come from a separately seeded GameRNG.

  | Strategy | How it plays |
  |---|---|
  | cautious | least risk; verifies intel; keeps the books; makes peace at the table |
  | aggressive | escalates; threatens at the table, then walks |
  | random | random advice and random moves at the table |
  | ignore_law | follows the money and ignores heat, Exposure and the courts |
  | silent | never advises |
  | paper | best looking on paper; verifies; keeps the books |

  The attentive bots (cautious, paper, ignore_law) flag light envelopes, move rackets away from capos who stay short, and staff unattended rackets.
- **Report:** win rate (retired or reached 1972 with the family intact), average ending rank and length, endings by strategy, average treasury at each year end, war rate and months at war, how often the rat was found, final Don's Trust, events that never fired, and balance bugs. A strategy over 70% wins or an event that never fires is a bug. Events marked `rare` (deliberate fallbacks) are listed but not counted.
- **Tuning the harness drove:**
  - Tribute agreed at a sit-down now lasts 24 months (expenses can have an end month).
  - Stipend raises are +$500, at most every two years.
  - Payoffs drop from $6,000 to $5,000.
  - A month in which you advise on none of the Don's matters costs 1 Don's Trust, down to a floor of 25. Silence on a single matter is still free, but a silent consigliere is sidelined.
  - Retirement is offered at 8 years with Don's Trust 70.
  - "Intact" needs strength 45 and $25k in the treasury.
- **Latest result** (`docs/BALANCE.md`, 1,000 runs each): cautious 54% wins, paper 44%, silent 30%, ignore_law 7%, aggressive 3%, random 0%. No balance bugs; only the rare `succession_pair` fallback never fired.

## Milestone 5: web screens
- **Dossiers tab:** everyone you know, pinned first. For each man:
  - his reputation (traits)
  - what you believe about his loyalty, with when you last noticed and how sure you are
  - his envelopes against what they should be
  - the law
  - everything you've noticed about him, and the news that names him
  - your own notes, saved in the game (`Note`, `Pin` commands)
- **Envelopes against expectations** (Books): each capo's rackets' expected envelope against his last six. "Show the Don" puts a flagged_books matter on the desk, with intel on whether he's keeping back money; once per capo per six months.
- **Who runs what** (Family): propose moving any racket to another capo. It becomes a reassignment or assignment matter with your advice on record, and the Don decides. Each man's card shows his envelopes.
- **Engine:** envelopes record their racket; matter ids stay unique; schema version 7. Everything is mirrored in JS, and the parity bot flags and proposes too.

## Milestone 8: time and succession
- **Aging** (`engine/lifecycle.py`): past 50, health slips with a monthly chance of 1.5% per year over. Dons and rival bosses run ×1.5, and drink adds 5%. A man below 35 health can have a spell. At 0 he dies off the page and a funeral is narrated. The Don usually dies in the mid to late 1960s.
- **Rival succession:** a dead rival boss is replaced by the next man in his family (Nicky Brancato, Paolo Orsini).
- **New blood:** "An empty chair" arises when your crew is down to fewer than five, and lets you make a steady soldier or an earner into a capo. Recruits are generated from `content/recruits.yaml` (name lists and temperament profiles). Without this, every long game ran out of men and ended in ruin.
- **Succession crisis:** when the Don dies, is jailed or flees, "Who will be Don" arrives. It is a matter **you decide** (new `you_decide` events, where silence takes a `default_option` and the Don isn't consulted).
  - Your sources tell you who has the votes.
  - The capos choose by respect + loyalty/2, plus 20 + Influence/2 for the man you back.
  - If you backed the winner, his trust starts at 70. If you stayed out, it starts at 45. If you backed a loser, he keeps you (30% + Influence/200, trust 25) or pushes you out.
  - There is a two-candidate variant for a depleted family.
- **Endings** (`content/endings.yaml`, ranked best first), checked at the end of every month:
  1. retired with the family intact
  2. the end of an era (December 1972) with the family intact
  3. retired, from a diminished family
  4. the end of an era, diminished; or died in his bed (both rank 4)
  5. pushed out
  6. gone to ground (Exposure 100)
  7. prison
  8. killed
  9. disposed of (Don's Trust 0)
  10. the family's ruin

  Retirement is offered as a matter you decide after six years, if the Don trusts you (60+). Once a run ends, the month no longer advances and commands are refused.
- **Memoir:** months served, Dons served, matters settled, advice given and taken, how things went, the rat, the peak and final treasury, districts held, final trust, and everyone lost along the way and how.
- **Web:** cards for decisions that are yours alone (no Don's filter, default shown), the memoir screen with "Begin again", and a list of Dons served.
- **Schema** version 6, with a migration from version 5.

## Milestone 6: the world
- **The city:** 8 districts across three families. You hold 4. The Brancatos (hothead boss, broke) hold 2 across the river, and the Orsinis (cautious, rich, stronger) hold 2 uptown. Every racket sits in a district. Rival rackets earn without capos, and rivals pay upkeep.
- **Heat:** each racket gains its heat rate each month and sheds 8%. Family heat follows its rackets' average, and war adds +4 a month to every family.
- **The law** (`engine/world.py`): a man draws an investigation when his heat is over 45. Heat means his rackets' heat for a capo, family heat for the Don, and Exposure for you.
  - Investigations climb surveillance → informant recruitment → grand jury → indictment → prison. They advance with heat, faster while a rat talks and slower while he is fed lies. Cold ones close.
  - A jailed man's rackets go unattended, his family is owed a stipend (missing it costs loyalty), and an indictment is narrated. The Don's jailing starts a succession.
  - You learn of investigations through an honest police source (better odds) or when a grand jury makes them public. Matters let you take his rackets away, put Mr. Fessler on it, bribe, hire the best lawyer, ship him abroad, or lean on witnesses.
- **The conflict ladder:** peace → insult → sit-down → retaliation → blood → war.
  - Tension drifts each month with the rival boss's temperament and the strength gap, then cools 5%.
  - Events climb the ladder: an insult at a christening; encroachment in a district (with intel on whether they can afford a fight); a burned car; the question of a hit on their boss.
  - War costs $3,000 a month and 1–3 strength a side. Capos can be killed (news). After 3 months the Commission demands a settlement. The side that breaks first cedes a district.
- **Scripted sit-downs:** you negotiate directly, without the Don, over a monthly tribute.
  - They have a hidden red line: higher if they're stronger, lower if they're broke. They open $800–1,400 above it.
  - Your moves: concede $300 (they drop $200), hold firm (works only on a broke rival), threaten (credible only if you're 10+ stronger, otherwise it costs their patience), or walk.
  - A deal sets the tribute as a monthly expense and makes peace. A deal near their red line earns Don's Trust +3. No deal escalates the ladder. A sit-down left unfinished at month end breaks up.
- **Web:** a sit-down panel on the desk, a City tab (districts and heat, the ladder with each rival, the investigations you know of), a Heat meter, and men in prison or killed marked in Family.
- **Content:** 15 new events in Milestone 6 and 6 in Milestone 8, for 52 in all.
- **Schema** version 5, with a migration from version 4.

## Balance check (40 seeds, full runs to an ending; rank 1 is best of 11)
| Strategy | Avg ending rank | Avg length | Endings |
|---|---|---|---|
| Knows every secret | 2.1 | 124 months | retired intact 22, retired diminished 14, pushed out 4 |
| Best option on paper | 2.8 | 126 months | retired intact 18, retired diminished 12, pushed out 6, disposed 3, era intact 1 |
| Silent | 3.6 | 148 months | era intact 15, pushed out 13, era diminished 12 |
| Random | 8.7 | 43 months | disposed 38, retired intact 1, pushed out 1 |

No strategy wins more than 70% of the time (the design doc's bar). Random advice gets you disposed of within about four years.

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

## Known issues (Milestones 6 and 8)
- The Don decides matters for the month in which he dies, before the succession sits.
- Bots back succession candidates blindly, which is why "pushed out" is common in the table above. A player reading "who has the votes" should do much better.

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
- Play full runs on each difficulty, to an ending, and tune by feel.
- Milestone 10 (optional): live sit-downs over the Claude API, with the scripted sit-down as fallback.
