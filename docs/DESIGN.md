# Consigliere: Game Design Document

Oct 1, 2026 · Anthony Garza

## Concept and pillars

Consigliere is a text-based strategy and narrative game where you are the trusted advisor to the head of a crime family. You rarely act yourself. You advise, broker deals, gather information, and manage people, and your fate depends on whether your counsel keeps the family strong and keeps you indispensable.

Setting (default, swappable): a fictional East Coast city, 1958 to 1972. Fictional families, fictional characters, no real people. A run lasts roughly 60 to 120 in-game months and ends with your death, prison, exile, retirement, or the family's rise or ruin.

### Player fantasy

You are the smartest person in the room, but not the most powerful. You win through judgment, leverage, and timing, not firepower. Every recommendation carries your name, and when the Don ignores you and things go wrong, you still have to clean it up.

### Design pillars

1. **Influence, not control.** The Don, capos, and rivals have their own minds. Your advice shifts odds; it never guarantees outcomes.
2. **Information is the real currency.** Most decisions are made on partial, stale, or deliberately false information. Knowing who to trust is the core skill.
3. **Everyone remembers.** Favors, slights, and betrayals persist and resurface months later.
4. **The world moves without you.** Rivals scheme, the law investigates, and people age whether or not you act.
5. **Short sessions, long arcs.** A turn takes two to five minutes; a run tells a story worth retelling.

### Out of scope

Real-time combat, graphics, multiplayer, and playing as the Don directly.

## Core loop

One turn is one month and takes two to five minutes. The tension sits between your recommendation and the Don's decision.

*Each month, your advice is only as good as what you know* (monthly turn · 7 steps, 1 feedback loop):

```
World ticks ──▶ Reports arrive ──────▶ Matters arise ──▶ You investigate
(rivals, law,   (true, stale, or       (2 to 4 per       (verify sources)
 money)          false)                  month)                 │
    ▲                                                           ▼
    │ next month                                          You recommend
    └──────── Consequences ◀──── Don decides ◀──────────  (advice on record)
              (now or months      (listens, or not)
               later)                    ▲
                  │ outcomes             │ sets how often he listens
                  ▼                      │
              Your standing ─────────────┘
              (Don's Trust, Influence, Exposure;
               carried month to month)
```

The Don follows your advice with a probability set by Don's Trust, his traits, and his mood. A good call he ignores still costs you when things go wrong; a bad call he follows costs more.

For each matter you can recommend one of its 2 to 4 options, recommend waiting, or stay silent (no risk, no gain). A month in which you say nothing on any of the Don's matters costs a little of his trust, down to a floor: a consigliere who never speaks is sidelined, though silence alone never gets him killed. With enough Influence you can also act behind the scenes: arrange a meeting, move money, plant a rumor, or warn someone. Each matter shows what you believe, how sure you are, and what it would cost to learn more.

There is no win screen. Runs end in one of several endings, ranked in the end-of-run memoir; the best is retiring alive with the family intact.

## Systems

Eight systems carry the game. Each is simple on its own; the fun comes from how they push on each other.

### Characters

Every named person is a Character with:

- **Role:** Don, underboss, consigliere (you), capo, soldier, associate, rival boss, cop, prosecutor, politician, union boss, journalist, family member.
- **Traits (3 to 5):** e.g. Ambitious, Loyal, Hothead, Greedy, Cautious, Pious, Vain, Paranoid, Sentimental. Traits weight their decisions and unlock trait-specific events.
- **Stats (0 to 100):** Loyalty (to the family), Fear, Respect, Competence, Greed, Discretion.
- **Hidden state:** secret allegiances (informant, rival plant), debts, vices, health, age.
- **Memory:** a list of remembered events with weights that decay slowly. A betrayal decays far slower than a favor.

### Relationships

A directed graph. Each edge from A to B holds Trust, Affection, Fear, and Debt (favors owed). Edges are asymmetric: the capo may fear you while you trust him. Decisions consult the graph, so a capo whose rival you just promoted becomes a real risk.

### Your standing

Three meters define you:

| Meter | What raises it | What it does | At zero |
|---|---|---|---|
| Don's Trust | Advice that works; discretion | How often the Don follows your counsel | You are sidelined, then disposed of |
| Influence | Favors banked; people placed | Lets you act directly (arrange meetings, move money, plant rumors) | You can only advise |
| Exposure | Your name on deals; informants near you | Raises law and rival attention on you personally | (high is bad) Indictment or a contract on you |

### Information

Every fact the player sees is a Report with a source, a date, and a confidence. Sources have hidden reliability and may be compromised. The player can:

- Spend Influence to verify a report through a second source.
- Cultivate informants (in the police, rival families, the press).
- Plant false reports to test who leaks.

The true world state is never shown directly. The UI shows what you believe, and the gap between belief and truth is where the drama comes from.

