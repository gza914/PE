# Cartel Conquest

A single-player, real-time-with-pause grand strategy game set in a Sinaloa
cartel civil war, built as a browser game in TypeScript. The full design is in
[docs/GDD.md](docs/GDD.md).

**Status:** all five roadmap phases are playable: logistics and detection,
combat, the economy, the utility AI with characters and endings, and (phase
5) the State, information warfare, schemes, and events. Crews move, get
spotted, ambush, clash, raid, and besiege; money flows from routes,
extortion, labs, and rackets into stash houses and out to payroll. AI faction
heads plan offensives and send requests; AI lieutenants answer them, raid,
ambush, and scout, all from their own network's reports. Calentura brings
checkpoints, army raids, and capture operations; banners, videos, corridos,
and planted rumors move morale and what rivals believe; schemes flip, kill,
frame, and buy halcones; 49 events tell the story. The war ends in
territorial defeat, collapse, a truce, or the day-270 time cap, with a score
and title.

**Coalition warfare** is built on top: joint operations and pacts between
bosses, sightings as ranges with drones over towns and informants, deeper
recruitment (tiers, weapons, training camps, veterans, mercenaries, crews of
50, columns), the outside cartels CJNG and CdG, capturing bosses and deciding
their fate, choices for a boss who has lost everything, the countryside around
every plaza, and battle stances and actions. See the build log at the end of
the GDD.

## Commands

```sh
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # Vitest: content validation, determinism, save/load, headless run
npm run typecheck
npm run build
npm run balance    # AI-vs-AI campaigns scored against the GDD balance targets (RUNS sets the count, default 12;
                   # TUNE='{"ai":{...}}' deep-merges tuning overrides)
```

In game: `Space` pauses, `1`–`5` set speed, `Esc` cancels route planning.
Select a crew, press Move or Raid, click a destination, pick a route. Click a
road to launch a drone. Click a ⚔ marker (or a battle report) to open the
battle and make decisions. In the Culiacán view, click a colonia to deploy
crews there. The Faction tab shows your faction's war plan and the requests
your head sends you. The Shadows tab covers the State region by region
(bribes, police, lying low, scapegoats), messages, rumors, and your schemes.
Banners, shows of force, tip-offs, and buying halcones are on the plaza
panel; schemes against a person are on their character panel (click any
name). Events pop up for a decision; "Decide later" parks them behind a top
bar button. The top bar also has map overlays and a debug fog toggle.

The side tabs: Intel (each rival town's strength as a range, sources, eyes
there), Forces (every crew and column, pay, loyalty, recruitment and
mercenaries), Diplomacy (joint operations, pacts, and the outside cartels),
and Shadows (captives and, if you lose your last plaza, your choice). On a
rival plaza, "Plan joint attack" invites allies; on yours, "Ask for help
holding". Crews can camp in the hills around a plaza, strike the town from
there, or sweep the hills. In a battle, pick a stance every few hours.

## Layout

```
docs/GDD.md          game design document (source of truth)
src/data/            content JSON + Zod schemas (schemas.ts) + loader (content.ts)
  tuning.json        every balance number
  events/*.json      one event per file
src/sim/             pure, deterministic simulation core (no DOM)
  state.ts           the single serializable GameState
  tick.ts            advances one in-game hour
  commands.ts        the only way to change state from outside
  rng.ts             seeded, serializable PRNG
  routing.ts         route planner (Fastest / Balanced / Safest, waypoints)
  signature.ts       signature and detection math
  knowledge.ts       what a network knows (UI and AI read through this)
  power.ts           combat strength and attack decisions
  money.ts           cash, stash houses, and the ledger
  orders.ts          shared order and notification helpers
  opinion.ts         relationship bases and decaying opinion modifiers
  requests.ts        faction requests (offensives, defense, levies)
  diplomacy.ts       declaring for a side and switching sides
  pacts.ts           pacts: non-aggression, safe passage, mutual defense, route
                     share, local truce, income share
  operations.ts      joint operations between bosses on one side
  estimate.ts        sightings as ranges
  intel.ts           drones over towns and informants
  forces.ts          tiers, pay, weapons, training, veterans, mercenaries
  outside.ts         CJNG and CdG: negotiation, contingents, associates
  capture.ts         the capture roll and captive options
  remnants.ts        a boss who has lost everything
  countryside.ts     influence in the hills, camps, sweeps, rural economy
  battleActions.ts   battle stances and one-off actions
  invariants.ts      what must always hold; checked in long AI campaigns
  balance.ts         headless AI-vs-AI campaign runner and target report
  ai/                strategic, operational, tactical, economy, logistics,
                     shadow (the State, messages, schemes), coalition,
                     outside, and countryside layers;
                     intel.ts is the AI's reports-only view
  systems/           movement, detection, combat, economy, characters, pulse,
                     endings, events, stateForces, infowar, schemes, ai
src/ui/              React + Zustand shell, SVG maps
tests/               Vitest unit tests and headless campaign runs
```

## Content

All content is first-draft data written for the game, ready for review:
48 map nodes and 74 roads, 10 trafficking routes, 16 Culiacán colonias, 31 fictional characters
(2 heads, 24 lieutenants, 5 crew leaders), 40 message templates, and 49
events. Characters are invented composites; their names deliberately avoid
real people. The scripts that generated the drafts are not needed to edit
them: edit the JSON directly and the loader validates it.
