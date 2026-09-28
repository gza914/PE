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

## AI conventions

- The AI (`src/sim/ai`) acts only by returning `Command`s, the same ones the player issues. It never writes to state directly, except its own planning records (`warPlan`, `offensives`, `requests`).
- AI plans from `Intel` (`ai/intel.ts`), which reads only the planning network's reports, plus typical-garrison priors where it has none. Never read `state.crews` of a rival network in AI code. `Intel` is a per-tick cache; never store it in state.
- Each layer has a switch at `tuning.ai.layers`. Mechanics tests turn the AI off (`calm`, `certain`, `noAi`, `quiet()` in `tests/helpers.ts`); AI tests turn on only the layer under test.
- `isAi(state, id)` decides who the AI commands; it includes the player when `state.autoplay` is on (the balance runner uses this).
- After changing AI behavior or tuning, run `npm run balance` (use `RUNS=80` for a decision; 40 runs swing by ±10 points) and keep `checkInvariants` at 0 problems.