As built (Milestone 4): each source has a hidden reliability and a first impression (how far you trust him at the start). The two can differ in either direction. A compromised source, including a family member who is secretly an informant, always reports the opposite of the truth. When a matter is settled, the truth behind its claims comes out with some chance, and each source's record of right and wrong calls updates how far you trust him. Verifying costs Influence, which accrues slowly each month and through favors. Planting false reports exists as the canary trap in the Rat arc.

### Economy

Rackets (numbers, loansharking, unions, docks, construction, gambling, protection, later narcotics as a tempting, high-heat option) each have income, heat per month, and an assigned capo. Capos skim based on Greed and Loyalty. The family treasury pays tribute, bribes, lawyers, and the families of jailed men. Neglecting those families lowers Loyalty across the crew.

### Heat and the law

Heat accumulates per racket, per capo, and per family. Above thresholds, law enforcement opens investigations that progress through stages: surveillance, informant recruitment, grand jury, indictments. Investigations target people, so moving a hot capo away from a racket matters. Bribed officials slow progress but add Exposure.

### Conflict

Families have Strength, Wealth, and Cohesion. Disputes escalate along a ladder: insult, sit-down, sanctioned retaliation, hit, open war. War drains everyone and spikes heat for all families, which creates pressure from the Commission (a council of bosses) to settle. Violence is resolved abstractly through odds, not tactics.

### Succession and time

Each turn is one month. Characters age, fall ill, and die. The Don's health declines on a hidden curve. When he dies or is jailed, a succession crisis fires: candidates lobby, rivals probe for weakness, and your choice of who to back decides whether you remain consigliere.

As built (Milestone 8): the succession is a matter you decide yourself, since there is no Don to ask. Your sources tell you who has the votes, and your backing (with your Influence behind it) tips the capos. When the crew runs thin, soldiers can be made capos, so the family can last the full run. Runs end in one of ten ranked endings, from retiring with the family intact to the family's ruin, followed by a memoir of your career.

## Content

Content lives in data files, not code, so it can grow without touching the engine.

### Events

An event is a YAML file with: trigger conditions (state predicates), weight, cooldown, the text shown to the player, 2 to 4 options, and per-option effects and follow-up events. Effects can be probabilistic and delayed ("in 2 to 4 months, if X still holds, fire Y"). The exact schema is documented at the top of `engine/eventdefs.py`: a cast of characters and rackets picked at random from those that fit, conditions as `[left, op, right]`, options with the Don's own leanings by trait, and weighted outcomes each with a tone (good, bad, neutral) and effects. A `news` event has no options; it is a consequence that simply happens, usually as a follow-up.

Target counts:

| Milestone | Generic events | Trait events | Story arcs |
|---|---|---|---|
| Vertical slice | 30 | 10 | 1 |
| Full game | 150+ | 60+ | 8 to 12 |

### Story arcs

Multi-month chains with branching outcomes. Starter list:

1. **The Rat.** Someone close is talking to the FBI. Evidence points at three people; one is innocent and loyal.
2. **The Ambitious Capo.** A top earner wants more territory and is quietly courting a rival.
3. **The Narcotics Question.** Huge money, huge heat; the Don is against it, half the capos are for it.
4. **The Prodigal Son.** The Don's son wants in and is not suited for it.
5. **The Senate Hearing.** A televised investigation subpoenas the family.
6. **Succession.** Fires on the Don's death or jailing; always present.

### Sit-downs

Negotiations between families or within the family. Version 1 is scripted: each side has demands, red lines, and hidden leverage; you choose offers, concessions, and threats across 3 to 5 rounds. Version 2 (optional) uses the Claude API so you negotiate in free text; the model receives the character sheet, memory, and red lines, and must return a structured outcome the engine validates.

### Tone and writing guide

- Restrained, specific, and dry. Menace is implied, not shouted.
- Violence happens off-page and is reported after the fact.
- People speak in euphemism; the player learns to read it.
- Short paragraphs. An event's text fits on one screen.
- Fictional names and places only. Avoid ethnic caricature; give characters inner lives.
- Every event should make the player weigh two things they care about.

## Interface and presentation

A single web page, designed for a desktop browser first: mouse or keyboard, readable in a laptop window and better on a large screen. It also works in a narrow window. (Changed from the original plan of a Textual terminal app; the plain-text loop remains for quick headless play.)

Screens:

| Screen | Shows | Key actions |
|---|---|---|
| The Office (hub) | Month, treasury, your three meters, the Don's mood, pending matters | Open a matter, end month |
| The Matter | One event or decision: text, sources, options | Choose, verify a source, defer |
| Dossiers | Each known character: what you believe, with confidence | Pin, assign informant, add note |
| The Family | Org tree, capos, rackets, earnings | Recommend reassignment or promotion |
| The City | Territory by family, heat by district | Inspect a district |
| The Ledger | Income, expenses, skim estimates | Flag a discrepancy |
| The Papers | Monthly headlines, the public view of events | None (flavor and clues) |
| Sit-down | Negotiation rounds | Offer, concede, threaten, walk away |

Presentation touches: a typewriter effect for key scenes (skippable), muted color with red reserved for danger, newspaper-style headline formatting, and an end-of-run "memoir" summarizing your career. Accessibility: no information conveyed by color alone, all effects can be turned off.

