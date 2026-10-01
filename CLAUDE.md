# Cartel Conquest — notes for Claude Code

The design document is `docs/GDD.md`. Read the relevant section before building a system.

## Core rules (from the GDD)

1. `src/sim` is pure TypeScript with no DOM access; it must run headless in Vitest.
2. Deterministic: same seed + same commands = same game. Use `src/sim/rng.ts` with `state.rng`, never `Math.random()` or `Date.now()` in the sim.
3. All game state is one plain, JSON-serializable object (`GameState` in `src/sim/state.ts`). No classes, Maps, Sets, or functions in state.
4. The UI never changes state. It enqueues `Command`s (`src/sim/commands.ts`); AI issues the same commands.
5. Every balance number lives in `src/data/tuning.json` (with its schema in `src/data/schemas.ts`), not in code.
6. Content is data, validated at load by Zod plus cross-reference checks in `src/data/content.ts`.
7. AI sees only its own network's reports: no cheating on information.

## Workflow

- Write headless tests for a system before its UI.
- Run `npm run typecheck && npm test` before committing.
- Adding a tuning value means updating both `tuning.json` and `TuningSchema`.
- Adding a content cross-reference means adding a check in `crossReferenceProblems`.
- Event triggers and effects use a closed vocabulary (`EventConditionsSchema`, `EventEffectsSchema`). Add a key there before using it in content.

## Sim conventions

- Systems mutate the cloned state inside `tick`; `advance` mutates in place and is only for callers that own their state (the headless runner).
- Iterate crews via `sortedCrewIds` and consume RNG in a fixed order so runs stay deterministic.
- Anything the UI or AI shows about rivals must come from `knowledge.ts` (reports), never from reading `state.crews` directly.
- Only the player's network gets feed entries (`pushFeed` filters by audience); AI acts on reports.
- Fights start in two places: movement queues `ctx.engagements` (ambush, clash, interception, raid arrival) and the combat system adds garrison attacks and Culiacán skirmishes. Crews with `battle` set do not move.
- Culiacán is fought only colonia by colonia (`crew.colonia`); never start node-level battles there.
- Money moves only through `money.ts` (`deposit`, `spend`, `spendUpTo`, `moveCash`) so stash houses and the ledger stay consistent. Never touch `purse` or `stash` directly outside it (tests may, to set up state).
- Attack decisions go through `wantsToAttack` with an enemy estimate: `reportedPower` when judging from reports, true power only at close range.

## UI conventions

- Read what you need off a React event (`currentTarget`, coordinates, rects) before calling `setState`; state updaters run later, when the event's `currentTarget` is already null. That bug once blanked the whole screen on the first wheel zoom.
- Each area of the screen sits in an `ErrorBoundary`, so a crash shows a "Something broke" box with Try again instead of a blank page. Keep new top-level areas inside one.
- The game autosaves to `localStorage` once per in-game day (best effort, wrapped in try/catch); the start screen offers Continue.
- `tests/fuzz.test.ts` throws random commands at the sim; `FUZZ_SEEDS` and `FUZZ_DAYS` run a deeper sweep.

## AI conventions

- The AI (`src/sim/ai`) acts only by returning `Command`s, the same ones the player issues. It never writes to state directly, except its own planning records (`warPlan`, `offensives`, `requests`).
- AI plans from `Intel` (`ai/intel.ts`), which reads only the planning network's reports, plus typical-garrison priors where it has none. Never read `state.crews` of a rival network in AI code. `Intel` is a per-tick cache; never store it in state.
- Each layer has a switch at `tuning.ai.layers`. Mechanics tests turn the AI off (`calm`, `certain`, `noAi`, `quiet()` in `tests/helpers.ts`); AI tests turn on only the layer under test.
- `isAi(state, id)` decides who the AI commands; it includes the player when `state.autoplay` is on (the balance runner uses this).
- After changing AI behavior or tuning, run `npm run balance` (use `RUNS=80` for a decision; 40 runs swing by ±10 points) and keep `checkInvariants` at 0 problems.
- The shadow layer (`ai/shadow.ts`) is the AI's dealings with the State, messages, and schemes; AI answers to events run inside the event system. Both have layer switches (`shadow`, `events`).
- A captured or jailed head does not stop the war: `actingHead` hands the strategic plan to the most senior free member the AI plays.

