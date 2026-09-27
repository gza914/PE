# Cartel Conquest

A single-player, real-time-with-pause grand strategy game set in a Sinaloa
cartel civil war, built as a browser game in TypeScript. The full design is in
[docs/GDD.md](docs/GDD.md).

**Status:** scaffold only. The project structure, data schemas, content
loader, deterministic sim loop, save/load, and a bare UI shell are in place.
No gameplay systems are implemented yet.

## Commands

```sh
npm install
npm run dev        # dev server at http://localhost:5173
npm test           # Vitest: content validation, determinism, save/load, headless run
npm run typecheck
npm run build
```

In game: `Space` pauses, `1`–`5` set speed.

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
  systems/           movement, detection, combat, economy, ... (stubs)
src/ui/              React + Zustand shell, SVG maps
tests/               Vitest unit tests and headless campaign runs
```

## Placeholder content

`map.json`, `roads.json`, `colonias.json`, `characters.json`, and
`messages.json` hold placeholder data so the pipeline runs end to end. They
are marked with a `_comment` field and are waiting on the real content (see
"Open questions" in the GDD).