## Technical architecture

Python 3.11 for the engine, Pydantic for the data model, YAML for content, pytest for tests. The UI is one self-contained web page (`web/`), built by `tools/build_web.py`. The page runs `web/engine.js`, a JavaScript mirror of the monthly tick that reproduces Python's random generator and float math exactly; a parity test plays the same seeded games in both and requires identical results. The rule that matters most: **the simulation never imports the UI.** The engine runs headless so it can be tested and balanced by script.

### Module layout

| Module | Responsibility |
|---|---|
| `engine/state.py` | `WorldState`: the single source of truth, fully serializable |
| `engine/models.py` | Pydantic models: Character, Relationship, Family, Racket, Investigation, Report, Event |
| `engine/turn.py` | Monthly tick: runs each system in a fixed order |
| `engine/systems/` | One file per system: economy, heat, law, conflict, relationships, aging, information |
| `engine/ai.py` | NPC decision-making: utility scores weighted by traits and memory |
| `engine/eventdefs.py`, `engine/matters.py` | Event schema; matters arising, triggers, effects, the Don's decisions, follow-ups |
| `engine/rng.py` | One seeded random generator passed everywhere |
| `content/` | Events, arcs, name lists, rackets, starting scenarios (YAML) |
| `web/` | The web UI (`index.html`, `app.js`) and the JS engine mirror (`engine.js`); reads state and sends player commands only |
| `llm/` (optional) | Sit-down and dialogue calls; strict JSON output, validated, with a scripted fallback |
| `tools/simulate.py` | Runs thousands of headless games with bot players |
| `tests/` | Unit tests per system, golden-seed regression tests |

### Key decisions

- **Determinism.** All randomness goes through one seeded RNG. Same seed plus same choices gives the same game, which makes bugs reproducible.
- **Commands, not mutations.** The UI emits commands (`RecommendAction`, `VerifyReport`, `EndMonth`); only the engine changes state.
- **Saves.** `WorldState` serialized to JSON with a schema version number and migration functions.
- **Belief vs. truth.** The engine holds the truth; a `PlayerKnowledge` layer holds reports. The UI reads only `PlayerKnowledge`.

### Balance and testing

`tools/simulate.py` plays N games with simple bot strategies (always cautious, always aggressive, random, "ignore the law") and outputs: average run length, cause of ending, treasury curves, war frequency, and events that never fire. Any strategy that wins over 70% of the time, or any event that never fires in 1,000 runs, is a balance bug.

## Build order

Each milestone ends with something playable. Do not start the next until the current one is fun, or you know why it isn't.

1. **Skeleton.** Models, seeded RNG, `WorldState`, JSON save/load, monthly tick that does nothing yet. A plain text loop (no Textual) that advances months. Tests pass.
2. **Economy and characters.** One family, the Don, 4 capos, 6 rackets, skimming, loyalty drift. Plain text reports each month.
3. **The advisory loop.** Matters, recommendations, Don's Trust, and the Don's decision logic. 15 events. First playable: is advising interesting?
4. **Information.** Reports, sources, confidence, verification, one informant. The rat arc. Vertical slice: one family, 24 months, 30 events, one arc.
5. **Web UI.** Office (desk and last month), Matter, Dossiers, Family, Ledger views. Started early; grows with each milestone.
6. **The world.** Two rival families, territory, heat, investigations, the conflict ladder, scripted sit-downs.
7. **Simulation harness.** Bot strategies, balance reports; tune until no strategy dominates.
8. **Time and succession.** Aging, death, the Don's decline, succession crisis, endings and memoir.
9. **Content pass.** Scale to 150+ events and 8+ arcs; tone edit by hand.
10. **Optional: live sit-downs.** Claude API negotiation with validated JSON output and scripted fallback.
11. **Polish.** Papers screen, typewriter effects, settings, tutorial month, difficulty levels.

As built (Milestones 9 and 11): 151 events, with arcs for the rat, narcotics, the Don's son, a Senate committee, a capo's ambition, a union election, a kidnapping, succession and war. Retirement is a request the Don can refuse, or resent. "Intact" means strength 45 and $100,000 put away. The web page has the Evening Herald (Papers), settings (theme, typewriter, tips), a tutorial month with tips from an old hand, and three difficulty levels chosen at New game.

## Working with Claude Code

Save this document as `docs/DESIGN.md` in the repo and keep a short `CLAUDE.md` at the root, which Claude Code reads at the start of each session.

### Session habits

- One milestone, or one slice of one, per session. Ask for a plan before code on anything bigger than a bug fix.
- End each session by having Claude update `PROGRESS.md` with what changed, known issues, and the next step.
- Play the game yourself after every milestone and write down what felt boring, confusing, or too easy. That list drives the next session more than this document does.
- Commit after each working step so you can roll back an experiment.
- When writing events in bulk, ask for 10 at a time, read them, and give tone feedback before the next batch.
- Keep this document current. When a design decision changes, change it here first.