## Events, the State, and information warfare

- Every event instance has a scope (plaza, region, faction, or character), a decider (who picks and bears personal effects), and an optional other character (the target of opinion, kill, promote, and release effects). The header of `systems/events.ts` says who decides what.
- Systems fire events by id through `fireById`. Any id a system fires must be listed in `SYSTEM_EVENT_IDS` (`data/content.ts`) and marked `fired_by_system` in its file.
- A new effect or condition key needs the schema key (closed vocabulary), handling in `applyEffects` or `check`, and a line in `describeEffects` for the popup's preview.
- Mechanics tests switch the random world off with `noWorld` (events, State forces, schemes); `calm`, `certain`, and `quiet()` already include it.
- Planted rumors are ordinary `Report`s with `planted: true` and a ghost crew id (`ghost_…`) that is not in `state.crews`. UI and AI code must not assume a report's crew exists.
- Army units are not on the map: fights with the State resolve at once in `militaryClash`.

## Intelligence as estimates

- Every `Report` carries `men` (most likely) plus `low`/`high`. Make sightings with `sample`/`around` from `estimate.ts`; never file a bare number.
- Read rivals through `knowledge.ts` (`beliefs`, `lastSeen`, `crewEstimate`, `plazaIntel`): they combine every report on a crew (overlap of ranges) and widen them with age. Show ranges with `fmtRange`/`shortRange`.
- Informants and drones over towns live in `intel.ts` and file ordinary reports (`source: 'informant'` or `'drone'`). An informant or a presence report means the whole garrison was in view.
- AI plans against most likely plus `ai.strategic.rangeCaution` of the way to the top of the range.

## Coalition warfare

- Joint operations (`operations.ts`) and pacts (`pacts.ts`) are proposed and answered through commands; the AI side is `ai/coalition.ts` (layer `coalition`). Refusing costs nothing; agreeing and not showing up is remembered.
- Spoils: `plazaRecipient` in combat gives a captured plaza by the operation's agreed rule, else by contribution (men who fought + `contributionLossWeight` × losses, from `BattleSide.ownerMen`/`ownerLosses`).

## Recruitment and outside cartels

- Pay goes through `crewPayPerWeek` (`forces.ts`): tier multiplier, mercenary multiplier, or a contingent's fixed `hired.weekly`. Tier names come from `tuning.forces.skillNames`/`gearNames` via `tierLabel`.
- `CrewState.hired` marks troops who are not the owner's own: mercenaries leave the week pay is missed; contingents (`kind: 'contingent'`, `from` a cartel) have loyalty, can be recalled, may defect, go home if their boss dies, and never count toward score.
- CJNG and CdG are `kind: 'outside'` factions (`outside.ts`). Their boss characters carry `outsider` set to their cartel. While associated (after being handed a plaza) the boss sits in the partner faction, so his plazas count for that side; he is never a lieutenant there. Every faction-member loop (succession, acting head, offensives, requests, events, invites) must skip `outsider !== null`; `isAi` already does.
- Only the player and faction heads deal with them (`dealerBlocked`). Contact: a port, a border road, or an envoy.

## Capture, remnants, and the countryside

- Leaders of losing crews roll `captureChance` (`capture.ts`): force ratio, encirclement (`Battle.approaches`, from `CrewTransit.lastRoad`), rank, traits, terrain, and how the crew left. The captor decides with the `captive` command; AI captors choose by personality in `runCaptivesDaily`.
- A boss who loses his last plaza chooses in `remnants.ts` (AI by traits; the player from the Shadows tab). The player is never eliminated for losing plazas; `flee` ends the game as `player_fled`. Gone characters are `isGone(status)` (dead, extradited, fled).
- `state.countryside[node][network]` is 0–100 influence in a plaza's hills (`countryside.ts`). Crews with order `camp` are in the hills: they stay out of town fights, presence sightings, informants, and drones over town; they fight `sweep` battles with the terrain. The hills count toward `territoryShares` at `countryside.shareWeight`.
