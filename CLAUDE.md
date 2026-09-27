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
